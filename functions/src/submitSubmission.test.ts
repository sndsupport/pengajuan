import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

// Point the Admin SDK (used internally by submitSubmission.ts via ./admin) at the
// local Firestore emulator instead of production. Must be set before "./submitSubmission"
// (and transitively "./admin") is ever imported, since getFirestore() reads this at init time.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-submit-test";

const fft = functionsTest({ projectId: "demo-pengajuan-submit-test" }, undefined);
let testEnv: RulesTestEnvironment;

// resubmitAfterRevisi does best-effort Drive cleanup of removed attachments;
// mock it so tests don't make real network calls and so we can assert on it.
const deleteFromDriveMock = vi.fn();
vi.mock("./googleDrive", () => ({
  deleteFromDrive: deleteFromDriveMock,
}));

async function seedUser(uid: string, role: string, branch: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name: "Test User",
    email: `${uid}@example.com`,
    role,
    branch,
    department: "Operasional",
    position: "Staff",
    createdAt: new Date(),
  });
}

describe("submitSubmissionHandler (create)", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-submit-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
    deleteFromDriveMock.mockReset();
    deleteFromDriveMock.mockResolvedValue(undefined);
  });

  afterAll(() => fft.cleanup());

  const validItems = [
    { itemName: "Toyota Avanza", brandType: "Toyota Avanza 1.3", km: 45000, quantity: 1, unit: "unit", description: "Service" },
  ];

  it("rejects when caller is not authenticated", async () => {
    const { submitSubmissionHandler } = await import("./submitSubmission");
    await expect(
      submitSubmissionHandler(
        { type: "kendaraan", subType: "service_berkala", requesterSignatureUrl: "https://x/y.png", items: validItems },
        { auth: undefined } as any
      )
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when caller role is not admin_cabang/snd", async () => {
    await seedUser("uid-spv", "spv", "WHO");
    const { submitSubmissionHandler } = await import("./submitSubmission");
    await expect(
      submitSubmissionHandler(
        { type: "kendaraan", subType: "service_berkala", requesterSignatureUrl: "https://x/y.png", items: validItems },
        { auth: { uid: "uid-spv" } } as any
      )
    ).rejects.toThrow(HttpsError);
  });

  it("creates a new submission with generated number and statusHistory entry", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const { submitSubmissionHandler } = await import("./submitSubmission");
    const result = await submitSubmissionHandler(
      { type: "kendaraan", subType: "service_berkala", requesterSignatureUrl: "https://x/y.png", items: validItems },
      { auth: { uid: "uid-admin" } } as any
    );

    expect(result.submissionNumber).toMatch(/^L\.001\/TSI-OPR\/WHO\/[IVX]+\/\d{4}$/);
    expect(result.status).toBe("diajukan");
  });

  it("writes attachments to the attachments subcollection when creating a new submission", async () => {
    await seedUser("uid-admin2", "admin_cabang", "WHO");
    const { submitSubmissionHandler } = await import("./submitSubmission");
    const result = await submitSubmissionHandler(
      {
        type: "kendaraan",
        subType: "service_berkala",
        requesterSignatureUrl: "https://x/y.png",
        items: validItems,
        attachments: [
          { fileId: "file-abc", fileUrl: "https://drive.google.com/file/d/abc/view", fileName: "nota.png", fileType: "image/png" },
        ],
      },
      { auth: { uid: "uid-admin2" } } as any
    );

    const admin = testEnv.unauthenticatedContext().firestore();
    const attachments = await admin
      .collection("submissions")
      .doc(result.submissionId)
      .collection("attachments")
      .get();
    expect(attachments.docs).toHaveLength(1);
    expect(attachments.docs[0].data().fileName).toBe("nota.png");
  });
});

describe("submitSubmissionHandler (resubmit after revisi)", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-submit-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
    deleteFromDriveMock.mockReset();
    deleteFromDriveMock.mockResolvedValue(undefined);
  });

  it("rejects resubmit when status is not perlu_revisi", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const admin = testEnv.unauthenticatedContext().firestore();
    const subRef = admin.collection("submissions").doc("sub-1");
    await subRef.set({
      submissionNumber: "001/WHO/VIII/2026",
      status: "diajukan",
      requesterId: "uid-admin",
      branch: "WHO",
    });

    const { submitSubmissionHandler } = await import("./submitSubmission");
    await expect(
      submitSubmissionHandler(
        {
          submissionId: "sub-1",
          type: "kendaraan",
          subType: "service_berkala",
          requesterSignatureUrl: "https://x/y.png",
          items: [{ itemName: "X", brandType: "X", km: 1000, quantity: 1, unit: "unit", description: "" }],
        },
        { auth: { uid: "uid-admin" } } as any
      )
    ).rejects.toThrow(/perlu_revisi/);
  });

  it("resubmits, keeps the same submissionNumber, and replaces items", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const admin = testEnv.unauthenticatedContext().firestore();
    const subRef = admin.collection("submissions").doc("sub-2");
    await subRef.set({
      submissionNumber: "002/WHO/VIII/2026",
      status: "perlu_revisi",
      requesterId: "uid-admin",
      branch: "WHO",
      rejectionNote: "KM salah",
    });
    await subRef.collection("items").doc("old-item").set({ itemName: "Old", brandType: "Old", km: 1, quantity: 1, unit: "unit", description: "" });

    const { submitSubmissionHandler } = await import("./submitSubmission");
    const result = await submitSubmissionHandler(
      {
        submissionId: "sub-2",
        type: "kendaraan",
        subType: "service_berkala",
        requesterSignatureUrl: "https://x/new.png",
        items: [{ itemName: "Fixed", brandType: "Fixed", km: 45000, quantity: 1, unit: "unit", description: "" }],
      },
      { auth: { uid: "uid-admin" } } as any
    );

    expect(result.submissionNumber).toBe("002/WHO/VIII/2026");
    expect(result.status).toBe("diajukan");

    const updated = await subRef.get();
    expect(updated.data()!.rejectionNote).toBeNull();

    const items = await subRef.collection("items").get();
    expect(items.docs).toHaveLength(1);
    expect(items.docs[0].data().itemName).toBe("Fixed");
  });

  it("replaces attachments on resubmit", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const admin = testEnv.unauthenticatedContext().firestore();
    const subRef = admin.collection("submissions").doc("sub-3");
    await subRef.set({
      submissionNumber: "003/WHO/VIII/2026",
      status: "perlu_revisi",
      requesterId: "uid-admin",
      branch: "WHO",
      rejectionNote: "Lampiran kurang jelas",
    });
    await subRef.collection("items").doc("old-item").set({ itemName: "Old", brandType: "Old", km: 1, quantity: 1, unit: "unit", description: "" });
    await subRef.collection("attachments").doc("old-attachment").set({ fileId: "file-old", fileUrl: "https://drive.google.com/file/d/old/view", fileName: "lama.png", fileType: "image/png" });

    const { submitSubmissionHandler } = await import("./submitSubmission");
    await submitSubmissionHandler(
      {
        submissionId: "sub-3",
        type: "kendaraan",
        subType: "service_berkala",
        requesterSignatureUrl: "https://x/new.png",
        items: [{ itemName: "Fixed", brandType: "Fixed", km: 45000, quantity: 1, unit: "unit", description: "" }],
        attachments: [
          { fileId: "file-new", fileUrl: "https://drive.google.com/file/d/new/view", fileName: "baru.png", fileType: "image/png" },
        ],
      },
      { auth: { uid: "uid-admin" } } as any
    );

    const attachments = await subRef.collection("attachments").get();
    expect(attachments.docs).toHaveLength(1);
    expect(attachments.docs[0].data().fileName).toBe("baru.png");
    expect(deleteFromDriveMock).toHaveBeenCalledWith("file-old");
    expect(deleteFromDriveMock).not.toHaveBeenCalledWith("file-new");
  });

  it("removes all attachments on resubmit when the payload has none", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const admin = testEnv.unauthenticatedContext().firestore();
    const subRef = admin.collection("submissions").doc("sub-4");
    await subRef.set({
      submissionNumber: "004/WHO/VIII/2026",
      status: "perlu_revisi",
      requesterId: "uid-admin",
      branch: "WHO",
      rejectionNote: "Tidak perlu lampiran",
    });
    await subRef.collection("items").doc("old-item").set({ itemName: "Old", brandType: "Old", km: 1, quantity: 1, unit: "unit", description: "" });
    await subRef.collection("attachments").doc("old-attachment").set({ fileId: "file-old", fileUrl: "https://drive.google.com/file/d/old/view", fileName: "lama.png", fileType: "image/png" });

    const { submitSubmissionHandler } = await import("./submitSubmission");
    await submitSubmissionHandler(
      {
        submissionId: "sub-4",
        type: "kendaraan",
        subType: "service_berkala",
        requesterSignatureUrl: "https://x/new.png",
        items: [{ itemName: "Fixed", brandType: "Fixed", km: 45000, quantity: 1, unit: "unit", description: "" }],
      },
      { auth: { uid: "uid-admin" } } as any
    );

    const attachments = await subRef.collection("attachments").get();
    expect(attachments.docs).toHaveLength(0);
    expect(deleteFromDriveMock).toHaveBeenCalledWith("file-old");
  });

  it("does not delete Drive files that are unchanged (kept) across resubmit", async () => {
    await seedUser("uid-admin", "admin_cabang", "WHO");
    const admin = testEnv.unauthenticatedContext().firestore();
    const subRef = admin.collection("submissions").doc("sub-5");
    await subRef.set({
      submissionNumber: "005/WHO/VIII/2026",
      status: "perlu_revisi",
      requesterId: "uid-admin",
      branch: "WHO",
      rejectionNote: "Perbaiki item",
    });
    await subRef.collection("items").doc("old-item").set({ itemName: "Old", brandType: "Old", km: 1, quantity: 1, unit: "unit", description: "" });
    await subRef.collection("attachments").doc("kept-attachment").set({ fileId: "file-kept", fileUrl: "https://drive.google.com/file/d/kept/view", fileName: "kept.png", fileType: "image/png" });

    const { submitSubmissionHandler } = await import("./submitSubmission");
    await submitSubmissionHandler(
      {
        submissionId: "sub-5",
        type: "kendaraan",
        subType: "service_berkala",
        requesterSignatureUrl: "https://x/new.png",
        items: [{ itemName: "Fixed", brandType: "Fixed", km: 45000, quantity: 1, unit: "unit", description: "" }],
        attachments: [
          { fileId: "file-kept", fileUrl: "https://drive.google.com/file/d/kept/view", fileName: "kept.png", fileType: "image/png" },
        ],
      },
      { auth: { uid: "uid-admin" } } as any
    );

    expect(deleteFromDriveMock).not.toHaveBeenCalled();
  });
});
