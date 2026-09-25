import { describe, expect, it } from 'vitest';
import parameters from '../fixtures/controls.json';
import fixture from '../fixtures/calibration.json';
import { calibratedValues, resolveCalibration, type Calibration } from '../src/calibration';

const fresh = () => structuredClone(fixture) as Calibration;

describe('synthetic intended-view calibration', () => {
  it('uses asymmetric declared anchors rather than treating raw controls as degrees', () => {
    expect(calibratedValues(parameters, {}, fresh(), { yaw: -10 }))
      .toEqual({ 'synthetic.horizontal': -1 });
    expect(calibratedValues(parameters, {}, fresh(), { yaw: 15 }))
      .toEqual({ 'synthetic.horizontal': 0.5 });
    expect(calibratedValues(parameters, {}, fresh(), {}))
      .toEqual({ 'synthetic.horizontal': 0 });
  });
  it('supports reversed controls and preserves the configured expression neutral', () => {
    const input = fresh();
    input.axes[0].anchors.forEach(a => { a.value *= -1; });
    expect(calibratedValues(parameters, { 'synthetic.open': 0.75 }, input, { yaw: -10 }))
      .toEqual({ 'synthetic.horizontal': 1, 'synthetic.open': 0.75 });
  });
  it('refuses extrapolation, unknown axes and missing calibration', () => {
    expect(() => calibratedValues(parameters, {}, undefined, { yaw: 0 })).toThrow('unavailable');
    expect(() => calibratedValues(parameters, {}, fresh(), { yaw: 31 })).toThrow('range');
    expect(() => calibratedValues(parameters, {}, fresh(), { pitch: 0 })).toThrow('Unknown');
    expect(() => calibratedValues(parameters, {}, fresh(), { yaw: NaN })).toThrow('invalid');
  });
  it('rejects ambiguous, unsupported or unproven anchors', () => {
    for (const mutate of [
      (c: Calibration) => { c.axes[0].anchors[0].source = ''; },
      (c: Calibration) => { c.axes[0].anchors[0].intendedView = ''; },
      (c: Calibration) => { c.axes[0].anchors[0].value = -10; },
      (c: Calibration) => { c.axes[0].anchors[2].value = -1; },
      (c: Calibration) => { c.axes[0].anchors[2].degrees = 0; },
      (c: Calibration) => { c.axes[0].anchors[1].degrees = 1; },
      (c: Calibration) => { c.axes[0].parameterId = 'unknown'; },
      (c: Calibration) => { c.axes.push(c.axes[0]); },
    ]) {
      const input = fresh();
      mutate(input);
      expect(() => resolveCalibration(parameters, {}, input)).toThrow();
    }
    expect(() => resolveCalibration(parameters, { 'synthetic.horizontal': 1 }, fresh()))
      .toThrow('neutral');
  });
  it('does not promote isolated sweeps to a coupled calibration', () => {
    const input = fresh();
    input.axes.push({ axis: 'pitch', parameterId: 'synthetic.open', anchors: [
      { degrees: 0, value: 0.25, source: 'synthetic', intendedView: 'neutral' },
      { degrees: 10, value: 1, source: 'synthetic', intendedView: 'raised' },
    ] });
    expect(() => calibratedValues(parameters, {}, input, { yaw: 10, pitch: 5 })).toThrow('Coupled');
    expect(calibratedValues(parameters, {}, input, { yaw: 0, pitch: 5 })['synthetic.open'])
      .toBe(0.625);
  });
});
