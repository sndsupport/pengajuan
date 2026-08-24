import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-done-test";

const fft = functionsTest({ projectId: "demo-pengajuan-done-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({ name: "T", email: "t@x.com", role, branch: "WHO", department: "Ops", position: "Staff", createdAt: new Date() });
}

async function seedSubmission(id: string, status: string, requesterId = "uid-requester") {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("submissions").doc(id).set({
    submissionNumber: "L.001/TSI-OPR/WHO/VIII/2026",
    status,
    requesterId,
    branch: "WHO",
  });
}

describe("markAsDoneHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-done-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => fft.cleanup());

  it("rejects when caller is not authenticated", async () => {
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(markAsDoneHandler({ submissionId: "sub-1" }, { auth: undefined })).rejects.toThrow(HttpsError);
  });

  it("rejects when caller isn't the submission's requester, even if superadmin", async () => {
    await seedUser("uid-superadmin", "superadmin");
    await seedSubmission("sub-2", "on_proses_ga");
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(
      markAsDoneHandler({ submissionId: "sub-2" }, { auth: { uid: "uid-superadmin" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when status isn't on_proses_ga", async () => {
    await seedUser("uid-requester", "admin_cabang");
    await seedSubmission("sub-3", "siap_dikirim");
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(
      markAsDoneHandler({ submissionId: "sub-3" }, { auth: { uid: "uid-requester" } } as any)
    ).rejects.toThrow(/on_proses_ga/);
  });

  it("sets status selesai and completedAt when the requester marks it done", async () => {
    await seedUser("uid-requester", "admin_cabang");
    await seedSubmission("sub-4", "on_proses_ga");
    const { markAsDoneHandler } = await import("./markAsDone");
    await markAsDoneHandler({ submissionId: "sub-4" }, { auth: { uid: "uid-requester" } } as any);

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-4").get();
    expect(updated.data()!.status).toBe("selesai");
    expect(updated.data()!.completedAt).toBeTruthy();

    const history = await admin.collection("submissions").doc("sub-4").collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "selesai" && d.data().actorId === "uid-requester")).toBe(
      true
    );
  });
});
