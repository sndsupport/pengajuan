import { z } from "zod";

export const subTypeByType = {
  kendaraan: ["service_berkala", "service_insidentil", "pengadaan_baru"] as const,
  perlengkapan: ["pengadaan_baru", "penggantian"] as const,
};

export const itemSchema = z.object({
  itemName: z.string().min(1),
  brandType: z.string().min(1),
  km: z.number().int().nonnegative().nullable(),
  quantity: z.number().int().positive(),
  unit: z.string().min(1),
  description: z.string(),
});

export const createSubmissionSchema = z
  .object({
    submissionId: z.string().nullish(),
    type: z.enum(["kendaraan", "perlengkapan"]),
    subType: z.string(),
    requesterSignatureUrl: z.string().url(),
    items: z.array(itemSchema).min(1),
  })
  .refine((data) => (subTypeByType[data.type] as readonly string[]).includes(data.subType), {
    message: "subType tidak valid untuk type ini",
    path: ["subType"],
  });

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export const reviewSubmissionSchema = z
  .object({
    submissionId: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
    rejectionNote: z.string().nullish(),
  })
  .refine((data) => data.decision !== "reject" || (data.rejectionNote && data.rejectionNote.trim().length > 0), {
    message: "rejectionNote wajib diisi saat reject",
    path: ["rejectionNote"],
  });

export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;
