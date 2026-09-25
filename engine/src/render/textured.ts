/** CPU reference for the explicitly selected normal/sRGB textured path.
 * Retains every nontransparent part contribution per pixel; the opaque
 * resolver is a separate step.
 */
export interface RgbaTexture {
  width: number;
  height: number;
  /** Straight-alpha sRGB samples; source rows run from top to bottom. */
  rgba: Uint8ClampedArray;
}
export interface TexturedMesh {
  /** Projected pixel coordinates (top-left origin), independent of source UVs. */
  xy: Float64Array;
  depth: Float64Array;
  indices: Uint32Array;
  /** Normalized texture coordinates; v increases downwards. */
  uv: Float64Array;
  texture: RgbaTexture;
  opacity: number;
  depthOffset: number;
  /** 'mipmap' adds a pyramid for minification; see `mipPyramid`. */
  sampling: 'nearest' | 'bilinear' | 'mipmap';
  mask?: TextureMask;
  /**
   * How this mesh combines with what is already under it (Step F(b)).
   *
   * Absent or `'normal'` is source-over, which is what everything drawn before
   * this existed uses and what every earlier fixture still renders. The three
   * separable modes are the ones a layered source actually carries for shading
   * and light: `multiply` darkens, `screen` lightens, `add` (Photoshop's
   * *linear dodge (add)*) sums. Every other mode is still REFUSED at import
   * with `material-pending` rather than approximated here.
   *
   * Blending is against the BACKDROP: everything already composited beneath
   * this fragment at that pixel, which back-to-front compositing has in hand.
   * It is done in the same encoded sRGB the rest of this file works in, which
   * is what Photoshop does too, and is stated rather than assumed.
   */
  blend?: BlendMode;
}

/** The separable blend modes the compositor implements. */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add';
export const BLEND_MODES: readonly BlendMode[] = ['normal', 'multiply', 'screen', 'add'];

/**
 * B(Cb, Cs) for one channel, on straight (unpremultiplied) values in [0, 1].
 *
 * These are the separable blend functions of the PDF/Photoshop model, and
 * nothing else: `add` is a clamped sum, which is what *linear dodge (add)* is.
 */
export function blendChannel(mode: BlendMode, backdrop: number, source: number): number {
  switch (mode) {
    case 'multiply': return backdrop * source;
    case 'screen': return backdrop + source - backdrop * source;
    case 'add': return Math.min(1, backdrop + source);
    default: return source;
  }
}
/** Prototype independent current-frame mask; dependency graphs remain separate. */
export interface TextureMask {
  texture: RgbaTexture;
  /** u=a*x+c*y+tx, v=b*x+d*y+ty, for output pixel coordinates. */
  screenToUv: [number, number, number, number, number, number];
  sampling: 'nearest' | 'bilinear';
  channel: 'red' | 'alpha';
  outsideValue: number;
  invert: boolean;
}
export interface TexturedResult {
  width: number;
  height: number;
  /** Straight RGBA for output. Compare low-alpha colors in premultiplied space. */
  rgba: Uint8ClampedArray;
  /** Normalized sRGB premultiplied output before byte quantization. */
  premultiplied: Float64Array;
  /** New alpha-aware population; not interchangeable with opaque coverage. */
  alphaCoverageCount: Uint32Array;
  /** Nearest nontransparent part, diagnostic only; it is not the final color. */
  frontPart: Int32Array;
  /** Pixels a single mesh covered more than once, in `selfOverlap: 'count'`
   * mode. A deformed sheet CAN fold over itself, and the measurement wants the
   * number, not an exception; in the default mode this stays 0 and the render
   * throws instead, which is what the Step C path relies on. */
  selfOverlapPixels: number;
}
export interface TexturedOptions {
  /** 'throw' (default) rejects a self-overlapping sheet; 'count' measures it. */
  selfOverlap?: 'throw' | 'count';
}
export type Rgba = [number, number, number, number];
interface Fragment { depth: number; part: number; color: Rgba; blend: BlendMode }

/** Filter premultiplied samples, so hidden RGB does not produce edge halos. */
export function sampleTexture(texture: RgbaTexture, u: number, v: number,
  sampling: TexturedMesh['sampling'], lod = 0): Rgba {
  u = Math.max(0, Math.min(1, u));
  v = Math.max(0, Math.min(1, v));
  if (sampling === 'mipmap') return sampleMipmap(texture, u, v, lod);
  const texel = (x: number, y: number): Rgba => {
    const i = (Math.max(0, Math.min(texture.height - 1, y)) * texture.width +
      Math.max(0, Math.min(texture.width - 1, x))) * 4;
    const alpha = texture.rgba[i + 3] / 255;
    return [texture.rgba[i] / 255 * alpha, texture.rgba[i + 1] / 255 * alpha,
      texture.rgba[i + 2] / 255 * alpha, alpha];
  };
  if (sampling === 'nearest') return texel(Math.floor(u * texture.width), Math.floor(v * texture.height));
  const x = u * texture.width - 0.5, y = v * texture.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const samples = [texel(x0, y0), texel(x0 + 1, y0), texel(x0, y0 + 1), texel(x0 + 1, y0 + 1)];
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  return [0, 1, 2, 3].map(channel => samples.reduce((sum, rgba, i) => sum + rgba[channel] * weights[i], 0)) as Rgba;
}

/**
 * Minification, which bilinear filtering does not solve.
 *
 * A 2400x4500 source drawn into a 128 px preview covers one output pixel with
 * about twenty source pixels in each direction. Nearest sampling picks one of
 * them and bilinear averages four, so both show whichever texels the sampling
 * grid happens to land on: thin lashes flicker in and out, and a hair strand
 * appears or does not depending on the scale. A pyramid averages the ones that
 * are actually covered.
 *
 * The levels are built in PREMULTIPLIED space and stored that way. Averaging
 * straight-alpha colour would pull the colour hidden under transparent pixels
 * into the visible average, which is the halo this repository already avoids in
 * the bilinear path. Level 0 is the source, and a level is half the previous
 * one rounded up, so a 1-px dimension stops halving.
 */
interface MipLevel { width: number; height: number; rgba: Float32Array }
const PYRAMIDS = new WeakMap<RgbaTexture, MipLevel[]>();

export function mipPyramid(texture: RgbaTexture): MipLevel[] {
  const cached = PYRAMIDS.get(texture);
  if (cached) return cached;
  const base: MipLevel = { width: texture.width, height: texture.height,
    rgba: new Float32Array(texture.width * texture.height * 4) };
  for (let i = 0; i < texture.rgba.length; i += 4) {
    const alpha = texture.rgba[i + 3] / 255;
    base.rgba[i] = texture.rgba[i] / 255 * alpha;
    base.rgba[i + 1] = texture.rgba[i + 1] / 255 * alpha;
    base.rgba[i + 2] = texture.rgba[i + 2] / 255 * alpha;
    base.rgba[i + 3] = alpha;
  }
  const levels = [base];
  while (levels.at(-1)!.width > 1 || levels.at(-1)!.height > 1) {
    const from = levels.at(-1)!;
    const width = Math.max(1, from.width >> 1), height = Math.max(1, from.height >> 1);
    const next: MipLevel = { width, height, rgba: new Float32Array(width * height * 4) };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      // Average the box this texel covers, which is 2x2 except on an odd edge,
      // where it is whatever is there rather than a wrapped or clamped guess.
      const x0 = x * 2, y0 = y * 2;
      const x1 = Math.min(from.width - 1, x0 + 1), y1 = Math.min(from.height - 1, y0 + 1);
      const xs = x1 === x0 ? [x0] : [x0, x1], ys = y1 === y0 ? [y0] : [y0, y1];
      const out = (y * width + x) * 4;
      for (const sy of ys) for (const sx of xs) {
        const i = (sy * from.width + sx) * 4;
        for (let c = 0; c < 4; c++) next.rgba[out + c] += from.rgba[i + c];
      }
      for (let c = 0; c < 4; c++) next.rgba[out + c] /= xs.length * ys.length;
    }
    levels.push(next);
  }
  PYRAMIDS.set(texture, levels);
  return levels;
}

function sampleLevel(level: MipLevel, u: number, v: number): Rgba {
  const texel = (x: number, y: number): Rgba => {
    const i = (Math.max(0, Math.min(level.height - 1, y)) * level.width +
      Math.max(0, Math.min(level.width - 1, x))) * 4;
    return [level.rgba[i], level.rgba[i + 1], level.rgba[i + 2], level.rgba[i + 3]];
  };
  const x = u * level.width - 0.5, y = v * level.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const samples = [texel(x0, y0), texel(x0 + 1, y0), texel(x0, y0 + 1), texel(x0 + 1, y0 + 1)];
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  return [0, 1, 2, 3].map(c => samples.reduce((sum, rgba, i) => sum + rgba[c] * weights[i], 0)) as Rgba;
}

/** Trilinear: bilinear within the two levels around `lod`, linear between them. */
function sampleMipmap(texture: RgbaTexture, u: number, v: number, lod: number): Rgba {
  const levels = mipPyramid(texture);
  const clamped = Math.max(0, Math.min(levels.length - 1, lod));
  const lo = Math.floor(clamped), hi = Math.min(levels.length - 1, lo + 1), f = clamped - lo;
  const a = sampleLevel(levels[lo], u, v);
  if (f === 0 || hi === lo) return a;
  const b = sampleLevel(levels[hi], u, v);
  return [0, 1, 2, 3].map(c => a[c] * (1 - f) + b[c] * f) as Rgba;
}

function validateTexture(texture: RgbaTexture) {
  const { width, height, rgba } = texture;
  if (![width, height].every(v => Number.isSafeInteger(v) && v > 0) ||
      rgba.length !== width * height * 4) throw new Error('Invalid texture dimensions');
}

function sampleMask(mask: TextureMask, x: number, y: number): number {
  const [a, b, c, d, tx, ty] = mask.screenToUv;
  const u = a * x + c * y + tx, v = b * x + d * y + ty;
  const { width, height, rgba } = mask.texture;
  const channel = mask.channel === 'red' ? 0 : 3;
  const texel = (px: number, py: number) => px < 0 || py < 0 || px >= width || py >= height
    ? mask.outsideValue : rgba[(py * width + px) * 4 + channel] / 255;
  let value: number;
  if (mask.sampling === 'nearest') value = texel(Math.floor(u * width), Math.floor(v * height));
  else {
    const px = u * width - 0.5, py = v * height - 0.5;
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    value = texel(ix, iy) * (1 - fx) * (1 - fy) + texel(ix + 1, iy) * fx * (1 - fy) +
      texel(ix, iy + 1) * (1 - fx) * fy + texel(ix + 1, iy + 1) * fx * fy;
  }
  return mask.invert ? 1 - value : value;
}

export function validateTexturedMesh(mesh: TexturedMesh) {
  const n = mesh.depth.length;
  if (!n || mesh.xy.length !== n * 2 || mesh.uv.length !== n * 2 ||
      mesh.indices.length % 3 || !mesh.indices.every(i => i < n) ||
      !mesh.xy.every(Number.isFinite) || !mesh.depth.every(Number.isFinite) ||
      !mesh.uv.every(Number.isFinite) || !Number.isFinite(mesh.depthOffset) ||
      !Number.isFinite(mesh.opacity) || mesh.opacity < 0 || mesh.opacity > 1 ||
      !['nearest', 'bilinear', 'mipmap'].includes(mesh.sampling) ||
      mesh.blend !== undefined && !BLEND_MODES.includes(mesh.blend)) throw new Error('Invalid textured mesh');
  validateTexture(mesh.texture);
  if (mesh.mask) {
    const mask = mesh.mask;
    validateTexture(mask.texture);
    if (mask.screenToUv.length !== 6 || !mask.screenToUv.every(Number.isFinite) ||
        !['nearest', 'bilinear'].includes(mask.sampling) || !['red', 'alpha'].includes(mask.channel) ||
        !Number.isFinite(mask.outsideValue) || mask.outsideValue < 0 || mask.outsideValue > 1 ||
        typeof mask.invert !== 'boolean') throw new Error('Invalid texture mask');
  }
}

/** Normal source-over only, in encoded sRGB; no implicit groups or blend modes.
 * This is an allocation-heavy correctness reference, not a device-cost claim.
 * The current domain is non-self-overlapping sheets. Folded meshes are rejected.
 */
export function renderTextured(meshes: readonly TexturedMesh[], width: number, height: number,
  background: Rgba = [0, 0, 0, 0], options: TexturedOptions = {}): TexturedResult {
  if (![width, height].every(v => Number.isSafeInteger(v) && v > 0) ||
      !Number.isSafeInteger(width * height * 4) || background.length !== 4 ||
      !background.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
    throw new Error('Invalid textured viewport/background');
  }
  meshes.forEach(validateTexturedMesh);
  const count = width * height;
  const fragments: (Fragment[] | undefined)[] = new Array(count);
  const result: TexturedResult = { width, height, rgba: new Uint8ClampedArray(count * 4),
    premultiplied: new Float64Array(count * 4), alphaCoverageCount: new Uint32Array(count),
    frontPart: new Int32Array(count).fill(-1), selfOverlapPixels: 0 };
  const countOverlap = options.selfOverlap === 'count';
  const edge = (ax: number, ay: number, bx: number, by: number, x: number, y: number) =>
    (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  /**
   * The same shared edge, evaluated to exactly opposite values from the two
   * triangles that meet along it.
   *
   * `edge(a, b, p)` and `edge(b, a, p)` are not floating-point negations of each
   * other, so a pixel centre lying on a shared edge could round to a negative
   * value from BOTH sides and be rejected by both -- a one-pixel hole along the
   * seam, which the top-left rule alone cannot close because it only decides
   * exact zeroes. Evaluating the edge in a canonical endpoint order and negating
   * for the triangle that sees it the other way makes the two values exact
   * negations, so the top-left rule then claims the pixel for exactly one.
   */
  const shared = (ax: number, ay: number, bx: number, by: number, x: number, y: number) =>
    bx < ax || bx === ax && by < ay
      ? -edge(bx, by, ax, ay, x, y) : edge(ax, ay, bx, by, x, y);
  const topLeft = (ax: number, ay: number, bx: number, by: number) => by < ay || by === ay && bx > ax;

  meshes.forEach((mesh, part) => {
    if (mesh.opacity === 0) return;
    const covered = new Set<number>();
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t];
      let b = mesh.indices[t + 1], c = mesh.indices[t + 2];
      const ax = mesh.xy[a * 2], ay = mesh.xy[a * 2 + 1];
      let bx = mesh.xy[b * 2], by = mesh.xy[b * 2 + 1], cx = mesh.xy[c * 2], cy = mesh.xy[c * 2 + 1];
      let area = edge(ax, ay, bx, by, cx, cy);
      if (!Number.isFinite(area)) throw new Error('Invalid textured mesh extent');
      if (area === 0) continue;
      if (area < 0) {
        [b, c] = [c, b]; [bx, cx] = [cx, bx]; [by, cy] = [cy, by]; area = -area;
      }
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
      const ab = topLeft(ax, ay, bx, by), bc = topLeft(bx, by, cx, cy), ca = topLeft(cx, cy, ax, ay);
      // One level of detail per triangle. The uv map across a triangle is
      // affine, so the texels-per-pixel ratio is constant over it and there is
      // nothing a per-pixel derivative would add: it is the ratio of the
      // triangle's area in texels to its area in pixels, and the level is half
      // its base-2 logarithm because area grows as the square of the scale.
      let lod = 0;
      if (mesh.sampling === 'mipmap') {
        const du1 = (mesh.uv[b * 2] - mesh.uv[a * 2]) * mesh.texture.width;
        const dv1 = (mesh.uv[b * 2 + 1] - mesh.uv[a * 2 + 1]) * mesh.texture.height;
        const du2 = (mesh.uv[c * 2] - mesh.uv[a * 2]) * mesh.texture.width;
        const dv2 = (mesh.uv[c * 2 + 1] - mesh.uv[a * 2 + 1]) * mesh.texture.height;
        const texels = Math.abs(du1 * dv2 - dv1 * du2);
        if (texels > 0 && area > 0) lod = Math.max(0, 0.5 * Math.log2(texels / area));
      }
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const e0 = shared(bx, by, cx, cy, x + 0.5, y + 0.5);
        const e1 = shared(cx, cy, ax, ay, x + 0.5, y + 0.5);
        const e2 = shared(ax, ay, bx, by, x + 0.5, y + 0.5);
        if (e0 < 0 || e0 === 0 && !bc || e1 < 0 || e1 === 0 && !ca || e2 < 0 || e2 === 0 && !ab) continue;
        const pixel = y * width + x;
        if (covered.has(pixel)) {
          if (!countOverlap) throw new Error('Textured sheet self-overlap is unsupported');
          result.selfOverlapPixels++;
        } else covered.add(pixel);
        const w0 = e0 / area, w1 = e1 / area, w2 = e2 / area;
        const u = w0 * mesh.uv[a * 2] + w1 * mesh.uv[b * 2] + w2 * mesh.uv[c * 2];
        const v = w0 * mesh.uv[a * 2 + 1] + w1 * mesh.uv[b * 2 + 1] + w2 * mesh.uv[c * 2 + 1];
        const opacity = mesh.opacity * (mesh.mask ? sampleMask(mesh.mask, x + 0.5, y + 0.5) : 1);
        const color = sampleTexture(mesh.texture, u, v, mesh.sampling, lod).map(c => c * opacity) as Rgba;
        if (color[3] === 0) continue;
        const depth = w0 * mesh.depth[a] + w1 * mesh.depth[b] + w2 * mesh.depth[c] + mesh.depthOffset;
        (fragments[pixel] ??= []).push({ depth, part, color, blend: mesh.blend ?? 'normal' });
      }
    }
  });
  for (let pixel = 0; pixel < count; pixel++) {
    const stack = fragments[pixel];
    const color: Rgba = [background[0] * background[3], background[1] * background[3],
      background[2] * background[3], background[3]];
    if (stack) {
      // Smaller depth is nearer; on an exact tie the earlier input part wins.
      stack.sort((a, b) => b.depth - a.depth || b.part - a.part);
      result.alphaCoverageCount[pixel] = stack.length;
      result.frontPart[pixel] = stack[stack.length - 1].part;
      for (const fragment of stack) {
        const remaining = 1 - fragment.color[3];
        if (fragment.blend === 'normal') {
          for (let channel = 0; channel < 4; channel++) {
            color[channel] = fragment.color[channel] + color[channel] * remaining;
          }
          continue;
        }
        // The general separable composite, on straight values:
        //   Co = as*(1-ab)*Cs + as*ab*B(Cb, Cs) + (1-as)*ab*Cb
        //   ao = as + ab*(1-as)
        // With premultiplied accumulators, (1-as)*ab*Cb is (1-as)*color[c].
        // Where the backdrop is empty every mode reduces to source-over, which
        // is what makes a blended layer over nothing look like the layer.
        const as = fragment.color[3], ab = color[3];
        for (let channel = 0; channel < 3; channel++) {
          const cs = as ? fragment.color[channel] / as : 0;
          const cb = ab ? color[channel] / ab : 0;
          const blended = blendChannel(fragment.blend, cb, cs);
          color[channel] = as * (1 - ab) * cs + as * ab * blended + remaining * color[channel];
        }
        color[3] = as + ab * remaining;
      }
    }
    const base = pixel * 4;
    result.premultiplied.set(color, base);
    for (let channel = 0; channel < 3; channel++) result.rgba[base + channel] = color[3] ? Math.round(color[channel] / color[3] * 255) : 0;
    result.rgba[base + 3] = Math.round(color[3] * 255);
  }
  return result;
}
