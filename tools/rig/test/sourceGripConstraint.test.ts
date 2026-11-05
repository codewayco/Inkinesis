import {it,expect} from 'vitest';
import {sourceGripProbes,sourceGripSlip} from '../sourceGripConstraint';
import {encodePNG} from '../../shared/encodePNG';
import type {InpDocument} from '../inp';
const chain={root:{x:50,y:10},joint:{x:50,y:50},tip:{x:50,y:90},rootBlend:24,jointBlend:18,blendMode:'angle' as const};
function fixture(propAlpha=255){
 const arm={uuid:1,name:'arm-l',type:'Part',enabled:true,zsort:0,textures:[0],mesh:{verts:[-5,20,5,20,-5,45,5,45],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}};
 const prop={...structuredClone(arm),uuid:2,name:'objects#1:l',textures:[1]};
 const puppet={meta:{canvas:{width:100,height:100}},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[arm,prop]},param:[{uuid:10,name:'Arm L',is_vec2:true,min:[-30,-60],max:[30,60],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0,.5,1],[0,.5,1]],bindings:[1,2].map(node=>({node,param_name:'deform',interpolate_mode:'Linear',values:[],isSet:[]}))}]} as InpDocument;
 const rgba=new Uint8ClampedArray(4*4*4).fill(255),transparent=new Uint8ClampedArray(rgba);for(let i=3;i<transparent.length;i+=4)transparent[i]=propAlpha;
 return {puppet,arm,prop,textures:[Buffer.from(encodePNG(rgba,4,4)),Buffer.from(encodePNG(transparent,4,4))]};
}
it('tracks actual material contact under a common rigid frame and detects a detached hand',()=>{
 const f=fixture(),p=sourceGripProbes(f.puppet,f.textures,'Arm L',chain);expect(p.hasCarrier).toBe(true);expect(p.probes.length).toBeGreaterThan(10);
 const rotate=(v:number[])=>v.map((_,i)=>i%2? v[i-1]*.6+v[i]*.8+17:v[i]*.8-v[i+1]*.6-13),posed=rotate(f.arm.mesh.verts);
 expect(sourceGripSlip(p.probes,new Map([[1,posed],[2,posed]] )).max).toBeLessThan(1e-10);
 const detached=posed.map((v,i)=>v+(i%2?0:10)),slip=sourceGripSlip(p.probes,new Map([[1,detached],[2,posed]]));
 expect(slip.max).toBeCloseTo(10,9);expect(slip.sum/slip.count).toBeCloseTo(10,9);
});
it('does not invent contacts in transparent padding or proximal source overlap',()=>{
 const transparent=fixture(0);expect(sourceGripProbes(transparent.puppet,transparent.textures,'Arm L',chain).probes).toHaveLength(0);
 const proximal=fixture();for(const n of [proximal.arm,proximal.prop])n.mesh.verts=n.mesh.verts.map((v,i)=>v-(i%2?40:0));
 expect(sourceGripProbes(proximal.puppet,proximal.textures,'Arm L',chain).probes).toHaveLength(0);
});
it('excludes front duplicates and objects not owned by this parameter',()=>{
 const f=fixture();f.prop.name+='__front';expect(sourceGripProbes(f.puppet,f.textures,'Arm L',chain).hasCarrier).toBe(false);
 f.prop.name='objects#1:l';f.puppet.param[0].bindings=f.puppet.param[0].bindings.filter(b=>b.node!==2);
 expect(sourceGripProbes(f.puppet,f.textures,'Arm L',chain).hasCarrier).toBe(false);
});
