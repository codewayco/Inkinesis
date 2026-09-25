/** Raw exported controls only. No value here denotes a physical head angle. */
export interface Parameter {
  id: string;
  minimum: number;
  maximum: number;
  defaultValue: number;
}

export interface FrameRequest {
  frame: number;
  fps: number;
  values: Record<string, number>;
}

/** Complete snapshots prevent omitted controls inheriting a previous pose. */
export function resolveFrame(parameters: readonly Parameter[], request: FrameRequest) {
  if (!Number.isSafeInteger(request.frame) || request.frame < 0 ||
      !Number.isFinite(request.fps) || request.fps <= 0) {
    throw new Error('Expected a nonnegative integer frame and positive finite fps');
  }
  const known = new Set(parameters.map(p => p.id));
  if (known.size !== parameters.length) throw new Error('Duplicate parameter ID');
  for (const id of Object.keys(request.values)) {
    if (!known.has(id)) throw new Error(`Unknown parameter: ${id}`);
  }
  const values = parameters.map(p => {
    const value = Object.hasOwn(request.values, p.id) ? request.values[p.id] : p.defaultValue;
    if (![p.minimum, p.maximum, p.defaultValue, value].every(Number.isFinite) ||
        p.minimum > p.maximum || p.defaultValue < p.minimum ||
        p.defaultValue > p.maximum || value < p.minimum || value > p.maximum) {
      throw new Error(`Invalid parameter range or value: ${p.id}`);
    }
    return value;
  });
  return { timeSeconds: request.frame / request.fps, values };
}
