import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { rigFixture } from '../../tools/test/rigFixture';
import { readCombined, evaluateCombined } from '../src/combinedRuntime';
interface NativeFrame {
    label: string;
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
describe.skipIf(!process.env.RIG_TEST_ASSET_DIR)('optional native parity against private reference assets', () => {
    for (const subject of ['purple-couture', 'saffron-orbit'])
        it(`${subject}: all signed endpoints, head lattice and simultaneous clips`, () => {
            const root = `${process.env.RIG_TEST_ASSET_DIR}/${subject}`, asset = readCombined(readFileSync(root + '/character.inp'));
            const frames = JSON.parse(readFileSync(root + '/poses.json', 'utf8')).frames as NativeFrame[];
            let maxPositionError = 0, maxOpacityError = 0;
            for (const f of frames) {
                const values = { ...(f.suppliedControls ?? {}) };
                if (f.parameter)
                    values[f.parameter] = [f.value, f.valueY ?? 0];
                // The native verifier's two built-in expression combinations predate suppliedControls.
                if (f.additionalControls?.[0])
                    values[f.additionalControls[0]] = [0, 0];
                if (f.additionalControls?.[1])
                    values[f.additionalControls[1]] = [f.additionalControls[1] === 'Viseme' ? 4 : 1, 0];
                const parts = new Map(evaluateCombined(asset, values).map(p => [p.uuid, p]));
                for (const p of f.parts) {
                    const actual = parts.get(p.uuid)!;
                    expect(actual.xy.length).toBe(p.xy.length);
                    for (let i = 0; i < p.xy.length; i++)
                        maxPositionError = Math.max(maxPositionError, Math.abs(actual.xy[i] - p.xy[i]));
                    maxOpacityError = Math.max(maxOpacityError, Math.abs(actual.opacity - p.opacity));
                }
            }
            expect(frames.length).toBeGreaterThan(150);
            expect(maxPositionError).toBeLessThan(.001);
            expect(maxOpacityError).toBeLessThan(.00001);
        });
 });
describe('portable INP runtime',()=>{
    it('rejects truncated or unrelated files',()=>{
        expect(()=>readCombined(new Uint8Array(12))).toThrow();
        const bytes=rigFixture();expect(()=>readCombined(bytes.subarray(0,bytes.length-10))).toThrow('Truncated');
    });
    it('interpolates and adds independent fields at intermediate values',()=>{
        const asset=readCombined(rigFixture());
        const rest=evaluateCombined(asset)[0];
        const posed=evaluateCombined(asset,{'Head Angles':[15,-15],'Arm L':[-15,15],ParamAngleZ:[15]})[0];
        for(let i=0;i<rest.xy.length;i++)expect(posed.xy[i]-rest.xy[i]).toBeCloseTo(i%2?0:1,8);
    });
});
