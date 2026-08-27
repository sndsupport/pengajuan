import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "demo-pengajuan-createuser-test";

const fft = functionsTest({ projectId: "demo-pengajuan-createuser-test" }, undefined);
let testEnv: RulesTestEnvironment;

async function seedCaller(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name: "Caller",
    username: "caller",
    role,
    branch: null,
    department: "IT",
    position: "Staff",
    createdAt: new Date(),
  });
}

describe("createUserHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-createuser-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
  });

  afterAll(() => fft.cleanup());

  const validInput = {
    name: "Admin WHO Baru",
    username: "admin.who2",
    password: "password123",
    role: "admin_cabang",
    branch: "WHO",
    department: "Operasional",
    position: "Admin Cabang",
  };

  it("rejects when caller is not superadmin", async () => {
    await seedCaller("uid-spv", "spv");
    const { createUserHandler } = await import("./createUser");
    await expect(
      createUserHandler(validInput, { auth: { uid: "uid-spv" } } as any)
    ).rejects.toThrow(HttpsError);
  });

  it("creates a Firebase Auth user and a matching Firestore doc", async () => {
    await seedCaller("uid-super", "superadmin");
    const { createUserHandler } = await import("./createUser");
    const result = await createUserHandler(validInput, { auth: { uid: "uid-super" } } as any);

    expect(result.username).toBe("admin.who2");

    const admin = testEnv.unauthenticatedContext().firestore();
    const createdDoc = await admin.collection("users").doc(result.uid).get();
    expect(createdDoc.data()!.username).toBe("admin.who2");
    expect(createdDoc.data()!.role).toBe("admin_cabang");
    expect(createdDoc.data()!.branch).toBe("WHO");
  });

  it("rejects a duplicate username", async () => {
    await seedCaller("uid-super", "superadmin");
    const { createUserHandler } = await import("./createUser");
    const dupInput = { ...validInput, username: "dup.test.user" };
    await createUserHandler(dupInput, { auth: { uid: "uid-super" } } as any);

    await expect(
      createUserHandler({ ...dupInput, name: "Lain" }, { auth: { uid: "uid-super" } } as any)
    ).rejects.toThrow(/sudah dipakai/);
  });

  it("rejects when branch doesn't match role", async () => {
    await seedCaller("uid-super", "superadmin");
    const { createUserHandler } = await import("./createUser");
    await expect(
      createUserHandler({ ...validInput, branch: "SND" }, { auth: { uid: "uid-super" } } as any)
    ).rejects.toThrow(HttpsError);
  });
});
