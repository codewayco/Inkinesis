import {describe,expect,it} from 'vitest';
import type {InpDocument,InpParameter} from '../rig/inp';
import {recipeFor,showcaseValues,showcaseOrder} from './showcaseMotion';

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
    it('opens with Purple Couture and keeps garment-only avatars at the end without changing the catalog',()=>{
        const recipe=recipeFor(puppet()),entries=['01-tidal-glass','02-ember-waltz','03-solstice-mosaic','04-purple-couture','06-saffron-orbit','05-ultramarine-tempo','09-desert-ranger'].map(id=>({id,recipe}));
        const ordered=showcaseOrder(entries);
        expect(ordered.slice(0,5).map(e=>e.id)).toEqual(['04-purple-couture','03-solstice-mosaic','06-saffron-orbit','05-ultramarine-tempo','09-desert-ranger']);
        expect(ordered.slice(-2).map(e=>e.id)).toEqual(['01-tidal-glass','02-ember-waltz']);expect(entries[0].id).toBe('01-tidal-glass');
    });
});
