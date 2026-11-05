import {it,expect} from 'vitest';
import {partitionLimbBindings} from '../partitionLimbBindings';
import {inpParts,type InpDocument,type InpParameter} from '../inp';
import {evaluateCombined,type CombinedAsset} from '../../../player/src/combinedRuntime';
it('preserves every triangle, UV and posed vertex while removing inactive owners',()=>{
 const verts=[0,0,10,0,0,10,10,10],uvs=verts.map(x=>x/10);
 const p=(name:string,id:number,delta:number[][]):InpParameter=>({uuid:id,name,is_vec2:true,min:[0,0],max:[1,1],defaults:[0,0],axis_points:[[0,1],[0,1]],merge_mode:'Passthrough',bindings:[{node:1,param_name:'deform',interpolate_mode:'Linear',isSet:[[true,true],[true,true]],values:[[verts.filter((_,i)=>i%2===0).map(()=>[0,0]),delta],[delta,delta]]}]});
 const doc:InpDocument={meta:{canvas:{width:10,height:10}},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[{uuid:1,name:'legwear-l',type:'Part',enabled:true,zsort:1,mesh:{verts,uvs,indices:[0,1,2,1,3,2],origin:[0,0]}}]},param:[p('Leg L',2,[[1,2],[1,2],[1,2],[1,2]]),p('Leg R',3,[[0,0],[0,0],[0,0],[3,4]])]};
 const before=structuredClone(doc);expect(partitionLimbBindings(doc)).toHaveLength(1);expect(inpParts(doc)).toHaveLength(2);
 const asset=(puppet:InpDocument):CombinedAsset=>({puppet,parts:inpParts(puppet),width:10,height:10,textures:[]});
 for(const x of [0,.13,1])for(const y of [0,.67,1]){
  const state={'Leg L':[x,y],'Leg R':[y,x]},a=evaluateCombined(asset(before),state)[0],b=evaluateCombined(asset(doc),state);
  for(const [k,node] of inpParts(doc).entries())for(let i=0;i<node.mesh!.verts.length;i+=2){const orig=verts.findIndex((v,j)=>j%2===0&&v===node.mesh!.verts[i]&&verts[j+1]===node.mesh!.verts[i+1]);expect(b[k].xy.slice(i,i+2)).toEqual(a.xy.slice(orig,orig+2));expect(node.mesh!.uvs.slice(i,i+2)).toEqual(uvs.slice(orig,orig+2));}
 }
 expect(inpParts(doc).reduce((n,p)=>n+p.mesh!.indices.length,0)).toBe(6);
 expect(doc.param.find(p=>p.name==='Leg R')!.bindings).toHaveLength(1);
});
