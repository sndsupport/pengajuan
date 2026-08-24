import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-pdf-test";

const fft = functionsTest({ projectId: "demo-pengajuan-pdf-test" }, undefined);
let testEnv: RulesTestEnvironment;

const renderPdfBufferMock = vi.fn();
vi.mock("./pdf/renderPdfBuffer", () => ({ renderPdfBuffer: renderPdfBufferMock }));

const uploadToDriveMock = vi.fn();
vi.mock("./googleDrive", () => ({ uploadToDrive: uploadToDriveMock }));

async function seedUser(uid: string, overrides: Record<string, unknown> = {}) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name: "Default Name",
    email: "d@x.com",
    role: "admin_cabang",
    branch: "WHO",
    department: "Operasional",
    position: "Admin",
    createdAt: new Date(),
    ...overrides,
  });
}

async function seedItems(submissionId: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin
    .collection("submissions")
    .doc(submissionId)
    .collection("items")
    .add({ itemName: "Mobil", brandType: "Grandmax Box D 8706 FN", km: 151995, quantity: 1, unit: "Unit", description: "Service Berkala" });
}

const AFTER_DISETUJUI = {
  status: "disetujui",
  submissionNumber: "L.001/TSI-OPR/WHO/VIII/2026",
  type: "kendaraan",
  branch: "WHO",
  department: "Operasional",
  position: "Admin",
  requesterId: "uid-requester",
  requesterSignatureUrl: "data:image/png;base64,aGVsbG8=",
  approverId: "uid-approver",
  approverSignatureUrl: "data:image/png;base64,d29ybGQ=",
  submittedAt: { toDate: () => new Date("2026-08-21T00:00:00Z") },
};

describe("generateSubmissionPdfHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-pdf-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
    renderPdfBufferMock.mockReset();
    uploadToDriveMock.mockReset();
  });

  afterAll(() => fft.cleanup());

  it("does nothing when status was already disetujui before the update", async () => {
    const { generateSubmissionPdfHandler } = await import("./generateSubmissionPdf");
    await generateSubmissionPdfHandler("sub-1", { status: "disetujui" }, { status: "disetujui" });
    expect(renderPdfBufferMock).not.toHaveBeenCalled();
  });

  it("does nothing when the new status isn't disetujui", async () => {
    const { generateSubmissionPdfHandler } = await import("./generateSubmissionPdf");
    await generateSubmissionPdfHandler("sub-2", { status: "diajukan" }, { status: "perlu_revisi" });
    expect(renderPdfBufferMock).not.toHaveBeenCalled();
  });

  it("generates a PDF, uploads it to Drive, and transitions status to siap_dikirim", async () => {
    await seedUser("uid-requester", { name: "Rahmat Agus Tiyan" });
    await seedUser("uid-approver", { name: "Rizki Trihatanto", position: "Kepala Departemen", role: "spv" });
    await seedItems("sub-3");
    const admin = testEnv.unauthenticatedContext().firestore();
    await admin.collection("submissions").doc("sub-3").set({
      status: "diajukan",
      requesterId: "uid-requester",
      branch: "WHO",
    });
    renderPdfBufferMock.mockResolvedValue(Buffer.from("PDF-BYTES"));
    uploadToDriveMock.mockResolvedValue({
      fileId: "pdf-file-1",
      webViewLink: "https://drive.google.com/file/d/pdf-file-1/view",
    });

    const { generateSubmissionPdfHandler } = await import("./generateSubmissionPdf");
    await generateSubmissionPdfHandler("sub-3", { status: "diajukan" }, AFTER_DISETUJUI);

    expect(uploadToDriveMock).toHaveBeenCalledWith({
      fileName: "Formulir - L.001/TSI-OPR/WHO/VIII/2026.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("PDF-BYTES"),
    });

    const updated = await admin.collection("submissions").doc("sub-3").get();
    expect(updated.data()!.status).toBe("siap_dikirim");
    expect(updated.data()!.pdfUrl).toBe("https://drive.google.com/file/d/pdf-file-1/view");

    const history = await admin.collection("submissions").doc("sub-3").collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "siap_dikirim" && d.data().actorId === "system")).toBe(true);
  });
});
