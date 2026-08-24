import { google } from "googleapis";
import { Readable } from "stream";

export async function uploadToDrive(params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ fileId: string; webViewLink: string }> {
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error("DRIVE_FOLDER_ID env var is not configured.");
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  const createRes = await drive.files.create({
    requestBody: {
      name: params.fileName,
      parents: [folderId],
    },
    media: {
      mimeType: params.mimeType,
      body: Readable.from(params.buffer),
    },
    fields: "id, webViewLink",
  });

  const fileId = createRes.data.id;
  const webViewLink = createRes.data.webViewLink;
  if (!fileId || !webViewLink) {
    throw new Error("Drive did not return an id/webViewLink for the uploaded file.");
  }

  await drive.permissions.create({
    fileId,
    requestBody: { type: "anyone", role: "reader" },
  });

  return { fileId, webViewLink };
}
