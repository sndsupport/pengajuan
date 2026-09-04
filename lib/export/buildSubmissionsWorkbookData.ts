export type SubmissionRow = {
  submissionNumber: string;
  type: string;
  subType: string;
  status: string;
  employeeName: string;
  branch: string | null;
  department: string;
  position: string;
  requesterId: string;
  approverName: string | null;
  approverRole: string | null;
  rejectionNote: string | null;
  pdfUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  sentToGaAt: string | null;
  completedAt: string | null;
};

export type ItemRow = {
  submissionNumber: string;
  itemName: string;
  brandType: string;
  km: number | null;
  quantity: number;
  unit: string;
  description: string;
};

export type HistoryRow = {
  submissionNumber: string;
  status: string;
  note: string | null;
  actorRole: string;
  timestamp: string | null;
};

export type SubmissionsWorkbookData = {
  submissions: SubmissionRow[];
  items: ItemRow[];
  history: HistoryRow[];
};

type FirestoreTimestampLike = { toDate: () => Date } | null | undefined;

function formatTimestamp(value: FirestoreTimestampLike): string | null {
  if (!value || typeof value.toDate !== "function") return null;
  return value.toDate().toLocaleString("id-ID");
}

export function buildSubmissionsWorkbookData(
  submissionDocs: Array<{ id: string; data: Record<string, unknown> }>,
  itemsBySubmission: Map<string, Array<Record<string, unknown>>>,
  historyBySubmission: Map<string, Array<Record<string, unknown>>>
): SubmissionsWorkbookData {
  const submissions: SubmissionRow[] = submissionDocs.map(({ data }) => ({
    submissionNumber: data.submissionNumber as string,
    type: data.type as string,
    subType: data.subType as string,
    status: data.status as string,
    employeeName: data.employeeName as string,
    branch: (data.branch as string | null) ?? null,
    department: (data.department as string) ?? "",
    position: (data.position as string) ?? "",
    requesterId: data.requesterId as string,
    approverName: (data.approverName as string | null) ?? null,
    approverRole: (data.approverRole as string | null) ?? null,
    rejectionNote: (data.rejectionNote as string | null) ?? null,
    pdfUrl: (data.pdfUrl as string | null) ?? null,
    periodStart: (data.periodStart as string | null) ?? null,
    periodEnd: (data.periodEnd as string | null) ?? null,
    submittedAt: formatTimestamp(data.submittedAt as FirestoreTimestampLike),
    reviewedAt: formatTimestamp(data.reviewedAt as FirestoreTimestampLike),
    approvedAt: formatTimestamp(data.approvedAt as FirestoreTimestampLike),
    sentToGaAt: formatTimestamp(data.sentToGaAt as FirestoreTimestampLike),
    completedAt: formatTimestamp(data.completedAt as FirestoreTimestampLike),
  }));

  const items: ItemRow[] = [];
  const history: HistoryRow[] = [];

  for (const { id, data } of submissionDocs) {
    const submissionNumber = data.submissionNumber as string;

    for (const item of itemsBySubmission.get(id) ?? []) {
      items.push({
        submissionNumber,
        itemName: (item.itemName as string) ?? "",
        brandType: (item.brandType as string) ?? "",
        km: (item.km as number | null) ?? null,
        quantity: (item.quantity as number) ?? 0,
        unit: (item.unit as string) ?? "",
        description: (item.description as string) ?? "",
      });
    }

    for (const entry of historyBySubmission.get(id) ?? []) {
      history.push({
        submissionNumber,
        status: (entry.status as string) ?? "",
        note: (entry.note as string | null) ?? null,
        actorRole: (entry.actorRole as string) ?? "",
        timestamp: formatTimestamp(entry.timestamp as FirestoreTimestampLike),
      });
    }
  }

  return { submissions, items, history };
}
