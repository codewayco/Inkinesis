import {inpParts,inpTextures,type InpDocument} from './inp';
import type {ContinuousLimb} from '../../engine/src/body/continuousLimb';
export type GripProbe={arm:number;armIds:number[];armWeights:number[];prop:number;propIds:number[];propWeights:number[]};
/** Source material correspondence, not a hand landmark.
 * Interior quadrature of opaque arm triangles is intersected with the source
 * rigid carrier in the distal half of the forearm. Both barycentric coordinates
 * are retained so actual baked deformation, rather than analytic points alone,
 * is compared. Front duplicates are excluded. */
export function sourceGripProbes(puppet:InpDocument,textures:Buffer[],name:string,chain:ContinuousLimb) {
 const nodes=inpParts(puppet),decoded=inpTextures(textures),parameter=puppet.param.find(p=>p.name===name)!;
 const bound=new Set(parameter.bindings.filter(b=>b.param_name==='deform').map(b=>b.node));
 const props=nodes.filter(n=>bound.has(n.uuid)&&/^(objects|prop)(?:#|__|$)/.test(n.name)&&!n.name.includes('__front'));
 const side=name.at(-1)!.toLowerCase(),arms=nodes.filter(n=>bound.has(n.uuid)&&new RegExp(`^(arm|hand|handwear)-${side}(?:#|__|$)`).test(n.name)&&!n.name.includes('__front'));
 const {width,height}=puppet.meta.canvas as {width:number;height:number},dx=chain.tip.x-chain.joint.x,dy=chain.tip.y-chain.joint.y,den=dx*dx+dy*dy;
 const alpha=(node:typeof nodes[number],ids:number[],weights:number[])=>{
  const tex=decoded[node.textures![0]],uv=node.mesh!.uvs;
  const u=ids.reduce((s,id,i)=>s+weights[i]*uv[2*id],0),v=ids.reduce((s,id,i)=>s+weights[i]*uv[2*id+1],0);
  const x=Math.max(0,Math.min(tex.width-1,Math.round(u*(tex.width-1)))),y=Math.max(0,Math.min(tex.height-1,Math.round(v*(tex.height-1))));
  return tex.rgba[4*(y*tex.width+x)+3]/255;
 };
 const triangles=props.flatMap(node=>{const m=node.mesh!,out=[];for(let t=0;t<m.indices.length;t+=3){const ids=m.indices.slice(t,t+3),[a,b,c]=ids.map(i=>[m.verts[2*i],m.verts[2*i+1]]),ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-a[0],vy=c[1]-a[1],det=ux*vy-uy*vx;if(Math.abs(det)>1e-8)out.push({node,ids,a,ux,uy,vx,vy,det});}return out;});
 const probes:GripProbe[]=[];
 for(const arm of arms){const m=arm.mesh!;for(let t=0;t<m.indices.length;t+=3){const ids=m.indices.slice(t,t+3);
  for(let u=0;u<6;u++)for(let v=0;v<6-u;v++){
   const bw=(u+1/3)/6,cw=(v+1/3)/6,weights=[1-bw-cw,bw,cw];if(alpha(arm,ids,weights)<.5)continue;
   const x=ids.reduce((s,id,i)=>s+weights[i]*m.verts[2*id],0),y=ids.reduce((s,id,i)=>s+weights[i]*m.verts[2*id+1],0);
   if(((x+width/2-chain.joint.x)*dx+(y+height/2-chain.joint.y)*dy)/den<.5)continue;
   for(const tr of triangles){const zx=x-tr.a[0],zy=y-tr.a[1],b=(zx*tr.vy-zy*tr.vx)/tr.det,c=(tr.ux*zy-tr.uy*zx)/tr.det,a=1-b-c;if(Math.min(a,b,c)<-1e-9)continue;const ws=[a,b,c];if(alpha(tr.node,tr.ids,ws)<.5)continue;probes.push({arm:arm.uuid,armIds:ids,armWeights:weights,prop:tr.node.uuid,propIds:tr.ids,propWeights:ws});break;}
  }
 }}
 return {hasCarrier:props.length>0,probes};
}
export function sourceGripSlip(probes:GripProbe[],frames:Map<number,ArrayLike<number>>) {
 let sum=0,max=0;
 for(const p of probes){const arm=frames.get(p.arm)!,prop=frames.get(p.prop)!;const xy=(a:ArrayLike<number>,ids:number[],weights:number[],axis:number)=>ids.reduce((s,id,i)=>s+weights[i]*a[2*id+axis],0);
  const error=Math.hypot(xy(arm,p.armIds,p.armWeights,0)-xy(prop,p.propIds,p.propWeights,0),xy(arm,p.armIds,p.armWeights,1)-xy(prop,p.propIds,p.propWeights,1));sum+=error;max=Math.max(max,error);
 }
 return {sum,max,count:probes.length};
}
