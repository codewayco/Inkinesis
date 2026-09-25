import { describe, expect, it } from 'vitest';
import { alignedMatrix, clearColor, resolveAlignment } from '../src/alignment';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('synthetic reference framing', () => {
  it('preserves square framing and maintains pixel aspect in a wide viewport', () => {
    expect(Array.from(alignedMatrix(identity, 100, 100))).toEqual(identity);
    const matrix = alignedMatrix(identity, 200, 100);
    expect(matrix[0] * 200).toBe(matrix[5] * 100);
  });
  it('applies exported translation before view scale and clip-space offset', () => {
    const model = [...identity];
    model[12] = 0.5;
    model[13] = -0.25;
    const matrix = alignedMatrix(model, 200, 100,
      { scale: 2, offsetX: -0.1, offsetY: 0.2, background: [1, 1, 1, 1] });
    expect(matrix[0]).toBe(1);
    expect(matrix[5]).toBe(2);
    expect(matrix[12]).toBeCloseTo(0.4);
    expect(matrix[13]).toBeCloseTo(-0.3);
  });
  it('copies inputs and premultiplies a translucent background', () => {
    const original = resolveAlignment();
    const copied = resolveAlignment(original);
    original.background[0] = 1;
    expect(copied.background).toEqual([0, 0, 0, 0]);
    expect(clearColor({ ...copied, background: [1, 0.5, 0.25, 0.5] }))
      .toEqual([0.5, 0.25, 0.125, 0.5]);
  });
  it('rejects invalid framing instead of accepting a degenerate comparison', () => {
    for (const scale of [0, -1, NaN, Infinity]) {
      expect(() => resolveAlignment({ ...resolveAlignment(), scale })).toThrow('alignment');
    }
    expect(() => resolveAlignment({ ...resolveAlignment(), offsetX: NaN })).toThrow('alignment');
    expect(() => resolveAlignment({ ...resolveAlignment(), background: [0, 0, 0, 2] }))
      .toThrow('alignment');
    expect(() => alignedMatrix(identity, 0, 100)).toThrow('viewport');
    expect(() => alignedMatrix([NaN], 100, 100)).toThrow('matrix');
  });
});
