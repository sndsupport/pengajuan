// functions/src/uploadFile.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { HttpsError } from "firebase-functions/v2/https";

// Point the Admin SDK (used internally by uploadFile.ts via ./admin) at the
// local Firestore emulator instead of production. Must be set before "./uploadFile"
// (and transitively "./admin") is ever imported, since getFirestore() reads this at init time.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-upload-test";

const fft = functionsTest({ projectId: "demo-pengajuan-upload-test" }, undefined);
let testEnv: RulesTestEnvironment;

const uploadToDriveMock = vi.fn();
vi.mock("./googleDrive", () => ({
  uploadToDrive: uploadToDriveMock,
}));

async function seedUser(uid: string, role: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({ name: "T", email: "t@x.com", role, branch: "WHO", department: "Ops", position: "Staff", createdAt: new Date() });
}

const VALID_PAYLOAD = {
  purpose: "attachment" as const,
  fileName: "nota.png",
  fileType: "image/png",
  fileData: "data:image/png;base64,aGVsbG8=",
};

describe("uploadFileHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-upload-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
    uploadToDriveMock.mockReset();
  });

  afterAll(() => fft.cleanup());

  it("rejects when caller is not authenticated", async () => {
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(uploadFileHandler(VALID_PAYLOAD, { auth: undefined })).rejects.toThrow(HttpsError);
  });

  it("rejects when caller role is not admin_cabang/snd", async () => {
    await seedUser("uid-spv", "spv");
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(uploadFileHandler(VALID_PAYLOAD, { auth: { uid: "uid-spv" } } as any)).rejects.toThrow(HttpsError);
  });

  it("rejects an unsupported file type for the given purpose", async () => {
    await seedUser("uid-admin", "admin_cabang");
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(
      uploadFileHandler({ ...VALID_PAYLOAD, fileType: "application/zip" }, { auth: { uid: "uid-admin" } } as any)
    ).rejects.toThrow(/tidak didukung/);
  });

  it("rejects a signature upload that isn't PNG", async () => {
    await seedUser("uid-admin", "admin_cabang");
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(
      uploadFileHandler(
        { purpose: "signature", fileName: "ttd.jpg", fileType: "image/jpeg", fileData: "data:image/jpeg;base64,aGVsbG8=" },
        { auth: { uid: "uid-admin" } } as any
      )
    ).rejects.toThrow(/tidak didukung/);
  });

  it("rejects a file larger than the purpose's max size", async () => {
    await seedUser("uid-admin", "admin_cabang");
    const bigBase64 = Buffer.alloc(11 * 1024 * 1024).toString("base64");
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(
      uploadFileHandler(
        { purpose: "attachment", fileName: "big.png", fileType: "image/png", fileData: `data:image/png;base64,${bigBase64}` },
        { auth: { uid: "uid-admin" } } as any
      )
    ).rejects.toThrow(/maksimal/);
  });

  it("uploads a valid attachment and returns Drive metadata", async () => {
    await seedUser("uid-admin", "admin_cabang");
    uploadToDriveMock.mockResolvedValue({ fileId: "file-1", webViewLink: "https://drive.google.com/file/d/file-1/view" });
    const { uploadFileHandler } = await import("./uploadFile");
    const result = await uploadFileHandler(VALID_PAYLOAD, { auth: { uid: "uid-admin" } } as any);
    expect(result).toEqual({ fileUrl: "https://drive.google.com/file/d/file-1/view", fileName: "nota.png", fileType: "image/png" });
    expect(uploadToDriveMock).toHaveBeenCalledWith({ fileName: "nota.png", mimeType: "image/png", buffer: expect.any(Buffer) });
  });

  it("surfaces a generic error if the Drive upload fails", async () => {
    await seedUser("uid-admin", "admin_cabang");
    uploadToDriveMock.mockRejectedValue(new Error("Drive quota exceeded"));
    const { uploadFileHandler } = await import("./uploadFile");
    await expect(uploadFileHandler(VALID_PAYLOAD, { auth: { uid: "uid-admin" } } as any)).rejects.toThrow(/Gagal upload file/);
  });
});
