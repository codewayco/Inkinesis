import type { InpParameter } from '../../tools/rig/inp';

/** Cubism's near-key sampling contract, also declared as EPS_KEY by psd2live.
 * Keep this in the reference harness: Inochi remains continuously interpolated.
 * Raw cross-format differences must be reported separately, never discarded.
 */
export function coreKeyValues(parameters: InpParameter[], values: Record<string, number[]>) {
    return Object.fromEntries(parameters.map(p => [p.name,
        (values[p.name] ?? p.defaults).map((value, axis) => {
            if (axis > 0 && !p.is_vec2) return value;
            const keys = p.axis_points[axis].map(t => p.min[axis] + t * (p.max[axis] - p.min[axis]));
            const nearby = keys.filter(k => Math.abs(k - value) < .001)
                .sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
            return nearby[0] ?? value;
        })]));
}
