"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  createSubmissionSchema,
  CreateSubmissionInput,
  subTypeByType,
  createPersonaliaSubmissionSchema,
  CreatePersonaliaSubmissionInput,
  PERSONALIA_SUBTYPE_LABEL,
} from "@/lib/schemas/submission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header/PageHeader";
import { SignaturePad } from "@/components/signature-pad/SignaturePad";
import { FileUpload } from "@/components/file-upload/FileUpload";
import { useAuth } from "@/lib/hooks/useAuth";
import { submitSubmission } from "@/lib/submissions/submitSubmission";
import { submitPersonaliaSubmission } from "@/lib/submissions/submitPersonaliaSubmission";
import type { AppUser } from "@/lib/hooks/useAuth";
import { AlertCircle, FileText, Paperclip, PenLine, Plus, Trash2 } from "lucide-react";

type OperationalType = keyof typeof subTypeByType;
type Category = OperationalType | "lembur" | "cuti" | "izin";

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "kendaraan", label: "Kendaraan" },
  { value: "perlengkapan", label: "Perlengkapan" },
  { value: "gedung_fasilitas", label: "Gedung & Fasilitas" },
  { value: "lembur", label: "Lembur" },
  { value: "cuti", label: "Cuti" },
  { value: "izin", label: "Izin" },
];

const PERSONALIA_ALLOWED_ROLES: Record<"lembur" | "cuti" | "izin", AppUser["role"][]> = {
  lembur: ["admin_cabang", "snd"],
  cuti: ["admin_cabang", "snd", "spv"],
  izin: ["admin_cabang", "snd", "spv"],
};

function categoryOptionsForRole(role: AppUser["role"] | undefined): typeof CATEGORY_OPTIONS {
  if (!role) return CATEGORY_OPTIONS;
  return CATEGORY_OPTIONS.filter((opt) => {
    if (opt.value === "lembur" || opt.value === "cuti" || opt.value === "izin") {
      return PERSONALIA_ALLOWED_ROLES[opt.value].includes(role);
    }
    return true;
  });
}

function isPersonaliaCategory(category: Category): category is "lembur" | "cuti" | "izin" {
  return category === "lembur" || category === "cuti" || category === "izin";
}

export default function NewPengajuanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appUser } = useAuth();
  const resubmitId = searchParams.get("resubmit") ?? undefined;
  const [category, setCategory] = useState<Category>("kendaraan");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoadingResubmit, setIsLoadingResubmit] = useState(!!resubmitId);
  const [resubmitError, setResubmitError] = useState<string | null>(null);
  const [signatureMode, setSignatureMode] = useState<"gambar" | "upload">("gambar");
  const [signatureFileName, setSignatureFileName] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof createSubmissionSchema>, unknown, CreateSubmissionInput>({
    resolver: zodResolver(createSubmissionSchema),
    defaultValues: {
      submissionId: resubmitId,
      type: "kendaraan",
      subType: "service_berkala",
      requesterSignatureUrl: "",
      items: [{ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" }],
      attachments: [],
    },
  });

  const {
    register: registerPersonalia,
    handleSubmit: handleSubmitPersonalia,
    setValue: setValuePersonalia,
    watch: watchPersonalia,
    reset: resetPersonalia,
    formState: { errors: personaliaErrors, isSubmitting: isSubmittingPersonalia },
  } = useForm<z.input<typeof createPersonaliaSubmissionSchema>, unknown, CreatePersonaliaSubmissionInput>({
    resolver: zodResolver(createPersonaliaSubmissionSchema),
    defaultValues: {
      submissionId: resubmitId,
      subType: "cuti",
      employeeName: "",
      periodStart: "",
      periodEnd: "",
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const {
    fields: attachmentFields,
    append: appendAttachment,
    remove: removeAttachment,
  } = useFieldArray({ control, name: "attachments" });
  // createSubmissionSchema's "type" field is typed against the full
  // submissionTypeSchema enum (which also includes "personalia", since that's
  // a valid `submissions.type` value in Firestore for the separate personalia
  // form below). This operational branch's category switcher only ever calls
  // setValue("type", ...) with an operational category, so the cast here is
  // safe — it just narrows back down to the keys subTypeByType actually has.
  const selectedType = watch("type") as OperationalType;
  const typeField = register("type");
  const personaliaAttachmentName = watchPersonalia("attachment")?.fileName;

  function handleCategoryChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextCategory = event.target.value as Category;
    setCategory(nextCategory);
    if (!isPersonaliaCategory(nextCategory)) {
      setValue("type", nextCategory);
      setValue("subType", subTypeByType[nextCategory][0]);
    }
  }

  function handleSignatureModeChange(mode: "gambar" | "upload") {
    setSignatureMode(mode);
    setValue("requesterSignatureUrl", "");
    setSignatureFileName(null);
  }

  useEffect(() => {
    if (!resubmitId) return;
    const id = resubmitId;
    let cancelled = false;

    async function loadResubmitData() {
      setIsLoadingResubmit(true);
      setResubmitError(null);
      try {
        const submissionSnap = await getDoc(doc(db, "submissions", id));
        if (!submissionSnap.exists()) {
          throw new Error("Pengajuan tidak ditemukan.");
        }
        const submissionData = submissionSnap.data();

        if (submissionData?.type === "personalia") {
          const attachmentsSnap = await getDocs(collection(db, "submissions", id, "attachments"));
          const firstAttachment = attachmentsSnap.docs[0]?.data();
          if (cancelled) return;
          setCategory(submissionData.subType as Category);
          resetPersonalia({
            submissionId: id,
            subType: submissionData.subType,
            employeeName: submissionData.employeeName ?? "",
            periodStart: submissionData.periodStart ?? "",
            periodEnd: submissionData.periodEnd ?? "",
            attachment: firstAttachment
              ? {
                  fileId: firstAttachment.fileId,
                  fileUrl: firstAttachment.fileUrl,
                  fileName: firstAttachment.fileName,
                  fileType: firstAttachment.fileType,
                }
              : undefined,
          });
          return;
        }

        const itemsSnap = await getDocs(collection(db, "submissions", id, "items"));
        const items = itemsSnap.docs.map((itemDoc) => {
          const data = itemDoc.data();
          return {
            itemName: data.itemName ?? "",
            brandType: data.brandType ?? "",
            km: data.km ?? null,
            quantity: data.quantity ?? 1,
            unit: data.unit ?? "",
            description: data.description ?? "",
          };
        });
        const attachmentsSnap = await getDocs(collection(db, "submissions", id, "attachments"));
        const attachments = attachmentsSnap.docs.map((attachmentDoc) => {
          const data = attachmentDoc.data();
          return {
            fileId: data.fileId ?? "",
            fileUrl: data.fileUrl ?? "",
            fileName: data.fileName ?? "",
            fileType: data.fileType ?? "",
          };
        });

        if (cancelled) return;

        setCategory((submissionData?.type as Category) ?? "kendaraan");
        reset({
          submissionId: id,
          type: submissionData?.type ?? "kendaraan",
          subType: submissionData?.subType ?? "service_berkala",
          requesterSignatureUrl: "",
          items:
            items.length > 0
              ? items
              : [{ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" }],
          attachments,
        });
      } catch (err) {
        if (cancelled) return;
        const code = (err as { code?: string } | undefined)?.code;
        if (code === "permission-denied") {
          setResubmitError("Anda tidak punya akses ke pengajuan ini.");
        } else if (err instanceof Error && err.message === "Pengajuan tidak ditemukan.") {
          setResubmitError(err.message);
        } else {
          setResubmitError("Gagal memuat data pengajuan untuk direvisi.");
        }
      } finally {
        if (!cancelled) setIsLoadingResubmit(false);
      }
    }

    loadResubmitData();
    return () => {
      cancelled = true;
    };
  }, [resubmitId, reset, resetPersonalia]);

  async function onSubmit(data: CreateSubmissionInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      const result = await submitSubmission(data, appUser);
      router.push(`/pengajuan/detail?id=${result.submissionId}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengirim pengajuan.");
    }
  }

  async function onSubmitPersonalia(data: CreatePersonaliaSubmissionInput) {
    if (!appUser) return;
    setServerError(null);
    try {
      const result = await submitPersonaliaSubmission(data, appUser);
      router.push(`/pengajuan/detail?id=${result.submissionId}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengirim pengajuan.");
    }
  }

  if (isLoadingResubmit) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">Memuat data pengajuan...</div>;
  }

  if (resubmitError) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-destructive">{resubmitError}</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title={resubmitId ? "Revisi Pengajuan" : "Buat Pengajuan"}
        description="Isi detail kendaraan, perlengkapan, gedung & fasilitas, atau lembur/cuti/izin yang ingin Anda ajukan."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kategori Pengajuan</CardTitle>
        </CardHeader>
        <CardContent>
          <NativeSelect value={category} onChange={handleCategoryChange} disabled={!!resubmitId}>
            {categoryOptionsForRole(appUser?.role).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </NativeSelect>
        </CardContent>
      </Card>

      {isPersonaliaCategory(category) ? (
        <form onSubmit={handleSubmitPersonalia(onSubmitPersonalia)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Detail Pengajuan {PERSONALIA_SUBTYPE_LABEL[category]}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="employeeName">Nama Karyawan</Label>
                <Input
                  id="employeeName"
                  aria-invalid={!!personaliaErrors.employeeName}
                  aria-describedby={personaliaErrors.employeeName ? "employeeName-error" : undefined}
                  {...registerPersonalia("employeeName")}
                />
                {personaliaErrors.employeeName && (
                  <p id="employeeName-error" className="text-sm text-destructive">
                    {personaliaErrors.employeeName.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodStart">Tanggal Mulai</Label>
                <Input
                  id="periodStart"
                  type="date"
                  aria-invalid={!!personaliaErrors.periodStart}
                  aria-describedby={personaliaErrors.periodStart ? "periodStart-error" : undefined}
                  {...registerPersonalia("periodStart")}
                />
                {personaliaErrors.periodStart && (
                  <p id="periodStart-error" className="text-sm text-destructive">
                    {personaliaErrors.periodStart.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="periodEnd">Tanggal Selesai</Label>
                <Input
                  id="periodEnd"
                  type="date"
                  aria-invalid={!!personaliaErrors.periodEnd}
                  aria-describedby={personaliaErrors.periodEnd ? "periodEnd-error" : undefined}
                  {...registerPersonalia("periodEnd")}
                />
                {personaliaErrors.periodEnd && (
                  <p id="periodEnd-error" className="text-sm text-destructive">
                    {personaliaErrors.periodEnd.message}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Paperclip className="h-4 w-4 text-primary" />
                Dokumen Form {PERSONALIA_SUBTYPE_LABEL[category]}
              </CardTitle>
              <CardDescription>Upload form yang sudah diisi & ditandatangani manual (PDF).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {personaliaAttachmentName ? (
                <div className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                  <span className="truncate">{personaliaAttachmentName}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Hapus dokumen"
                    onClick={() => setValuePersonalia("attachment", undefined as never)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <FileUpload purpose="attachment" onUploaded={(file) => setValuePersonalia("attachment", file)} />
              )}
              {personaliaErrors.attachment && (
                <p className="text-sm text-destructive">Dokumen PDF wajib diupload.</p>
              )}
            </CardContent>
          </Card>

          {serverError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Button type="submit" disabled={isSubmittingPersonalia} size="lg">
            {isSubmittingPersonalia ? "Mengirim..." : "Kirim Pengajuan"}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Sub Jenis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <input type="hidden" {...typeField} />
              <NativeSelect
                id="subType"
                aria-invalid={!!errors.subType}
                aria-describedby={errors.subType ? "subType-error" : undefined}
                {...register("subType")}
              >
                {subTypeByType[selectedType].map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </NativeSelect>
              {errors.subType && (
                <p id="subType-error" className="text-sm text-destructive">
                  {errors.subType.message}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Item</CardTitle>
                <CardDescription>Daftar barang/layanan yang diajukan.</CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" })
                }
              >
                <Plus className="h-4 w-4" />
                Tambah Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {fields.map((field, index) => {
                const itemErrors = errors.items?.[index];
                return (
                  <div key={field.id} className="space-y-3 rounded-xl border bg-muted/30 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Input
                          placeholder="Nama item"
                          aria-label="Nama item"
                          aria-invalid={!!itemErrors?.itemName}
                          aria-describedby={itemErrors?.itemName ? `item-${index}-itemName-error` : undefined}
                          {...register(`items.${index}.itemName`)}
                        />
                        {itemErrors?.itemName && (
                          <p id={`item-${index}-itemName-error`} className="text-sm text-destructive">
                            {itemErrors.itemName.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Input
                          placeholder="Merk/Tipe"
                          aria-label="Merk/Tipe"
                          aria-invalid={!!itemErrors?.brandType}
                          aria-describedby={itemErrors?.brandType ? `item-${index}-brandType-error` : undefined}
                          {...register(`items.${index}.brandType`)}
                        />
                        {itemErrors?.brandType && (
                          <p id={`item-${index}-brandType-error`} className="text-sm text-destructive">
                            {itemErrors.brandType.message}
                          </p>
                        )}
                      </div>
                      {selectedType === "kendaraan" && (
                        <div className="space-y-1.5">
                          <Input
                            type="number"
                            placeholder="KM"
                            aria-label="KM"
                            className="font-mono"
                            aria-invalid={!!itemErrors?.km}
                            aria-describedby={itemErrors?.km ? `item-${index}-km-error` : undefined}
                            {...register(`items.${index}.km`, {
                              setValueAs: (v) => (v === "" ? null : Number(v)),
                            })}
                          />
                          {itemErrors?.km && (
                            <p id={`item-${index}-km-error`} className="text-sm text-destructive">
                              {itemErrors.km.message}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Input
                          type="number"
                          placeholder="Jumlah"
                          aria-label="Jumlah"
                          className="font-mono"
                          aria-invalid={!!itemErrors?.quantity}
                          aria-describedby={itemErrors?.quantity ? `item-${index}-quantity-error` : undefined}
                          {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                        />
                        {itemErrors?.quantity && (
                          <p id={`item-${index}-quantity-error`} className="text-sm text-destructive">
                            {itemErrors.quantity.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Input
                          placeholder="Satuan"
                          aria-label="Satuan"
                          aria-invalid={!!itemErrors?.unit}
                          aria-describedby={itemErrors?.unit ? `item-${index}-unit-error` : undefined}
                          {...register(`items.${index}.unit`)}
                        />
                        {itemErrors?.unit && (
                          <p id={`item-${index}-unit-error`} className="text-sm text-destructive">
                            {itemErrors.unit.message}
                          </p>
                        )}
                      </div>
                    </div>
                    <Textarea placeholder="Deskripsi" aria-label="Deskripsi" {...register(`items.${index}.description`)} />
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Hapus Item
                      </Button>
                    )}
                  </div>
                );
              })}
              {errors.items && !Array.isArray(errors.items) && (
                <p className="text-sm text-destructive">{errors.items.message as string}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Paperclip className="h-4 w-4 text-primary" />
                Lampiran <span className="font-normal text-muted-foreground">(opsional)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {attachmentFields.map((field, index) => (
                <div key={field.id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                  <span className="truncate">{field.fileName}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Hapus lampiran ${field.fileName}`}
                    onClick={() => removeAttachment(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <FileUpload purpose="attachment" onUploaded={(file) => appendAttachment(file)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PenLine className="h-4 w-4 text-primary" />
                Tanda Tangan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2" role="group" aria-label="Mode tanda tangan">
                <Button
                  type="button"
                  variant={signatureMode === "gambar" ? "default" : "outline"}
                  size="sm"
                  aria-pressed={signatureMode === "gambar"}
                  onClick={() => handleSignatureModeChange("gambar")}
                >
                  Gambar
                </Button>
                <Button
                  type="button"
                  variant={signatureMode === "upload" ? "default" : "outline"}
                  size="sm"
                  aria-pressed={signatureMode === "upload"}
                  onClick={() => handleSignatureModeChange("upload")}
                >
                  Upload File
                </Button>
              </div>
              {signatureMode === "gambar" ? (
                <SignaturePad onChange={(dataUrl) => setValue("requesterSignatureUrl", dataUrl ?? "")} />
              ) : (
                <>
                  <FileUpload
                    purpose="signature"
                    onUploaded={(file) => {
                      setValue("requesterSignatureUrl", file.fileUrl);
                      setSignatureFileName(file.fileName);
                    }}
                  />
                  {signatureFileName && (
                    <p className="text-sm text-muted-foreground">Berhasil diupload: {signatureFileName}</p>
                  )}
                </>
              )}
              {errors.requesterSignatureUrl && (
                <p role="alert" className="text-sm text-destructive">
                  Tanda tangan wajib diisi.
                </p>
              )}
            </CardContent>
          </Card>

          {serverError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Button type="submit" disabled={isSubmitting} size="lg">
            {isSubmitting ? "Mengirim..." : "Kirim Pengajuan"}
          </Button>
        </form>
      )}
    </div>
  );
}
