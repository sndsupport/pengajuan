import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

// Point the Admin SDK (used internally by reviewSubmission.ts via ./admin) at the
// local Firestore emulator instead of production. Must be set before "./reviewSubmission"
// (and transitively "./admin") is ever imported, since getFirestore() reads this at init time.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-review-test";

const fft = functionsTest({ projectId: "demo-pengajuan-review-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({ name: "T", email: "t@x.com", role, branch: "WHO", department: "Ops", position: "Staff", createdAt: new Date() });
}

async function seedSubmission(id: string, status: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("submissions").doc(id).set({
    submissionNumber: "001/WHO/VIII/2026",
    status,
    requesterId: "uid-requester",
    branch: "WHO",
  });
}

describe("reviewSubmissionHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-review-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => fft.cleanup());

  it("rejects when caller role is not spv/management", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedSubmission("sub-1", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await expect(
      reviewSubmissionHandler({ submissionId: "sub-1", decision: "approve" }, { auth: { uid: "uid-admin" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects reviewing a submission that isn't in diajukan", async () => {
    await seedUser("uid-spv", "spv");
    await seedSubmission("sub-2", "disetujui");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await expect(
      reviewSubmissionHandler(
        { submissionId: "sub-2", decision: "approve", approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig" },
        { auth: { uid: "uid-spv" } } as any
      )
    ).rejects.toThrow(/diajukan/);
  });

  it("approves and sets approverId/approverRole/status/approverSignatureUrl", async () => {
    await seedUser("uid-spv", "spv");
    await seedSubmission("sub-3", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await reviewSubmissionHandler(
      { submissionId: "sub-3", decision: "approve", approverSignatureUrl: "https://drive.google.com/uc?export=view&id=sig" },
      { auth: { uid: "uid-spv" } } as any
    );

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-3").get();
    expect(updated.data()!.status).toBe("disetujui");
    expect(updated.data()!.approverId).toBe("uid-spv");
    expect(updated.data()!.approverRole).toBe("spv");
    expect(updated.data()!.approverSignatureUrl).toBe("https://drive.google.com/uc?export=view&id=sig");
  });

  it("rejects approve without approverSignatureUrl", async () => {
    await seedUser("uid-spv", "spv");
    await seedSubmission("sub-6", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await expect(
      reviewSubmissionHandler({ submissionId: "sub-6", decision: "approve" }, { auth: { uid: "uid-spv" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects without rejectionNote", async () => {
    await seedUser("uid-mgmt", "management");
    await seedSubmission("sub-4", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await expect(
      reviewSubmissionHandler({ submissionId: "sub-4", decision: "reject" }, { auth: { uid: "uid-mgmt" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects with rejectionNote and sets status perlu_revisi", async () => {
    await seedUser("uid-mgmt", "management");
    await seedSubmission("sub-5", "diajukan");
    const { reviewSubmissionHandler } = await import("./reviewSubmission");
    await reviewSubmissionHandler(
      { submissionId: "sub-5", decision: "reject", rejectionNote: "KM tidak sesuai" },
      { auth: { uid: "uid-mgmt" } } as any
    );

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-5").get();
    expect(updated.data()!.status).toBe("perlu_revisi");
    expect(updated.data()!.rejectionNote).toBe("KM tidak sesuai");
  });
});
