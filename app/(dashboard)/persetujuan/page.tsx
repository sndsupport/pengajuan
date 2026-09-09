"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { generateAndAttachSubmissionPdf } from "@/lib/pdf/generateAndAttachSubmissionPdf";
import { SignaturePlacementModal } from "@/components/pdf/SignaturePlacementModal";
import type { SubmissionPdfData, SubmissionPdfItem } from "@/lib/pdf/pdfTemplate";
import type { SignaturePositionPx } from "@/lib/pdf/signaturePosition";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { SignaturePad } from "@/components/signature-pad/SignaturePad";
import { FileUpload } from "@/components/file-upload/FileUpload";
import { AttachmentsList } from "@/components/attachments-list/AttachmentsList";
import { reviewSubmission } from "@/lib/submissions/reviewSubmission";
import { reviewPersonaliaSubmission } from "@/lib/submissions/reviewPersonaliaSubmission";
import { AlertCircle, Check, ClipboardCheck, X } from "lucide-react";
import { TYPE_LABEL } from "@/lib/schemas/submission";

type ApprovalRecord = { approverId: string; approverName: string } | null;
type QueueRow = {
  id: string;
  submissionNumber: string;
  type: string;
  subType: string;
  branch: string;
  department: string;
  position: string;
  employeeName: string;
  requesterSignatureUrl: string;
  spvApproval: ApprovalRecord;
  managerApproval: ApprovalRecord;
  submittedAt: Date | null;
};

function formatSubmittedAt(date: Date | null): string {
  if (!date) return "-";
  return date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default function PersetujuanPage() {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [noteBySubmission, setNoteBySubmission] = useState<Record<string, string>>({});
  const [signatureBySubmission, setSignatureBySubmission] = useState<Record<string, string>>({});
  const [signatureModeBySubmission, setSignatureModeBySubmission] = useState<Record<string, "gambar" | "upload">>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionErrorBySubmission, setActionErrorBySubmission] = useState<Record<string, string>>({});
  const [placement, setPlacement] = useState<{
    row: QueueRow;
    data: Omit<SubmissionPdfData, "approverSignatureUrl">;
    signatureImageUrl: string;
  } | null>(null);

  useEffect(() => {
    // Per the brief's role table, superadmin can read/monitor but not approve/reject —
    // matches reviewSubmissionHandler's own role check, so this page's action buttons
    // are only ever shown to roles that can actually use them.
    if (!loading && appUser && !["spv", "management"].includes(appUser.role)) {
      router.replace("/pengajuan");
    }
  }, [loading, appUser, router]);

  useEffect(() => {
    const q = query(collection(db, "submissions"), where("status", "==", "diajukan"), orderBy("submittedAt", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        setListError(null);
        setRows(
          snap.docs.map((d) => ({
            id: d.id,
            submissionNumber: d.data().submissionNumber,
            type: d.data().type,
            subType: d.data().subType,
            branch: d.data().branch,
            department: d.data().department,
            position: d.data().position,
            employeeName: d.data().employeeName,
            requesterSignatureUrl: d.data().requesterSignatureUrl,
            spvApproval: d.data().spvApproval ?? null,
            managerApproval: d.data().managerApproval ?? null,
            submittedAt: d.data().submittedAt?.toDate() ?? null,
          }))
        );
      },
      (err) => {
        setListError(err.code);
      }
    );
  }, []);

  function handleSignatureModeChange(submissionId: string, mode: "gambar" | "upload") {
    setSignatureModeBySubmission((prev) => ({ ...prev, [submissionId]: mode }));
    setSignatureBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
  }

  async function handleReject(submissionId: string) {
    if (!appUser) return;
    setBusyId(submissionId);
    setActionErrorBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
    try {
      await reviewSubmission(
        { submissionId, decision: "reject", rejectionNote: noteBySubmission[submissionId] },
        appUser
      );
    } catch (err) {
      setActionErrorBySubmission((prev) => ({
        ...prev,
        [submissionId]: err instanceof Error ? err.message : "Gagal memproses review.",
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveClick(row: QueueRow) {
    if (!appUser) return;
    const signatureUrl = signatureBySubmission[row.id];
    if (!signatureUrl) return;
    setActionErrorBySubmission((prev) => ({ ...prev, [row.id]: "" }));
    try {
      const itemsSnap = await getDocs(collection(db, "submissions", row.id, "items"));
      const items: SubmissionPdfItem[] = itemsSnap.docs.map((d) => {
        const item = d.data();
        return {
          itemName: item.itemName as string,
          brandType: item.brandType as string,
          km: (item.km as number | null) ?? null,
          quantity: item.quantity as number,
          unit: item.unit as string,
          description: item.description as string,
        };
      });
      setPlacement({
        row,
        signatureImageUrl: signatureUrl,
        data: {
          submissionNumber: row.submissionNumber,
          type: row.type as "kendaraan" | "perlengkapan" | "gedung_fasilitas",
          subType: row.subType,
          branch: row.branch,
          department: row.department,
          position: row.position,
          requesterName: row.employeeName,
          requesterSignatureUrl: row.requesterSignatureUrl,
          approverName: appUser.name,
          approverRole: appUser.role as "spv" | "management",
          submittedAt: row.submittedAt ?? new Date(),
          approvedAt: new Date(),
          items,
        },
      });
    } catch (err) {
      setActionErrorBySubmission((prev) => ({
        ...prev,
        [row.id]: err instanceof Error ? err.message : "Gagal menyiapkan preview PDF.",
      }));
    }
  }

  async function handleConfirmPlacement(position: SignaturePositionPx) {
    if (!placement || !appUser) return;
    const { row } = placement;
    setBusyId(row.id);
    try {
      await reviewSubmission(
        { submissionId: row.id, decision: "approve", approverSignatureUrl: signatureBySubmission[row.id] },
        appUser
      );
      await generateAndAttachSubmissionPdf(row.id, appUser, position);
      setPlacement(null);
    } finally {
      setBusyId(null);
    }
  }

  async function handlePersonaliaDecision(submissionId: string, decision: "approve" | "reject") {
    if (!appUser) return;
    setBusyId(submissionId);
    setActionErrorBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
    try {
      await reviewPersonaliaSubmission(
        {
          submissionId,
          decision,
          rejectionNote: noteBySubmission[submissionId],
        },
        appUser
      );
    } catch (err) {
      setActionErrorBySubmission((prev) => ({
        ...prev,
        [submissionId]: err instanceof Error ? err.message : "Gagal memproses review.",
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Antrian Persetujuan"
        description="Tinjau pengajuan yang menunggu keputusan Anda sebagai AWS Supervisor / Operational Manager."
      />

      {listError ? (
        <EmptyState
          icon={AlertCircle}
          variant="error"
          title="Gagal memuat antrian"
          description="Coba muat ulang halaman."
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Tidak ada pengajuan menunggu review." />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            if (row.type === "personalia") {
              const ownApproval = appUser?.role === "spv" ? row.spvApproval : row.managerApproval;
              const otherApproval = appUser?.role === "spv" ? row.managerApproval : row.spvApproval;
              const otherRoleLabel = appUser?.role === "spv" ? "Operational Manager" : "AWS Supervisor";
              return (
                <Card key={row.id}>
                  <CardHeader className="flex-row items-center justify-between space-y-0 border-b">
                    <div>
                      <p className="font-mono text-sm font-semibold">{row.submissionNumber}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        Diajukan: {formatSubmittedAt(row.submittedAt)}
                      </p>
                      <p className="text-sm font-medium">{row.employeeName || "-"}</p>
                      <p className="text-sm text-muted-foreground">
                        {TYPE_LABEL[row.type] ?? row.type} · {row.branch}
                      </p>
                    </div>
                    <StatusBadge status="diajukan" />
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    {ownApproval ? (
                      <p className="text-sm text-muted-foreground">
                        Anda sudah menyetujui pengajuan ini{otherApproval ? "" : `, menunggu ${otherRoleLabel}`}.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        <Label htmlFor={`note-${row.id}`}>Catatan (wajib jika tolak)</Label>
                        <Textarea
                          id={`note-${row.id}`}
                          placeholder="Tulis catatan revisi di sini..."
                          value={noteBySubmission[row.id] ?? ""}
                          onChange={(e) => setNoteBySubmission((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        />
                      </div>
                    )}
                    {actionErrorBySubmission[row.id] && (
                      <p role="alert" className="text-sm text-destructive">
                        {actionErrorBySubmission[row.id]}
                      </p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="lg"
                        disabled={busyId === row.id || !appUser || !!ownApproval}
                        onClick={() => handlePersonaliaDecision(row.id, "approve")}
                      >
                        <Check className="h-4 w-4" />
                        Setujui
                      </Button>
                      <Button
                        size="lg"
                        variant="destructive"
                        disabled={busyId === row.id || !appUser || !!ownApproval || !noteBySubmission[row.id]?.trim()}
                        onClick={() => handlePersonaliaDecision(row.id, "reject")}
                      >
                        <X className="h-4 w-4" />
                        Tolak
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            }

            const mode = signatureModeBySubmission[row.id] ?? "gambar";
            const hasSignature = !!signatureBySubmission[row.id];
            return (
              <Card key={row.id}>
                <CardHeader className="flex-row items-center justify-between space-y-0 border-b">
                  <div>
                    <p className="font-mono text-sm font-semibold">{row.submissionNumber}</p>
                    <p className="text-sm font-medium">{row.employeeName || "-"}</p>
                    <p className="text-sm text-muted-foreground">
                      {TYPE_LABEL[row.type] ?? row.type} · {row.branch}
                    </p>
                  </div>
                  <StatusBadge status="diajukan" />
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  <AttachmentsList submissionId={row.id} />
                  <div className="space-y-1.5">
                    <Label htmlFor={`note-${row.id}`}>Catatan (wajib jika tolak)</Label>
                    <Textarea
                      id={`note-${row.id}`}
                      placeholder="Tulis catatan revisi di sini..."
                      value={noteBySubmission[row.id] ?? ""}
                      onChange={(e) => setNoteBySubmission((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tanda Tangan Approver (wajib untuk Setujui)</Label>
                    <div className="flex gap-2" role="group" aria-label="Mode tanda tangan">
                      <Button
                        type="button"
                        variant={mode === "gambar" ? "default" : "outline"}
                        size="sm"
                        aria-pressed={mode === "gambar"}
                        onClick={() => handleSignatureModeChange(row.id, "gambar")}
                      >
                        Gambar
                      </Button>
                      <Button
                        type="button"
                        variant={mode === "upload" ? "default" : "outline"}
                        size="sm"
                        aria-pressed={mode === "upload"}
                        onClick={() => handleSignatureModeChange(row.id, "upload")}
                      >
                        Upload File
                      </Button>
                    </div>
                    {mode === "gambar" ? (
                      <SignaturePad
                        onChange={(dataUrl) =>
                          setSignatureBySubmission((prev) => ({ ...prev, [row.id]: dataUrl ?? "" }))
                        }
                      />
                    ) : (
                      <FileUpload
                        purpose="signature"
                        onUploaded={(file) =>
                          setSignatureBySubmission((prev) => ({ ...prev, [row.id]: file.fileUrl }))
                        }
                      />
                    )}
                  </div>
                  {actionErrorBySubmission[row.id] && (
                    <p role="alert" className="text-sm text-destructive">
                      {actionErrorBySubmission[row.id]}
                    </p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="lg"
                      disabled={busyId === row.id || !hasSignature || !appUser}
                      onClick={() => handleApproveClick(row)}
                    >
                      <Check className="h-4 w-4" />
                      Setujui
                    </Button>
                    <Button
                      size="lg"
                      variant="destructive"
                      disabled={busyId === row.id || !appUser || !noteBySubmission[row.id]?.trim()}
                      onClick={() => handleReject(row.id)}
                    >
                      <X className="h-4 w-4" />
                      Tolak
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {placement && (
        <SignaturePlacementModal
          data={placement.data}
          signatureImageUrl={placement.signatureImageUrl}
          onConfirm={handleConfirmPlacement}
          onCancel={() => setPlacement(null)}
        />
      )}
    </div>
  );
}
