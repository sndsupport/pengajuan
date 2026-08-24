// @sparticuz/chromium's bundled binary only runs on the Linux container Cloud
// Functions deploys to — it doesn't run on a developer's Windows/macOS machine.
// FUNCTIONS_EMULATOR is set automatically by the Firebase emulator, so locally
// we launch the full `puppeteer` package instead, which downloads its own
// Chromium that actually runs on the dev machine.
export async function renderPdfBuffer(html: string): Promise<Buffer> {
  const browser =
    process.env.FUNCTIONS_EMULATOR === "true" ? await launchLocalBrowser() : await launchProductionBrowser();

  try {
    const page = await browser.newPage();
    // puppeteer-core's types narrow `setContent`'s `waitUntil` to exclude
    // "networkidle0"/"networkidle2" (only allowed on `page.goto`), even though
    // the runtime accepts it. Cast to keep the intended wait behavior.
    await page.setContent(html, { waitUntil: "networkidle0" } as unknown as Parameters<typeof page.setContent>[1]);
    const pdfData = await page.pdf({ format: "a4", printBackground: true });
    return Buffer.from(pdfData);
  } finally {
    await browser.close();
  }
}

async function launchLocalBrowser() {
  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch({ headless: true });
}

async function launchProductionBrowser() {
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = (await import("puppeteer-core")).default;
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}
