"use client";

import { useId, useState } from "react";
import { uploadToDriveClient } from "@/lib/drive-upload";
import { Button } from "@/components/ui/button";
import { AlertCircle, FileIcon, Loader2, UploadCloud } from "lucide-react";

export type UploadedFile = { fileId: string; fileUrl: string; fileName: string; fileType: string };

const PURPOSE_CONFIG = {
  attachment: {
    acceptedTypes: ["image/jpeg", "image/png", "application/pdf"],
    maxSizeBytes: 10 * 1024 * 1024,
    maxSizeLabel: "10MB",
    accept: "image/jpeg,image/png,application/pdf",
    hint: "JPG, PNG, atau PDF · maks. 10MB",
  },
  signature: {
    acceptedTypes: ["image/png", "image/jpeg"],
    maxSizeBytes: 2 * 1024 * 1024,
    maxSizeLabel: "2MB",
    accept: "image/png,image/jpeg",
    hint: "PNG atau JPG · maks. 2MB",
  },
} as const;

export function FileUpload({
  purpose,
  onUploaded,
}: {
  purpose: "attachment" | "signature";
  onUploaded: (file: UploadedFile) => void;
}) {
  const inputId = useId();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = PURPOSE_CONFIG[purpose];

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
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

    // Chrome refuses to open a popup ("window.open blocked due to active
    // file chooser") if it happens within the same user-activation as the
    // native file-picker dialog that just closed. So uploading (which opens
    // the Google Drive OAuth popup) has to wait for a separate, later click
    // — hence staging the file here instead of uploading immediately.
    setPendingFile(file);
  }

  async function handleUploadClick() {
    if (!pendingFile) return;
    setError(null);
    setUploading(true);
    try {
      const { fileId, fileUrl } = await uploadToDriveClient(pendingFile, purpose);
      onUploaded({ fileId, fileUrl, fileName: pendingFile.name, fileType: pendingFile.type });
      setPendingFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal upload file.");
    } finally {
      setUploading(false);
    }
  }

  if (pendingFile) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-3 rounded-xl border p-3">
          <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{pendingFile.name}</span>
          <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={() => setPendingFile(null)}>
            Batal
          </Button>
          <Button type="button" size="sm" disabled={uploading} onClick={handleUploadClick}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {uploading ? "Mengupload..." : "Upload"}
          </Button>
        </div>
        {error && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-input bg-muted/30 px-4 py-6 text-center transition-colors hover:bg-muted/60"
      >
        <UploadCloud className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm font-medium">Klik untuk pilih file</span>
        <span className="text-xs text-muted-foreground">{config.hint}</span>
        <input
          id={inputId}
          type="file"
          accept={config.accept}
          onChange={handleFileChange}
          className="sr-only"
        />
      </label>
      {error && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
