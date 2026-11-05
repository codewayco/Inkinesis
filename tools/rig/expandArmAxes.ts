import {inpParts,combinedChains,type InpDocument,type InpParameter} from './inp';
import type {ChainName} from '../imageToRig/capabilities';
import {poseContinuousLimb} from '../../engine/src/body/continuousLimb';
import {poseHeldProp} from './heldPropAttachments';
import {combinedMeshGate} from './combinedMeshGate';
import {attachmentMotionGate} from './attachmentMotionGate';
import {clipParameterGrid} from './parameterGridClip';
import {evaluateCombined} from '../../player/src/combinedRuntime';
import {sourceGripProbes,sourceGripSlip} from './sourceGripConstraint';
/** Recover the authored source field and grow each bound independently. Geometry,
 * clothing and source material grip constraints stay enabled. No evaluation pose
 * is an input. Paired drivers require their own constraint solver. */
export function expandArmAxes(puppet:InpDocument,textures:Buffer[],original:InpParameter,options:{recoverFoldedHinge?:number;linearHinge?:boolean}={}){
 const nodes=inpParts(puppet),{width,height}=puppet.meta.canvas as {width:number;height:number};
 const storedRecord=combinedChains(puppet).find(r=>r.name===original.name),record=storedRecord?structuredClone(storedRecord):undefined;
 if(!record||!original.name.startsWith('Arm '))throw Error('No authored arm');
 if(puppet.meta.pairedGripDrive)throw Error('Paired driver is not an independent arm field');
 let sampling=record.sampling;while(sampling?.prior)sampling=sampling.prior;
 if(!sampling?.xs||!sampling?.ys)throw Error('No original sampling provenance');
 const full=structuredClone(original),axes=[sampling.xs as number[],sampling.ys as number[]];
 full.min=axes.map(a=>a[0]);full.max=axes.map(a=>a.at(-1)!);
 if(!options.recoverFoldedHinge&&!options.linearHinge&&original.min.every((v,d)=>v===full.min[d])&&original.max.every((v,d)=>v===full.max[d]))return {changed:false,reason:'Already full authored range'};
 const pose=(node:number,pt:{x:number;y:number},x:number,y:number)=>/^(objects|prop)(?:#|__|$)/.test(nodes.find(n=>n.uuid===node)!.name)?poseHeldProp(pt,record.chain,x,y):poseContinuousLimb(pt,record.chain,x,y);
 let sourceResidual=0;
 for(const b of original.bindings){if(b.param_name!=='deform')throw Error('Nondeformation binding');const n=nodes.find(n=>n.uuid===b.node)!;
 original.axis_points[0].forEach((tx,ix)=>original.axis_points[1].forEach((ty,iy)=>{const x=original.min[0]+tx*(original.max[0]-original.min[0]),y=original.min[1]+ty*(original.max[1]-original.min[1]);for(let k=0;k<n.mesh!.verts.length;k+=2){const pt={x:n.mesh!.verts[k]+width/2,y:n.mesh!.verts[k+1]+height/2},q=pose(b.node,pt,x,y),v=(b.values[ix][iy] as number[][])[k/2];sourceResidual=Math.max(sourceResidual,Math.hypot(v[0]-q.x+pt.x,v[1]-q.y+pt.y));}}));}
 if(sourceResidual>.5)throw Error('Source reconstruction exceeds 0.5 px: '+sourceResidual);
 if(options.linearHinge)record.chain.hingeProfile='linear';
 if(options.recoverFoldedHinge){record.chain.weightMode='bisector';record.chain.bisectorBandFraction=options.recoverFoldedHinge;}
 const candidateMeta={...puppet.meta,combined:{...(puppet.meta.combined as object),chains:combinedChains(puppet).map(r=>r.name===record.name?record:r)}};
 full.axis_points=axes.map((a,d)=>a.map(x=>(x-full.min[d])/(full.max[d]-full.min[d])));
 for(const b of full.bindings){const n=nodes.find(n=>n.uuid===b.node)!;b.values=axes[0].map(x=>axes[1].map(y=>Array.from({length:n.mesh!.verts.length/2},(_,k)=>{const pt={x:n.mesh!.verts[2*k]+width/2,y:n.mesh!.verts[2*k+1]+height/2},q=pose(b.node,pt,x,y);return[q.x-pt.x,q.y-pt.y];})));b.isSet=axes[0].map(()=>axes[1].map(()=>true));}
 const contact=sourceGripProbes(puppet,textures,original.name,record.chain);
 const asset=(p:InpParameter)=>({puppet:{...puppet,param:[p]},parts:nodes,width,height,textures:[]});
 const slip=(p:InpParameter,min=p.min,max=p.max)=>{let worst=0,sum=0,n=0;for(const tx of [0,.25,.5,.75,1])for(const ty of [0,.25,.5,.75,1]){const frames=evaluateCombined(asset(p),{[p.name]:[min[0]+tx*(max[0]-min[0]),min[1]+ty*(max[1]-min[1])]});const r=sourceGripSlip(contact.probes,new Map(frames.map(f=>[f.uuid,f.xy])));worst=Math.max(worst,r.max);sum+=r.sum;n+=r.count;}return{max:worst,mean:sum/Math.max(1,n)};};
 const oldSlip=contact.hasCarrier?slip(original):{max:0,mean:0};
 const test=(min:number[],max:number[])=>{const p=clipParameterGrid(full,min,max),doc={...puppet,meta:candidateMeta,param:[p]};const mesh=combinedMeshGate(doc),attachment=attachmentMotionGate(doc,textures,p.name as ChainName,{armMatteCoverage:true});if(attachment.status!=='passed')throw Error('Garment attachment: '+attachment.detail);
 let grip=null;if(contact.hasCarrier){if(!contact.probes.length)throw Error('No source grip material');const common=slip(p,original.min,original.max),expanded=slip(p);if(common.max>oldSlip.max+.001||common.mean>oldSlip.mean+.001)throw Error('Existing grip regression '+JSON.stringify({oldSlip,common}));if(expanded.max>Math.max(height*.005,oldSlip.max+.001))throw Error('Expanded source grip exceeds limit '+expanded.max);grip={old:oldSlip,common,expanded,probes:contact.probes.length};}
 return {p,mesh,attachment,grip};};
 let best=test(options.recoverFoldedHinge?[original.min[0],-Math.max(Math.abs(full.min[1]),Math.abs(full.max[1]))/512]:original.min,options.recoverFoldedHinge?[original.max[0],Math.max(Math.abs(full.min[1]),Math.abs(full.max[1]))/512]:original.max);const attempts:{axis:number;side:'min'|'max';value:number;passed:boolean;reason?:string}[]=[];
 // Grow shoulder first, then elbow. No shrinking of an already safe axis.
 for(const d of [0,1])for(const side of ['min','max'] as const){let good=best.p[side][d],bad=full[side][d];if(Math.abs(good-bad)<1e-8)continue;
 for(let step=0;step<5;step++){const value=step===0?bad:(good+bad)/2,min=[...best.p.min],max=[...best.p.max];(side==='min'?min:max)[d]=value;
 try{const trial=test(min,max);best=trial;good=value;attempts.push({axis:d,side,value,passed:true});if(step===0)break;}catch(e){bad=value;attempts.push({axis:d,side,value,passed:false,reason:String(e)});}}}
 const changed=!!options.recoverFoldedHinge||!!options.linearHinge||best.p.min.some((v,d)=>v<original.min[d]-1e-6)||best.p.max.some((v,d)=>v>original.max[d]+1e-6);
 return {changed,parameter:best.p,chain:record.chain,sourceResidual,oldRange:[original.min,original.max],newRange:[best.p.min,best.p.max],attempts,mesh:best.mesh,attachment:best.attachment,grip:best.grip};
}
