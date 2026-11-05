import { describe, it, expect } from 'vitest';
import { rigFixture } from '../../test/rigFixture';
import { packAtlas } from '../live2d/packAtlas';
import { prepareLive2D } from '../live2d/export';
import { encodePNG } from '../../shared/encodePNG';
import { decodePNG } from '../../generate/png';
import { readCombined, type CombinedAsset } from '../../../player/src/combinedRuntime';
import { renderTextured } from '../../../engine/src/render/textured';

/** Fixture with the shapes shipped exports carry: a byte-identical page, a sparse full-canvas
 *  page, an edge-touching UV box, a shared slot and an unused page. */
function sparseFixture() {
  const a = readCombined(rigFixture()), base = a.parts[0];
  const canvas = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) canvas.set([x * 4, y * 4, (x ^ y) * 4, x > 40 && y > 40 ? 255 : (x + y) % 3 ? 0 : 200], (y * 64 + x) * 4);
  const sparse = encodePNG(canvas, 64, 64);
  a.textures.push(new Uint8Array(a.textures[0]), sparse, encodePNG(new Uint8ClampedArray(32 * 32 * 4), 32, 32));
  const add = (uuid: number, page: number, uvs: number[]) => {
    const n = { ...structuredClone(base), uuid, name: `part${uuid}`, textures: [page, 0xffffffff, 0xffffffff] };
    n.mesh!.uvs = uvs; a.parts.push(n); a.puppet.nodes.children!.push(n);
  };
  add(2, 1, [.25, .25, .75, .25, .75, .75, .25, .75]);  // duplicate of page 0
  add(3, 2, [.66, .66, 1, .66, 1, 1, .66, 1]);          // touches the right and bottom edges
  add(4, 2, [.66, .66, 1, .66, 1, 1, .66, 1]);          // shares part 3's slot
  add(5, 2, [0, 0, .3, 0, .3, .2, 0, .2]);              // same page, distinct slot
  return a;
}

function render(asset: CombinedAsset, textures: Uint8Array[], uvs: (uuid: number) => number[], page: (uuid: number) => number) {
  const decoded = textures.map(t => decodePNG(t));
  return asset.parts.map(p => renderTextured([{
    xy: new Float64Array(p.mesh!.verts.map((v, k) => v * 1.7 + (k % 2 ? asset.height : asset.width) / 2)),
    uv: new Float64Array(uvs(p.uuid)), indices: new Uint32Array(p.mesh!.indices), depth: new Float64Array(p.mesh!.verts.length / 2),
    depthOffset: 0, opacity: 1, texture: decoded[page(p.uuid)], sampling: 'bilinear',
  }], asset.width, asset.height).premultiplied);
}

describe('Live2D atlas packing', () => {
  it('collapses duplicate and unused pages into one power-of-two page', () => {
    const a = sparseFixture(), packed = packAtlas(a);
    expect(packed.report).toMatchObject({ sourcePages: 4, duplicateSourcePages: 1, unusedSourcePages: 1, slots: 4 });
    expect(packed.textures).toHaveLength(1);
    for (const p of packed.report.pages) { expect(p.width).toBe(p.height); expect(Math.log2(p.width) % 1).toBe(0); }
  });
  it('keeps shared slots shared and distinct slots distinct', () => {
    const packed = packAtlas(sparseFixture());
    expect(packed.uvs.get(3)).toBe(packed.uvs.get(4));
    expect(new Set([1, 2, 3, 5].map(id => packed.uvs.get(id)!.join())).size).toBe(4);
  });
  it('renders every drawable from the same texels', () => {
    const a = sparseFixture(), packed = packAtlas(a);
    const before = render(a, a.textures, id => a.parts.find(p => p.uuid === id)!.mesh!.uvs, id => a.parts.find(p => p.uuid === id)!.textures![0]);
    const after = render(a, packed.textures, id => packed.uvs.get(id)!, id => packed.page.get(id)!);
    // Only bilinear weights computed at shifted coordinates may differ, by float rounding.
    before.forEach((color, i) => expect(Math.max(...color.map((v, k) => Math.abs(v - after[i][k])))).toBeLessThan(1e-9));
  });
  it('feeds the bridge without changing the asset', () => {
    const a = sparseFixture(), uvs = a.parts.map(p => [...p.mesh!.uvs]), packed = packAtlas(a), bridge = prepareLive2D(a, 'Fixture', {}, packed);
    expect(bridge.textures).toEqual(['textures/texture_00.png']);
    for (const d of bridge.drawables) { expect(d.uvs).toBe(packed.uvs.get(d.uuid)); expect(d.texture).toBe(0); }
    expect(a.parts.map(p => p.mesh!.uvs)).toEqual(uvs);
  });
  it('refuses UVs outside the page', () => {
    const a = sparseFixture(); a.parts[1].mesh!.uvs[0] = 1.2;
    expect(() => packAtlas(a)).toThrow(/outside the texture page/);
  });
});
