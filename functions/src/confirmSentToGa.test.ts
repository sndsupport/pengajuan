import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-confirm-test";

const fft = functionsTest({ projectId: "demo-pengajuan-confirm-test" }, undefined);
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

describe("confirmSentToGaHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-confirm-test",
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
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await expect(confirmSentToGaHandler({ submissionId: "sub-1" }, { auth: undefined })).rejects.toThrow(HttpsError);
  });

  it("rejects when caller isn't the submission's requester", async () => {
    await seedUser("uid-other", "admin_cabang");
    await seedSubmission("sub-2", "siap_dikirim");
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await expect(
      confirmSentToGaHandler({ submissionId: "sub-2" }, { auth: { uid: "uid-other" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects when status isn't siap_dikirim", async () => {
    await seedUser("uid-requester", "admin_cabang");
    await seedSubmission("sub-3", "diajukan");
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await expect(
      confirmSentToGaHandler({ submissionId: "sub-3" }, { auth: { uid: "uid-requester" } } as any)
    ).rejects.toThrow(/siap_dikirim/);
  });

  it("sets status on_proses_ga and sentToGaAt when the requester confirms", async () => {
    await seedUser("uid-requester", "admin_cabang");
    await seedSubmission("sub-4", "siap_dikirim");
    const { confirmSentToGaHandler } = await import("./confirmSentToGa");
    await confirmSentToGaHandler({ submissionId: "sub-4" }, { auth: { uid: "uid-requester" } } as any);

    const admin = testEnv.unauthenticatedContext().firestore();
    const updated = await admin.collection("submissions").doc("sub-4").get();
    expect(updated.data()!.status).toBe("on_proses_ga");
    expect(updated.data()!.sentToGaAt).toBeTruthy();

    const history = await admin.collection("submissions").doc("sub-4").collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "on_proses_ga" && d.data().actorId === "uid-requester")).toBe(
      true
    );
  });
});
