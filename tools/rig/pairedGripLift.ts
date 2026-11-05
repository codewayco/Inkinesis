/** Opt-in authoring-only paired vertical lift. Independent arm controls remain
 * unavailable. Distal hand frames follow the object; both runtime outputs use
 * ordinary baked keyforms. Rendering/export still need per-model review. */
import {inpParts,type InpDocument,type InpNode,type InpParameter} from './inp';
import {solvePairedGrip,poseGripFrame} from '../../engine/src/body/pairedGrip';
import type {ContinuousLimb} from '../../engine/src/body/continuousLimb';
import {attachmentMotionGate} from './attachmentMotionGate';
import {combinedMeshGate} from './combinedMeshGate';
export function bakePairedGripLift(puppet:InpDocument,textures:Buffer[],props:InpNode[]) {
 const arms=puppet.param.filter(p=>/^Arm [LR]$/.test(p.name)).sort((a,b)=>a.name.localeCompare(b.name));
 const records=(puppet.meta.combined as {chains:{name:string;chain:ContinuousLimb}[]}).chains;
 const reject=(reason:string)=>{puppet.param=puppet.param.filter(p=>!arms.includes(p));return {status:'rejected',attempts:[{status:'rejected',reason}]};};
 if(arms.length!==2||arms.some(p=>!records.some(r=>r.name===p.name)))return reject('Paired lift requires both source arm fields; shared prop remains static');
 const chains=arms.map(p=>records.find(r=>r.name===p.name)!.chain) as [ContinuousLimb,ContinuousLimb];
 const {width,height}=puppet.meta.canvas as {width:number;height:number},nodes=inpParts(puppet);
 const affected=arms.flatMap(p=>p.bindings.map(b=>b.node));
 if(new Set(affected).size!==affected.length)return reject('Shared arm binding ownership requires an explicit combined field');
 const attempts=[];
 for(const span of [.015,.01,.005]){
  const lifts=Array.from({length:33},(_,i)=>-span*height*(1-i/32)),solves=lifts.map(l=>solvePairedGrip(chains,0,l));
  if(solves.some(s=>!s.ok||s.arms.some(a=>!a.ok||Math.abs(a.proximal)>30||Math.abs(a.distal)>60))){attempts.push({span,status:'unreachable or exceeds original source angle range'});continue;}
  try{
   // Retain the original ownership check on a containing rectangle of actual
   // solved angles, with freshly evaluated fields rather than relabelled keys.
   const garment=[];
   for(const [side,p] of arms.entries()){
    const angles=solves.map(s=>s.arms[side]).filter(a=>a.ok),q=structuredClone(p);
    q.min=[Math.min(...angles.map(a=>a.proximal)),Math.min(...angles.map(a=>a.distal))];q.max=[Math.max(...angles.map(a=>a.proximal)),Math.max(...angles.map(a=>a.distal))];
    q.axis_points=[[0,.5,1],[0,.5,1]];
    for(const bind of q.bindings){if(bind.param_name!=='deform')throw Error('Only deformation arm bindings supported');const n=nodes.find(n=>n.uuid===bind.node)!;
     bind.values=q.axis_points[0].map(t=>q.axis_points[1].map(u=>n.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>{const v={x:n.mesh!.verts[2*i]+width/2,y:n.mesh!.verts[2*i+1]+height/2},z=poseGripFrame(v,chains[side],q.min[0]+t*(q.max[0]-q.min[0]),q.min[1]+u*(q.max[1]-q.min[1]));return [z.x-v.x,z.y-v.y];})));
    }
    const g=attachmentMotionGate({...puppet,param:[q]},textures,p.name as 'Arm L'|'Arm R',{armMatteCoverage:true,poseFunction:poseGripFrame});garment.push(g);if(g.status!=='passed')throw Error(g.detail);
   }
   const bindings=arms.flatMap((p,side)=>p.bindings.map(bind=>{
    const n=nodes.find(n=>n.uuid===bind.node)!;
    return {...bind,isSet:lifts.map(()=>[true]),values:solves.map(s=>{const a=s.arms[side];if(!a.ok)throw Error('Unreachable');return [n.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>{const v={x:n.mesh!.verts[2*i]+width/2,y:n.mesh!.verts[2*i+1]+height/2},z=poseGripFrame(v,chains[side],a.proximal,a.distal);return [z.x-v.x,z.y-v.y];})];})};
   }));
   for(const n of props)bindings.push({node:n.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:lifts.map(()=>[true]),values:lifts.map(l=>[n.mesh!.verts.filter((_,i)=>i%2===0).map(()=>[0,l])])});
   const parameter:InpParameter={uuid:Math.max(...puppet.param.map(p=>p.uuid))+1,name:'ParamGripLift',is_vec2:false,min:[lifts[0],0],max:[0,0],defaults:[0,0],axis_points:[lifts.map(l=>(l-lifts[0])/-lifts[0]),[0]],merge_mode:'Passthrough',bindings};
   const gate=combinedMeshGate({...puppet,param:[parameter]});
   puppet.param=puppet.param.filter(p=>!arms.includes(p));puppet.param.push(parameter);
   const result={status:'needs_review',liftRangePx:[lifts[0],0],garment,gate,attempts,sourceSolves:solves,limitations:['Distal hand frame is constrained; mesh interpolation and source contact require visual review.','Independent arm controls remain unchanged.','Runtime parity and simultaneous body controls require separate validation.']};
   puppet.meta.pairedGrip=result;return result;
  }catch(error){attempts.push({span,status:'rejected',reason:String(error)});}
 }
 puppet.param=puppet.param.filter(p=>!arms.includes(p));
 return {status:'rejected',attempts};
}
