import { describe, it, expect, vi, beforeEach } from "vitest";

const filesCreate = vi.fn();
const permissionsCreate = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(() => ({})),
    },
    drive: vi.fn().mockImplementation(() => ({
      files: { create: filesCreate },
      permissions: { create: permissionsCreate },
    })),
  },
}));

describe("uploadToDrive", () => {
  beforeEach(() => {
    filesCreate.mockReset();
    permissionsCreate.mockReset();
    process.env.DRIVE_FOLDER_ID = "folder-123";
  });

  it("throws if DRIVE_FOLDER_ID is not configured", async () => {
    delete process.env.DRIVE_FOLDER_ID;
    const { uploadToDrive } = await import("./googleDrive");
    await expect(
      uploadToDrive({ fileName: "x.png", mimeType: "image/png", buffer: Buffer.from("x") })
    ).rejects.toThrow(/DRIVE_FOLDER_ID/);
  });

  it("uploads the file into the configured folder and sets anyone-reader permission", async () => {
    filesCreate.mockResolvedValue({
      data: { id: "file-abc", webViewLink: "https://drive.google.com/file/d/file-abc/view" },
    });
    permissionsCreate.mockResolvedValue({});

    const { uploadToDrive } = await import("./googleDrive");
    const result = await uploadToDrive({
      fileName: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from("hello"),
    });

    expect(result).toEqual({ fileId: "file-abc", webViewLink: "https://drive.google.com/file/d/file-abc/view" });
    expect(filesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { name: "test.png", parents: ["folder-123"] },
        fields: "id, webViewLink",
      })
    );
    expect(permissionsCreate).toHaveBeenCalledWith({
      fileId: "file-abc",
      requestBody: { type: "anyone", role: "reader" },
    });
  });

  it("throws if Drive does not return a file id/webViewLink", async () => {
    filesCreate.mockResolvedValue({ data: {} });
    const { uploadToDrive } = await import("./googleDrive");
    await expect(
      uploadToDrive({ fileName: "x.png", mimeType: "image/png", buffer: Buffer.from("x") })
    ).rejects.toThrow(/id\/webViewLink/);
  });
});
