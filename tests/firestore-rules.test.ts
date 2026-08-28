import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, assertSucceeds, assertFails, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";

let testEnv: RulesTestEnvironment;

describe("firestore.rules", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-rules-test",
      firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") },
    });
    await testEnv.clearFirestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("users").doc("uid-admin").set({ role: "admin_cabang", branch: "WHO", name: "Budi Santoso" });
      await db.collection("users").doc("uid-snd").set({ role: "snd", branch: "SND", name: "Dewi Lestari" });
      await db.collection("users").doc("uid-spv").set({ role: "spv", branch: "WHO", name: "Siti Aminah" });
      await db.collection("users").doc("uid-spv2").set({ role: "spv", branch: "WHO", name: "Rudi Hartono" });
      await db.collection("submissions").doc("sub-1").set({ requesterId: "uid-admin", status: "diajukan" });
      await db.collection("submissions").doc("sub-1").collection("items").doc("item-1").set({
        itemName: "Toyota Avanza",
        quantity: 1,
      });
      await db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").set({
        fileUrl: "https://drive.google.com/file/d/abc/view",
        fileName: "nota.png",
        fileType: "image/png",
      });
    });
  });

  afterAll(() => testEnv?.cleanup());

  it("denies unauthenticated read of a submission", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.collection("submissions").doc("sub-1").get());
  });

  it("allows the owner to read their own submission", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertSucceeds(db.collection("submissions").doc("sub-1").get());
  });

  it("allows spv to read any submission", async () => {
    const db = testEnv.authenticatedContext("uid-spv").firestore();
    await assertSucceeds(db.collection("submissions").doc("sub-1").get());
  });

  it("denies a non-owner, non-reviewer read", async () => {
    const db = testEnv.authenticatedContext("uid-snd").firestore();
    await assertFails(db.collection("submissions").doc("sub-1").get());
  });

  it("denies an unauthorized direct status change", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(db.collection("submissions").doc("sub-1").update({ status: "disetujui" }));
  });

  describe("submissions create rule", () => {
    it("allows an admin_cabang/snd user to create a submission as themselves in status diajukan", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-new").set({ requesterId: "uid-admin", status: "diajukan" })
      );
    });

    it("denies create when the caller's role is not admin_cabang/snd", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-new").set({ requesterId: "uid-spv", status: "diajukan" })
      );
    });

    it("denies create when requesterId does not match the caller", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-new").set({ requesterId: "uid-snd", status: "diajukan" })
      );
    });

    it("denies create when status is not diajukan", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-new").set({ requesterId: "uid-admin", status: "disetujui" })
      );
    });
  });

  describe("submissions update rule — status transitions", () => {
    it("allows the owner to resubmit after perlu_revisi", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-revisi").set({
          requesterId: "uid-admin",
          status: "perlu_revisi",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-revisi").update({ status: "diajukan", rejectionNote: null })
      );
    });

    it("denies a non-owner from resubmitting", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-revisi2").set({
          requesterId: "uid-admin",
          status: "perlu_revisi",
        });
      });
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-revisi2").update({ status: "diajukan", rejectionNote: null })
      );
    });

    it("allows spv to approve a diajukan submission with approverSignatureUrl", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-spv",
          approverRole: "spv",
          approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig",
          approverName: "Siti Aminah",
        })
      );
    });

    it("allows spv to approve while also setting approverName", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-spv",
          approverRole: "spv",
          approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig",
          approverName: "Siti Aminah",
        })
      );
    });

    it("denies approve when approverName doesn't match the caller's real name", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-spv",
          approverRole: "spv",
          approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig",
          approverName: "Someone Else",
        })
      );
    });

    it("denies approve without approverSignatureUrl", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-spv",
          approverRole: "spv",
          approverSignatureUrl: "",
        })
      );
    });

    it("denies approve when approverRole doesn't match the caller's real role", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-spv",
          approverRole: "management",
          approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig",
        })
      );
    });

    it("allows spv to reject a diajukan submission with rejectionNote", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").update({
          status: "perlu_revisi",
          rejectionNote: "KM tidak sesuai",
        })
      );
    });

    it("denies reject without rejectionNote", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "perlu_revisi",
          rejectionNote: "",
        })
      );
    });

    it("denies a non-reviewer from approving", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-admin",
          approverRole: "admin_cabang",
          approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig",
        })
      );
    });

    it("allows the owner to confirm sent to GA when siap_dikirim", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-siap").set({
          requesterId: "uid-admin",
          status: "siap_dikirim",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("submissions").doc("sub-siap").update({ status: "on_proses_ga" }));
    });

    it("denies confirming sent to GA by a non-owner", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-siap2").set({
          requesterId: "uid-admin",
          status: "siap_dikirim",
        });
      });
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(db.collection("submissions").doc("sub-siap2").update({ status: "on_proses_ga" }));
    });

    it("allows the owner to mark as done when on_proses_ga", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-proses").set({
          requesterId: "uid-admin",
          status: "on_proses_ga",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("submissions").doc("sub-proses").update({ status: "selesai" }));
    });

    it("denies marking as done from a status other than on_proses_ga", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(db.collection("submissions").doc("sub-1").update({ status: "selesai" }));
    });

    it("denies resubmit that also reassigns requesterId to someone else", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-revisi3").set({
          requesterId: "uid-admin",
          status: "perlu_revisi",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-revisi3").update({
          status: "diajukan",
          rejectionNote: null,
          requesterId: "uid-snd",
        })
      );
    });

    it("denies approve that also reassigns requesterId to someone else", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-spv",
          approverRole: "spv",
          approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig",
          requesterId: "uid-snd",
        })
      );
    });

    it("denies approve that also modifies requesterSignatureUrl", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").update({
          status: "disetujui",
          approverId: "uid-spv",
          approverRole: "spv",
          approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig",
          requesterSignatureUrl: "https://drive.google.com/uc?export=view&id=tampered",
        })
      );
    });

    it("denies resubmit that also modifies submissionNumber", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-revisi4").set({
          requesterId: "uid-admin",
          status: "perlu_revisi",
          submissionNumber: "001/WHO/VIII/2026",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-revisi4").update({
          status: "diajukan",
          rejectionNote: null,
          submissionNumber: "999/WHO/VIII/2026",
        })
      );
    });

    it("denies confirming sent to GA that also modifies branch", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-siap3").set({
          requesterId: "uid-admin",
          status: "siap_dikirim",
          branch: "WHO",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-siap3").update({
          status: "on_proses_ga",
          branch: "WHP",
        })
      );
    });
  });

  describe("submissions update rule — disetujui to siap_dikirim (PDF generation)", () => {
    it("allows the approver to advance to siap_dikirim with a pdfUrl", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-disetujui").update({
          status: "siap_dikirim",
          pdfUrl: "https://drive.google.com/file/d/pdf-1/view",
        })
      );
    });

    it("allows the requester to advance to siap_dikirim with a pdfUrl (retry path)", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui2").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-disetujui2").update({
          status: "siap_dikirim",
          pdfUrl: "https://drive.google.com/file/d/pdf-2/view",
        })
      );
    });

    it("denies an unrelated user from advancing to siap_dikirim", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui3").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-disetujui3").update({
          status: "siap_dikirim",
          pdfUrl: "https://drive.google.com/file/d/pdf-3/view",
        })
      );
    });

    it("denies a different spv/management user (not the recorded approver) from advancing to siap_dikirim", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui6").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv2").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-disetujui6").update({
          status: "siap_dikirim",
          pdfUrl: "https://drive.google.com/file/d/pdf-6/view",
        })
      );
    });

    it("denies advancing to siap_dikirim with a non-Drive pdfUrl", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui7").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-disetujui7").update({
          status: "siap_dikirim",
          pdfUrl: "javascript:alert(1)",
        })
      );
    });

    it("denies advancing to siap_dikirim without a pdfUrl", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui4").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-disetujui4").update({
          status: "siap_dikirim",
          pdfUrl: "",
        })
      );
    });

    it("denies advancing to siap_dikirim while also modifying an unrelated field", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-disetujui5").set({
          requesterId: "uid-admin",
          approverId: "uid-spv",
          status: "disetujui",
          branch: "WHO",
        });
      });
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-disetujui5").update({
          status: "siap_dikirim",
          pdfUrl: "https://drive.google.com/file/d/pdf-5/view",
          branch: "WHP",
        })
      );
    });
  });

  describe("statusHistory create rule", () => {
    it("allows creating a statusHistory entry with a matching actorId/actorRole", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").collection("statusHistory").doc("h-ok").set({
          status: "diajukan",
          note: null,
          actorId: "uid-admin",
          actorRole: "admin_cabang",
        })
      );
    });

    it("denies creating a statusHistory entry with a forged actorRole", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("statusHistory").doc("h-forged").set({
          status: "diajukan",
          note: null,
          actorId: "uid-admin",
          actorRole: "superadmin",
        })
      );
    });

    it("denies creating a statusHistory entry with a forged actorId", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("statusHistory").doc("h-forged2").set({
          status: "diajukan",
          note: null,
          actorId: "uid-snd",
          actorRole: "admin_cabang",
        })
      );
    });

    it("denies a non-owner, non-reviewer from creating a statusHistory entry under someone else's submission", async () => {
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("statusHistory").doc("h-outsider").set({
          status: "diajukan",
          note: null,
          actorId: "uid-snd",
          actorRole: "snd",
        })
      );
    });
  });

  describe("users rule", () => {
    it("allows the owner to read their own user document", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("users").doc("uid-admin").get());
    });

    it("allows a reviewer to read someone else's user document", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(db.collection("users").doc("uid-admin").get());
    });

    it("denies a non-owner, non-reviewer from reading someone else's user document", async () => {
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(db.collection("users").doc("uid-admin").get());
    });

    it("denies any client write to a user document", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(db.collection("users").doc("uid-admin").update({ role: "superadmin" }));
    });
  });

  describe("users write rule", () => {
    it("allows superadmin to create a new user", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(
        db.collection("users").doc("uid-new").set({
          name: "User Baru",
          username: "user.baru",
          role: "admin_cabang",
          branch: "WHO",
          department: "Operasional",
          position: "Admin Cabang",
          email: null,
        })
      );
    });

    it("allows superadmin to update an existing user", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(
        db.collection("users").doc("uid-admin").update({
          name: "Budi Santoso Updated",
          role: "admin_cabang",
          branch: "WHP",
          department: "Operasional",
          position: "Admin Cabang",
          email: null,
        })
      );
    });

    it("allows superadmin to update their own user document", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertSucceeds(
        db.collection("users").doc("uid-super").update({
          name: "Admin Utama Updated",
          role: "superadmin",
          branch: null,
          department: "Manajemen",
          position: "Superadmin",
          email: null,
        })
      );
    });

    it("denies a non-superadmin from creating a user", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(
        db.collection("users").doc("uid-new2").set({
          name: "User Baru",
          username: "user.baru2",
          role: "admin_cabang",
          branch: "WHO",
          department: "Operasional",
          position: "Admin Cabang",
          email: null,
        })
      );
    });

    it("denies creating a user with an invalid role value", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertFails(
        db.collection("users").doc("uid-new3").set({
          name: "User Baru",
          username: "user.baru3",
          role: "not_a_real_role",
          branch: null,
          department: "Operasional",
          position: "Staff",
          email: null,
        })
      );
    });

    it("denies any client from deleting a user", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("users").doc("uid-super").set({
          role: "superadmin",
          branch: null,
          name: "Admin Utama",
        });
      });
      const db = testEnv.authenticatedContext("uid-super").firestore();
      await assertFails(db.collection("users").doc("uid-admin").delete());
    });
  });

  describe("items subcollection rule", () => {
    it("allows the owner to read an item under their own submission", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("submissions").doc("sub-1").collection("items").doc("item-1").get());
    });

    it("allows a reviewer to read an item under any submission", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(db.collection("submissions").doc("sub-1").collection("items").doc("item-1").get());
    });

    it("denies a non-owner, non-reviewer from reading an item", async () => {
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(db.collection("submissions").doc("sub-1").collection("items").doc("item-1").get());
    });

    it("denies direct client update of an item", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("items").doc("item-1").update({ quantity: 2 })
      );
    });

    it("allows the owner to create an item while status is diajukan", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").collection("items").doc("item-new").set({
          itemName: "Kertas A4",
          quantity: 5,
        })
      );
    });

    it("allows the owner to delete an item while status is diajukan", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("submissions").doc("sub-1").collection("items").doc("item-1").delete());
    });

    it("denies a non-owner from creating an item", async () => {
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("items").doc("item-new2").set({
          itemName: "Kertas A4",
          quantity: 5,
        })
      );
    });

    it("denies creating an item once the submission is no longer editable", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("submissions").doc("sub-approved").set({
          requesterId: "uid-admin",
          status: "disetujui",
        });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-approved").collection("items").doc("item-new3").set({
          itemName: "Kertas A4",
          quantity: 5,
        })
      );
    });
  });

  describe("attachments subcollection rule", () => {
    it("allows the owner to read an attachment under their own submission", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").get()
      );
    });

    it("allows a reviewer to read an attachment under any submission", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertSucceeds(
        db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").get()
      );
    });

    it("denies a non-owner, non-reviewer from reading an attachment", async () => {
      const db = testEnv.authenticatedContext("uid-snd").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").get()
      );
    });

    it("denies direct client update of an attachment", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").update({ fileName: "hacked.png" })
      );
    });
  });

  describe("counters rule", () => {
    it("allows an admin_cabang/snd user to create a new counter at 1", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("counters").doc("WHO-2026-09").set({ lastNumber: 1 }));
    });

    it("denies creating a new counter at a value other than 1", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(db.collection("counters").doc("WHO-2026-10").set({ lastNumber: 2 }));
    });

    it("allows incrementing an existing counter by exactly 1", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("counters").doc("WHO-2026-08").set({ lastNumber: 1 });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertSucceeds(db.collection("counters").doc("WHO-2026-08").update({ lastNumber: 2 }));
    });

    it("denies incrementing a counter by more than 1", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection("counters").doc("WHO-2026-08").set({ lastNumber: 1 });
      });
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(db.collection("counters").doc("WHO-2026-08").update({ lastNumber: 5 }));
    });

    it("denies a reviewer role from writing counters", async () => {
      const db = testEnv.authenticatedContext("uid-spv").firestore();
      await assertFails(db.collection("counters").doc("WHO-2026-11").set({ lastNumber: 1 }));
    });
  });
});
