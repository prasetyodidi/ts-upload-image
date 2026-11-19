import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { cleanupAll, cleanupJob, closeSupport, createdJobIds, makeJpeg } from "./support";

test.afterAll(async () => {
  await cleanupAll();
  await closeSupport();
});

test("uploads an image, shows completion, and downloads the WebP", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Resize, compress, convert." }),
  ).toBeVisible();

  const input = await makeJpeg(2_000, 1_000);
  await page.locator("#image").setInputFiles({
    name: "browser.jpg",
    mimeType: "image/jpeg",
    buffer: input,
  });

  await page.getByRole("button", { name: "Proses gambar" }).click();
  await expect(page.getByText("Selesai", { exact: true })).toBeVisible({
    timeout: 120_000,
  });

  const jobId = (
    await page.locator('[aria-live="polite"] code').innerText()
  ).trim();
  expect(jobId.length).toBeGreaterThan(0);
  createdJobIds.add(jobId);

  const downloadLink = page.getByRole("link", { name: "Download WebP" });
  await expect(downloadLink).toBeVisible();
  const href = await downloadLink.getAttribute("href");
  expect(href).toBeTruthy();

  const download = await request.get(new URL(href!, page.url()).toString());
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("image/webp");

  const metadata = await sharp(Buffer.from(await download.body())).metadata();
  expect(metadata.format).toBe("webp");
  expect(metadata.width).toBe(1280);

  await cleanupJob(jobId);
});

test("shows a client-side error for an unsupported file type", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#image").setInputFiles({
    name: "bad.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });

  await expect(page.getByRole("alert")).toContainText("Format file harus");
  await expect(
    page.getByRole("button", { name: "Proses gambar" }),
  ).toBeDisabled();
});
