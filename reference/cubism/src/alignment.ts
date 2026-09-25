/** Explicit orthographic framing; coordinates are clip-space, before viewport mapping. */
export interface Alignment {
  scale: number;
  offsetX: number;
  offsetY: number;
  background: [number, number, number, number];
}

export function resolveAlignment(input?: Alignment): Alignment {
  const value = input ?? { scale: 1, offsetX: 0, offsetY: 0, background: [0, 0, 0, 0] };
  if (![value.scale, value.offsetX, value.offsetY].every(Number.isFinite) || value.scale <= 0 ||
      !Array.isArray(value.background) || value.background.length !== 4 ||
      !value.background.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
    throw new Error('Invalid reference alignment');
  }
  return { ...value, background: [...value.background] };
}

/** Column-major projection * exported model matrix; offsets are not scaled with art. */
export function alignedMatrix(model: ArrayLike<number>, width: number, height: number,
  input?: Alignment): Float32Array {
  const view = resolveAlignment(input);
  if (![width, height].every(v => Number.isSafeInteger(v) && v > 0) ||
      model.length !== 16 || !Array.from(model).every(Number.isFinite)) {
    throw new Error('Invalid reference viewport or model matrix');
  }
  const result = new Float32Array(model);
  const xScale = view.scale * height / width;
  for (let column = 0; column < 4; column++) {
    const i = column * 4;
    result[i] = xScale * model[i] + view.offsetX * model[i + 3];
    result[i + 1] = view.scale * model[i + 1] + view.offsetY * model[i + 3];
  }
  return result;
}

/** WebGL clear values must match a premultiplied-alpha drawing buffer. */
export function clearColor(alignment: Alignment): [number, number, number, number] {
  const [r, g, b, a] = resolveAlignment(alignment).background;
  return [r * a, g * a, b * a, a];
}
