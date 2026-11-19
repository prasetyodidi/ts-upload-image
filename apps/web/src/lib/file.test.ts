import { describe, expect, test } from "bun:test";
import { validateFile } from "./file";

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("validateFile", () => {
  test("accepts a supported image under the limit", () => {
    expect(validateFile(file("photo.webp", "image/webp", 10))).toBeNull();
  });

  test("rejects an unsupported type", () => {
    expect(validateFile(file("photo.gif", "image/gif", 10))).toContain("JPG");
  });

  test("rejects an empty file", () => {
    expect(validateFile(file("empty.png", "image/png", 0))).toContain("kosong");
  });

  test("rejects a file above 20 MB", () => {
    expect(validateFile(file("large.png", "image/png", 20 * 1024 * 1024 + 1))).toContain(
      "20 MB",
    );
  });
});
