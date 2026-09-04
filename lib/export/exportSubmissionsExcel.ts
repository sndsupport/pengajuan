import { collection, getDocs, query, orderBy } from "firebase/firestore";
import * as XLSX from "xlsx";
import { db } from "@/lib/firebase/client";
import { buildSubmissionsWorkbookData } from "./buildSubmissionsWorkbookData";

export async function exportSubmissionsToExcel(): Promise<void> {
  const submissionsSnap = await getDocs(query(collection(db, "submissions"), orderBy("submittedAt", "asc")));
  const submissionDocs = submissionsSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

  const itemsBySubmission = new Map<string, Array<Record<string, unknown>>>();
  const historyBySubmission = new Map<string, Array<Record<string, unknown>>>();

  await Promise.all(
    submissionDocs.map(async ({ id }) => {
      const [itemsSnap, historySnap] = await Promise.all([
        getDocs(collection(db, "submissions", id, "items")),
        getDocs(collection(db, "submissions", id, "statusHistory")),
      ]);
      itemsBySubmission.set(id, itemsSnap.docs.map((d) => d.data()));
      historyBySubmission.set(id, historySnap.docs.map((d) => d.data()));
    })
  );

  const { submissions, items, history } = buildSubmissionsWorkbookData(
    submissionDocs,
    itemsBySubmission,
    historyBySubmission
  );

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(submissions), "Submissions");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(items), "Items");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(history), "Status History");

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const filename = `pengajuan-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}.xlsx`;

  XLSX.writeFile(workbook, filename);
}
