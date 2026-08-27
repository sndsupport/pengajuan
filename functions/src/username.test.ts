import { describe, it, expect } from "vitest";
import { normalizeUsername, usernameToSyntheticEmail, InvalidUsernameError } from "./username";

describe("normalizeUsername", () => {
  it("trims and lowercases", () => {
    expect(normalizeUsername("  Admin.WHO  ")).toBe("admin.who");
  });

  it("rejects usernames containing a space", () => {
    expect(() => normalizeUsername("admin who")).toThrow(InvalidUsernameError);
  });

  it("rejects usernames containing @", () => {
    expect(() => normalizeUsername("admin@who")).toThrow(InvalidUsernameError);
  });

  it("rejects an empty username", () => {
    expect(() => normalizeUsername("   ")).toThrow(InvalidUsernameError);
  });
});

describe("usernameToSyntheticEmail", () => {
  it("builds the synthetic email from a normalized username", () => {
    expect(usernameToSyntheticEmail("Admin.WHO")).toBe("admin.who@pengajuan-tsi.internal");
  });

  it("propagates normalization errors", () => {
    expect(() => usernameToSyntheticEmail("bad user")).toThrow(InvalidUsernameError);
  });
});
