"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { StatusBadge } from "@/components/status-badge/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { EmptyState } from "@/components/empty-state/EmptyState";
import { SignaturePad } from "@/components/signature-pad/SignaturePad";
import { FileUpload } from "@/components/file-upload/FileUpload";
import { reviewSubmission } from "@/lib/submissions/reviewSubmission";
import { reviewPersonaliaSubmission } from "@/lib/submissions/reviewPersonaliaSubmission";
import { AlertCircle, Check, ClipboardCheck, X } from "lucide-react";
import { TYPE_LABEL } from "@/lib/schemas/submission";

type QueueRow = { id: string; submissionNumber: string; type: string; subType: string; branch: string };

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

  async function handleDecision(submissionId: string, decision: "approve" | "reject") {
    if (!appUser) return;
    setBusyId(submissionId);
    setActionErrorBySubmission((prev) => ({ ...prev, [submissionId]: "" }));
    try {
      await reviewSubmission(
        {
          submissionId,
          decision,
          rejectionNote: noteBySubmission[submissionId],
          approverSignatureUrl: decision === "approve" ? signatureBySubmission[submissionId] : undefined,
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
              return (
                <Card key={row.id}>
                  <CardHeader className="flex-row items-center justify-between space-y-0 border-b">
                    <div>
                      <p className="font-mono text-sm font-semibold">{row.submissionNumber}</p>
                      <p className="text-sm text-muted-foreground">
                        {TYPE_LABEL[row.type] ?? row.type} · {row.branch}
                      </p>
                    </div>
                    <StatusBadge status="diajukan" />
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <div className="space-y-1.5">
                      <Label htmlFor={`note-${row.id}`}>Catatan (wajib jika tolak)</Label>
                      <Textarea
                        id={`note-${row.id}`}
                        placeholder="Tulis catatan revisi di sini..."
                        value={noteBySubmission[row.id] ?? ""}
                        onChange={(e) => setNoteBySubmission((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      />
                    </div>
                    {actionErrorBySubmission[row.id] && (
                      <p className="text-sm text-destructive">{actionErrorBySubmission[row.id]}</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        disabled={busyId === row.id || !appUser}
                        onClick={() => handlePersonaliaDecision(row.id, "approve")}
                      >
                        <Check className="h-4 w-4" />
                        Setujui
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busyId === row.id || !appUser}
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
                    <p className="text-sm text-muted-foreground">
                      {TYPE_LABEL[row.type] ?? row.type} · {row.branch}
                    </p>
                  </div>
                  <StatusBadge status="diajukan" />
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
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
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={mode === "gambar" ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleSignatureModeChange(row.id, "gambar")}
                      >
                        Gambar
                      </Button>
                      <Button
                        type="button"
                        variant={mode === "upload" ? "default" : "outline"}
                        size="sm"
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
                    <p className="text-sm text-destructive">{actionErrorBySubmission[row.id]}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={busyId === row.id || !hasSignature || !appUser}
                      onClick={() => handleDecision(row.id, "approve")}
                    >
                      <Check className="h-4 w-4" />
                      Setujui
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyId === row.id || !appUser}
                      onClick={() => handleDecision(row.id, "reject")}
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
    </div>
  );
}
