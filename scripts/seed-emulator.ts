import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { usernameToSyntheticEmail } from "../lib/auth/username";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const app = initializeApp({ projectId: "sndsupportapps" });
const auth = getAuth(app);
const db = getFirestore(app);

const SEED_USERS = [
  { username: "admin.who", email: "admin.who@example.com", password: "password123", name: "Admin WHO", role: "admin_cabang", branch: "WHO", department: "Operasional", position: "Admin Cabang" },
  { username: "snd", email: "snd@example.com", password: "password123", name: "Staff SND", role: "snd", branch: "SND", department: "SND", position: "Staff" },
  { username: "spv", email: "spv@example.com", password: "password123", name: "AWS Supervisor", role: "spv", branch: null, department: "AWS", position: "Supervisor" },
  { username: "management", email: "management@example.com", password: "password123", name: "Management", role: "management", branch: null, department: "Management", position: "Manager" },
  { username: "superadmin", email: null, password: "password123", name: "Superadmin", role: "superadmin", branch: null, department: "IT", position: "Superadmin" },
];

async function seed() {
  for (const u of SEED_USERS) {
    const userRecord = await auth.createUser({
      email: usernameToSyntheticEmail(u.username),
      password: u.password,
      displayName: u.name,
    });
    await db.collection("users").doc(userRecord.uid).set({
      name: u.name,
      username: u.username,
      email: u.email,
      role: u.role,
      branch: u.branch,
      department: u.department,
      position: u.position,
      createdAt: new Date(),
    });
    console.log(`Seeded ${u.username} (${u.role})`);
  }
}

seed().then(() => process.exit(0));
