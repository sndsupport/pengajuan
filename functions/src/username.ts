export class InvalidUsernameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUsernameError";
  }
}

const SYNTHETIC_EMAIL_DOMAIN = "pengajuan-tsi.internal";

export function normalizeUsername(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    throw new InvalidUsernameError("Username tidak boleh kosong.");
  }
  if (/\s/.test(trimmed)) {
    throw new InvalidUsernameError("Username tidak boleh mengandung spasi.");
  }
  if (trimmed.includes("@")) {
    throw new InvalidUsernameError("Username tidak boleh mengandung '@'.");
  }
  return trimmed;
}

export function usernameToSyntheticEmail(username: string): string {
  return `${normalizeUsername(username)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}
