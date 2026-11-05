/** Retain the three original garment-v1 controls when upgrading its body.
 * Reuse unchanged bindings verbatim; evaluate the same original fields only
 * for newly partitioned surfaces. No animation is inferred from a screenshot. */
import {inpParts,type InpDocument,type InpNode} from './inp';
import {clothOffset} from './buildGarment';
import type {GarmentRegion} from '../imageToRig/garmentAnalysis';
import type {LimbPoint} from '../../engine/src/body/continuousLimb';
export function preserveLegacyGarmentControls(puppet:InpDocument,reference:InpDocument,marks:Record<string,LimbPoint>) {
 const oldMeta=reference.meta.garment as {regions:GarmentRegion[];bodyParts:number[];parameters:string[]}|undefined;
 if(!oldMeta)return {controls:[],changed:false};
 const oldNodes=inpParts(reference),nodes=inpParts(puppet),{width,height}=reference.meta.canvas as {width:number;height:number};
 const sway=reference.param.find(p=>p.name==='ParamBodySway');if(!sway)return {controls:[],changed:false};
 const magnitude=Math.max(...sway.bindings.flatMap(b=>b.values.flatMap(col=>col.flatMap(v=>(v as number[][]).map(p=>Math.abs(p[0]))))));
 const amplitude=magnitude/(width*.0025),smooth=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
 const regions=oldMeta.regions,torso=marks.shoulderL&&marks.shoulderR?(marks.shoulderL.y+marks.shoulderR.y)/2:height*.3,floor=Math.max(...oldNodes.flatMap(n=>n.mesh!.verts.filter((_,i)=>i%2).map(y=>y+height/2))),waist=regions.filter(r=>r.kind!=='sleeve').map(r=>r.anchorY).sort((a,b)=>a-b)[0]??torso+height*.15,center=marks.shoulderL&&marks.shoulderR?(marks.shoulderL.x+marks.shoulderR.x)/2:width/2;
 const bodyNames=new Set(oldNodes.filter(n=>oldMeta.bodyParts.includes(n.uuid)).map(n=>n.name)),baseName=(n:InpNode)=>n.name.split('__')[0];
 const field=(name:string,n:InpNode,p:LimbPoint)=>{
  if(name==='ParamBodySway')return width*.0025*smooth((floor-p.y)/Math.max(1,floor-torso));
  if(name==='ParamBreath'){if(!bodyNames.has(baseName(n))||p.y<torso||p.y>waist)return 0;const t=(p.y-torso)/Math.max(1,waist-torso);return (p.x-center)*.012*Math.sin(Math.PI*t)**2*(1-smooth(Math.abs(p.x-center)/(width*.15)));}
  if(!/^(topwear|bottomwear|handwear|arm)(?:-[lr])?$/.test(baseName(n)))return 0;
  return regions.filter(g=>g.kind==='sleeve'?/^(handwear|arm)/.test(baseName(n)):/^(topwear|bottomwear)/.test(baseName(n))).map(r=>clothOffset(p,r,width,height,marks).x).reduce((a,b)=>Math.abs(a)>Math.abs(b)?a:b,0);
 };
 let uuid=Math.max(...puppet.param.map(p=>p.uuid))+1;const controls=[];
 for(const name of ['ParamGarmentSway','ParamBodySway','ParamBreath']){
  const old=reference.param.find(p=>p.name===name);if(!old)continue;if(puppet.param.some(p=>p.name===name))throw Error('Refusing to overwrite existing garment control '+name);
  const p={...structuredClone(old),uuid:uuid++,bindings:[] as typeof old.bindings};
  for(const n of nodes){
   const oldNode=oldNodes.find(q=>q.name===n.name),oldBinding=oldNode&&old.bindings.find(b=>b.node===oldNode.uuid);
   if(oldNode&&JSON.stringify(oldNode.mesh)===JSON.stringify(n.mesh)){if(oldBinding)p.bindings.push({...structuredClone(oldBinding),node:n.uuid});continue;}
   const offsets=n.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>field(name,n,{x:n.mesh!.verts[2*i]+width/2,y:n.mesh!.verts[2*i+1]+height/2})*amplitude);
   if(!offsets.some(x=>Math.abs(x)>1e-6))continue;
   p.bindings.push({node:n.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:p.axis_points[0].map(()=>[true]),values:p.axis_points[0].map(t=>[offsets.map(x=>[x*(p.min[0]+t*(p.max[0]-p.min[0])),0])])});
  }
  puppet.param.push(p);controls.push(name);
 }
 return {controls,changed:controls.length>0,amplitude,scope:'Original garment-v1 fields and amplitude; exact old bindings retained for unchanged meshes'};
}
