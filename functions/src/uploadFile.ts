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
  if (!caller || !["admin_cabang", "snd"].includes(caller.role)) {
    throw new HttpsError("permission-denied", "Hanya admin cabang atau SND yang bisa upload file.");
  }

  const parsed = uploadFileSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input = parsed.data;

  if (!ALLOWED_MIME_TYPES[input.purpose].includes(input.fileType)) {
    throw new HttpsError("invalid-argument", "Tipe file tidak didukung.");
  }

  const base64Payload = input.fileData.includes(",") ? input.fileData.split(",")[1] : input.fileData;
  const buffer = Buffer.from(base64Payload, "base64");

  if (buffer.byteLength > MAX_SIZE_BYTES[input.purpose]) {
    const maxMb = MAX_SIZE_BYTES[input.purpose] / (1024 * 1024);
    throw new HttpsError("invalid-argument", `Ukuran file maksimal ${maxMb}MB.`);
  }

  try {
    const { webViewLink } = await uploadToDrive({
      fileName: input.fileName,
      mimeType: input.fileType,
      buffer,
    });
    return { fileUrl: webViewLink, fileName: input.fileName, fileType: input.fileType };
  } catch (error) {
    console.error("uploadFile: Drive upload failed", error);
    throw new HttpsError("internal", "Gagal upload file, coba lagi.");
  }
}
