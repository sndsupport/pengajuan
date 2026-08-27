import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "demo-pengajuan-resetpw-test";

const fft = functionsTest({ projectId: "demo-pengajuan-resetpw-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function clearAuthEmulator() {
  await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-pengajuan-resetpw-test/accounts", {
    method: "DELETE",
  });
}

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name: "T",
    username: uid,
    role,
    branch: null,
    department: "IT",
    position: "Staff",
    createdAt: new Date(),
  });
}

describe("resetUserPasswordHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-resetpw-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
    await clearAuthEmulator();
  });

  afterAll(() => fft.cleanup());

  it("rejects when caller is not superadmin", async () => {
    await seedUser("uid-spv", "spv");
    const { resetUserPasswordHandler } = await import("./resetUserPassword");
    await expect(
      resetUserPasswordHandler({ uid: "uid-spv", newPassword: "newpassword123" }, { auth: { uid: "uid-spv" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("rejects a password shorter than 6 characters", async () => {
    await seedUser("uid-super", "superadmin");
    const { resetUserPasswordHandler } = await import("./resetUserPassword");
    await expect(
      resetUserPasswordHandler({ uid: "uid-super", newPassword: "123" }, { auth: { uid: "uid-super" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("resets the target user's Auth password", async () => {
    await seedUser("uid-super", "superadmin");
    const { auth } = await import("./admin");
    const target = await auth.createUser({ email: "target@pengajuan-tsi.internal", password: "oldpassword" });

    const { resetUserPasswordHandler } = await import("./resetUserPassword");
    const result = await resetUserPasswordHandler(
      { uid: target.uid, newPassword: "newpassword123" },
      { auth: { uid: "uid-super" } } as any
    );

    expect(result.uid).toBe(target.uid);
  });

  it("rejects resetting a non-existent Auth user", async () => {
    await seedUser("uid-super", "superadmin");
    const { resetUserPasswordHandler } = await import("./resetUserPassword");
    await expect(
      resetUserPasswordHandler(
        { uid: "does-not-exist", newPassword: "newpassword123" },
        { auth: { uid: "uid-super" } } as any
      )
    ).rejects.toThrow(HttpsError);
  });
});
