"use client";

import { useState } from "react";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { firebaseApp } from "@/lib/firebase/client";

const functions = getFunctions(firebaseApp);
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  try {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  } catch (error) {
    // connectFunctionsEmulator throws if called again on an already-configured
    // instance (e.g. Next.js Fast Refresh re-evaluating this module).
    console.warn("[functions] Emulator connection skipped (already configured):", error);
  }
}

export type UploadedFile = { fileId: string; fileUrl: string; fileName: string; fileType: string };

const PURPOSE_CONFIG = {
  attachment: {
    acceptedTypes: ["image/jpeg", "image/png", "application/pdf"],
    maxSizeBytes: 10 * 1024 * 1024,
    maxSizeLabel: "10MB",
    accept: "image/jpeg,image/png,application/pdf",
  },
  signature: {
    acceptedTypes: ["image/png"],
    maxSizeBytes: 2 * 1024 * 1024,
    maxSizeLabel: "2MB",
    accept: "image/png",
  },
} as const;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca file."));
    reader.readAsDataURL(file);
  });
}

export function FileUpload({
  purpose,
  onUploaded,
}: {
  purpose: "attachment" | "signature";
  onUploaded: (file: UploadedFile) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = PURPOSE_CONFIG[purpose];

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);

    if (!(config.acceptedTypes as readonly string[]).includes(file.type)) {
      setError("Tipe file tidak didukung.");
      return;
    }
    if (file.size > config.maxSizeBytes) {
      setError(`Ukuran file maksimal ${config.maxSizeLabel}.`);
      return;
    }

    setUploading(true);
    try {
      const fileData = await readFileAsDataUrl(file);
      const uploadFile = httpsCallable(functions, "uploadFile");
      const result = await uploadFile({ purpose, fileName: file.name, fileType: file.type, fileData });
      onUploaded(result.data as UploadedFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal upload file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1">
      <input
        type="file"
        accept={config.accept}
        disabled={uploading}
        onChange={handleFileChange}
        className="block w-full text-sm"
      />
      {uploading && <p className="text-sm text-muted-foreground">Mengupload...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
