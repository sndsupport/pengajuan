"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
import { usernameToSyntheticEmail, InvalidUsernameError } from "@/lib/auth/username";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const syntheticEmail = usernameToSyntheticEmail(username);
      const credential = await signInWithEmailAndPassword(auth, syntheticEmail, password);
      const snap = await getDoc(doc(db, "users", credential.user.uid));
      const role = snap.exists() ? (snap.data().role as string) : null;
      router.push(role === "spv" || role === "management" ? "/persetujuan" : "/pengajuan");
    } catch (err) {
      if (err instanceof InvalidUsernameError) {
        setError("Username tidak boleh kosong, mengandung spasi, atau '@'.");
      } else {
        setError("Username atau password salah.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border p-6">
        <h1 className="text-lg font-semibold">Masuk</h1>
        <div className="space-y-1">
          <Label htmlFor="username">Username</Label>
          <Input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Memproses..." : "Masuk"}
        </Button>
      </form>
    </main>
  );
}
