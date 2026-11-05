import {describe,expect,it} from 'vitest';
import type {InpDocument,InpParameter} from '../rig/inp';
import {recipeFor,showcaseValues,showcaseOrder,showcaseCast,showcaseArmScale} from './showcaseMotion';

function puppet():InpDocument {
    const parameter=(name:string,min:number[],max:number[],defaults=[0,0]):InpParameter=>({uuid:1,name,min,max,defaults,is_vec2:true,axis_points:[[0,1],[0,1]],merge_mode:'Passthrough',bindings:[{node:1,param_name:'deform',values:[],isSet:[],interpolate_mode:'Linear'}]});
    return {meta:{},nodes:{uuid:1,name:'root',type:'Node',enabled:true,zsort:0},param:[
        parameter('Arm L',[-30,-60],[30,60]),parameter('Arm R',[-30,-60],[30,60]),
        parameter('Leg L',[-25,0],[25,60]),parameter('Leg R',[-25,0],[25,60]),
        parameter('Head Angles',[-45,-30],[45,30]),parameter('ParamAngleZ',[-30,0],[30,0]),
        parameter('ParamEyeLOpen',[0,0],[1,0],[1,0]),parameter('ParamEyeROpen',[0,0],[1,0],[1,0]),
        parameter('ParamMouthOpenY',[0,0],[1,0]),
    ]};
}
describe('README GIF motion',()=>{
    it('reaches the GIF angles at its arm, right leg and left leg peaks',()=>{
        const p=puppet(),recipe=recipeFor(p);
        const arms=showcaseValues(p,recipe,.6);
        expect(arms['Arm L']).toEqual([-16,-30]);expect(arms['Arm R']).toEqual([16,30]);
        expect(arms['Leg L']).toEqual([0,0]);expect(arms['Leg R']).toEqual([0,0]);
        const right=showcaseValues(p,recipe,1.4),left=showcaseValues(p,recipe,2.2);
        expect(right['Leg R'][0]).toBeCloseTo(18);expect(right['Leg R'][1]).toBeCloseTo(45);expect(right['Leg L']).toEqual([0,0]);
        expect(left['Leg L'][0]).toBeCloseTo(-18);expect(left['Leg L'][1]).toBeCloseTo(45);expect(left['Leg R']).toEqual([0,0]);
        expect(right['Arm L']).toEqual([0,0]);expect(left['Arm R']).toEqual([0,0]);
    });
    it('halves only the arm targets of the listed showcase rigs',()=>{
        const p=puppet(),id=Object.keys(showcaseArmScale)[0],recipe=recipeFor(p,id);
        expect(showcaseCast).toContain(id);
        expect(showcaseValues(p,recipe,.6)['Arm R']).toEqual([8,15]);
        expect(showcaseValues(p,recipe,1.4)['Leg R'][1]).toBeCloseTo(45);
        expect(recipeFor(p,'not-listed').armScale).toBe(1);
    });
    it('makes the full head excursion and repeats after four seconds',()=>{
        const p=puppet(),recipe=recipeFor(p);
        expect(showcaseValues(p,recipe,2.75)['Head Angles']).toEqual([20,0]);
        expect(showcaseValues(p,recipe,2.75).ParamAngleZ).toEqual([10,0]);
        expect(showcaseValues(p,recipe,3.2)['Head Angles']).toEqual([-20,0]);
        expect(showcaseValues(p,recipe,3.2).ParamAngleZ).toEqual([-10,0]);
        for(const t of [.5,1.5,2.75,3.5])expect(showcaseValues(p,recipe,t+12)).toEqual(showcaseValues(p,recipe,t));
        for(const t of [0,4,8])expect(showcaseValues(p,recipe,t)).toEqual({});
    });
    it('respects fixed controls and clamps only to actual exported limits',()=>{
        const p=puppet();p.meta.motionCapabilities={chains:{'Arm R':{mode:'fixed'},'Leg L':{mode:'fixed'},'Leg R':{mode:'fixed'}},face:{head:{mode:'limited'},blink:{mode:'fixed'},mouth:{mode:'fixed'}},headAxes:{yaw:{mode:'fixed'},pitch:{mode:'articulated'},roll:{mode:'fixed'}}};
        p.param.find(x=>x.name==='Arm L')!.min=[-5,-8];const recipe=recipeFor(p);
        expect(recipe.arms).toEqual(['Arm L']);expect(recipe.legs).toEqual([]);
        expect(showcaseValues(p,recipe,.6)['Arm L']).toEqual([-5,-8]);
        for(let t=0;t<8;t+=.05){const v=showcaseValues(p,recipe,t);expect(v['Arm R']).toBeUndefined();expect(Object.keys(v).some(k=>/^(Leg|ParamEye|ParamMouth)/.test(k))).toBe(false);expect(v['Head Angles']??[0,0]).toEqual([0,0]);expect(v.ParamAngleZ??[0,0]).toEqual([0,0]);}
    });
    it('keeps blink timing in the face phase',()=>{
        const p=puppet(),recipe=recipeFor(p);
        expect(showcaseValues(p,recipe,3).ParamEyeLOpen[0]).toBe(0);
        expect(showcaseValues(p,recipe,3.3).ParamEyeLOpen[0]).toBe(1);
        expect(showcaseValues(p,recipe,1).ParamMouthOpenY[0]).toBe(0);
    });
    it('presents the explicit cast in order without changing the catalog',()=>{
        const recipe=recipeFor(puppet()),entries=[...showcaseCast].reverse().map(id=>({id,recipe}));
        expect(showcaseOrder(entries).map(e=>e.id)).toEqual(showcaseCast);expect(entries[0].id).toBe(showcaseCast.at(-1));
        expect(new Set(showcaseCast).size).toBe(showcaseCast.length);
        expect(()=>showcaseOrder(entries.slice(1))).toThrow('Missing showcase avatar');
    });
});
