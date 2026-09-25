import { describe, expect, it } from 'vitest';
import parameters from '../fixtures/controls.json';
import { resolveFrame } from '../src/controls';

describe('public synthetic reference controls', () => {
  const neutral = { frame: 0, fps: 60, values: {} };
  it('uses explicit frame time and resets omitted inputs on every call', () => {
    const posed = resolveFrame(parameters, { frame: 30, fps: 60,
      values: { 'synthetic.horizontal': 1, 'synthetic.open': 1 } });
    expect(posed).toEqual({ timeSeconds: 0.5, values: [1, 1] });
    expect(resolveFrame(parameters, neutral).values).toEqual([0, 0.25]);
    expect(resolveFrame(parameters, { ...neutral, frame: 30 }).timeSeconds).toBe(0.5);
  });
  it('rejects unknown controls rather than creating SDK virtual parameters', () => {
    expect(() => resolveFrame(parameters, { ...neutral, values: { missing: 0 } })).toThrow('Unknown');
  });
  it.each([3, -3, NaN, Infinity])('rejects invalid raw control %s', value => {
    expect(() => resolveFrame(parameters, { ...neutral,
      values: { 'synthetic.horizontal': value } })).toThrow('Invalid');
  });
  it.each([-1, 0.5, Infinity])('rejects invalid frame %s', frame => {
    expect(() => resolveFrame(parameters, { ...neutral, frame })).toThrow('frame');
  });
  it.each([0, -1, Infinity, NaN])('rejects invalid fps %s', fps => {
    expect(() => resolveFrame(parameters, { ...neutral, fps })).toThrow('fps');
  });
  it('rejects malformed descriptor inventories', () => {
    expect(() => resolveFrame([parameters[0], parameters[0]], neutral)).toThrow('Duplicate');
    expect(() => resolveFrame([{ ...parameters[0], defaultValue: 10 }], neutral)).toThrow('Invalid');
  });
});
