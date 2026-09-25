import { describe, it, expect } from 'vitest';
import { compactFaceKeys } from '../compactFace';
import type { InpDocument } from '../inp';
import { evaluateCombined, type CombinedAsset } from '../../../player/src/combinedRuntime';

function fixture(values:number[]): CombinedAsset {
    const node={name:'mouth',uuid:1,type:'Part' as const,enabled:true,zsort:0,opacity:1,mesh:{verts:[0,0],uvs:[0,0],indices:[],origin:[0,0]}};
    const puppet:InpDocument={meta:{},nodes:{uuid:0,name:'root',type:'Node',enabled:true,zsort:0,children:[node]},param:[{
        uuid:2,name:'ParamMouthOpenY',is_vec2:false,min:[0,0],max:[1,1],defaults:[0,0],merge_mode:'Passthrough',
        axis_points:[values.map((_,i)=>i/(values.length-1)),[0]],bindings:[{node:1,param_name:'deform',interpolate_mode:'Linear',
            isSet:values.map(()=>[true]),values:values.map(v=>[[[v,0]]])}]}]};
    return {puppet,parts:[node],textures:[],width:10,height:10};
}
describe('bounded face key reduction',()=>{
    it('removes redundant linear knots without changing interpolated motion',()=>{
        const asset=fixture([0,1,2,3,4]),original=structuredClone(asset);
        const report=compactFaceKeys(asset.puppet);
        expect(report.axes[0].after).toBe(2);
        for(let i=0;i<=100;i++)expect(evaluateCombined(asset,{ParamMouthOpenY:[i/100]})[0].xy[0]).toBeCloseTo(evaluateCombined(original,{ParamMouthOpenY:[i/100]})[0].xy[0],10);
    });
    it('preserves a narrow expression peak and bounds all intermediate errors',()=>{
        const asset=fixture([0,.005,2,.005,0]),original=structuredClone(asset);
        compactFaceKeys(asset.puppet,.025);
        for(let i=0;i<=1000;i++){
            const x=evaluateCombined(asset,{ParamMouthOpenY:[i/1000]})[0].xy[0];
            const y=evaluateCombined(original,{ParamMouthOpenY:[i/1000]})[0].xy[0];
            expect(Math.abs(x-y)).toBeLessThanOrEqual(.025+1e-9);
        }
    });
    it('never changes limb controls',()=>{
        const asset=fixture([0,1,2,3,4]);asset.puppet.param[0].name='Arm L';
        expect(compactFaceKeys(asset.puppet).axes).toEqual([]);
        expect(asset.puppet.param[0].axis_points[0]).toHaveLength(5);
    });
});
