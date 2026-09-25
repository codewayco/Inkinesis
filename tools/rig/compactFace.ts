/** Error-bounded scalar mouth key reduction; every original knot is checked. */
import type { InpDocument } from './inp';

export function compactFaceKeys(puppet: InpDocument, pixelBudget = .025) {
    const report: { parameter: string; before: number; after: number; maxPositionError: number; maxOpacityError: number }[] = [];
    for (const p of puppet.param) {
        if (p.is_vec2 || !/^ParamMouth(Form|OpenY)$/.test(p.name)) continue;
        const axis = [...p.axis_points[0]], kept = axis.map((_, i) => i);
        const flatten = (value: unknown): number[] => typeof value === 'number' ? [value] : (value as number[][]).flat();
        const values = p.bindings.map(b => b.values.map(row => flatten(row[0])));
        const error = (a: number, b: number) => {
            let position = 0, opacity = 0;
            for (let k = a + 1; k < b; k++) {
                const t = (axis[k] - axis[a]) / (axis[b] - axis[a]);
                values.forEach((rows, j) => rows[k].forEach((v, i) => {
                    const e = Math.abs(v - (rows[a][i] * (1-t) + rows[b][i] * t));
                    if (p.bindings[j].param_name === 'opacity') opacity = Math.max(opacity, e);
                    else position = Math.max(position, e);
                }));
            }
            return { position, opacity };
        };
        let changed = true;
        const defaultKey = (p.defaults[0]-p.min[0])/(p.max[0]-p.min[0]);
        while (changed) {
            changed = false;
            for (let i=1;i<kept.length-1;i++) {
                if (Math.abs(axis[kept[i]]-defaultKey)<1e-8) continue;
                const e = error(kept[i-1],kept[i+1]);
                if (e.position <= pixelBudget && e.opacity <= 1e-7) {
                    kept.splice(i,1);changed=true;break;
                }
            }
        }
        const errors=kept.slice(1).map((b,i)=>error(kept[i],b));
        report.push({parameter:p.name,before:axis.length,after:kept.length,
            maxPositionError:Math.max(0,...errors.map(e=>e.position)),maxOpacityError:Math.max(0,...errors.map(e=>e.opacity))});
        p.axis_points[0]=kept.map(i=>axis[i]);
        for (const b of p.bindings) {
            b.values=kept.map(i=>b.values[i]);b.isSet=kept.map(i=>b.isSet[i]);
        }
    }
    return {pixelBudget,opacityBudget:1e-7,axes:report,scope:'Scalar mouth axes, per-coordinate pixel error; maximum checked at every original knot. Linear interpolation error is bounded between knots; separate additive axes can accumulate their bounds.'};
}
