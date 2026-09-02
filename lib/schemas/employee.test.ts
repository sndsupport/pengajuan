import { describe, it, expect } from "vitest";
import { createEmployeeSchema, updateEmployeeSchema } from "./employee";

describe("createEmployeeSchema", () => {
  const valid = { name: "Rahmat Hidayat", branch: "WHO" as const, department: "Operasional", position: "Staff Gudang" };

  it("accepts a valid payload", () => {
    expect(createEmployeeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(createEmployeeSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects an invalid branch", () => {
    expect(createEmployeeSchema.safeParse({ ...valid, branch: "JKT" }).success).toBe(false);
  });

  it("rejects an empty department", () => {
    expect(createEmployeeSchema.safeParse({ ...valid, department: "" }).success).toBe(false);
  });

  it("rejects an empty position", () => {
    expect(createEmployeeSchema.safeParse({ ...valid, position: "" }).success).toBe(false);
  });
});

describe("updateEmployeeSchema", () => {
  it("requires an id in addition to the base fields", () => {
    const result = updateEmployeeSchema.safeParse({
      name: "Rahmat Hidayat",
      branch: "WHO",
      department: "Operasional",
      position: "Staff Gudang",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid payload with id", () => {
    const result = updateEmployeeSchema.safeParse({
      id: "emp-1",
      name: "Rahmat Hidayat",
      branch: "WHO",
      department: "Operasional",
      position: "Staff Gudang",
    });
    expect(result.success).toBe(true);
  });
});
