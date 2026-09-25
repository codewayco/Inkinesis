/** Audit the new browser evaluator against native poses, including body orientation. */
import { readFileSync, writeFileSync } from 'node:fs';
import { readCombined, evaluateCombined } from '../../player/src/combinedRuntime';
const [inp, poses, out] = process.argv.slice(2);
const asset = readCombined(readFileSync(inp));
const hairNames=new Set(((asset.puppet.meta.headAttachments as {layer:string}[] | undefined)??[]).map(r=>r.layer));
const garmentBody = new Set((asset.puppet.meta.garment as {bodyParts?: number[]} | undefined)?.bodyParts ?? []);
interface Frame {
    parameter: string;
    value: number;
    valueY: number;
    suppliedControls: Record<string, number[]> | null;
    additionalControls: string[];
    parts: {
        uuid: number;
        xy: number[];
        opacity: number;
    }[];
}
const frames = JSON.parse(readFileSync(poses, 'utf8')).frames as Frame[];
let maxPositionError = 0, maxOpacityError = 0, triangleChecks = 0, foldovers = 0;
for (const frame of frames) {
    const values = { ...(frame.suppliedControls ?? {}) };
    if (frame.parameter)
        values[frame.parameter] = [frame.value, frame.valueY ?? 0];
    if (frame.additionalControls?.[0])
        values[frame.additionalControls[0]] = [0, 0];
    if (frame.additionalControls?.[1])
        values[frame.additionalControls[1]] = [1, 0];
    const evaluated = new Map(evaluateCombined(asset, values).map(p => [p.uuid, p]));
    for (const part of frame.parts) {
        const actual = evaluated.get(part.uuid);
        if (!actual || actual.xy.length !== part.xy.length)
            throw new Error('Native part inventory differs');
        for (let i = 0; i < part.xy.length; i++)
            maxPositionError = Math.max(maxPositionError, Math.abs(actual.xy[i] - part.xy[i]));
        maxOpacityError = Math.max(maxOpacityError, Math.abs(actual.opacity - part.opacity));
        const node = asset.parts.find(n => n.uuid === part.uuid)!;
        if (!garmentBody.has(node.uuid) && !hairNames.has(node.name) && !/^(arm|hand|handwear|legwear|footwear)-|^(topwear|bottomwear)__/.test(node.name))
            continue;
        const mesh = node.mesh!, area = (xy: number[], a: number, b: number, c: number) => (xy[2 * b] - xy[2 * a]) * (xy[2 * c + 1] - xy[2 * a + 1]) - (xy[2 * b + 1] - xy[2 * a + 1]) * (xy[2 * c] - xy[2 * a]);
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const [a, b, c] = mesh.indices.slice(i, i + 3), rest = area(mesh.verts, a, b, c);
            if (Math.abs(rest) <= .1)
                continue;
            triangleChecks++;
            const posed = area(part.xy, a, b, c);
            if (!Number.isFinite(posed) || posed * rest <= 0)
                foldovers++;
        }
    }
}
const passed = Number.isFinite(maxPositionError) && maxPositionError < .001 && maxOpacityError < .00001 && foldovers === 0 && frames.length > 0;
writeFileSync(out, JSON.stringify({ status: passed ? 'passed' : 'failed', frames: frames.length, maxPositionError, maxOpacityError, triangleChecks, foldovers, scope: 'Native geometry and opacity parity, and sampled body and attached-hair triangle orientation. Not GPU pixel parity, visual acceptance or continuous proof.' }, null, 2) + '\n');
if (!passed)
    throw new Error('Native/browser geometry validation failed; see validation.json');
