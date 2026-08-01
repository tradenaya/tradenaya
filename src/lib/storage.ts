const STORAGE_BASE_URL =
  process.env.NEXT_PUBLIC_STORAGE_URL;

export function getFileUrl(
  path: string
) {
  return `${STORAGE_BASE_URL}/${path}`;
}