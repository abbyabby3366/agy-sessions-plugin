import zlib from 'node:zlib';
import { nativeImage, type NativeImage } from 'electron';

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter None
    const srcStart = y * width * 4;
    raw.set(rgba.subarray(srcStart, srcStart + width * 4), rowStart + 1);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Generates a crisp 32x32 tray badge PNG programmatically so no external asset is missing.
 */
export function createTrayIcon(hasActiveRuns: boolean, hasWaitingInput: boolean): NativeImage {
  const size = 32;
  const rgba = new Uint8Array(size * size * 4);

  const bgR = 24;
  const bgG = 28;
  const bgB = 34;

  // Cobalt signal blue (#2563EB) or amber (#F59E0B) or emerald (#10B981)
  const [dotR, dotG, dotB] = hasWaitingInput
    ? [245, 158, 11]
    : hasActiveRuns
      ? [16, 185, 129]
      : [100, 116, 139];

  const cx = 15.5;
  const cy = 15.5;
  const outerR = 13.5;
  const innerRingR = 9.0;
  const innerRingMin = 6.3;
  const centerR = 3.8;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const idx = (y * size + x) * 4;

      if (dist <= outerR) {
        const edgeAlpha = dist > outerR - 1 ? Math.max(0, outerR - dist) : 1;
        let r = bgR;
        let g = bgG;
        let b = bgB;

        // Outer subtle cobalt arc + inner active core
        if (dist <= centerR) {
          r = dotR;
          g = dotG;
          b = dotB;
        } else if (dist >= innerRingMin && dist <= innerRingR) {
          r = 59;
          g = 130;
          b = 246;
        }

        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = Math.round(edgeAlpha * 255);
      }
    }
  }

  return nativeImage.createFromBuffer(encodeRgbaPng(size, size, rgba));
}
