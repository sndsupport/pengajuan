"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { createSubmissionSchema, CreateSubmissionInput, subTypeByType } from "@/lib/schemas/submission";
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
import { AlertCircle, FileText, Paperclip, PenLine, Plus, Trash2 } from "lucide-react";

export default function NewPengajuanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appUser } = useAuth();
  const resubmitId = searchParams.get("resubmit") ?? undefined;
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

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const {
    fields: attachmentFields,
    append: appendAttachment,
    remove: removeAttachment,
  } = useFieldArray({ control, name: "attachments" });
  const selectedType = watch("type");
  const typeField = register("type");

  // When the user changes "Jenis Pengajuan" via the dropdown, default subType
  // to the first valid option for the new type. This is wired as an onChange
  // handler (rather than a useEffect on the watched value) specifically so it
  // only fires on user interaction — a useEffect keyed on `selectedType` would
  // also fire right after `reset()` populates the resubmit data below, and
  // clobber the freshly-loaded subType with the default.
  function handleTypeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    typeField.onChange(event);
    const nextType = event.target.value as CreateSubmissionInput["type"];
    setValue("subType", subTypeByType[nextType][0]);
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
  }, [resubmitId, reset]);

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
        description="Isi detail kendaraan atau perlengkapan yang ingin Anda ajukan."
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />
              Detail Pengajuan
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="type">Jenis Pengajuan</Label>
              <NativeSelect id="type" {...typeField} onChange={handleTypeChange}>
                <option value="kendaraan">Kendaraan</option>
                <option value="perlengkapan">Perlengkapan</option>
              </NativeSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="subType">Sub Jenis</Label>
              <NativeSelect id="subType" {...register("subType")}>
                {subTypeByType[selectedType].map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </NativeSelect>
              {errors.subType && <p className="text-sm text-destructive">{errors.subType.message}</p>}
            </div>
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
                      <Input placeholder="Nama item" {...register(`items.${index}.itemName`)} />
                      {itemErrors?.itemName && (
                        <p className="text-sm text-destructive">{itemErrors.itemName.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Input placeholder="Merk/Tipe" {...register(`items.${index}.brandType`)} />
                      {itemErrors?.brandType && (
                        <p className="text-sm text-destructive">{itemErrors.brandType.message}</p>
                      )}
                    </div>
                    {selectedType === "kendaraan" && (
                      <div className="space-y-1.5">
                        <Input
                          type="number"
                          placeholder="KM"
                          className="font-mono"
                          {...register(`items.${index}.km`, {
                            setValueAs: (v) => (v === "" ? null : Number(v)),
                          })}
                        />
                        {itemErrors?.km && <p className="text-sm text-destructive">{itemErrors.km.message}</p>}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Input
                        type="number"
                        placeholder="Jumlah"
                        className="font-mono"
                        {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                      />
                      {itemErrors?.quantity && (
                        <p className="text-sm text-destructive">{itemErrors.quantity.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Input placeholder="Satuan" {...register(`items.${index}.unit`)} />
                      {itemErrors?.unit && <p className="text-sm text-destructive">{itemErrors.unit.message}</p>}
                    </div>
                  </div>
                  <Textarea placeholder="Deskripsi" {...register(`items.${index}.description`)} />
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
                <Button type="button" variant="ghost" size="sm" onClick={() => removeAttachment(index)}>
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
            <div className="flex gap-2">
              <Button
                type="button"
                variant={signatureMode === "gambar" ? "default" : "outline"}
                size="sm"
                onClick={() => handleSignatureModeChange("gambar")}
              >
                Gambar
              </Button>
              <Button
                type="button"
                variant={signatureMode === "upload" ? "default" : "outline"}
                size="sm"
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
              <p className="text-sm text-destructive">Tanda tangan wajib diisi.</p>
            )}
          </CardContent>
        </Card>

        {serverError && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <Button type="submit" disabled={isSubmitting} size="lg">
          {isSubmitting ? "Mengirim..." : "Kirim Pengajuan"}
        </Button>
      </form>
    </div>
  );
}
