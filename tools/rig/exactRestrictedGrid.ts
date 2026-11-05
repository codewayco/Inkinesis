import type {InpDocument,InpParameter} from './inp';
import {inpParts} from './inp';
import {clipParameterGrid} from './parameterGridClip';
import {combinedMeshGate} from './combinedMeshGate';
import {attachmentMotionGate} from './attachmentMotionGate';
import {evaluateCombined} from '../../player/src/combinedRuntime';
import {sourceGripProbes,sourceGripSlip} from './sourceGripConstraint';
import type {ContinuousLimb} from '../../engine/src/body/continuousLimb';
const sources=new WeakMap<InpParameter,{source:InpParameter;snapshot:string}>();
/** Retain provenance only for an unmodified restricted field. Field selection,
 * width/shoulder replacement and paired-object controls run before adoption. */
export function rememberRestrictedSource(parameter:InpParameter,source:InpParameter){sources.set(parameter,{source:structuredClone(source),snapshot:JSON.stringify(parameter)});}
export function restrictedSource(parameter:InpParameter){const r=sources.get(parameter);return r&&r.snapshot===JSON.stringify(parameter)?r.source:undefined;}
export function applyExactRestrictedGrids(puppet:InpDocument,textures:Buffer[],options:{armMatteCoverage?:boolean}={}){
 const nodes=inpParts(puppet),{width,height}=puppet.meta.canvas as {width:number;height:number};const report=[];
 for(const p of puppet.param){
  if(!/^(Arm|Leg) [LR]$/.test(p.name))continue;const source=restrictedSource(p);
  if(!source){report.push({name:p.name,accepted:false,reason:'No unchanged restricted-field provenance; later field corrections preserved'});continue;}
  try{
   const q=clipParameterGrid(source,p.min,p.max),record=(puppet.meta.combined as {chains:{name:string;chain:ContinuousLimb}[]}).chains.find(r=>r.name===p.name)!;
   const contact=sourceGripProbes({...puppet,param:[p]},textures,p.name,record.chain);
   const asset=(param:InpParameter)=>({puppet:{...puppet,param:[param]},parts:nodes,width,height,textures:[]});const old=asset(p),next=asset(q);
   let maxDeviationPx=0,oldSum=0,newSum=0,count=0,oldMax=0,newMax=0;
   for(const tx of [0,.137,.317,.5,.683,.863,1])for(const ty of [0,.137,.317,.5,.683,.863,1]){
    const values={[p.name]:[p.min[0]+tx*(p.max[0]-p.min[0]),p.min[1]+ty*(p.max[1]-p.min[1])]};const a=evaluateCombined(old,values),b=evaluateCombined(next,values);
    for(let i=0;i<a.length;i++)for(let k=0;k<a[i].xy.length;k++)maxDeviationPx=Math.max(maxDeviationPx,Math.abs(a[i].xy[k]-b[i].xy[k]));
    const x=sourceGripSlip(contact.probes,new Map(a.map(p=>[p.uuid,p.xy]))),y=sourceGripSlip(contact.probes,new Map(b.map(p=>[p.uuid,p.xy])));oldSum+=x.sum;newSum+=y.sum;count+=x.count;oldMax=Math.max(oldMax,x.max);newMax=Math.max(newMax,y.max);
   }
   const evidence={name:p.name,range:[p.min,p.max],oldKeys:p.axis_points.map(a=>a.length),newKeys:q.axis_points.map(a=>a.length),maxDeviationPx,sourceContact:{hasCarrier:contact.hasCarrier,probes:contact.probes.length,oldMean:oldSum/Math.max(1,count),newMean:newSum/Math.max(1,count),oldMax,newMax}};
   if(maxDeviationPx>.5){report.push({...evidence,accepted:false,reason:'Subpixel source-fidelity budget exceeded (0.5px)'});continue;}
   if(contact.hasCarrier&&(!contact.probes.length||newSum/Math.max(1,count)>oldSum/Math.max(1,count)+.001||newMax>oldMax+.001)){report.push({...evidence,accepted:false,reason:'Source hand-carrier contact regression'});continue;}
   const doc={...puppet,param:[q]};const mesh=combinedMeshGate(doc),attachment=attachmentMotionGate(doc,textures,p.name as 'Arm L'|'Arm R',{armMatteCoverage:options.armMatteCoverage});
   if(attachment.status!=='passed'){report.push({...evidence,accepted:false,reason:'Existing attachment gate failed',attachment});continue;}
   Object.assign(p,q);report.push({...evidence,accepted:true,mesh,attachment,scope:'Same chosen field and physical range; source keys retained exactly inside restricted domain.49 independent source states bound coordinate changes below0.5px and contact regression below0.001px. Full runtime/visual validation remains required.'});
  }catch(e){report.push({name:p.name,accepted:false,reason:String(e)});}
 }
 return report;
}
