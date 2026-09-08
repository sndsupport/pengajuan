import { describe, it, expect } from "vitest";
import { createVehicleSchema, updateVehicleSchema } from "./vehicle";

describe("createVehicleSchema", () => {
  const valid = {
    plateNumber: "D 8664 FC",
    vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
    branch: "WHO Bandung" as const,
    category: "Mobil" as const,
  };

  it("accepts a valid payload", () => {
    expect(createVehicleSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty plateNumber", () => {
    expect(createVehicleSchema.safeParse({ ...valid, plateNumber: "" }).success).toBe(false);
  });

  it("rejects an empty vehicleType", () => {
    expect(createVehicleSchema.safeParse({ ...valid, vehicleType: "" }).success).toBe(false);
  });

  it("rejects an invalid branch", () => {
    expect(createVehicleSchema.safeParse({ ...valid, branch: "JKT" }).success).toBe(false);
  });

  it("rejects an invalid category", () => {
    expect(createVehicleSchema.safeParse({ ...valid, category: "Kapal" }).success).toBe(false);
  });

  it("accepts all three valid categories", () => {
    expect(createVehicleSchema.safeParse({ ...valid, category: "Mobil" }).success).toBe(true);
    expect(createVehicleSchema.safeParse({ ...valid, category: "Motor" }).success).toBe(true);
    expect(createVehicleSchema.safeParse({ ...valid, category: "Truk" }).success).toBe(true);
  });
});

describe("updateVehicleSchema", () => {
  it("requires an id in addition to the base fields", () => {
    const result = updateVehicleSchema.safeParse({
      plateNumber: "D 8664 FC",
      vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
      branch: "WHO Bandung",
      category: "Mobil",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid payload with id", () => {
    const result = updateVehicleSchema.safeParse({
      id: "veh-1",
      plateNumber: "D 8664 FC",
      vehicleType: "GRANMAX S402RP-PMRFJJ KJ",
      branch: "WHO Bandung",
      category: "Mobil",
    });
    expect(result.success).toBe(true);
  });
});
