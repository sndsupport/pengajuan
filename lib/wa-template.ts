export type WaTemplateSubmission = {
  submissionNumber: string;
  type: string;
  subType: string;
  branch: string;
  pdfUrl: string;
};

export function buildWaTemplate(submission: WaTemplateSubmission, requesterName: string): string {
  return `Halo GA, mohon diproses pengajuan berikut:

No. Pengajuan: ${submission.submissionNumber}
Jenis: ${submission.type} (${submission.subType})
Cabang: ${submission.branch}
Pengaju: ${requesterName}

Dokumen: ${submission.pdfUrl}

Terima kasih.`;
}
