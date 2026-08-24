import { describe, it, expect, vi, beforeEach } from "vitest";

const newPage = vi.fn();
const pagePdf = vi.fn();
const pageSetContent = vi.fn();
const browserClose = vi.fn();
const puppeteerLaunch = vi.fn();
const puppeteerCoreLaunch = vi.fn();
const chromiumExecutablePath = vi.fn();

vi.mock("puppeteer", () => ({
  default: { launch: puppeteerLaunch },
}));
vi.mock("puppeteer-core", () => ({
  default: { launch: puppeteerCoreLaunch },
}));
vi.mock("@sparticuz/chromium", () => ({
  default: { args: ["--no-sandbox"], executablePath: chromiumExecutablePath },
}));

function makeBrowser() {
  pageSetContent.mockReset();
  pagePdf.mockReset().mockResolvedValue(new Uint8Array(Buffer.from("PDF-DATA")));
  newPage.mockReset().mockResolvedValue({ setContent: pageSetContent, pdf: pagePdf });
  browserClose.mockReset();
  return { newPage, close: browserClose };
}

describe("renderPdfBuffer", () => {
  beforeEach(() => {
    puppeteerLaunch.mockReset();
    puppeteerCoreLaunch.mockReset();
    chromiumExecutablePath.mockReset().mockResolvedValue("/opt/chromium/chromium");
    delete process.env.FUNCTIONS_EMULATOR;
  });

  it("uses the full puppeteer package (bundled Chromium) when running in the emulator", async () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    puppeteerLaunch.mockResolvedValue(makeBrowser());
    const { renderPdfBuffer } = await import("./renderPdfBuffer");
    await renderPdfBuffer("<html></html>");
    expect(puppeteerLaunch).toHaveBeenCalledWith({ headless: true });
    expect(puppeteerCoreLaunch).not.toHaveBeenCalled();
  });

  it("uses puppeteer-core + @sparticuz/chromium when not running in the emulator", async () => {
    puppeteerCoreLaunch.mockResolvedValue(makeBrowser());
    const { renderPdfBuffer } = await import("./renderPdfBuffer");
    await renderPdfBuffer("<html></html>");
    expect(puppeteerCoreLaunch).toHaveBeenCalledWith({
      args: ["--no-sandbox"],
      executablePath: "/opt/chromium/chromium",
      headless: true,
    });
    expect(puppeteerLaunch).not.toHaveBeenCalled();
  });

  it("renders the given HTML, returns a PDF buffer, and closes the browser", async () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    puppeteerLaunch.mockResolvedValue(makeBrowser());
    const { renderPdfBuffer } = await import("./renderPdfBuffer");
    const result = await renderPdfBuffer("<html><body>Hi</body></html>");
    expect(pageSetContent).toHaveBeenCalledWith("<html><body>Hi</body></html>", { waitUntil: "networkidle0" });
    expect(pagePdf).toHaveBeenCalledWith({ format: "a4", printBackground: true });
    expect(browserClose).toHaveBeenCalled();
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe("PDF-DATA");
  });
});
