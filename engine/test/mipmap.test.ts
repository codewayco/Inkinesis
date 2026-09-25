import { describe, expect, it } from 'vitest';
import { mipPyramid, renderTextured, sampleTexture, type RgbaTexture, type TexturedMesh } from '../src/render/textured';

/** A checkerboard, for the pyramid's own arithmetic. */
function checker(size: number, a = [255, 255, 255, 255], b = [0, 0, 0, 255]): RgbaTexture {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    rgba.set((x + y) % 2 ? a : b, (y * size + x) * 4);
  }
  return { width: size, height: size, rgba };
}
const quad = (texture: RgbaTexture, w: number, h: number,
  sampling: TexturedMesh['sampling']): TexturedMesh => ({ texture,
  xy: new Float64Array([0, 0, w, 0, w, h, 0, h]),
  uv: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  depth: new Float64Array(4), depthOffset: 0, opacity: 1, sampling });

describe('mipmapped minification', () => {
  it('halves until one texel, and averages what each level covers', () => {
    const levels = mipPyramid(checker(8));
    expect(levels.map(l => `${l.width}x${l.height}`)).toEqual(['8x8', '4x4', '2x2', '1x1']);
    // A black and white checkerboard averages to mid grey, in premultiplied
    // space where both are fully opaque.
    const top = levels.at(-1)!;
    expect(top.rgba[0]).toBeCloseTo(0.5, 6);
    expect(top.rgba[3]).toBeCloseTo(1, 6);
  });

  it('averages a non-square texture down to a single texel too', () => {
    expect(mipPyramid(checker(1)).map(l => l.width)).toEqual([1]);
    const wide: RgbaTexture = { width: 3, height: 1, rgba: new Uint8ClampedArray(12).fill(255) };
    expect(mipPyramid(wide).map(l => `${l.width}x${l.height}`)).toEqual(['3x1', '1x1']);
  });

  it('averages in premultiplied space, so hidden colour stays hidden', () => {
    // One opaque red texel and one fully transparent GREEN texel. Averaging
    // straight colour would drag the green into the visible result; averaging
    // premultiplied colour keeps it out and halves the coverage instead.
    const texture: RgbaTexture = { width: 2, height: 1,
      rgba: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]) };
    const top = mipPyramid(texture).at(-1)!;
    expect(top.rgba[3]).toBeCloseTo(0.5, 6);
    expect(top.rgba[0]).toBeCloseTo(0.5, 6);
    expect(top.rgba[1]).toBeCloseTo(0, 6);
  });

  it('NEGATIVE CONTROL: thin lines, which neither point nor bilinear sampling can report', () => {
    // The lash and hair-strand case, made exact. A 64x64 texture whose every
    // eighth row is white: one eighth of the surface is lit, so an output pixel
    // covering the whole thing is 255/8 = 32.
    //
    // Nearest lands on a lit row every time and reports a FULLY WHITE surface.
    // Bilinear averages four texels of the 256 it covers and reports mid grey.
    // Neither is noise around the answer; both are confident and wrong, in
    // opposite directions. The pyramid averages the texels that are there.
    const size = 64, period = 8;
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      rgba.set(y % period === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * size + x) * 4);
    }
    const texture: RgbaTexture = { width: size, height: size, rgba };
    const luma = (image: { rgba: Uint8ClampedArray }) =>
      [...image.rgba].filter((_, i) => i % 4 === 0);
    const truth = Math.round(255 / period);
    expect(luma(renderTextured([quad(texture, 4, 4, 'nearest')], 4, 4))).toEqual(Array(16).fill(255));
    expect(luma(renderTextured([quad(texture, 4, 4, 'bilinear')], 4, 4))).toEqual(Array(16).fill(128));
    expect(luma(renderTextured([quad(texture, 4, 4, 'mipmap')], 4, 4))).toEqual(Array(16).fill(truth));
  });

  it('costs nothing at one texel per pixel: level 0 is the source', () => {
    // Magnification and 1:1 must not go soft. At lod 0 the pyramid's base is the
    // source, so mipmap and bilinear agree there.
    const texture = checker(8);
    for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.3]]) {
      expect(sampleTexture(texture, u, v, 'mipmap', 0))
        .toEqual(sampleTexture(texture, u, v, 'bilinear'));
    }
    const one = renderTextured([quad(texture, 8, 8, 'mipmap')], 8, 8);
    const same = renderTextured([quad(texture, 8, 8, 'bilinear')], 8, 8);
    expect(Array.from(one.rgba)).toEqual(Array.from(same.rgba));
  });

  it('rejects an unknown sampling mode rather than defaulting to one', () => {
    expect(() => renderTextured([quad(checker(4), 4, 4, 'trilinear' as never)], 4, 4)).toThrow();
  });
});
