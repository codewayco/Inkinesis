import { resolveFrame, type Parameter } from './controls';

export type HeadAxis = 'yaw' | 'pitch' | 'roll';
export interface CalibrationAnchor {
  degrees: number;
  value: number;
  /** Location of intended-view/landmark evidence, not an inference from an ID. */
  source: string;
  intendedView: string;
}
export interface AxisCalibration {
  axis: HeadAxis;
  parameterId: string;
  anchors: CalibrationAnchor[];
}
export interface Calibration {
  /** Axis sweeps do not establish the validity of coupled controls. */
  scope: 'isolated-axes';
  axes: AxisCalibration[];
}

/** Validate declared evidence and ranges; this cannot authenticate rigger intent. */
export function resolveCalibration(parameters: readonly Parameter[],
  neutralValues: Record<string, number>, input: Calibration): Calibration {
  const neutral = resolveFrame(parameters, { frame: 0, fps: 60, values: neutralValues });
  if (input.scope !== 'isolated-axes' || !input.axes.length) {
    throw new Error('Expected isolated-axis calibration evidence');
  }
  const axes = new Set<string>();
  const ids = new Set<string>();
  return { scope: input.scope, axes: input.axes.map(mapping => {
    const index = parameters.findIndex(p => p.id === mapping.parameterId);
    if (!['yaw', 'pitch', 'roll'].includes(mapping.axis) || axes.has(mapping.axis) ||
        ids.has(mapping.parameterId) || index < 0) {
      throw new Error('Unknown or duplicate calibration axis/control');
    }
    axes.add(mapping.axis);
    ids.add(mapping.parameterId);
    const parameter = parameters[index];
    const anchors = mapping.anchors.map(anchor => ({ ...anchor })).sort((a, b) => a.degrees - b.degrees);
    if (anchors.length < 2 || !anchors.every(a =>
      Number.isFinite(a.degrees) && Number.isFinite(a.value) &&
      a.value >= parameter.minimum && a.value <= parameter.maximum &&
      typeof a.source === 'string' && a.source.trim() &&
      typeof a.intendedView === 'string' && a.intendedView.trim())) {
      throw new Error('Invalid calibration anchors or missing intended-view evidence');
    }
    const zero = anchors.find(a => a.degrees === 0);
    if (!zero || zero.value !== neutral.values[index]) {
      throw new Error('Calibration neutral does not match the declared trial neutral');
    }
    const direction = Math.sign(anchors[1].value - anchors[0].value);
    if (!direction || anchors.slice(1).some((a, i) =>
      a.degrees <= anchors[i].degrees || Math.sign(a.value - anchors[i].value) !== direction)) {
      throw new Error('Calibration must be strictly monotone');
    }
    return { ...mapping, anchors };
  }) };
}

/** Piecewise-linear interpolation is a declared approximation, never extrapolation. */
export function calibratedValues(parameters: readonly Parameter[],
  neutralValues: Record<string, number>, calibration: Calibration | undefined,
  angles: Partial<Record<HeadAxis, number>>): Record<string, number> {
  if (!calibration) throw new Error('Physical-angle calibration unavailable');
  const resolved = resolveCalibration(parameters, neutralValues, calibration);
  const known = new Set(resolved.axes.map(a => a.axis));
  for (const [axis, angle] of Object.entries(angles)) {
    if (!known.has(axis as HeadAxis) || !Number.isFinite(angle)) {
      throw new Error('Unknown or invalid calibrated angle');
    }
  }
  if (Object.values(angles).filter(angle => angle !== 0).length > 1) {
    throw new Error('Coupled angles require separate intended-view calibration evidence');
  }
  const values = { ...neutralValues };
  for (const { axis, parameterId, anchors } of resolved.axes) {
    const angle = angles[axis] ?? 0;
    if (angle < anchors[0].degrees || angle > anchors[anchors.length - 1].degrees) {
      throw new Error('Requested angle outside the calibrated range');
    }
    const exact = anchors.find(a => a.degrees === angle);
    if (exact) { values[parameterId] = exact.value; continue; }
    const high = anchors.findIndex(a => a.degrees > angle);
    const left = anchors[high - 1];
    const right = anchors[high];
    const fraction = (angle - left.degrees) / (right.degrees - left.degrees);
    values[parameterId] = left.value + fraction * (right.value - left.value);
  }
  return values;
}
