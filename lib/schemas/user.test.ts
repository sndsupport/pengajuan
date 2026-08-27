import { describe, it, expect } from "vitest";
import { createUserSchema, updateUserSchema, resetUserPasswordSchema, isValidBranchForRole } from "./user";

describe("isValidBranchForRole", () => {
  it("requires WHO or WHP for admin_cabang", () => {
    expect(isValidBranchForRole("admin_cabang", "WHO")).toBe(true);
    expect(isValidBranchForRole("admin_cabang", "WHP")).toBe(true);
    expect(isValidBranchForRole("admin_cabang", "SND")).toBe(false);
    expect(isValidBranchForRole("admin_cabang", null)).toBe(false);
  });

  it("requires SND for snd role", () => {
    expect(isValidBranchForRole("snd", "SND")).toBe(true);
    expect(isValidBranchForRole("snd", "WHO")).toBe(false);
  });

  it("requires null branch for spv/management/superadmin", () => {
    expect(isValidBranchForRole("spv", null)).toBe(true);
    expect(isValidBranchForRole("spv", "WHO")).toBe(false);
    expect(isValidBranchForRole("management", null)).toBe(true);
    expect(isValidBranchForRole("superadmin", null)).toBe(true);
  });
});

describe("createUserSchema", () => {
  const valid = {
    name: "Admin WHO",
    username: "admin.who",
    password: "password123",
    role: "admin_cabang" as const,
    branch: "WHO" as const,
    department: "Operasional",
    position: "Admin Cabang",
  };

  it("accepts a valid admin_cabang payload", () => {
    expect(createUserSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when branch doesn't match role", () => {
    expect(createUserSchema.safeParse({ ...valid, branch: "SND" }).success).toBe(false);
  });

  it("rejects a password shorter than 6 characters", () => {
    expect(createUserSchema.safeParse({ ...valid, password: "123" }).success).toBe(false);
  });

  it("accepts spv with null branch", () => {
    const result = createUserSchema.safeParse({ ...valid, role: "spv", branch: null, username: "spv1" });
    expect(result.success).toBe(true);
  });

  it("accepts an omitted email", () => {
    expect(createUserSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an invalid email when provided", () => {
    expect(createUserSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects a username containing a space", () => {
    expect(createUserSchema.safeParse({ ...valid, username: "admin cabang" }).success).toBe(false);
  });

  it("rejects a username containing @", () => {
    expect(createUserSchema.safeParse({ ...valid, username: "admin@cabang" }).success).toBe(false);
  });
});

describe("updateUserSchema", () => {
  const valid = {
    uid: "abc",
    name: "Admin WHO",
    role: "admin_cabang" as const,
    branch: "WHO" as const,
    department: "Operasional",
    position: "Admin Cabang",
  };

  it("accepts a valid payload without username or password fields", () => {
    expect(updateUserSchema.safeParse(valid).success).toBe(true);
  });

  it("strips an unexpected username field rather than accepting it", () => {
    const result = updateUserSchema.safeParse({ ...valid, username: "should-be-ignored" });
    expect(result.success).toBe(true);
    expect(result.success && "username" in result.data).toBe(false);
  });

  it("rejects mismatched branch/role", () => {
    expect(updateUserSchema.safeParse({ ...valid, role: "snd", branch: "WHO" }).success).toBe(false);
  });
});

describe("resetUserPasswordSchema", () => {
  it("rejects a password shorter than 6 characters", () => {
    expect(resetUserPasswordSchema.safeParse({ uid: "abc", newPassword: "123" }).success).toBe(false);
  });

  it("accepts a 6+ character password", () => {
    expect(resetUserPasswordSchema.safeParse({ uid: "abc", newPassword: "abcdef" }).success).toBe(true);
  });
});
