"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { firebaseApp } from "@/lib/firebase/client";
import { createSubmissionSchema, CreateSubmissionInput, subTypeByType } from "@/lib/schemas/submission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/signature-pad/SignaturePad";

const functions = getFunctions(firebaseApp);
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  try {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  } catch (error) {
    // connectFunctionsEmulator throws if called again on an already-configured
    // instance (e.g. Next.js Fast Refresh re-evaluating this module).
    console.warn("[functions] Emulator connection skipped (already configured):", error);
  }
}

export default function NewPengajuanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resubmitId = searchParams.get("resubmit") ?? undefined;
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateSubmissionInput>({
    resolver: zodResolver(createSubmissionSchema),
    defaultValues: {
      submissionId: resubmitId,
      type: "kendaraan",
      subType: "service_berkala",
      requesterSignatureUrl: "",
      items: [{ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const selectedType = watch("type");

  useEffect(() => {
    setValue("subType", subTypeByType[selectedType][0]);
  }, [selectedType, setValue]);

  async function onSubmit(data: CreateSubmissionInput) {
    setServerError(null);
    try {
      const submitSubmission = httpsCallable(functions, "submitSubmission");
      const result = await submitSubmission(data);
      router.push(`/pengajuan/${(result.data as { submissionId: string }).submissionId}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Gagal mengirim pengajuan.");
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Buat Pengajuan</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-1">
          <Label htmlFor="type">Jenis Pengajuan</Label>
          <select id="type" {...register("type")} className="w-full rounded border p-2">
            <option value="kendaraan">Kendaraan</option>
            <option value="perlengkapan">Perlengkapan</option>
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="subType">Sub Jenis</Label>
          <select id="subType" {...register("subType")} className="w-full rounded border p-2">
            {subTypeByType[selectedType].map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          {errors.subType && <p className="text-sm text-red-600">{errors.subType.message}</p>}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Item</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                append({ itemName: "", brandType: "", km: null, quantity: 1, unit: "", description: "" })
              }
            >
              Tambah Item
            </Button>
          </div>
          {fields.map((field, index) => {
            const itemErrors = errors.items?.[index];
            return (
              <div key={field.id} className="grid grid-cols-2 gap-2 rounded border p-3">
                <div className="space-y-1">
                  <Input placeholder="Nama item" {...register(`items.${index}.itemName`)} />
                  {itemErrors?.itemName && (
                    <p className="text-sm text-red-600">{itemErrors.itemName.message}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Input placeholder="Merk/Tipe" {...register(`items.${index}.brandType`)} />
                  {itemErrors?.brandType && (
                    <p className="text-sm text-red-600">{itemErrors.brandType.message}</p>
                  )}
                </div>
                {selectedType === "kendaraan" && (
                  <div className="space-y-1">
                    <Input
                      type="number"
                      placeholder="KM"
                      {...register(`items.${index}.km`, {
                        setValueAs: (v) => (v === "" ? null : Number(v)),
                      })}
                    />
                    {itemErrors?.km && <p className="text-sm text-red-600">{itemErrors.km.message}</p>}
                  </div>
                )}
                <div className="space-y-1">
                  <Input
                    type="number"
                    placeholder="Jumlah"
                    {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                  />
                  {itemErrors?.quantity && (
                    <p className="text-sm text-red-600">{itemErrors.quantity.message}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Input placeholder="Satuan" {...register(`items.${index}.unit`)} />
                  {itemErrors?.unit && <p className="text-sm text-red-600">{itemErrors.unit.message}</p>}
                </div>
                <Textarea placeholder="Deskripsi" {...register(`items.${index}.description`)} />
                {fields.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                    Hapus
                  </Button>
                )}
              </div>
            );
          })}
          {errors.items && !Array.isArray(errors.items) && (
            <p className="text-sm text-red-600">{errors.items.message as string}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label>Tanda Tangan</Label>
          <SignaturePad onChange={(dataUrl) => setValue("requesterSignatureUrl", dataUrl ?? "")} />
          {errors.requesterSignatureUrl && <p className="text-sm text-red-600">Tanda tangan wajib diisi.</p>}
        </div>

        {serverError && <p className="text-sm text-red-600">{serverError}</p>}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Mengirim..." : "Kirim Pengajuan"}
        </Button>
      </form>
    </main>
  );
}
