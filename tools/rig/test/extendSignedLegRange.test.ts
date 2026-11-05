import {describe,it,expect} from 'vitest';
import {poseContinuousLimb} from '../../../engine/src/body/continuousLimb';
import {reconstructLegOwnership,signedLegCandidate} from '../extendSignedLegRange';
import type {InpDocument} from '../inp';
function fixture():InpDocument{
 const chain={root:{x:100,y:40},joint:{x:100,y:100},tip:{x:100,y:170},rootBlend:20,jointBlend:20,blendMode:'angle' as const};
 const points=[{x:95,y:150},{x:105,y:150},{x:100,y:165}],weights=[.7,.7,.7],xs=[-10,0,10],ys=[0,10,20];
 const values=xs.map(x=>ys.map(y=>points.map((p,i)=>{const q=poseContinuousLimb(p,chain,x,y);return [(q.x-p.x)*weights[i],(q.y-p.y)*weights[i]];})));
 return {meta:{canvas:{width:200,height:200},combined:{chains:[{name:'Leg L',chain,distalSign:1}]}},nodes:{uuid:0,name:'root',type:'Node',enabled:true,zsort:0,children:[{uuid:1,name:'arbitrary-material',type:'Part',enabled:true,zsort:0,mesh:{verts:points.flatMap(p=>[p.x-100,p.y-100]),uvs:[0,0,1,0,.5,1],indices:[0,1,2],origin:[0,0]}}]},param:[{uuid:2,name:'Leg L',min:[-10,0],max:[10,20],defaults:[0,0],is_vec2:true,merge_mode:'Passthrough',axis_points:[[0,.5,1],[0,.5,1]],bindings:[{node:1,param_name:'deform',values,isSet:xs.map(()=>ys.map(()=>true)),interpolate_mode:'Linear'}]}]};
}
describe('source-owned signed knee field',()=>{
 it('preserves neutral, original keys, ownership and source document while adding reverse motion',()=>{const p=fixture(),before=JSON.stringify(p),r=signedLegCandidate(p,p.param[0],1);expect(JSON.stringify(p)).toBe(before);expect(r.parameter.min).toEqual([-10,-20]);expect(r.parameter.axis_points[1]).toEqual([0,.25,.5,.75,1]);const b=r.parameter.bindings[0];for(let x=0;x<3;x++)for(let y=0;y<3;y++)for(let k=0;k<3;k++)for(let d=0;d<2;d++)expect((b.values[x][y+2] as number[][])[k][d]).toBeCloseTo((p.param[0].bindings[0].values[x][y] as number[][])[k][d],10);expect(r.meshGate.status).toBe('passed');expect(reconstructLegOwnership(p,p.param[0]).fields[0].weights[0]).toBeCloseTo(.7,12);});
 it('rejects a key field inconsistent with a single fixed material ownership',()=>{const p=fixture();(p.param[0].bindings[0].values[0][0] as number[][])[0][0]+=.1;expect(()=>reconstructLegOwnership(p,p.param[0])).toThrow();});
 it('refuses non-leg controls',()=>{const p=fixture();p.param[0].name='Arm L';expect(()=>signedLegCandidate(p,p.param[0],1)).toThrow();});
});
