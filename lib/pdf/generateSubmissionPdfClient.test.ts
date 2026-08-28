import { describe, it, expect } from "vitest";
import { computePdfPageSlices } from "./generateSubmissionPdfClient";

describe("computePdfPageSlices", () => {
  it("returns a single slice when content fits on one page", () => {
    const slices = computePdfPageSlices(1000, 500, 210, 297);
    expect(slices).toEqual([{ sourceYPx: 0, sliceHeightPx: 500 }]);
  });

  it("splits content taller than one page into multiple slices", () => {
    const slices = computePdfPageSlices(1588, 3000, 210, 297);
    expect(slices).toHaveLength(2);
    expect(slices[0].sourceYPx).toBe(0);
    expect(slices[0].sliceHeightPx).toBeCloseTo(2245.9, 0);
    expect(slices[1].sourceYPx).toBeCloseTo(2245.9, 0);
    expect(slices[1].sliceHeightPx).toBeCloseTo(754.1, 0);
  });

  it("slices sum to the total canvas height", () => {
    const slices = computePdfPageSlices(1588, 5000, 210, 297);
    const totalHeight = slices.reduce((sum, s) => sum + s.sliceHeightPx, 0);
    expect(totalHeight).toBeCloseTo(5000, 5);
  });

  it("uses default A4 dimensions when page size is omitted", () => {
    const slices = computePdfPageSlices(1000, 100);
    expect(slices).toEqual([{ sourceYPx: 0, sliceHeightPx: 100 }]);
  });
});
