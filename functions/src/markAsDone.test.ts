import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-markdone-test";

const fft = functionsTest({ projectId: "demo-pengajuan-markdone-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name: "T",
    username: uid,
    role,
    branch: "WHO",
    department: "Ops",
    position: "Staff",
    createdAt: new Date(),
  });
}

async function seedSubmission(id: string, status: string, requesterId: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("submissions").doc(id).set({
    submissionNumber: "001/WHO/VIII/2026",
    status,
    requesterId,
    branch: "WHO",
  });
}

describe("markAsDoneHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-markdone-test",
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
    await expect(
      markAsDoneHandler({ submissionId: "sub-1" }, { auth: undefined })
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when caller is not the requester", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedUser("uid-other", "admin_cabang");
    await seedSubmission("sub-1", "on_proses_ga", "uid-admin");
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(
      markAsDoneHandler({ submissionId: "sub-1" }, { auth: { uid: "uid-other" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when status isn't on_proses_ga", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedSubmission("sub-2", "siap_dikirim", "uid-admin");
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(
      markAsDoneHandler({ submissionId: "sub-2" }, { auth: { uid: "uid-admin" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("marks done and sets status/completedAt/statusHistory", async () => {
    await seedUser("uid-admin", "admin_cabang");
    await seedSubmission("sub-3", "on_proses_ga", "uid-admin");
    const { markAsDoneHandler } = await import("./markAsDone");
    const result = await markAsDoneHandler({ submissionId: "sub-3" }, { auth: { uid: "uid-admin" } } as any);
    expect(result.status).toBe("selesai");

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-3").get();
    expect(updated.data()!.status).toBe("selesai");
    expect(updated.data()!.completedAt).toBeTruthy();

    const history = await admin.collection("submissions").doc("sub-3").collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "selesai" && d.data().actorId === "uid-admin")).toBe(true);
  });

  it("rejects an empty submissionId", async () => {
    await seedUser("uid-admin", "admin_cabang");
    const { markAsDoneHandler } = await import("./markAsDone");
    await expect(
      markAsDoneHandler({ submissionId: "" }, { auth: { uid: "uid-admin" } } as any)
    ).rejects.toThrow(HttpsError);
  });
});
