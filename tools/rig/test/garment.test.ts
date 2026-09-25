import { describe, expect, it } from 'vitest';
import { clothOffset, auditGarment } from '../buildGarment';
import { assessGarment, type GarmentAssessment, type GarmentRegion } from '../../imageToRig/garmentAnalysis';
import type { CombinedAsset } from '../../../player/src/combinedRuntime';

const skirt:GarmentRegion={kind:'skirt',box:[100,200,900,1450],anchorY:500,confidence:.9,reason:'Visible waist, hidden legs'};
function assessment():GarmentAssessment {
    return {frontFacing:true,singleCharacter:true,longGarment:true,separateLimbs:false,facialHair:false,confidence:.9,reasons:[],
        points:Object.fromEntries(['eyeL','eyeR','mouth','chin'].map(k=>[k,{x:.5,y:.3,confidence:.9}])),
        garments:[{...skirt,box:[.1,.2,.9,.95],anchorY:.4}]};
}
describe('limited garment motion contract',()=>{
    it('accepts a visible face without inventing hidden knees, shoulders or the head top',()=>{
        const result=assessGarment(assessment());
        expect(result.canBuild).toBe(true);
        expect(result.capabilities).toEqual({face:true,body:false,garment:true,walk:false,arms:false,legs:false});
    });
    it('refuses uncertain faces and disables ambiguous garment regions',()=>{
        const a=assessment(); a.points.mouth!.confidence=.6;
        expect(assessGarment(a).canBuild).toBe(false);
        a.points.mouth!.confidence=.9; a.garments[0].confidence=.6;
        expect(assessGarment(a).capabilities.garment).toBe(false);
    });
    it('pins the waist and box boundaries and bounds all cloth offsets',()=>{
        for(let y=200;y<=500;y+=5)expect(clothOffset({x:500,y},skirt,1024,1536,{})).toEqual({x:0,y:0});
        for(let y=500;y<=1450;y+=5)for(const x of [100,900])expect(clothOffset({x,y},skirt,1024,1536,{}).x).toBe(0);
        let maximum=0;
        for(let y=200;y<=1450;y+=5)for(let x=100;x<=900;x+=10){const d=clothOffset({x,y},skirt,1024,1536,{});expect(d.y).toBe(0);maximum=Math.max(maximum,d.x);}
        expect(maximum).toBeGreaterThan(1);expect(maximum).toBeLessThanOrEqual(1024*.006);
    });
    it('does not move a sleeve without its visible attachment chain or at the wrist',()=>{
        const sleeve={...skirt,kind:'sleeve' as const};
        expect(clothOffset({x:650,y:1000},sleeve,1024,1536,{}).x).toBe(0);
        const marks={shoulderR:{x:500,y:400},elbowR:{x:500,y:700},wristR:{x:500,y:1000}};
        expect(clothOffset(marks.wristR,sleeve,1024,1536,marks).x).toBe(0);
        expect(clothOffset({x:650,y:1000},sleeve,1024,1536,marks).x).toBeGreaterThan(0);
    });
    it('rejects a combined deformation that reverses a retained body triangle',()=>{
        const n={uuid:1,name:'topwear',type:'Part' as const,enabled:true,zsort:0,mesh:{verts:[0,0,100,0,0,100],uvs:[0,0,1,0,0,1],indices:[0,1,2],origin:[0,0]}};
        const asset:CombinedAsset={width:100,height:100,parts:[n],textures:[],puppet:{meta:{},nodes:n,param:[{uuid:2,name:'ParamGarmentSway',min:[-1,0],max:[1,0],defaults:[0,0],is_vec2:false,merge_mode:'Passthrough',axis_points:[[0,.5,1],[0]],bindings:[{node:1,param_name:'deform',interpolate_mode:'Linear',isSet:[[true],[true],[true]],values:[-1,0,1].map(k=>[[[0,0],[-200*k,0],[0,0]]])}]}]}};
        expect(()=>auditGarment(asset,new Set([1]))).toThrow(/foldover/);
    });
});
