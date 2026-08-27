// functions/src/generateSubmissionPdf.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import functionsTest from "firebase-functions-test";
import { shouldGeneratePdf } from "./generateSubmissionPdf";

describe("shouldGeneratePdf", () => {
  it("returns true when status transitions into disetujui", () => {
    expect(shouldGeneratePdf({ status: "diajukan" }, { status: "disetujui" })).toBe(true);
  });

  it("returns false when status was already disetujui (avoids re-triggering)", () => {
    expect(shouldGeneratePdf({ status: "disetujui" }, { status: "disetujui" })).toBe(false);
  });

  it("returns false when the new status isn't disetujui", () => {
    expect(shouldGeneratePdf({ status: "diajukan" }, { status: "perlu_revisi" })).toBe(false);
  });
});

// The rest of this file requires the Firestore Emulator (FIRESTORE_EMULATOR_HOST)
// AND mocks out puppeteer-core/@sparticuz/chromium entirely, since the real
// packages need a Linux Chromium binary this Windows machine can't run — see
// docs/superpowers/specs/2026-08-27-generate-submission-pdf-design.md "Batasan testing".
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pengajuan-generatepdf-test";

const fft = functionsTest({ projectId: "demo-pengajuan-generatepdf-test" }, undefined);
let testEnv: RulesTestEnvironment;

// The pure-function tests above need a static top-level import of
// "./generateSubmissionPdf" (see the import at the top of this file), which
// means this module (and its transitive imports of puppeteer-core,
// @sparticuz/chromium, and ./googleDrive) gets evaluated before any plain
// `const` further down this file would run. vi.mock factories referencing
// those consts would otherwise hit a TDZ error ("Cannot access ... before
// initialization"), so the mock fns must be created via vi.hoisted(), which
// vitest hoists above all imports.
const { launchMock, uploadToDriveMock } = vi.hoisted(() => ({
  launchMock: vi.fn(),
  uploadToDriveMock: vi.fn(),
}));
vi.mock("puppeteer-core", () => ({
  default: { launch: (...args: unknown[]) => launchMock(...args) },
}));
vi.mock("@sparticuz/chromium", () => ({
  default: {
    args: [],
    defaultViewport: null,
    executablePath: vi.fn().mockResolvedValue("/fake/chromium"),
    headless: true,
  },
}));
vi.mock("./googleDrive", () => ({
  uploadToDrive: uploadToDriveMock,
}));

async function seedUser(uid: string, name: string) {
  const admin = testEnv.unauthenticatedContext().firestore();
  await admin.collection("users").doc(uid).set({
    name,
    username: uid,
    role: "admin_cabang",
    branch: "WHO",
    department: "Ops",
    position: "Staff",
    createdAt: new Date(),
  });
}

describe("generateSubmissionPdfHandler", () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-pengajuan-generatepdf-test",
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }",
      },
    });
    await testEnv.clearFirestore();
    launchMock.mockReset();
    uploadToDriveMock.mockReset();
  });

  afterAll(() => fft.cleanup());

  it("renders the PDF, uploads it to Drive, and updates status to siap_dikirim", async () => {
    await seedUser("uid-requester", "Budi Santoso");
    await seedUser("uid-approver", "Siti Aminah");

    const admin = testEnv.unauthenticatedContext().firestore();
    const submissionRef = admin.collection("submissions").doc("sub-1");
    await submissionRef.set({
      submissionNumber: "001/WHO/VIII/2026",
      type: "kendaraan",
      subType: "service_berkala",
      status: "disetujui",
      requesterId: "uid-requester",
      requesterSignatureUrl: "https://drive.google.com/uc?export=view&id=req-sig",
      approverId: "uid-approver",
      approverRole: "spv",
      approverSignatureUrl: "https://drive.google.com/uc?export=view&id=approver-sig",
      branch: "WHO",
      department: "Operasional",
      position: "Admin Cabang",
      submittedAt: new Date(),
      approvedAt: new Date(),
    });
    await submissionRef.collection("items").doc("item-1").set({
      itemName: "Toyota Avanza",
      brandType: "Toyota Avanza 1.3",
      km: 45000,
      quantity: 1,
      unit: "unit",
      description: "Service 40rb km",
    });

    const fakePage = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")),
    };
    const fakeBrowser = {
      newPage: vi.fn().mockResolvedValue(fakePage),
      close: vi.fn().mockResolvedValue(undefined),
    };
    launchMock.mockResolvedValue(fakeBrowser);
    uploadToDriveMock.mockResolvedValue({ fileId: "pdf-1", webViewLink: "https://drive.google.com/file/d/pdf-1/view" });

    const { generateSubmissionPdfHandler } = await import("./generateSubmissionPdf");
    const submissionSnap = await submissionRef.get();
    await generateSubmissionPdfHandler("sub-1", submissionSnap.data()!);

    expect(uploadToDriveMock).toHaveBeenCalledWith({
      fileName: "001-WHO-VIII-2026.pdf",
      mimeType: "application/pdf",
      buffer: expect.any(Buffer),
    });

    const updated = await submissionRef.get();
    expect(updated.data()!.status).toBe("siap_dikirim");
    expect(updated.data()!.pdfUrl).toBe("https://drive.google.com/file/d/pdf-1/view");

    const history = await submissionRef.collection("statusHistory").get();
    expect(history.docs.some((d) => d.data().status === "siap_dikirim" && d.data().actorId === "system")).toBe(true);
  });

  it("logs and exits without throwing if the requester or approver user doc is missing", async () => {
    const admin = testEnv.unauthenticatedContext().firestore();
    const submissionRef = admin.collection("submissions").doc("sub-2");
    await submissionRef.set({
      submissionNumber: "002/WHO/VIII/2026",
      type: "kendaraan",
      subType: "service_berkala",
      status: "disetujui",
      requesterId: "missing-requester",
      requesterSignatureUrl: "https://drive.google.com/uc?export=view&id=req-sig",
      approverId: "missing-approver",
      approverRole: "spv",
      approverSignatureUrl: "https://drive.google.com/uc?export=view&id=approver-sig",
      branch: "WHO",
      department: "Operasional",
      position: "Admin Cabang",
      submittedAt: new Date(),
      approvedAt: new Date(),
    });

    const { generateSubmissionPdfHandler } = await import("./generateSubmissionPdf");
    const submissionSnap = await submissionRef.get();
    await expect(generateSubmissionPdfHandler("sub-2", submissionSnap.data()!)).resolves.toBeUndefined();
    expect(uploadToDriveMock).not.toHaveBeenCalled();
  });
});
