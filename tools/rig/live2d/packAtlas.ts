/** Repacks a combined INP's texture pages into compact square pages for the Live2D bridge.
 *  The INP itself is never rewritten. Each atlas slot (page + uvs + indices, the same key as
 *  psd2live's Cmo3AtlasUndedup) copies its UV box plus a pad of original texels to an integer
 *  offset, so nearest and bilinear lookups read exactly the texels they read before. Byte-identical
 *  source pages collapse to one; pages no drawable samples are dropped. */
import { createHash } from 'node:crypto';
import { decodePNG } from '../../generate/png';
import { encodePNG } from '../../shared/encodePNG';
import type { CombinedAsset } from '../../../player/src/combinedRuntime';

// Original texels around each UV box (bilinear reads one texel beyond it), and transparent spacing
// between boxes so runtime mipmaps stay separated for a few levels.
const PAD = 2, GUTTER = 8, MIN_PAGE = 256;
const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

interface Slot { source: number; x0: number; y0: number; w: number; h: number; uvs: number[]; parts: number[]; page: number; x: number; y: number }
export interface AtlasReport {
  sourcePages: number; duplicateSourcePages: number; unusedSourcePages: number; slots: number;
  sourceBytes: number; packedBytes: number; pages: { width: number; height: number; bytes: number }[];
}
export interface PackedAtlas { textures: Buffer[]; uvs: Map<number, number[]>; page: Map<number, number>; report: AtlasReport }

/** Shelf-packs slots into square pages of `size`; returns false when a slot cannot fit. */
function shelve(slots: Slot[], size: number, pageLimit = Infinity) {
  let page = 0, x = GUTTER / 2, y = GUTTER / 2, shelf = 0;
  for (const s of slots) {
    if (s.w + GUTTER > size || s.h + GUTTER > size) return false;
    if (x + s.w + GUTTER / 2 > size) { x = GUTTER / 2; y += shelf + GUTTER; shelf = 0; }
    if (y + s.h + GUTTER / 2 > size) { if (++page >= pageLimit) return false; x = y = GUTTER / 2; shelf = 0; }
    s.page = page; s.x = x; s.y = y; x += s.w + GUTTER; shelf = Math.max(shelf, s.h);
  }
  return page + 1;
}

export function packAtlas(asset: CombinedAsset): PackedAtlas {
  const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const first = new Map<string, number>();
  const canonical = asset.textures.map((b, i) => { const h = hash(b); if (!first.has(h)) first.set(h, i); return first.get(h)!; });
  const dims = asset.textures.map(b => {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  });
  const slots = new Map<string, Slot>();
  for (const part of asset.parts) {
    const source = canonical[part.textures![0]], { width, height } = dims[source], uvs = part.mesh!.uvs;
    if (!uvs.every(v => Number.isFinite(v) && v >= -1e-6 && v <= 1 + 1e-6)) throw new Error(`UVs outside the texture page in ${part.name}`);
    const key = `${source}|${uvs.join(',')}|${part.mesh!.indices.join(',')}`;
    const existing = slots.get(key);
    if (existing) { existing.parts.push(part.uuid); continue; }
    const us = uvs.filter((_, k) => k % 2 === 0), vs = uvs.filter((_, k) => k % 2 === 1);
    // Unclamped: beyond a page edge the pad repeats the edge texel, which is what clamp-to-edge read.
    const x0 = Math.floor(Math.min(...us) * width) - PAD, y0 = Math.floor(Math.min(...vs) * height) - PAD;
    const x1 = Math.ceil(Math.max(...us) * width) + PAD, y1 = Math.ceil(Math.max(...vs) * height) + PAD;
    slots.set(key, { source, x0, y0, w: x1 - x0, h: y1 - y0, uvs, parts: [part.uuid], page: 0, x: 0, y: 0 });
  }
  const ordered = [...slots.values()].sort((a, b) => b.h - a.h || b.w - a.w);
  const cap = pow2(Math.max(...dims.map(d => Math.max(d.width, d.height)), ...ordered.map(s => Math.max(s.w, s.h) + GUTTER)));
  if (cap > 8192) throw new Error('An atlas slot exceeds the 8192 px Live2D page limit');
  // The smallest single page that holds everything, else full-size pages with a shrunken last one.
  let size = MIN_PAGE;
  while (size < cap && !shelve(ordered, size, 1)) size *= 2;
  const count = shelve(ordered, size) as number, sizes = Array(count).fill(size);
  if (count > 1) {
    const last = ordered.filter(s => s.page === count - 1);
    let small = MIN_PAGE;
    while (small < size && !shelve(last, small, 1)) small *= 2;
    shelve(last, small, 1); last.forEach(s => s.page = count - 1); sizes[count - 1] = small;
  }
  const pages = sizes.map(n => new Uint8ClampedArray(n * n * 4));
  for (const source of new Set(ordered.map(s => s.source))) {
    const image = decodePNG(asset.textures[source]);
    for (const s of ordered.filter(s => s.source === source)) {
      const target = pages[s.page], n = sizes[s.page];
      for (let y = 0; y < s.h; y++) {
        const sy = Math.max(0, Math.min(image.height - 1, s.y0 + y));
        for (let x = 0; x < s.w; x++) {
          const sx = Math.max(0, Math.min(image.width - 1, s.x0 + x)), from = (sy * image.width + sx) * 4, to = ((s.y + y) * n + s.x + x) * 4;
          target.set(image.rgba.subarray(from, from + 4), to);
        }
      }
    }
  }
  const textures = pages.map((rgba, i) => encodePNG(rgba, sizes[i], sizes[i]));
  const uvs = new Map<number, number[]>(), page = new Map<number, number>();
  for (const s of ordered) {
    const { width, height } = dims[s.source], n = sizes[s.page];
    const moved = s.uvs.map((v, k) => k % 2 === 0 ? (v * width - s.x0 + s.x) / n : (v * height - s.y0 + s.y) / n);
    for (const uuid of s.parts) { uvs.set(uuid, moved); page.set(uuid, s.page); }
  }
  const used = new Set(ordered.map(s => s.source));
  return { textures, uvs, page, report: {
    sourcePages: asset.textures.length, duplicateSourcePages: canonical.filter((c, i) => c !== i).length,
    unusedSourcePages: canonical.filter((c, i) => c === i && !used.has(i)).length, slots: ordered.length,
    sourceBytes: asset.textures.reduce((n, b) => n + b.length, 0), packedBytes: textures.reduce((n, b) => n + b.length, 0),
    pages: textures.map((b, i) => ({ width: sizes[i], height: sizes[i], bytes: b.length })),
  } };
}
