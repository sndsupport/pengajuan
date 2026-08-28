const SYNTHETIC_BOUNDARY = "pengajuan_drive_upload_boundary";

let cachedToken: { value: string; expiresAt: number } | null = null;
let gisLoadPromise: Promise<void> | null = null;

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string; expires_in?: number }) => void;
          }) => { requestAccessToken: (overrideConfig?: { prompt?: string }) => void };
        };
      };
    };
  }
}

function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Identity Services hanya bisa dimuat di browser."));
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisLoadPromise) {
    return gisLoadPromise;
  }
  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Gagal memuat Google Identity Services."));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

async function requestNewAccessToken(): Promise<string> {
  await loadGoogleIdentityServices();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID;
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID belum dikonfigurasi.");
  }

  return new Promise<string>((resolve, reject) => {
    const tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? "Gagal mendapatkan akses Google Drive."));
          return;
        }
        const expiresInMs = (response.expires_in ?? 3600) * 1000;
        cachedToken = { value: response.access_token, expiresAt: Date.now() + expiresInMs - 60_000 };
        resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken();
  });
}

let pendingTokenPromise: Promise<string> | null = null;

export async function getDriveAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  if (!pendingTokenPromise) {
    pendingTokenPromise = requestNewAccessToken().finally(() => {
      pendingTokenPromise = null;
    });
  }
  return pendingTokenPromise;
}

export function buildMultipartRequestBody(
  metadata: Record<string, unknown>,
  fileBlob: Blob,
  fileType: string,
  boundary: string = SYNTHETIC_BOUNDARY
): Blob {
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const fileHeaderPart = `--${boundary}\r\nContent-Type: ${fileType}\r\n\r\n`;
  const closingPart = `\r\n--${boundary}--`;
  return new Blob([metadataPart, fileHeaderPart, fileBlob, closingPart]);
}

export type DriveUploadResult = { fileId: string; fileUrl: string };

export async function uploadToDriveClient(
  file: File,
  purpose: "attachment" | "signature"
): Promise<DriveUploadResult> {
  const folderId = process.env.NEXT_PUBLIC_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error("NEXT_PUBLIC_DRIVE_FOLDER_ID belum dikonfigurasi.");
  }

  const accessToken = await getDriveAccessToken();
  const body = buildMultipartRequestBody({ name: file.name, parents: [folderId] }, file, file.type);

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${SYNTHETIC_BOUNDARY}`,
      },
      body,
    }
  );
  if (!uploadRes.ok) {
    throw new Error(`Gagal upload ke Google Drive (${uploadRes.status}).`);
  }
  const uploaded = (await uploadRes.json()) as { id: string; webViewLink: string };

  const permissionRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploaded.id}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "anyone", role: "reader" }),
  });
  if (!permissionRes.ok) {
    throw new Error(`Gagal mengatur izin akses file di Google Drive (${permissionRes.status}).`);
  }

  const fileUrl =
    purpose === "signature" ? `https://drive.google.com/uc?export=view&id=${uploaded.id}` : uploaded.webViewLink;

  return { fileId: uploaded.id, fileUrl };
}
