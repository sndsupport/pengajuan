"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";

export type AppUser = {
  uid: string;
  name: string;
  username: string;
  email: string | null;
  role: "admin_cabang" | "snd" | "spv" | "management" | "superadmin";
  branch: string | null;
  department: string;
  position: string;
};

export function useAuth() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setAppUser(null);
        setLoading(false);
        return;
      }
      const snap = await getDoc(doc(db, "users", user.uid));
      setAppUser(snap.exists() ? ({ uid: user.uid, ...(snap.data() as Omit<AppUser, "uid">) }) : null);
      setLoading(false);
    });
  }, []);

  return { firebaseUser, appUser, loading };
}
