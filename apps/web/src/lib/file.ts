export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    return "Format file harus JPG, PNG, atau WebP.";
  }

  if (file.size === 0) {
    return "File gambar kosong.";
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return "Ukuran file melebihi batas 20 MB.";
  }

  return null;
}
