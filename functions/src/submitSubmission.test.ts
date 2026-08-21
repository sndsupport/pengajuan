import { describe, it, expect, beforeEach, afterAll } from "vitest";
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

    expect(result.submissionNumber).toMatch(/^001\/WHO\/[IVX]+\/\d{4}$/);
    expect(result.status).toBe("diajukan");
  });
});
