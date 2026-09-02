import { describe, it, expect } from "vitest";
import { createUserSchema, updateUserSchema, isValidBranchForRole } from "./user";

describe("isValidBranchForRole", () => {
  it("requires null branch for every role", () => {
    expect(isValidBranchForRole("admin", null)).toBe(true);
    expect(isValidBranchForRole("admin", "WHO")).toBe(false);
    expect(isValidBranchForRole("spv", null)).toBe(true);
    expect(isValidBranchForRole("spv", "WHO")).toBe(false);
    expect(isValidBranchForRole("management", null)).toBe(true);
    expect(isValidBranchForRole("superadmin", null)).toBe(true);
  });
});

describe("createUserSchema", () => {
  const valid = {
    name: "Admin Utama",
    username: "admin",
    password: "password123",
    role: "admin" as const,
    branch: null,
    department: "GA",
    position: "Admin",
  };

  it("accepts a valid admin payload", () => {
    expect(createUserSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-null branch for admin", () => {
    expect(createUserSchema.safeParse({ ...valid, branch: "WHO" }).success).toBe(false);
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
    name: "Admin Utama",
    role: "admin" as const,
    branch: null,
    department: "GA",
    position: "Admin",
  };

  it("accepts a valid payload without username or password fields", () => {
    expect(updateUserSchema.safeParse(valid).success).toBe(true);
  });

  it("strips an unexpected username field rather than accepting it", () => {
    const result = updateUserSchema.safeParse({ ...valid, username: "should-be-ignored" });
    expect(result.success).toBe(true);
    expect(result.success && "username" in result.data).toBe(false);
  });

  it("rejects a non-null branch for admin", () => {
    expect(updateUserSchema.safeParse({ ...valid, branch: "WHO" }).success).toBe(false);
  });
});
