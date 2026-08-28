import { describe, it, expect } from "vitest";
import { buildMultipartRequestBody } from "./drive-upload";

describe("buildMultipartRequestBody", () => {
  it("includes the metadata as a JSON part", async () => {
    const fileBlob = new Blob(["hello"], { type: "text/plain" });
    const body = buildMultipartRequestBody(
      { name: "test.txt", parents: ["folder-1"] },
      fileBlob,
      "text/plain",
      "test-boundary"
    );
    const text = await body.text();
    expect(text).toContain("--test-boundary");
    expect(text).toContain("Content-Type: application/json; charset=UTF-8");
    expect(text).toContain('{"name":"test.txt","parents":["folder-1"]}');
  });

  it("includes the file content with its content type", async () => {
    const fileBlob = new Blob(["hello world"], { type: "image/png" });
    const body = buildMultipartRequestBody({ name: "sig.png" }, fileBlob, "image/png", "test-boundary");
    const text = await body.text();
    expect(text).toContain("Content-Type: image/png");
    expect(text).toContain("hello world");
  });

  it("closes with the boundary terminator", async () => {
    const fileBlob = new Blob(["x"], { type: "text/plain" });
    const body = buildMultipartRequestBody({ name: "x.txt" }, fileBlob, "text/plain", "test-boundary");
    const text = await body.text();
    expect(text.endsWith("--test-boundary--")).toBe(true);
  });
});
