const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SOI = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

/** True when the bytes begin with the 8-byte PNG file signature. */
export function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, PNG_SIGNATURE);
}

/** True when the bytes begin with the JPEG start-of-image marker. */
export function isJpeg(bytes: Uint8Array): boolean {
  return startsWith(bytes, JPEG_SOI);
}
