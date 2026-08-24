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
      await db.collection("users").doc("uid-admin").set({ role: "admin_cabang", branch: "WHO" });
      await db.collection("users").doc("uid-snd").set({ role: "snd", branch: "SND" });
      await db.collection("users").doc("uid-spv").set({ role: "spv", branch: "WHO" });
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

  it("denies direct client update of submission status", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(db.collection("submissions").doc("sub-1").update({ status: "disetujui" }));
  });

  it("denies direct client write to statusHistory", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(
      db.collection("submissions").doc("sub-1").collection("statusHistory").doc("h1").set({ status: "diajukan" })
    );
  });

  it("denies direct client write to counters", async () => {
    const db = testEnv.authenticatedContext("uid-admin").firestore();
    await assertFails(db.collection("counters").doc("WHO-2026-08").set({ lastNumber: 1 }));
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

    it("denies direct client write to an item", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("items").doc("item-1").update({ quantity: 2 })
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

    it("denies direct client write to an attachment", async () => {
      const db = testEnv.authenticatedContext("uid-admin").firestore();
      await assertFails(
        db.collection("submissions").doc("sub-1").collection("attachments").doc("attachment-1").update({ fileName: "hacked.png" })
      );
    });
  });
});
