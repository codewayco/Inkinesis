/**
 * A PNG decoder for the pictures the restyler writes, and nothing more.
 *
 * `tools/shared/encodePNG.ts` encodes; nothing in this repository decodes, because
 * until now nothing needed to read an image back in. This reads exactly the
 * kind of file `restyle.py` produces -- non-interlaced, eight bits per channel,
 * RGB or RGBA -- and REFUSES anything else by name rather than guessing.
 *
 * It is deliberately narrow. A general PNG decoder is a large thing with a long
 * tail of formats, and the tail is where a silently wrong pixel comes from; a
 * decoder that refuses a 16-bit or palette or interlaced file is one that
 * cannot quietly misread one.
 *
 * `zlib.inflateSync` does the decompression, so the only thing implemented here
 * is chunk walking and the five scanline filters, which is where PNG keeps its
 * actual complexity.
 */
import { inflateSync } from 'node:zlib';

export interface DecodedImage { width: number; height: number; rgba: Uint8ClampedArray }

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePNG(bytes: Uint8Array | Buffer): DecodedImage {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const [i, expected] of SIGNATURE.entries()) {
    if (data[i] !== expected) throw new Error('not a PNG: signature mismatch');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  let width = 0, height = 0, depth = 0, colourType = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= data.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      depth = body[8]; colourType = body[9]; interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') break;
    offset += 12 + length;
  }

  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}; this decoder reads 8`);
  if (interlace !== 0) throw new Error('unsupported interlaced PNG');
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (!channels) {
    throw new Error(`unsupported PNG colour type ${colourType}; this decoder reads RGB and RGBA`);
  }

  const joined = Buffer.concat(idat.map(chunk => Buffer.from(chunk)));
  const raw = new Uint8Array(inflateSync(joined));
  const stride = width * channels;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const previous = new Uint8Array(stride);
  const line = new Uint8Array(stride);

  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    line.set(raw.subarray(at, at + stride));
    at += stride;
    // The five filters, each defined against the byte `channels` to the left
    // (`a`), the byte above (`b`), and the byte above-left (`c`).
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      switch (filter) {
        case 0: break;
        case 1: line[x] = (line[x] + a) & 255; break;
        case 2: line[x] = (line[x] + b) & 255; break;
        case 3: line[x] = (line[x] + ((a + b) >> 1)) & 255; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          break;
        }
        default: throw new Error(`unknown PNG scanline filter ${filter} on row ${y}`);
      }
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels, to = (y * width + x) * 4;
      rgba[to] = line[from];
      rgba[to + 1] = line[from + 1];
      rgba[to + 2] = line[from + 2];
      rgba[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
    previous.set(line);
  }
  return { width, height, rgba };
}
