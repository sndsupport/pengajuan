const TYPE_LABEL: Record<"kendaraan" | "perlengkapan", string> = {
  kendaraan: "Kendaraan",
  perlengkapan: "Perlengkapan",
};

const APPROVER_ROLE_LABEL: Record<"spv" | "management", string> = {
  spv: "AWS Supervisor",
  management: "Operational Manager",
};

export type SubmissionPdfItem = {
  itemName: string;
  brandType: string;
  km: number | null;
  quantity: number;
  unit: string;
  description: string;
};

export type SubmissionPdfData = {
  submissionNumber: string;
  type: "kendaraan" | "perlengkapan";
  subType: string;
  branch: string;
  department: string;
  position: string;
  requesterName: string;
  requesterSignatureUrl: string;
  approverName: string;
  approverRole: "spv" | "management";
  approverSignatureUrl: string;
  submittedAt: Date;
  approvedAt: Date;
  items: SubmissionPdfItem[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function buildSubmissionPdfHtml(data: SubmissionPdfData): string {
  const showKm = data.type === "kendaraan";

  const itemsRows = data.items
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.itemName)}</td>
          <td>${escapeHtml(item.brandType)}</td>
          ${showKm ? `<td class="mono">${item.km ?? "-"}</td>` : ""}
          <td class="mono">${item.quantity}</td>
          <td>${escapeHtml(item.unit)}</td>
          <td>${escapeHtml(item.description)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Public Sans', Arial, sans-serif; color: #1f2937; margin: 0; padding: 32px; font-size: 12px; }
  h1 { font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 16px; margin: 0 0 4px; }
  .header { border-bottom: 3px solid #0891B2; padding-bottom: 12px; margin-bottom: 16px; }
  .mono { font-family: 'IBM Plex Mono', monospace; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; font-size: 11px; }
  th { background: #f3f4f6; font-family: 'Plus Jakarta Sans', Arial, sans-serif; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
  .signature-block { width: 45%; text-align: center; }
  .signature-block img { max-height: 60px; margin: 8px 0; }
  .signature-line { border-top: 1px solid #1f2937; margin-top: 4px; padding-top: 4px; }
  .footer { margin-top: 32px; font-size: 9px; color: #6b7280; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <h1>PT TRIDAYA SINERGI INDONESIA</h1>
    <div>FORMULIR PENGAJUAN KENDARAAN/PERLENGKAPAN</div>
    <div class="mono">${escapeHtml(data.submissionNumber)}</div>
  </div>
  <div class="info-grid">
    <div>
      <div><strong>Cabang:</strong> ${escapeHtml(data.branch)}</div>
      <div><strong>Departemen:</strong> ${escapeHtml(data.department)}</div>
      <div><strong>Posisi:</strong> ${escapeHtml(data.position)}</div>
      <div><strong>Nama Pengaju:</strong> ${escapeHtml(data.requesterName)}</div>
    </div>
    <div>
      <div><strong>Jenis Pengajuan:</strong> ${TYPE_LABEL[data.type]}</div>
      <div><strong>Sub Jenis:</strong> ${escapeHtml(data.subType)}</div>
      <div><strong>Tanggal Diajukan:</strong> <span class="mono">${formatDate(data.submittedAt)}</span></div>
      <div><strong>Tanggal Disetujui:</strong> <span class="mono">${formatDate(data.approvedAt)}</span></div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>No</th>
        <th>Nama Item</th>
        <th>Merk/Tipe</th>
        ${showKm ? "<th>KM</th>" : ""}
        <th>Jumlah</th>
        <th>Satuan</th>
        <th>Deskripsi</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>
  <div class="signatures">
    <div class="signature-block">
      <div>Pemohon</div>
      <img src="${escapeHtml(data.requesterSignatureUrl)}" alt="Tanda tangan pemohon" />
      <div class="signature-line">${escapeHtml(data.requesterName)}</div>
    </div>
    <div class="signature-block">
      <div>Mengetahui</div>
      <img src="${escapeHtml(data.approverSignatureUrl)}" alt="Tanda tangan approver" />
      <div class="signature-line">${escapeHtml(data.approverName)}<br/>${APPROVER_ROLE_LABEL[data.approverRole]}</div>
    </div>
  </div>
  <div class="footer">Dokumen digenerate otomatis oleh sistem pada ${formatDateTime(new Date())}.</div>
</body>
</html>`;
}
