import {inpParts,combinedChains,type InpDocument,type InpParameter} from './inp';
import {poseContinuousLimb} from '../../engine/src/body/continuousLimb';
import {fitLegGridBudget} from './fitLegGridBudget';
import {combinedMeshGate} from './combinedMeshGate';
/** General source-field reconstruction. No character identities or evaluation poses.
 * Retains authored per-vertex ownership; refuses fields not exactly explained by
 * the stored analytic chain times a scalar ownership weight. */
export function reconstructLegOwnership(puppet:InpDocument,param:InpParameter){
 const {width,height}=puppet.meta.canvas as {width:number;height:number};
 const record=combinedChains(puppet).find(r=>r.name===param.name);
 if(!record||!param.name.startsWith('Leg '))throw Error('Not a stored leg chain');
 const nodes=new Map(inpParts(puppet).map(n=>[n.uuid,n]));let maxResidual=0;
 const fields=param.bindings.map(b=>{
  if(b.param_name!=='deform')throw Error('Unsupported binding');const node=nodes.get(b.node)!;
  const vertices=Array.from({length:node.mesh!.verts.length/2},(_,i)=>({x:node.mesh!.verts[2*i]+width/2,y:node.mesh!.verts[2*i+1]+height/2}));
  const weights=vertices.map((pt,k)=>{let numerator=0,denominator=0;const samples:{d:number[];v:number[]}[]=[];
   param.axis_points[0].forEach((tx,ix)=>param.axis_points[1].forEach((ty,iy)=>{
    const q=poseContinuousLimb(pt,record.chain,param.min[0]+tx*(param.max[0]-param.min[0]),(param.min[1]+ty*(param.max[1]-param.min[1]))*record.distalSign);
    const d=[q.x-pt.x,q.y-pt.y],v=(b.values[ix][iy] as number[][])[k];samples.push({d,v});numerator+=d[0]*v[0]+d[1]*v[1];denominator+=d[0]**2+d[1]**2;
   }));
   let w=denominator>1e-12?numerator/denominator:0;
   if(w< -1e-8||w>1+1e-8)throw Error('Ownership outside [0,1]');w=Math.max(0,Math.min(1,w));
   for(const {d,v} of samples)maxResidual=Math.max(maxResidual,Math.hypot(v[0]-d[0]*w,v[1]-d[1]*w));return w;
  });return {node:b.node,vertices,weights};
 });
 if(maxResidual>1e-6)throw Error(`Stored keys not exact analytic ownership field: ${maxResidual} px`);
 return {record,fields,maxResidual};
}
export function signedLegCandidate(puppet:InpDocument,param:InpParameter,reverseFraction:number,keyCap=13){
 const {record,fields,maxResidual}=reconstructLegOwnership(puppet,param);
 if(param.min[1]!==0||param.max[1]<=0)throw Error('Only initially one-sided positive knee supported');
 const p=structuredClone(param),xs=p.axis_points[0].map(t=>p.min[0]+t*(p.max[0]-p.min[0]));
 const positive=p.axis_points[1].map(t=>p.min[1]+t*(p.max[1]-p.min[1]));
 // Mirror source keys, scaled by a geometry-selected fraction.
 const ys=[...positive.slice(1).map(y=>-y*reverseFraction).reverse(),...positive];p.min[1]=ys[0];
 p.axis_points=[xs.map(x=>(x-p.min[0])/(p.max[0]-p.min[0])),ys.map(y=>(y-p.min[1])/(p.max[1]-p.min[1]))];
 p.bindings.forEach((b,j)=>{const f=fields[j];b.values=xs.map(x=>ys.map(y=>f.vertices.map((pt,k)=>{const q=poseContinuousLimb(pt,record.chain,x,y*record.distalSign),w=f.weights[k];return [(q.x-pt.x)*w,(q.y-pt.y)*w];})));b.isSet=xs.map(()=>ys.map(()=>true));});
 const compression=fitLegGridBudget(p,keyCap);
 const meshGate=combinedMeshGate({...puppet,param:[p]});
 return {parameter:p,maxSourceResidualPx:maxResidual,compression,meshGate};
}
