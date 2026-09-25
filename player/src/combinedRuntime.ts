/** Browser reader/evaluator for the restricted INP subset emitted by buildCombined. */
import type { InpDocument, InpNode, InpParameter } from '../../tools/rig/inp';
export type { InpDocument };
export interface CombinedAsset {
    puppet: InpDocument;
    textures: Uint8Array[];
    parts: InpNode[];
    width: number;
    height: number;
}
export function readCombined(bytes: Uint8Array): CombinedAsset {
    let at = 0;
    const decoder = new TextDecoder();
    const take = (n: number) => { if (n < 0 || at + n > bytes.length)
        throw new Error('Truncated INP'); const result = bytes.slice(at, at + n); at += n; return result; };
    const word = () => { const b = take(4); return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0); };
    if (decoder.decode(take(8)) !== 'TRNSRTS\0')
        throw new Error('Expected an INP file');
    const puppet = JSON.parse(decoder.decode(take(word()))) as InpDocument;
    if (!puppet.meta.combined)
        throw new Error('Load a combined-method INP in this version.');
    if (decoder.decode(take(8)) !== 'TEX_SECT')
        throw new Error('Missing textures');
    const count = word(), textures: Uint8Array[] = [];
    if (count > 512)
        throw new Error('Too many textures');
    for (let i = 0; i < count; i++) {
        const size = word();
        if (take(1)[0] !== 0)
            throw new Error('PNG textures required');
        textures.push(take(size));
    }
    if (at !== bytes.length)
        throw new Error('Unexpected INP extension');
    const parts: InpNode[] = [];
    const walk = (n: InpNode) => { if (n.type === 'Part')
        parts.push(n); n.children?.forEach(walk); };
    walk(puppet.nodes);
    const canvas = puppet.meta.canvas as {
        width: number;
        height: number;
    };
    if (!canvas || ![canvas.width, canvas.height].every(n => Number.isFinite(n) && n > 0 && n <= 8192))
        throw new Error('Invalid canvas');
    for (const n of parts) {
        if (!n.mesh || !n.textures || !textures[n.textures[0]] || n.mesh.verts.length !== n.mesh.uvs.length || !n.mesh.verts.every(Number.isFinite) || !n.mesh.indices.every(i => Number.isInteger(i) && i >= 0 && i < n.mesh!.verts.length / 2))
            throw new Error('Invalid mesh');
        if ((n.masks?.length ?? 0) > 1 || n.masks?.some(m => m.mode !== 'Mask'))
            throw new Error('Unsupported mask');
    }
    for (const p of puppet.param) {
        if (p.merge_mode !== 'Passthrough')
            throw new Error('Unsupported parameter merge');
        for (const b of p.bindings)
            if (b.interpolate_mode !== 'Linear' || !['deform', 'opacity'].includes(b.param_name) || !b.isSet.every(r => r.every(Boolean)))
                throw new Error('Unsupported INP binding');
    }
    return { puppet, textures, parts, width: canvas.width, height: canvas.height };
}
function bracket(axis: number[], value: number) { if (axis.length === 1)
    return [0, 0, 0]; const n = Math.max(axis[0], Math.min(axis.at(-1)!, value)); let hi = 1; while (hi < axis.length - 1 && axis[hi] < n)
    hi++; return [hi - 1, hi, (n - axis[hi - 1]) / (axis[hi] - axis[hi - 1])]; }
export interface EvaluatedPart {
    uuid: number;
    xy: number[];
    opacity: number;
    enabled: boolean;
}
export function evaluateCombined(asset: CombinedAsset, values: Record<string, number[]> = {}): EvaluatedPart[] {
    const posed = asset.parts.map(n => ({ uuid: n.uuid, xy: [...n.mesh!.verts], opacity: n.opacity ?? 1, enabled: n.enabled }));
    const byId = new Map(posed.map(n => [n.uuid, n]));
    const opacityOwners = new Set<number>();
    for (const p of asset.puppet.param) {
        const value = values[p.name] ?? p.defaults;
        const normalized = (i: number) => (p.max[i] === p.min[i] ? 0 : ((value[i] ?? p.defaults[i]) - p.min[i]) / (p.max[i] - p.min[i]));
        const [x0, x1, fx] = bracket(p.axis_points[0], normalized(0)), [y0, y1, fy] = bracket(p.axis_points[1], normalized(1));
        const keys = [[x0, y0, (1 - fx) * (1 - fy)], [x1, y0, fx * (1 - fy)], [x0, y1, (1 - fx) * fy], [x1, y1, fx * fy]];
        for (const b of p.bindings) {
            const part = byId.get(b.node);
            if (!part)
                throw new Error('Binding refers to an absent node');
            if (b.param_name === 'opacity') {
                const v = keys.reduce((sum, [x, y, w]) => sum + Number(b.values[x][y]) * w, 0);
                if (!opacityOwners.has(b.node)) {
                    part.opacity = v;
                    opacityOwners.add(b.node);
                }
                else
                    part.opacity *= v;
            }
            else
                for (let i = 0; i < part.xy.length; i++)
                    part.xy[i] += keys.reduce((sum, [x, y, w]) => sum + (b.values[x][y] as number[][])[Math.floor(i / 2)][i % 2] * w, 0);
        }
    }
    return posed;
}
export function parameterByName(asset: CombinedAsset, name: string): InpParameter | undefined { return asset.puppet.param.find(p => p.name === name); }
