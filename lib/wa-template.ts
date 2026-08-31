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

export type WaTemplatePersonaliaSubmission = {
  submissionNumber: string;
  subType: string;
  employeeName: string;
  branch: string;
  periodStart: string;
  periodEnd: string;
  attachmentUrl: string;
};

export function buildPersonaliaWaTemplate(submission: WaTemplatePersonaliaSubmission, requesterName: string): string {
  return `Halo HC, mohon diproses pengajuan berikut:

No. Pengajuan: ${submission.submissionNumber}
Jenis: ${submission.subType}
Nama Karyawan: ${submission.employeeName}
Cabang: ${submission.branch}
Periode: ${submission.periodStart} s/d ${submission.periodEnd}
Pengaju: ${requesterName}

Dokumen: ${submission.attachmentUrl}

Terima kasih.`;
}
