import { doc, runTransaction, type Firestore } from "firebase/firestore";

const ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export async function getNextSubmissionNumber(
  db: Firestore,
  branch: string,
  year: number,
  month: number
): Promise<string> {
  const monthPadded = String(month).padStart(2, "0");
  const counterRef = doc(db, "counters", `${branch}-${year}-${monthPadded}`);

  const nextNumber = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data().lastNumber as number) : 0;
    const next = current + 1;
    tx.set(counterRef, { lastNumber: next }, { merge: true });
    return next;
  });

  const counterPadded = String(nextNumber).padStart(3, "0");
  return `${counterPadded}/${branch}/${ROMAN_MONTHS[month - 1]}/${year}`;
}
