import { inpParts, combinedChains, type InpDocument } from './inp';
import type { ChainName } from '../imageToRig/capabilities';
import { fitLegGridBudget } from './fitLegGridBudget';
import { signedLegCandidate } from './extendSignedLegRange';
import { attachmentMotionGate } from './attachmentMotionGate';
import { expandArmAxes } from './expandArmAxes';
import { continuousLimbWeights } from '../../engine/src/body/continuousLimb';
/** Accepted source/geometric-gated refinement; independent of character identity. */
export function refineMotion(puppet: InpDocument, textures: Buffer[]) {
    const a = { puppet, textures }, decisions: Record<string, unknown>[] = [];
    // Restore signed knee ranges only when sampled attachment geometry passes.
    for (const p of a.puppet.param.filter(p => p.name.startsWith('Leg '))) {
        decisions.push({ stage: 'leggrid13', name: p.name, ...fitLegGridBudget(p, 13) });
        for (const fraction of [1, .5, .25, .125, .0625]) {
            try {
                const c = signedLegCandidate(a.puppet, p, fraction), doc = { ...a.puppet, nodes: structuredClone(a.puppet.nodes), param: a.puppet.param.map(q => q === p ? c.parameter : q) };
                for (const n of inpParts(doc))
                    n.name = n.name.replace(/__influence_[01]+$/, '');
                const g = attachmentMotionGate(doc, a.textures, p.name as ChainName);
                if (g.status !== 'passed')
                    throw Error(JSON.stringify(g));
                Object.assign(p, c.parameter);
                const r = combinedChains(a.puppet).find(r => r.name === p.name)!;
                r.range = [p.min, p.max];
                r.signedRange = { fraction, sourceResidual: c.maxSourceResidualPx, compression: c.compression };
                decisions.push({ stage: 'signed', name: p.name, fraction, accepted: true });
                break;
            }
            catch (e) {
                decisions.push({ stage: 'signed', name: p.name, fraction, accepted: false, error: String(e) });
                if (String(e).includes('Ownership outside') || String(e).includes('not exact analytic'))
                    break;
            }
        }
    }
    // Expand restricted arm axes under the accepted surface/contact gates.
    for (const p of a.puppet.param.filter(p => p.name.startsWith('Arm ') && (p.max[0] < 30 || p.max[1] < 60))) {
        try {
            const r = expandArmAxes(a.puppet, a.textures, p), { parameter, ...detail } = r;
            decisions.push({ stage: 'axis', name: p.name, ...detail });
            if (r.changed && parameter) {
                Object.assign(p, parameter);
                const rec = combinedChains(a.puppet).find(r => r.name === p.name)!;
                rec.range = [p.min, p.max];
                rec.axisRangeRecovery = detail;
            }
        }
        catch (e) {
            decisions.push({ stage: 'axis', name: p.name, error: String(e) });
        }
    }
    // Detect folded artwork geometrically; no character IDs or asset paths.
    for (const p of a.puppet.param.filter(p => p.name.startsWith('Arm '))) {
        const rec = combinedChains(a.puppet).find(r => r.name === p.name)!, c = rec.chain, u = [c.joint.x - c.root.x, c.joint.y - c.root.y], v = [c.tip.x - c.joint.x, c.tip.y - c.joint.y];
        if (c.rootMode !== 'rigid' || u[0] * v[0] + u[1] * v[1] >= 0 || continuousLimbWeights(c.tip, c).distal > .01)
            continue;
        let best: (ReturnType<typeof expandArmAxes> & { fraction: number; span: number }) | undefined;
        for (const fraction of [.45, .6, .9, 1.3]) {
            try {
                const r = expandArmAxes(a.puppet, a.textures, p, { recoverFoldedHinge: fraction });
                if (!r.parameter)
                    continue;
                const span = r.parameter.max[1] - r.parameter.min[1];
                if (!best || span > best.span)
                    best = { ...r, fraction, span };
            }
            catch (e) {
                decisions.push({ stage: 'folded-hinge', name: p.name, fraction, error: String(e) });
            }
        }
        if (best) {
            Object.assign(p, best.parameter);
            rec.chain = best.chain!;
            rec.range = [p.min, p.max];
            rec.recoveredFoldedHinge = { fraction: best.fraction, span: best.span };
            decisions.push({ stage: 'folded-hinge', name: p.name, selected: best.fraction, span: best.span });
        }
    }
    for (const p of a.puppet.param.filter(p => p.name.startsWith('Arm ') && (p.max[0] < 30 || p.max[1] < 60))) {
        const rec = combinedChains(a.puppet).find(r => r.name === p.name)!, c = rec.chain, u = [c.joint.x - c.root.x, c.joint.y - c.root.y], v = [c.tip.x - c.joint.x, c.tip.y - c.joint.y];
        if (u[0] * v[0] + u[1] * v[1] >= 0)
            continue;
        try {
            const r = expandArmAxes(a.puppet, a.textures, p, { linearHinge: true }), { parameter, chain, ...detail } = r;
            decisions.push({ stage: 'linear-hinge', name: p.name, ...detail });
            if (r.changed && parameter) {
                Object.assign(p, parameter);
                rec.chain = chain;
                rec.range = [p.min, p.max];
                rec.rigidFoldRange = detail;
            }
        }
        catch (e) {
            decisions.push({ stage: 'linear-hinge', name: p.name, error: String(e) });
        }
    }
    return decisions;
}
