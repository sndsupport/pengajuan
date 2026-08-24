export interface SubmissionPdfItem {
  itemName: string;
  brandType: string;
  km: number | null;
  quantity: number;
  unit: string;
  description: string;
}

export interface SubmissionPdfData {
  submissionNumber: string;
  submittedAt: Date;
  type: "kendaraan" | "perlengkapan";
  branch: string;
  department: string;
  position: string;
  requesterName: string;
  requesterSignatureUrl: string;
  approverName: string;
  approverPosition: string;
  approverSignatureUrl: string;
  items: SubmissionPdfItem[];
}

const TYPE_LABELS: Record<SubmissionPdfData["type"], string> = {
  kendaraan: "Kendaraan",
  perlengkapan: "Perlengkapan",
};

const TOTAL_ROWS = 14;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTanggal(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(date);
}

function buildItemRow(item: SubmissionPdfItem): string {
  return `<tr class="item-row">
    <td>${escapeHtml(item.itemName)}</td>
    <td>${escapeHtml(item.brandType)}</td>
    <td>${item.km ?? "-"}</td>
    <td>${item.quantity}</td>
    <td>${escapeHtml(item.unit)}</td>
    <td>${escapeHtml(item.description)}</td>
  </tr>`;
}

function buildBlankRow(): string {
  return `<tr class="blank-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>`;
}

export function buildSubmissionPdfHtml(data: SubmissionPdfData): string {
  const itemRows = data.items.map(buildItemRow).join("");
  const blankRowCount = Math.max(0, TOTAL_ROWS - data.items.length);
  const blankRows = Array.from({ length: blankRowCount }, buildBlankRow).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 24px; }
  table { border-collapse: collapse; width: 100%; }
  .header-table td { vertical-align: top; padding: 4px; }
  .header-title { text-align: right; font-weight: bold; font-size: 16px; }
  .header-subtitle { text-align: right; font-size: 12px; }
  .info-table td { border: 1px solid #333; padding: 4px 8px; }
  .info-table td.label { width: 160px; background: #f3f3f3; }
  .items-table { margin-top: 12px; }
  .items-table th, .items-table td { border: 1px solid #333; padding: 4px 6px; text-align: left; }
  .items-table th { background: #f3f3f3; }
  .signature-table { margin-top: 32px; }
  .signature-table td { text-align: center; padding: 8px; width: 50%; }
  .signature-table img { height: 60px; margin: 8px 0; }
</style>
</head>
<body>
  <table class="header-table">
    <tr>
      <td style="width: 60%;">
        Kepada Yth,<br>
        Departemen General Affair<br>
        PT TRIDAYA SINERGI INDONESIA
      </td>
      <td>
        <div class="header-title">FORMULIR PERMOHONAN</div>
        <div class="header-subtitle">DIVISI GENERAL AFFAIR</div>
        <table style="margin-top: 8px;">
          <tr><td>Nomor Permintaan</td><td style="border: 1px solid #333;">${escapeHtml(data.submissionNumber)}</td></tr>
          <tr><td>Tanggal</td><td style="border: 1px solid #333;">${formatTanggal(data.submittedAt)}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <table class="info-table" style="margin-top: 16px;">
    <tr><td class="label">Nama Pemohon</td><td>${escapeHtml(data.requesterName)}</td></tr>
    <tr><td class="label">Departemen</td><td>${escapeHtml(data.department)}</td></tr>
    <tr><td class="label">Warehouse</td><td>${escapeHtml(data.branch)}</td></tr>
    <tr><td class="label">Jabatan</td><td>${escapeHtml(data.position)}</td></tr>
    <tr><td class="label">Jenis Permohonan</td><td>${TYPE_LABELS[data.type]}</td></tr>
  </table>

  <table class="items-table">
    <thead>
      <tr>
        <th>Nama Barang</th>
        <th>Merk / Type</th>
        <th>KM</th>
        <th>Jumlah</th>
        <th>Satuan</th>
        <th>Deskripsi</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      ${blankRows}
    </tbody>
  </table>

  <table class="signature-table">
    <tr>
      <td>
        Dibuat Oleh,<br>
        <img src="${data.requesterSignatureUrl}" alt="Tanda tangan pemohon"><br>
        ${escapeHtml(data.requesterName)}<br>
        Pemohon
      </td>
      <td>
        Mengetahui,<br>
        <img src="${data.approverSignatureUrl}" alt="Tanda tangan approver"><br>
        ${escapeHtml(data.approverName)}<br>
        ${escapeHtml(data.approverPosition)}
      </td>
    </tr>
  </table>
</body>
</html>`;
}
