import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-updateuser-test";

const fft = functionsTest({ projectId: "demo-pengajuan-updateuser-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedUser(uid: string, data: Record<string, unknown>) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({ createdAt: new Date(), ...data });
}

describe("updateUserHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-updateuser-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => fft.cleanup());

  it("rejects when caller is not superadmin", async () => {
    await seedUser("uid-spv", { name: "S", username: "spv", role: "spv", branch: null, department: "AWS", position: "Supervisor" });
    await seedUser("uid-target", { name: "Target", username: "target", role: "snd", branch: "SND", department: "SND", position: "Staff" });
    const { updateUserHandler } = await import("./updateUser");
    await expect(
      updateUserHandler(
        { uid: "uid-target", name: "Target Baru", role: "snd", branch: "SND", department: "SND", position: "Staff" },
        { auth: { uid: "uid-spv" } } as any
      )
    ).rejects.toThrow(HttpsError);
  });

  it("rejects updating a user that doesn't exist", async () => {
    await seedUser("uid-super", { name: "Super", username: "superadmin", role: "superadmin", branch: null, department: "IT", position: "Superadmin" });
    const { updateUserHandler } = await import("./updateUser");
    await expect(
      updateUserHandler(
        { uid: "missing-uid", name: "X", role: "snd", branch: "SND", department: "SND", position: "Staff" },
        { auth: { uid: "uid-super" } } as any
      )
    ).rejects.toThrow(HttpsError);
  });

  it("updates the target user's editable fields", async () => {
    await seedUser("uid-super", { name: "Super", username: "superadmin", role: "superadmin", branch: null, department: "IT", position: "Superadmin" });
    await seedUser("uid-target", { name: "Target Lama", username: "target", role: "snd", branch: "SND", department: "SND", position: "Staff" });
    const { updateUserHandler } = await import("./updateUser");
    await updateUserHandler(
      { uid: "uid-target", name: "Target Baru", role: "snd", branch: "SND", department: "SND", position: "Staff Senior" },
      { auth: { uid: "uid-super" } } as any
    );

    const admin = testEnv.unauthenticatedContext().firestore();
    const updatedDoc = await admin.collection("users").doc("uid-target").get();
    expect(updatedDoc.data()!.name).toBe("Target Baru");
    expect(updatedDoc.data()!.position).toBe("Staff Senior");
    expect(updatedDoc.data()!.username).toBe("target");
  });

  it("rejects when branch doesn't match role", async () => {
    await seedUser("uid-super", { name: "Super", username: "superadmin", role: "superadmin", branch: null, department: "IT", position: "Superadmin" });
    await seedUser("uid-target", { name: "Target", username: "target", role: "snd", branch: "SND", department: "SND", position: "Staff" });
    const { updateUserHandler } = await import("./updateUser");
    await expect(
      updateUserHandler(
        { uid: "uid-target", name: "Target", role: "snd", branch: "WHO", department: "SND", position: "Staff" },
        { auth: { uid: "uid-super" } } as any
      )
    ).rejects.toThrow(HttpsError);
  });
});
