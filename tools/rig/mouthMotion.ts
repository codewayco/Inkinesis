/**
 * Mouth timing and form for the imported bust; geometry-only, no new artwork.
 *
 * The engine closes the open-mouth artwork into a thin seam and fades the closed
 * lips out linearly over the whole range, so most in-between values show a
 * squashed tooth line under half-transparent closed lips: dashed or zig-zag
 * lips. Here the open artwork passes the thin-seam stage quickly (its authored
 * deformation is re-sampled at a faster-growing opening) and replaces the closed
 * lips at once instead of cross-fading over them. The engine's MouthForm moves only the
 * open artwork, which is invisible while the mouth is closed; the closed lips get
 * a bounded corner curve for the same control.
 */
import { inpParts, type InpBinding, type InpDocument, type InpParameter } from './inp';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** The open mouth first shows at this control value, already this far open. */
const appear = .04, firstOpening = .3;
/** Opening actually shown at control value v in [0,1]: the squashed seam stage is
 * skipped; the open artwork appears at a visible opening and grows from there. */
export const openingCurve = (v: number) => { v = clamp01(v); return v <= appear ? firstOpening * v / appear : firstOpening + (1 - firstOpening) * Math.pow((v - appear) / (1 - appear), .6); };
/** Opacity of the open and closed mouth at control value v in [0,1]. The two
 * mouths are never shown half transparent over each other: the open artwork,
 * drawn above the closed lips and covering them, becomes opaque within a few
 * thousandths of the first visible opening, and only then are the closed lips
 * (hidden under it) removed. The control's axis gets keys at these values, so
 * the linear interpolation between authored keys cannot widen the swap. */
const swap = .004;
export const openOpacity = (v: number) => clamp01((v - appear) / swap);
export const closedOpacity = (v: number) => 1 - clamp01((v - appear - swap) / swap);
const swapKeys = [appear, appear + swap, appear + 2 * swap];

type Offsets = number[][];
function resample(values: Offsets[], axis: number[], t: number) {
    let k = 0;
    while (k < axis.length - 2 && axis[k + 1] < t) k++;
    const span = axis[k + 1] - axis[k], w = span > 0 ? Math.max(0, Math.min(1, (t - axis[k]) / span)) : 0;
    return values[k].map((p, i) => p.map((c, j) => c * (1 - w) + values[k + 1][i][j] * w));
}
const lerp = (a: unknown, b: unknown, w: number): unknown => typeof a === 'number' ? a * (1 - w) + (b as number) * w : (a as unknown[]).map((x, i) => lerp(x, (b as unknown[])[i], w));
/** Add keys to a 1D parameter without changing any binding: each new key takes the
 * value the linear interpolation already produced there. */
function insertKeys(p: InpParameter, keys: number[]) {
    const axis = p.axis_points[0], added = keys.filter(k => k > 0 && k < 1 && !axis.some(a => Math.abs(a - k) < 1e-9));
    if (!added.length) return;
    const next = [...axis, ...added].sort((a, b) => a - b);
    for (const b of p.bindings) {
        b.values = next.map(t => {
            const i = axis.findIndex(a => Math.abs(a - t) < 1e-9);
            if (i >= 0) return b.values[i];
            let k = 0; while (k < axis.length - 2 && axis[k + 1] < t) k++;
            return [lerp(b.values[k][0], b.values[k + 1][0], (t - axis[k]) / (axis[k + 1] - axis[k]))];
        });
        b.isSet = next.map(() => [true]);
    }
    p.axis_points[0] = next;
}

export function retimeMouth(puppet: InpDocument) {
    const nodes = inpParts(puppet), open = nodes.find(n => n.name === 'mouth_open'), closed = nodes.find(n => n.name === 'mouth_close');
    const p = puppet.param.find(q => q.name === 'ParamMouthOpenY' && !q.is_vec2);
    if (!p || !open || !closed) return { status: 'skipped', reason: 'No imported open and closed mouth' };
    insertKeys(p, swapKeys);
    const axis = p.axis_points[0], value = (t: number) => (p.min[0] + t * (p.max[0] - p.min[0]) - p.min[0]) / (p.max[0] - p.min[0]);
    const deform = p.bindings.find(b => b.node === open.uuid && b.param_name === 'deform');
    if (deform) {
        const original = (deform.values as unknown as Offsets[][]).map(row => row[0]);
        deform.values = axis.map(t => [resample(original, axis, openingCurve(value(t)))]) as unknown as unknown[][];
    }
    const opacity = (node: number, f: (v: number) => number) => {
        const values = axis.map(t => [f(value(t))]);
        const existing = p.bindings.find(b => b.node === node && b.param_name === 'opacity');
        if (existing) existing.values = values;
        else p.bindings.push({ node, param_name: 'opacity', values, isSet: axis.map(() => [true]), interpolate_mode: 'Linear' } as InpBinding);
    };
    opacity(open.uuid, openOpacity); opacity(closed.uuid, closedOpacity);
    // Rest must stay the closed source mouth.
    open.opacity = 1; closed.opacity = 1;
    return { status: 'applied', opening: 'authored open-mouth deformation re-sampled from a 30% opening at v=0.04, then (v-0.04)^0.6', swap: { openOpaqueAt: appear + swap, closedRemovedAt: appear + 2 * swap }, addedKeys: swapKeys };
}

/** Smile/frown corner curve for the closed lips, bounded to a small fraction of the mouth width. */
export function closedMouthForm(puppet: InpDocument, amplitude = .07) {
    const closed = inpParts(puppet).find(n => n.name === 'mouth_close'), p = puppet.param.find(q => q.name === 'ParamMouthForm' && !q.is_vec2);
    if (!closed?.mesh || !p) return { status: 'skipped', reason: 'No closed mouth or MouthForm control' };
    if (p.bindings.some(b => b.node === closed.uuid && b.param_name === 'deform')) return { status: 'skipped', reason: 'Closed mouth already has a MouthForm deformation' };
    const xs = closed.mesh.verts.filter((_, i) => i % 2 === 0);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), cx = (x0 + x1) / 2, half = Math.max(1, (x1 - x0) / 2), lift = amplitude * (x1 - x0);
    const values = p.axis_points[0].map(t => {
        const form = p.min[0] + t * (p.max[0] - p.min[0]);
        return [xs.map(x => {
            const u = Math.max(-1, Math.min(1, (x - cx) / half));
            // Corners rise for a smile (form > 0) and drop for a frown; the centre stays.
            return [form * .04 * (x - cx), -form * lift * u * u];
        })];
    });
    p.bindings.push({ node: closed.uuid, param_name: 'deform', values, isSet: p.axis_points[0].map(() => [true]), interpolate_mode: 'Linear' } as InpBinding);
    return { status: 'applied', cornerLiftPixels: lift, widthChange: .04 };
}
