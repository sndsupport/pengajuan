import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin";
import { uploadFileSchema, UploadFileInput } from "./schemas";
import { uploadToDrive } from "./googleDrive";

interface CallerContext {
  auth?: { uid: string };
}

const MAX_SIZE_BYTES: Record<UploadFileInput["purpose"], number> = {
  attachment: 10 * 1024 * 1024,
  signature: 2 * 1024 * 1024,
};

const ALLOWED_MIME_TYPES: Record<UploadFileInput["purpose"], readonly string[]> = {
  attachment: ["image/jpeg", "image/png", "application/pdf"],
  signature: ["image/png"],
};

export async function uploadFileHandler(rawData: unknown, context: CallerContext) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const callerSnap = await db.collection("users").doc(context.auth.uid).get();
  const caller = callerSnap.data();
  if (!caller || !["admin_cabang", "snd", "spv", "management"].includes(caller.role)) {
    throw new HttpsError("permission-denied", "Hanya admin cabang, SND, SPV, atau Management yang bisa upload file.");
  }

  const parsed = uploadFileSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input = parsed.data;

  if (!ALLOWED_MIME_TYPES[input.purpose].includes(input.fileType)) {
    throw new HttpsError("invalid-argument", "Tipe file tidak didukung.");
  }

  // input.fileData is normally a data URL like "data:image/png;base64,....".
  // The declared input.fileType is client-supplied, so cross-check it against
  // the mime type embedded in the data URL's own prefix when one is present
  // (partial mitigation only — this doesn't inspect the actual file bytes).
  const commaIndex = input.fileData.indexOf(",");
  if (commaIndex !== -1) {
    const prefix = input.fileData.slice(0, commaIndex);
    const mimeMatch = prefix.match(/^data:([^;]+)/);
    if (mimeMatch && mimeMatch[1] !== input.fileType) {
      throw new HttpsError("invalid-argument", "Tipe file tidak didukung.");
    }
  }
  const base64Payload = commaIndex !== -1 ? input.fileData.slice(commaIndex + 1) : input.fileData;
  const buffer = Buffer.from(base64Payload, "base64");

  if (buffer.byteLength > MAX_SIZE_BYTES[input.purpose]) {
    const maxMb = MAX_SIZE_BYTES[input.purpose] / (1024 * 1024);
    throw new HttpsError("invalid-argument", `Ukuran file maksimal ${maxMb}MB.`);
  }

  try {
    const { fileId, webViewLink } = await uploadToDrive({
      fileName: input.fileName,
      mimeType: input.fileType,
      buffer,
    });
    // webViewLink is a Drive HTML viewer page, not raw image bytes — fine for
    // attachments (meant to be opened in a new tab) but useless as an <img src>.
    // Signatures need a link that actually serves the file's bytes so they can
    // be embedded directly (e.g. in the generated PDF).
    const fileUrl =
      input.purpose === "signature" ? `https://drive.google.com/uc?export=view&id=${fileId}` : webViewLink;
    return { fileId, fileUrl, fileName: input.fileName, fileType: input.fileType };
  } catch (error) {
    console.error("uploadFile: Drive upload failed", error);
    throw new HttpsError("internal", "Gagal upload file, coba lagi.");
  }
}
