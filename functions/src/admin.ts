import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const adminApp = getApps().length ? getApp() : initializeApp();
export const db = getFirestore(adminApp);
