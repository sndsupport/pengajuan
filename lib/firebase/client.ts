import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const REQUIRED_FIREBASE_CONFIG_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
] as const;

function assertFirebaseConfig(config: typeof firebaseConfig) {
  const missing = REQUIRED_FIREBASE_CONFIG_KEYS.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `Firebase client config is missing required value(s): ${missing
        .map((key) => `NEXT_PUBLIC_FIREBASE_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`)
        .join(", ")}. Check your environment variables.`,
    );
  }
}

assertFirebaseConfig(firebaseConfig);

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

let emulatorsConnected = false;

export function connectToEmulatorsIfConfigured() {
  if (emulatorsConnected) return;
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") return;
  try {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  } catch (error) {
    // Firebase throws if a connect*Emulator call is repeated against an
    // already-configured Auth/Firestore instance (e.g. Next.js Fast Refresh
    // re-evaluating this module while the Firebase app registry persists).
    // The module-level guard below covers the common cases; this catch keeps
    // the function safely callable for the rest.
    console.warn("[firebase] Emulator connection skipped (already configured):", error);
  }
  emulatorsConnected = true;
}
