// lib/schemas/submission.test.ts
import { describe, it, expect } from "vitest";
import { createSubmissionSchema, reviewSubmissionSchema } from "./submission";

describe("createSubmissionSchema", () => {
  const validPayload = {
    type: "kendaraan" as const,
    subType: "service_berkala" as const,
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

  it("allows km to be null for perlengkapan", () => {
    const payload = {
      type: "perlengkapan" as const,
      subType: "pengadaan_baru" as const,
      requesterSignatureUrl: "https://storage.example.com/sig.png",
      items: [{ itemName: "Kertas A4", brandType: "Sinar Dunia", km: null, quantity: 10, unit: "rim", description: "" }],
    };
    expect(createSubmissionSchema.safeParse(payload).success).toBe(true);
  });

  it("allows submissionId to be null (httpsCallable serializes an absent field as null on the wire)", () => {
    const result = createSubmissionSchema.safeParse({ ...validPayload, submissionId: null });
    expect(result.success).toBe(true);
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

  it("accepts approve without rejectionNote", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve" });
    expect(result.success).toBe(true);
  });

  it("accepts approve with rejectionNote null (httpsCallable serializes an absent field as null on the wire)", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "approve", rejectionNote: null });
    expect(result.success).toBe(true);
  });

  it("still rejects reject with rejectionNote null", () => {
    const result = reviewSubmissionSchema.safeParse({ submissionId: "abc", decision: "reject", rejectionNote: null });
    expect(result.success).toBe(false);
  });
});
