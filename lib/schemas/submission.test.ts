// lib/schemas/submission.test.ts
import { describe, it, expect } from "vitest";
import {
  createSubmissionSchema,
  reviewSubmissionSchema,
  uploadFileSchema,
  confirmSentToGaSchema,
  markAsDoneSchema,
  createPersonaliaSubmissionSchema,
  reviewPersonaliaSubmissionSchema,
} from "./submission";

describe("createSubmissionSchema", () => {
  const validPayload = {
    type: "kendaraan" as const,
    subType: "service_berkala" as const,
    employeeId: "emp-1",
    requesterSignatureUrl: "https://storage.example.com/sig.png",
    items: [
      { itemName: "Toyota Avanza", brandType: "Toyota Avanza 1.3", km: 45000, quantity: 1, unit: "unit", description: "Service 40rb km" },
    ],
  };

  it("accepts a valid kendaraan payload", () => {
    expect(createSubmissionSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects subType not valid for the given type", () => {
    const result = createSubmissionSchema.safeParse({ ...validPayload, subType: "penggantian" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty items array", () => {
    const result = createSubmissionSchema.safeParse({ ...validPayload, items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a missing employeeId", () => {
    const { employeeId, ...rest } = validPayload;
    expect(createSubmissionSchema.safeParse(rest).success).toBe(false);
  });

  it("allows km to be null for perlengkapan", () => {
    const payload = {
      type: "perlengkapan" as const,
      subType: "pengadaan_baru" as const,
      employeeId: "emp-1",
      requesterSignatureUrl: "https://storage.example.com/sig.png",
      items: [{ itemName: "Kertas A4", brandType: "Sinar Dunia", km: null, quantity: 10, unit: "rim", description: "" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(true);
  });

  it("allows submissionId to be null (httpsCallable serializes an absent field as null on the wire)", () => {
    const result = createSubmissionSchema.safeParse({ ...validPayload, submissionId: null });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with attachments and preserves them", () => {
    const payload = {
      ...validPayload,
      attachments: [
        { fileId: "file-abc", fileUrl: "https://drive.google.com/file/d/abc/view", fileName: "nota.png", fileType: "image/png" },
      ],
    };
    const result = createSubmissionSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments).toEqual(payload.attachments);
    }
  });

  it("defaults attachments to an empty array when omitted", () => {
    const result = createSubmissionSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments).toEqual([]);
    }
  });

  it("rejects an attachment with an invalid fileUrl", () => {
    const payload = {
      ...validPayload,
      attachments: [{ fileId: "file-abc", fileUrl: "not-a-url", fileName: "nota.png", fileType: "image/png" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects an attachment missing fileId", () => {
    const payload = {
      ...validPayload,
      attachments: [{ fileUrl: "https://drive.google.com/file/d/abc/view", fileName: "nota.png", fileType: "image/png" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(false);
  });
});

describe("createSubmissionSchema — gedung_fasilitas", () => {
  it("accepts a valid gedung_fasilitas payload without km", () => {
    const payload = {
      type: "gedung_fasilitas" as const,
      subType: "perbaikan" as const,
      employeeId: "emp-1",
      requesterSignatureUrl: "https://storage.example.com/sig.png",
      items: [{ itemName: "AC ruang meeting", brandType: "Daikin 1PK", km: null, quantity: 1, unit: "unit", description: "Bocor freon" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects a subType not valid for gedung_fasilitas", () => {
    const payload = {
      type: "gedung_fasilitas" as const,
      subType: "service_berkala",
      requesterSignatureUrl: "https://storage.example.com/sig.png",
      items: [{ itemName: "AC ruang meeting", brandType: "Daikin 1PK", km: null, quantity: 1, unit: "unit", description: "" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects type personalia via safeParse instead of throwing (no subTypeByType entry for it)", () => {
    expect(() =>
      createSubmissionSchema.safeParse({
        type: "personalia",
        subType: "lembur",
        requesterSignatureUrl: "https://storage.example.com/sig.png",
        items: [{ itemName: "x", brandType: "x", km: null, quantity: 1, unit: "x", description: "" }],
      })
    ).not.toThrow();
    const result = createSubmissionSchema.safeParse({
      type: "personalia",
      subType: "lembur",
      requesterSignatureUrl: "https://storage.example.com/sig.png",
      items: [{ itemName: "x", brandType: "x", km: null, quantity: 1, unit: "x", description: "" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("reviewSubmissionSchema", () => {
  it("requires rejectionNote when decision is reject", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: "" });
    expect(result.success).toBe(false);
  });

  it("accepts reject with a non-empty rejectionNote", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: "Data KM tidak sesuai" });
    expect(result.success).toBe(true);
  });

  it("accepts approve with approverSignatureUrl", () => {
    const result = reviewSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "approve",
      approverSignatureUrl: "https://drive.google.com/uc?export=view&id=abc",
    });
    expect(result.success).toBe(true);
  });

  it("accepts approve with rejectionNote null and a valid approverSignatureUrl (httpsCallable serializes an absent field as null on the wire)", () => {
    const result = reviewSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "approve",
      rejectionNote: null,
      approverSignatureUrl: "https://drive.google.com/uc?export=view&id=abc",
    });
    expect(result.success).toBe(true);
  });

  it("still rejects reject with rejectionNote null", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: null });
    expect(result.success).toBe(false);
  });

  it("rejects approve without approverSignatureUrl", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve" });
    expect(result.success).toBe(false);
  });

  it("rejects approve with approverSignatureUrl null", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve", approverSignatureUrl: null });
    expect(result.success).toBe(false);
  });

  it("accepts a data URL as approverSignatureUrl (drawn signature, not uploaded)", () => {
    const result = reviewSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "approve",
      approverSignatureUrl: "data:image/png;base64,aGVsbG8=",
    });
    expect(result.success).toBe(true);
  });
});

describe("uploadFileSchema", () => {
  it("accepts a valid attachment upload payload", () => {
    const result = uploadFileSchema.safeParse({
      purpose: "attachment",
      fileName: "nota.png",
      fileType: "image/png",
      fileData: "data:image/png;base64,aGVsbG8=",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown purpose", () => {
    const result = uploadFileSchema.safeParse({
      purpose: "avatar",
      fileName: "nota.png",
      fileType: "image/png",
      fileData: "data:image/png;base64,aGVsbG8=",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty fileData", () => {
    const result = uploadFileSchema.safeParse({
      purpose: "signature",
      fileName: "ttd.png",
      fileType: "image/png",
      fileData: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("confirmSentToGaSchema", () => {
  it("accepts a valid submissionId", () => {
    expect(confirmSentToGaSchema.safeParse({ submissionId: "abc" }).success).toBe(true);
  });

  it("rejects an empty submissionId", () => {
    expect(confirmSentToGaSchema.safeParse({ submissionId: "" }).success).toBe(false);
  });

  it("rejects a missing submissionId", () => {
    expect(confirmSentToGaSchema.safeParse({}).success).toBe(false);
  });
});

describe("markAsDoneSchema", () => {
  it("accepts a valid submissionId", () => {
    expect(markAsDoneSchema.safeParse({ submissionId: "abc" }).success).toBe(true);
  });

  it("rejects an empty submissionId", () => {
    expect(markAsDoneSchema.safeParse({ submissionId: "" }).success).toBe(false);
  });

  it("rejects a missing submissionId", () => {
    expect(markAsDoneSchema.safeParse({}).success).toBe(false);
  });
});

describe("createPersonaliaSubmissionSchema", () => {
  const validPayload = {
    subType: "cuti" as const,
    employeeName: "Rahmat Hidayat",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-03",
    attachment: {
      fileId: "file-cuti-1",
      fileUrl: "https://drive.google.com/file/d/cuti1/view",
      fileName: "form-cuti-rahmat.pdf",
      fileType: "application/pdf",
    },
  };

  it("accepts a valid cuti payload", () => {
    expect(createPersonaliaSubmissionSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts employeeId when provided (admin picking from master data)", () => {
    const result = createPersonaliaSubmissionSchema.safeParse({ ...validPayload, employeeId: "emp-1" });
    expect(result.success).toBe(true);
  });

  it("accepts lembur and izin as subType", () => {
    expect(createPersonaliaSubmissionSchema.safeParse({ ...validPayload, subType: "lembur" }).success).toBe(true);
    expect(createPersonaliaSubmissionSchema.safeParse({ ...validPayload, subType: "izin" }).success).toBe(true);
  });

  it("rejects an unknown subType", () => {
    expect(createPersonaliaSubmissionSchema.safeParse({ ...validPayload, subType: "sakit" }).success).toBe(false);
  });

  it("rejects an empty employeeName", () => {
    expect(createPersonaliaSubmissionSchema.safeParse({ ...validPayload, employeeName: "" }).success).toBe(false);
  });

  it("rejects periodEnd before periodStart", () => {
    const result = createPersonaliaSubmissionSchema.safeParse({
      ...validPayload,
      periodStart: "2026-09-05",
      periodEnd: "2026-09-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing attachment", () => {
    const rest: Partial<typeof validPayload> = { ...validPayload };
    delete rest.attachment;
    expect(createPersonaliaSubmissionSchema.safeParse(rest).success).toBe(false);
  });

  it("allows submissionId to be null (resubmit path serializes an absent field as null)", () => {
    expect(createPersonaliaSubmissionSchema.safeParse({ ...validPayload, submissionId: null }).success).toBe(true);
  });
});

describe("reviewPersonaliaSubmissionSchema", () => {
  it("requires rejectionNote when decision is reject", () => {
    const result = reviewPersonaliaSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: "" });
    expect(result.success).toBe(false);
  });

  it("accepts reject with a non-empty rejectionNote", () => {
    const result = reviewPersonaliaSubmissionSchema.safeParse({
      submissionId: "abc",
      decision: "reject",
      rejectionNote: "Tanggal cuti tidak jelas",
    });
    expect(result.success).toBe(true);
  });

  it("accepts approve without requiring a note", () => {
    const result = reviewPersonaliaSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve" });
    expect(result.success).toBe(true);
  });

  it("accepts approve with an optional note", () => {
    const result = reviewPersonaliaSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve", note: "OK" });
    expect(result.success).toBe(true);
  });
});
