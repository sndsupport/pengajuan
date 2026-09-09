import { describe, it, expect } from "vitest";
import { clampSignaturePosition } from "./signaturePosition";

describe("clampSignaturePosition", () => {
  it("leaves an in-bounds position unchanged", () => {
    const result = clampSignaturePosition({ x: 100, y: 200, width: 180, height: 60 }, 1000, 1000);
    expect(result).toEqual({ x: 100, y: 200, width: 180, height: 60 });
  });

  it("clamps negative x/y up to 0", () => {
    const result = clampSignaturePosition({ x: -50, y: -10, width: 180, height: 60 }, 1000, 1000);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("clamps x/y that would push the box past the right/bottom edge", () => {
    const result = clampSignaturePosition({ x: 950, y: 980, width: 180, height: 60 }, 1000, 1000);
    expect(result.x).toBe(820); // 1000 - 180
    expect(result.y).toBe(940); // 1000 - 60
  });

  it("keeps width/height unchanged", () => {
    const result = clampSignaturePosition({ x: -999, y: -999, width: 180, height: 60 }, 1000, 1000);
    expect(result.width).toBe(180);
    expect(result.height).toBe(60);
  });

  it("does not produce a negative x/y when the box is wider/taller than the canvas", () => {
    const result = clampSignaturePosition({ x: 500, y: 500, width: 1200, height: 1200 }, 1000, 1000);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});
