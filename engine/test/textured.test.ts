import { describe, expect, it } from 'vitest';
import { renderTextured, sampleTexture, type RgbaTexture, type TexturedMesh } from '../src/render/textured';

const solid = (rgba: number[]): RgbaTexture => ({ width: 1, height: 1, rgba: new Uint8ClampedArray(rgba) });
const quad = (texture: RgbaTexture, z = 0, width = 2, height = 2): TexturedMesh => ({
  texture, xy: new Float64Array([0, 0, width, 0, width, height, 0, height]),
  depth: new Float64Array(4).fill(z), indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  uv: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]), opacity: 1, depthOffset: 0, sampling: 'nearest',
});

describe('a tessellated sheet is watertight along its shared edges', () => {
  // The exact grid cell that exposed this, taken from a head-proxy tessellation:
  // its diagonal passes through the pixel centre (68.5, 103.5), and its corners
  // are not representable, so evaluating that shared edge from one end and from
  // the other gives two values that are not floating-point negations.
  const cell = (dx = 0): TexturedMesh => ({
    texture: solid([255, 0, 0, 255]),
    xy: new Float64Array([
      63.7640215849275 + dx, 98.76402158492749, 68.528043169855 + dx, 98.76402158492749,
      68.528043169855 + dx, 103.528043169855, 63.7640215849275 + dx, 103.528043169855,
    ]),
    // Two triangles sharing 0 -> 2, seen from opposite ends: what a grid emits.
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    depth: new Float64Array(4), uv: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]),
    opacity: 1, depthOffset: 0, sampling: 'nearest',
  });
  const filled = (r: ReturnType<typeof renderTextured>) =>
    Array.from(r.alphaCoverageCount).filter(Boolean).length;

  it('claims a pixel centre lying on the diagonal exactly once', () => {
    const result = renderTextured([cell()], 128, 128);
    // Rejected by BOTH triangles without the canonical shared-edge evaluation,
    // which leaves a hole on the seam; claimed twice by a rule that
    // overcorrects, which the renderer's self-overlap check would throw on.
    expect(result.alphaCoverageCount[103 * 128 + 68]).toBe(1);
    expect(Array.from(result.rgba.subarray((103 * 128 + 68) * 4, (103 * 128 + 68) * 4 + 4)))
      .toEqual([255, 0, 0, 255]);
  });

  it('covers as many pixel centres as the same cell moved off the seam', () => {
    expect(filled(renderTextured([cell()], 128, 128)))
      .toBe(filled(renderTextured([cell(0.13)], 128, 128)));
  });
});

describe('normal sRGB textured reference', () => {
  it('retains source orientation and samples texture coordinates at pixel centers', () => {
    const texture = { width: 2, height: 2, rgba: new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 70, 90, 110, 128,
    ]) };
    const result = renderTextured([quad(texture)], 2, 2);
    expect(result.rgba).toEqual(texture.rgba);
    expect(Array.from(result.alphaCoverageCount)).toEqual([1, 1, 1, 1]);
  });
  it('composites every translucent contributor rather than coloring only the nearest', () => {
    const front = quad(solid([255, 0, 0, 128]), -1);
    const back = quad(solid([0, 0, 255, 255]), 1);
    const result = renderTextured([front, back], 2, 2);
    expect(Array.from(result.rgba.subarray(0, 4))).toEqual([128, 0, 127, 255]);
    expect(result.alphaCoverageCount[0]).toBe(2);
    expect(result.frontPart[0]).toBe(0);
    expect(renderTextured([back, front], 2, 2).rgba).toEqual(result.rgba);
  });
  it('handles per-pixel depth interleaving and transparent front holes', () => {
    const red = quad(solid([255, 0, 0, 255]));
    red.depth.set([-1, 1, 1, -1]);
    const blue = quad(solid([0, 0, 255, 255]));
    const result = renderTextured([red, blue], 2, 2);
    expect(Array.from(result.rgba.subarray(0, 8))).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    const hole = quad(solid([255, 255, 0, 0]), -2);
    expect(renderTextured([hole, blue], 2, 2).rgba).toEqual(renderTextured([blue], 2, 2).rgba);
    expect(renderTextured([hole, blue], 2, 2).alphaCoverageCount[0]).toBe(1);
  });
  it('filters in premultiplied space without bleeding hidden RGB', () => {
    const texture = { width: 2, height: 1, rgba: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]) };
    expect(sampleTexture(texture, 0.5, 0.5, 'bilinear')).toEqual([0.5, 0, 0, 0.5]);
    expect(sampleTexture(texture, -1, 0.5, 'bilinear')).toEqual([1, 0, 0, 1]);
    const mesh = quad(texture, 0, 1, 1);
    mesh.sampling = 'bilinear';
    expect(Array.from(renderTextured([mesh], 1, 1, [1, 1, 1, 1]).rgba)).toEqual([255, 128, 128, 255]);
  });
  it('keeps UVs attached as geometry moves, clips to the viewport and respects opacity', () => {
    const mesh = quad(solid([255, 0, 0, 255]));
    for (let i = 0; i < mesh.xy.length; i += 2) mesh.xy[i] -= 1;
    mesh.opacity = 0.5;
    const result = renderTextured([mesh], 2, 2);
    expect(Array.from(result.rgba.subarray(0, 8))).toEqual([255, 0, 0, 128, 0, 0, 0, 0]);
    expect(Array.from(result.alphaCoverageCount)).toEqual([1, 0, 1, 0]);
  });
  it('uses a consistent fill rule, accepts reversed winding and rejects folded sheets', () => {
    const mesh = quad(solid([255, 0, 0, 128]));
    const expected = renderTextured([mesh], 2, 2).rgba;
    mesh.indices.set([2, 1, 0, 3, 2, 0]);
    expect(renderTextured([mesh], 2, 2).rgba).toEqual(expected);
    mesh.indices = new Uint32Array([0, 1, 2, 0, 1, 2]);
    expect(() => renderTextured([mesh], 2, 2)).toThrow('self-overlap');
  });
  it('rejects malformed buffers and nonfinite controls instead of rendering misleading output', () => {
    const mesh = quad(solid([255, 0, 0, 255]));
    expect(() => renderTextured([{ ...mesh, opacity: NaN }], 2, 2)).toThrow('mesh');
    expect(() => renderTextured([{ ...mesh, uv: new Float64Array(2) }], 2, 2)).toThrow('mesh');
    expect(() => renderTextured([{ ...mesh, texture: { ...mesh.texture, width: 2 } }], 2, 2)).toThrow('texture');
    expect(() => renderTextured([mesh], 0, 2)).toThrow('viewport');
  });
  it('moves the live mask independently without rebaking or changing source alpha', () => {
    const mesh = quad(solid([255, 0, 0, 255]));
    mesh.mask = { texture: { width: 2, height: 1,
      rgba: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]) },
      screenToUv: [0.5, 0, 0, 0.5, 0, 0], sampling: 'nearest', channel: 'alpha',
      outsideValue: 0, invert: false };
    const initial = renderTextured([mesh], 2, 2);
    expect(Array.from(initial.alphaCoverageCount)).toEqual([1, 0, 1, 0]);
    mesh.mask.screenToUv[4] = -0.5;
    expect(Array.from(renderTextured([mesh], 2, 2).alphaCoverageCount)).toEqual([0, 1, 0, 1]);
    mesh.mask.screenToUv[4] = 0;
    expect(renderTextured([mesh], 2, 2).rgba).toEqual(initial.rgba);
    expect(mesh.texture.rgba[3]).toBe(255);
    expect(Array.from(mesh.mask.texture.rgba)).toEqual([0, 0, 0, 255, 0, 0, 0, 0]);
  });
  it('honors grayscale mask channels, inversion and explicit outside coverage', () => {
    const mesh = quad(solid([255, 0, 0, 255]));
    mesh.mask = { texture: solid([64, 64, 64, 255]), screenToUv: [1, 0, 0, 1, 0, 0],
      sampling: 'nearest', channel: 'red', outsideValue: 1, invert: true };
    expect(Array.from(renderTextured([mesh], 2, 2).rgba.subarray(0, 8)))
      .toEqual([255, 0, 0, 191, 0, 0, 0, 0]);
    mesh.mask.invert = false;
    mesh.mask.sampling = 'bilinear';
    mesh.mask.outsideValue = 0;
    mesh.mask.screenToUv[4] = 0.5; // Sample halfway across the finite mask border.
    expect(renderTextured([mesh], 2, 2).rgba[3]).toBe(32);
    mesh.mask.outsideValue = 2;
    expect(() => renderTextured([mesh], 2, 2)).toThrow('mask');
  });
});
