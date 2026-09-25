import { describe, expect, it } from 'vitest';
import { constrainClosedEyes } from '../combinedExpressions';
import type { InpDocument, InpNode } from '../inp';

const puppet = (children: InpNode[]): InpDocument => ({
    meta: { canvas: { width: 100, height: 100 } }, param: [],
    nodes: { uuid: 0, name: 'root', type: 'Node', enabled: true, zsort: 0, children },
});

describe('absent eye artwork', () => {
    it('reports unsupported blink without changing a baked source face', () => {
        const source = puppet([]), before = structuredClone(source), textures: Buffer[] = [];
        const result = constrainClosedEyes(source, textures);
        expect(result).toHaveLength(2);
        expect(result.every(r => r.kind.includes('blink unsupported'))).toBe(true);
        expect(source).toEqual(before);
        expect(textures).toEqual([]);
    });
    it('still rejects missing closed-eye geometry when open eyes are separately authored', () => {
        const source = puppet([{ uuid: 1, name: 'eyewhite-l', type: 'Part', enabled: true, zsort: 0 }]);
        expect(() => constrainClosedEyes(source, [])).toThrow('Missing measured closed-eye geometry');
    });
});
