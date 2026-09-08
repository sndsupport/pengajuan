// scripts/seed-master-data.ts
import { readFileSync } from "fs";
import { signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../lib/firebase/client";
import { usernameToSyntheticEmail } from "../lib/auth/username";
import { createEmployee } from "../lib/employees/createEmployee";
import { createVehicle } from "../lib/vehicles/createVehicle";
import type { AppUser } from "../lib/hooks/useAuth";

type EmployeeSeed = { name: string; branch: string; department: string; position: string };
type VehicleSeed = { plateNumber: string; vehicleType: string; branch: string; category: "Mobil" | "Motor" | "Truk" };

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD environment variables before running this script.");
  }

  const credential = await signInWithEmailAndPassword(auth, usernameToSyntheticEmail(username), password);
  const userSnap = await getDocs(
    query(collection(db, "users"), where("username", "==", username.trim().toLowerCase()))
  );
  const userDoc = userSnap.docs[0];
  if (!userDoc || userDoc.data().role !== "superadmin") {
    throw new Error(`User "${username}" is not a superadmin — aborting.`);
  }
  const caller: AppUser = { uid: credential.user.uid, ...(userDoc.data() as Omit<AppUser, "uid">) };

  const employees: EmployeeSeed[] = JSON.parse(
    readFileSync("scripts/seed-data/employees-operational.json", "utf8")
  );
  const vehicles: VehicleSeed[] = JSON.parse(readFileSync("scripts/seed-data/vehicles.json", "utf8"));

  const existingEmployeeNames = new Set(
    (await getDocs(collection(db, "employees"))).docs.map((d) => d.data().name as string)
  );
  for (const employee of employees) {
    if (existingEmployeeNames.has(employee.name)) {
      console.log(`Skip employee (already exists): ${employee.name}`);
      continue;
    }
    const result = await createEmployee(employee, caller);
    console.log(`Seeded employee ${employee.name} (${result.id})`);
  }

  const existingPlateNumbers = new Set(
    (await getDocs(collection(db, "vehicles"))).docs.map((d) => d.data().plateNumber as string)
  );
  for (const vehicle of vehicles) {
    if (existingPlateNumbers.has(vehicle.plateNumber)) {
      console.log(`Skip vehicle (already exists): ${vehicle.plateNumber}`);
      continue;
    }
    const result = await createVehicle(vehicle, caller);
    console.log(`Seeded vehicle ${vehicle.plateNumber} (${result.id})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
