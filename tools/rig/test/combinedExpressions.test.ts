import { describe, expect, it } from 'vitest';
import { constrainClosedEyes } from '../combinedExpressions';
import type { InpDocument, InpNode } from '../inp';
import { encodePNG } from '../../shared/encodePNG';

const puppet = (children: InpNode[]): InpDocument => ({
    meta: { canvas: { width: 100, height: 100 } }, param: [],
    nodes: { uuid: 0, name: 'root', type: 'Node', enabled: true, zsort: 0, children },
});

describe('absent eye artwork', () => {
    it('hides open eye artwork when the measured closed lid is opaque, retaining the open endpoint', () => {
        const part=(uuid:number,name:string):InpNode=>({uuid,name,type:'Part',enabled:true,zsort:uuid,opacity:1,textures:[0],mesh:{verts:[0,0,8,0,0,8],uvs:[0,0,1,0,0,1],indices:[0,1,2],origin:[0,0]}});
        const parts=[part(1,'eyewhite-l'),part(2,'irides-l'),part(3,'eyelash-l'),part(4,'eye_close-l')];
        const puppet:InpDocument={meta:{canvas:{width:8,height:8}},nodes:{uuid:0,name:'root',type:'Node',enabled:true,zsort:0,children:parts},param:[{
            uuid:10,name:'ParamEyeLOpen',is_vec2:false,min:[0,0],max:[1,0],defaults:[1,0],axis_points:[[0,.5,1],[0]],merge_mode:'Passthrough',bindings:[{
                node:4,param_name:'opacity',interpolate_mode:'Linear',isSet:[[true],[true],[true]],values:[[1],[.4],[0]]
            }]
        }]};
        const textures=[Buffer.from(encodePNG(new Uint8ClampedArray(8*8*4).fill(255),8,8))];
        constrainClosedEyes(puppet,textures,true);
        for(const node of [1,2,3]){
            const binding=puppet.param[0].bindings.find(b=>b.node===node&&b.param_name==='opacity');
            expect(binding?.values).toEqual([[0],[.6],[1]]);
        }
        expect(puppet.param[0].bindings[0].values).toEqual([[1],[.4],[0]]);
    });
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

describe('neutral mouth restore', () => {
    it('restores the drawing color inside the prepared lip shape, never a rectangle of it', async () => {
        const { restoreNeutralMouth } = await import('../combinedExpressions');
        const { encodePNG } = await import('../../shared/encodePNG');
        const { decodePNG } = await import('../../generate/png');
        // A 4x4 atlas: only the centre two pixels belong to the lips.
        const atlas = new Uint8ClampedArray(4 * 4 * 4);
        for (const i of [5, 6]) atlas.set([10, 10, 10, 255], i * 4);
        const node: InpNode = { uuid: 1, name: 'mouth_close', type: 'Part', enabled: true, zsort: 0, textures: [0],
            mesh: { verts: [-50, -50, -46, -50, -50, -46, -46, -46], uvs: [0, 0, 1, 0, 0, 1, 1, 1], indices: [0, 1, 2, 1, 3, 2], origin: [0, 0] } };
        const textures = [encodePNG(atlas, 4, 4)];
        const drawing = { width: 100, height: 100, rgba: new Uint8ClampedArray(100 * 100 * 4).fill(255) };
        restoreNeutralMouth(puppet([node]), textures, drawing);
        const result = decodePNG(new Uint8Array(textures[node.textures![0]]));
        expect(result.rgba[5 * 4 + 3]).toBe(255); expect(result.rgba[5 * 4]).toBe(255);
        expect(result.rgba[0 * 4 + 3]).toBe(0); expect(result.rgba[15 * 4 + 3]).toBe(0);
    });
});
