import {inpParts,type InpDocument,type InpNode,type InpParameter} from './inp';
import {solveGripDrive,poseGripObject,poseGripDriveFrame} from '../../engine/src/body/pairedGripDrive';
import type {ContinuousLimb,LimbPoint} from '../../engine/src/body/continuousLimb';
import type {MotionCapabilities,ChainName} from '../imageToRig/capabilities';
import {attachmentMotionGate} from './attachmentMotionGate';
import {combinedMeshGate,drawsNoTexture} from './combinedMeshGate';
import {evaluateCombined} from '../../player/src/combinedRuntime';
/** Optional linked-arm driver. One source arm command drives a rigid object;
 * the other follows through IK. Existing vertical lift remains intact. Only
 * ordinary baked keys reach either runtime. Never describes this as two
 * independent arms; range, ownership, dense mesh and simultaneous lift tests
 * precede any publication of the control. */
export function bakePairedGripDrive(puppet:InpDocument,textures:Buffer[],props:InpNode[],sourceArms:InpParameter[],caps?:MotionCapabilities,options:{refineRange?:boolean}={}){
 const arms=sourceArms.slice().sort((a,b)=>a.name.localeCompare(b.name));
 const records=(puppet.meta.combined as {chains:{name:string;chain:ContinuousLimb;range:number[][];sampling?:unknown}[]}).chains;
 if(arms.length!==2||!props.length||!puppet.param.some(p=>p.name==='ParamGripLift'))return {status:'skipped',reason:'Requires validated shared-object lift and both original source arm bindings'};
 const chains=arms.map(p=>records.find(r=>r.name===p.name)!.chain) as [ContinuousLimb,ContinuousLimb],nodes=inpParts(puppet),{width,height}=puppet.meta.canvas as {width:number;height:number};
 const owned=arms.flatMap(p=>p.bindings.map(b=>b.node));if(new Set(owned).size!==owned.length)return {status:'rejected',reason:'Arm garment ownership overlaps'};
 const lift=puppet.param.find(p=>p.name==='ParamGripLift')!,attempts=[];
 const scales=options.refineRange?[.125,.109375,.09375,.078125,.0625,.0546875,.046875,.0390625,.03125,.02734375,.0234375,.01953125,.015625]:[.125,.0625,.03125,.015625];
 for(const scale of scales)for(const driver of [0,1] as const){
  const cache=new Map<string,ReturnType<typeof solveGripDrive>>(),solve=(x:number,y:number)=>{const key=x+','+y;if(!cache.has(key))cache.set(key,solveGripDrive(chains,driver,x,y));return cache.get(key)!;};
  let failure:string|undefined,maxThetaJump=0,maxJointJump=0;const fine=33;
  const states=Array.from({length:fine},(_,i)=>Array.from({length:fine},(_,j)=>solve((-30+60*i/(fine-1))*scale,(-60+120*j/(fine-1))*scale)));
  for(let i=0;i<fine;i++)for(let j=0;j<fine;j++){
   const s=states[i][j];if(!s.ok){failure=s.reason;continue;}
   for(const t of [i+1<fine?states[i+1][j]:undefined,j+1<fine?states[i][j+1]:undefined])if(t?.ok){maxThetaJump=Math.max(maxThetaJump,Math.abs(s.theta-t.theta));for(let a=0;a<2;a++){const x=s.arms[a],y=t.arms[a];if(x.ok&&y.ok)maxJointJump=Math.max(maxJointJump,Math.abs(x.proximal-y.proximal),Math.abs(x.distal-y.distal));}}
  }
  if(failure){attempts.push({driver,scale,status:'kinematic-rejection',reason:failure});continue;}
  const pose=(p:LimbPoint,side:number,x:number,y:number)=>{const s=solve(x,y);if(!s.ok)throw Error(s.reason);const a=s.arms[side];if(!a.ok)throw Error(a.reason);return poseGripDriveFrame(p,chains[side],a.proximal,a.distal,s.theta);};
  const axis=Array.from({length:17},(_,i)=>i/16),min=[-30*scale,-60*scale],max=[30*scale,60*scale];
  const bake=(p:InpParameter,side:number):InpParameter=>({...structuredClone(p),min,max,axis_points:[axis,axis],bindings:p.bindings.map(bind=>{
   if(bind.param_name!=='deform')throw Error('Linked grip requires deformation arm bindings');const n=nodes.find(n=>n.uuid===bind.node)!;
   return {...bind,isSet:axis.map(()=>axis.map(()=>true)),values:axis.map(t=>axis.map(u=>n.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>{const v={x:n.mesh!.verts[2*i]+width/2,y:n.mesh!.verts[2*i+1]+height/2},q=pose(v,side,min[0]+t*(max[0]-min[0]),min[1]+u*(max[1]-min[1]));return [q.x-v.x,q.y-v.y];})))};
  })});
  try{
   const baked=arms.map(bake),garment=baked.map((p,side)=>attachmentMotionGate({...puppet,param:[p]},textures,p.name as ChainName,{armMatteCoverage:true,poseFunction:(q,_chain,x,y)=>pose(q,side,x,y)}));
   if(garment.some(g=>g.status!=='passed'))throw Error('Existing ownership gate rejected linked field: '+garment.filter(g=>g.status!=='passed').map(g=>g.detail).join(';'));
   const parameter:InpParameter={...baked[driver],uuid:Math.max(...puppet.param.map(p=>p.uuid))+1,bindings:baked.flatMap(p=>p.bindings)};
   for(const n of props)parameter.bindings.push({node:n.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:axis.map(()=>axis.map(()=>true)),values:axis.map(t=>axis.map(u=>{const s=solve(min[0]+t*(max[0]-min[0]),min[1]+u*(max[1]-min[1]));if(!s.ok)throw Error(s.reason);return n.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>{const p={x:n.mesh!.verts[2*i]+width/2,y:n.mesh!.verts[2*i+1]+height/2},q=poseGripObject(p,chains[driver].tip,s.target,s.theta);return [q.x-p.x,q.y-p.y];});}))});
   const gate=combinedMeshGate({...puppet,param:[parameter]});
   // Preserve the existing lift and check additive combinations, not merely
   // each control in isolation. Every driver key+half cell, five lift levels.
   const selected=new Set([...parameter.bindings,...lift.bindings].filter(b=>b.param_name==='deform').map(b=>b.node)),parts=nodes.filter(n=>selected.has(n.uuid));
   const doc={...puppet,param:[parameter,lift]},asset={puppet:doc,parts:nodes,width,height,textures:[]};let combinedSamples=0,combinedTriangles=0;
   for(let i=0;i<33;i++)for(let j=0;j<33;j++)for(const amount of [0,.25,.5,.75,1]){
    const values={[parameter.name]:[min[0]+i/32*(max[0]-min[0]),min[1]+j/32*(max[1]-min[1])],ParamGripLift:[lift.min[0]+amount*(lift.max[0]-lift.min[0]),0]},frame=new Map(evaluateCombined(asset,values).map(p=>[p.uuid,p.xy]));combinedSamples++;
    for(const n of parts){const m=n.mesh!,xy=frame.get(n.uuid)!,area=(v:number[],a:number,b:number,c:number)=>(v[2*b]-v[2*a])*(v[2*c+1]-v[2*a+1])-(v[2*b+1]-v[2*a+1])*(v[2*c]-v[2*a]);
     for(let t=0;t<m.indices.length;t+=3){const [a,b,c]=m.indices.slice(t,t+3),rest=area(m.verts,a,b,c);if(Math.abs(rest)<=.1||drawsNoTexture(m.uvs,a,b,c))continue;combinedTriangles++;const moved=area(xy,a,b,c);if(!Number.isFinite(moved)||rest*moved<=0)throw Error(`Linked drive/lift foldover:${n.name},driver-grid${i}/${j},lift${amount}`);}
    }
   }
   puppet.param.push(parameter);const record=records.find(r=>r.name===parameter.name)!;record.range=[min,max];record.sampling={status:'17x17 linked driver with33x33 kinematic and key/half-grid mesh checks',maxThetaJump,maxJointJump};
   const result={status:'needs_review',driver:parameter.name,passiveArm:arms[1-driver].name,scale,range:[min,max],keys:17,garment,gate,combinedSamples,combinedTriangles,maxThetaJump,maxJointJump,attempts,independentArms:false,retainsLift:true,limitations:['One driver with passive other-hand coupling,not two independent arms.','Baked interpolation and material contact require separate measurement.','Driver+lift preserves distal contact through additive rigid rotation/translation;proximal arm shape still needs visual review.']};
   puppet.meta.pairedGripDrive=result;
   if(caps){const c=caps.chains[parameter.name as ChainName];c.mode='limited';c.stage='geometry';c.reasons.push('This control drives a shared rigid object; the other hand follows through a linked constraint. Independent opposite-arm motion is unavailable.');(c.checks??=[]).push({name:'linked grip ownership and mesh sweep',status:'passed',samples:combinedSamples,detail:'Both arm garment fields,driver mesh and combinations with retained vertical lift passed.'});}
   return result;
  }catch(e){attempts.push({driver,scale,status:'rejected',reason:String(e),maxThetaJump,maxJointJump});}
 }
 return {status:'rejected',attempts,reason:'No linked driver passed original ownership and dense mesh checks with retained lift'};
}
