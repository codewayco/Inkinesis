import { describe, expect, it } from 'vitest';
import { clothOffset, auditGarment, fitStrainAmplitude } from '../buildGarment';
import { assessGarment, adoptGarmentLandmarkCheck, type GarmentAssessment, type GarmentRegion } from '../../imageToRig/garmentAnalysis';
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
    it('verifies a 0.5-0.8 face on the decomposition instead of refusing it before the decomposition',()=>{
        // A small full-body face: the model answers mouth and chin with 0.7-0.78 and the whole image with 0.72.
        const a=assessment();a.confidence=.72;a.points.mouth!.confidence=.78;a.points.chin!.confidence=.7;
        expect(assessGarment(a).canBuild).toBe(false);
        const provisional=assessGarment(a,{provisional:true});
        expect(provisional.canBuild).toBe(true);expect(provisional.reasons.join(' ')).toContain('verified on the decomposition');
        // The landmark check verified the mouth and the chin on the mouth and face layers.
        const checked={...a,points:{...a.points,mouth:{...a.points.mouth!,verified:true},chin:{...a.points.chin!,verified:true}}};
        expect(assessGarment(checked,{checked:true}).canBuild).toBe(true);
        // Unverified points stay refused, and confidence below 0.5 is never enough.
        expect(assessGarment(a,{checked:true}).canBuild).toBe(false);
        expect(assessGarment({...checked,points:{...checked.points,chin:{...checked.points.chin!,confidence:.4}}},{checked:true}).canBuild).toBe(false);
        a.points.chin!.confidence=.4;expect(assessGarment(a,{provisional:true}).canBuild).toBe(false);
    });
    it('adopts the landmark check: verified points become build landmarks, the model answer is kept',()=>{
        const a=assessment();a.points.chin!.confidence=.7;a.points.shoulderL={x:.6,y:.4,confidence:.7};a.points.shoulderR={x:.4,y:.4,confidence:.7};
        const record={assessment:a,source:{width:1000,height:2000},points:{}};
        const points={...a.points,chin:{x:.5,y:.32,confidence:.7,verified:true},shoulderL:{...a.points.shoulderL,verified:true},shoulderR:{...a.points.shoulderR,verified:true}};
        const adopted=adoptGarmentLandmarkCheck(record,{schema:1,points,records:[],changed:0});
        expect(adopted.canBuild).toBe(true);expect(adopted.capabilities.body).toBe(true);
        expect(adopted.points.chin).toEqual({x:500,y:640});expect(adopted.assessment.modelPoints!.chin!.y).toBe(.3);
        expect(adopted.landmarkCheck).toBeDefined();
    });
    it('reduces the sway amplitude to fit the strain budget, but never below half and never past a foldover',()=>{
        let strain=1.3,scaled=0;
        const audit=()=>{if(strain>1.2)throw new Error('Garment deformation exceeds the area strain budget');return {maxAreaRatio:strain};};
        const fit=fitStrainAmplitude(audit,f=>{scaled++;strain=1+(strain-1)*f;});
        expect(fit.result.maxAreaRatio).toBeLessThanOrEqual(1.2);expect(scaled).toBe(3);expect(fit.amplitude).toBeCloseTo(.85**3,12);
        strain=3;expect(()=>fitStrainAmplitude(audit,f=>{strain=1+(strain-1)*f;})).toThrow('strain budget');
        expect(()=>fitStrainAmplitude(()=>{throw new Error('Garment foldover: skirt');},()=>{})).toThrow('foldover');
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
