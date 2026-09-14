import { describe, expect, it } from "vitest";
import { isJpeg, isPng } from "../../src/image.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);

describe("isPng", () => {
  it("accepts bytes that start with the PNG signature", () => {
    expect(isPng(PNG)).toBe(true);
  });
  it("rejects JPEG bytes", () => {
    expect(isPng(JPEG)).toBe(false);
  });
  it("rejects buffers shorter than the signature", () => {
    expect(isPng(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
});

describe("isJpeg", () => {
  it("accepts bytes that start with the JPEG SOI marker", () => {
    expect(isJpeg(JPEG)).toBe(true);
  });
  it("rejects PNG bytes", () => {
    expect(isJpeg(PNG)).toBe(false);
  });
  it("rejects buffers shorter than the marker", () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });
});
