"use client";

import { useState } from "react";
import { uploadToDriveClient } from "@/lib/drive-upload";

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
      const { fileId, fileUrl } = await uploadToDriveClient(file, purpose);
      onUploaded({ fileId, fileUrl, fileName: file.name, fileType: file.type });
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
