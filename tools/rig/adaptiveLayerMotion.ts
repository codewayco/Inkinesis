import {preparePropInstanceGroups} from './propInstanceGroups';
import {semanticLayer} from './carryPsd2Live';
import {expectedPropCarriers} from './expectedPropCarriers';
/** Source-only candidate selection around the existing ownership-aware rig builder. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildCombined,DEFAULT_BODY_MOTION,type BodyMotionOptions} from './buildCombined';
import type {PoseDump} from './carryPsd2Live';
import type {MotionCapabilities} from '../imageToRig/capabilities';
import type {LimbPoint} from '../../engine/src/body/continuousLimb';
import {inpParts,readInp,writeInp,combinedChains} from './inp';
import {decodePNG} from '../generate/png';
import {preserveFaceTracks} from './preserveFaceTracks';
import {preserveLegacyGarmentControls} from './preserveLegacyGarmentControls';
import {propContactHints} from './propContactHints';
import {rigConfig} from '../imageToRig/config';
import {inferLegPointsFromLayers,type LayerFootprint} from './layerBoundsLegs';
import {guardCoupledLegMotion} from './coupledLegMotion';

export interface CombinedConfig {
 sourcePoses:string;landmarks:string;reference:string;out:string;visibleSeparateLimbs:boolean;longGarment:boolean;
 compactFace?:boolean;headAttachmentSafety?:boolean;capabilities?:MotionCapabilities;
 motionOptions?:BodyMotionOptions;faceReference?:string;preparedPSD?:string;layerLandmarkFallback?:boolean;
}
export interface LayerProposals {known:Record<string,LimbPoint>;alpha:Record<string,LimbPoint>;provenance:Record<string,string>;layers:LayerFootprint[];width:number;height:number}
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function normalizeLimbLayerNames(source:PoseDump,marks:Record<string,LimbPoint>) {
 const dump=structuredClone(source),changes:{from:string;to:string}[]=[];
 if(!marks.ankleL||!marks.ankleR)return {dump,changes};
 for(const p of dump.drawables){
  if(!/^(legwear|footwear)#/.test(p.layer)||!p.rest)continue;
  const xs=p.rest.filter((_,i)=>i%2===0),ys=p.rest.filter((_,i)=>i%2===1).map(y=>dump.coordinateSystem==='canvas-y-down'?y:-y);
  const center={x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2};
  const distance=(q:LimbPoint)=>(q.x-center.x)**2+(q.y-center.y)**2;
  const name=p.layer.split('#')[0]+'-'+(distance(marks.ankleL)<distance(marks.ankleR)?'l':'r');changes.push({from:p.layer,to:name});p.layer=name;
 }
 for(const name of ['legwear-l','legwear-r','footwear-l','footwear-r'])if(dump.drawables.filter(p=>p.layer===name).length>1)throw Error('Ambiguous prepared limb layer: '+name);
 return {dump,changes};
}
export function legCapabilityScore(file:Buffer) {
 const ps=readInp(file).puppet.param.filter(p=>/^Leg [LR]$/.test(p.name));
 return [ps.length,ps.reduce((sum,p)=>sum+Math.min(1,(p.max[0]-p.min[0])/50)+Math.min(1,(p.max[1]-p.min[1])/120),0)];
}
export function containsExistingLimbDomains(candidate:Buffer,baseline:Buffer) {
 const a=readInp(candidate).puppet,b=readInp(baseline).puppet;
 return b.param.filter(p=>/^(Arm|Leg) [LR]$/.test(p.name)).every(p=>{const q=a.param.find(q=>q.name===p.name);return q&&p.min.every((v,i)=>q.min[i]<=v+1e-8)&&p.max.every((v,i)=>q.max[i]>=v-1e-8)});
}
export function boundsProposalUsable(known:Record<string,LimbPoint>,points:Record<string,LimbPoint>) {
 return !((!known.hipL||!known.hipR)&&points.hipL&&points.hipR&&points.hipL.x<=points.hipR.x);
}
export function buildAdaptiveConfig(config:CombinedConfig) {
 const sourceBytes=readFileSync(config.sourcePoses),dump=JSON.parse(sourceBytes.toString()) as PoseDump;
 if(!config.capabilities&&(config.visibleSeparateLimbs!==true||config.longGarment!==false))throw Error('Explicit visible-limb/short-clothing support declaration required');
 const atlases=new Map([...new Set(dump.drawables.map(d=>d.textureFile!))].map(f=>{if(basename(f)!==f)throw Error('Unsafe atlas path');return [f,readFileSync(resolve(dirname(config.sourcePoses),f))];}));
 const analysis=JSON.parse(readFileSync(config.landmarks,'utf8'));
 const scale=Math.max(dump.canvas.width,dump.canvas.height)/Math.max(analysis.source.width,analysis.source.height);
 const ox=(dump.canvas.width-analysis.source.width*scale)/2,oy=(dump.canvas.height-analysis.source.height*scale)/2;
 const known=Object.fromEntries(Object.entries(analysis.points as Record<string,LimbPoint|null>).filter(([,p])=>p).map(([k,p])=>[k,{x:p!.x*scale+ox,y:p!.y*scale+oy}]));
 const reference=decodePNG(new Uint8Array(readFileSync(config.reference)));
 const build=(source:PoseDump,marks:Record<string,LimbPoint>)=>{
  const result=buildCombined(source,atlases,marks,reference,config.compactFace===true,config.headAttachmentSafety===true,config.capabilities,{...config.motionOptions,...((config.motionOptions?.semanticPropGuard??DEFAULT_BODY_MOTION.semanticPropGuard)?{sourceContactHints:propContactHints(analysis.assessment??{})}:{})});
  if(config.faceReference){const ref=readInp(readFileSync(config.faceReference)),next=readInp(result.file);preserveLegacyGarmentControls(next.puppet,ref.puppet,marks);preserveFaceTracks(next.puppet,next.textures,ref.puppet,ref.textures);result.file=writeInp(next.puppet,next.textures);}
  return result;
 };
 const baseline=config.faceReference&&config.layerLandmarkFallback!==false?{file:readFileSync(config.faceReference),report:{preservedReference:true}}:build(dump,known);
 const baselineScore=legCapabilityScore(baseline.file);
 let selected:{file:Buffer;report:Record<string,unknown>;variant:string;score:number[];points:Record<string,LimbPoint>}={...baseline,variant:'original',score:baselineScore,points:known};
 const attempts:unknown[]=[];
 const psd=config.preparedPSD??resolve(dirname(config.sourcePoses),'../../assets/character.psd');
 if(config.layerLandmarkFallback!==false&&existsSync(psd)){
  const prep=spawnSync(rigConfig().python,[resolve(dirname(fileURLToPath(import.meta.url)),'inferLayerPoints.py'),resolve(config.landmarks),psd,String(dump.canvas.width),String(dump.canvas.height)],{encoding:'utf8',maxBuffer:8*1024*1024});
  if(prep.status!==0)throw Error('Layer landmark preparation failed: '+prep.stderr);
  const proposals=JSON.parse(prep.stdout) as LayerProposals;
  const bounds=inferLegPointsFromLayers(proposals.layers,dump.canvas,known).points;
  const boundsMarks={...known,...bounds};
  // Alias resolution is based on the fully supported alpha/source proposal,
  // matching the side labels of the same prepared native meshes in every branch.
  const normalized=normalizeLimbLayerNames(dump,proposals.alpha);
  for(const [variant,marks] of [['alpha',proposals.alpha],['bounds',boundsMarks]] as const){
   if(variant==='bounds'&&!boundsProposalUsable(known,marks)){attempts.push({variant,rejected:'Inferred pelvis reverses anatomical side order'});continue;}
   const added=Object.keys(marks).filter(k=>!known[k]);
   if(!added.length&&!normalized.changes.length){attempts.push({variant,rejected:'No missing points or native layer aliases'});continue;}
   try{
    const result=build(normalized.dump,marks);
    if(!containsExistingLimbDomains(result.file,baseline.file)){attempts.push({variant,rejected:'Existing limb range would shrink'});continue;}
    const guarded=guardCoupledLegMotion(result.file,baseline.file);
    if(guarded.report.rejectedToOriginal||guarded.report.after.status!=='passed'){attempts.push({variant,rejected:'Simultaneous-motion guard',guard:guarded.report});continue;}
    const score=legCapabilityScore(guarded.file);
    attempts.push({variant,score,added,estimatedPoints:Object.fromEntries(added.map(k=>[k,{...marks[k],verified:false}])),aliases:normalized.changes,guard:guarded.report});
    const improves=score[0]>baselineScore[0]||score[0]===baselineScore[0]&&score[1]>baselineScore[1]+1e-8;
    if(improves&&(score[0]>selected.score[0]||score[0]===selected.score[0]&&score[1]>=selected.score[1]))selected={...result,file:guarded.file,variant,score,points:marks};
   }catch(error){attempts.push({variant,rejected:String(error)});}
  }
 }
 // Existing rigs are retained unless unbound physical instances can
 // recover an arm without reducing any existing control domain.
 const propRecovery:{status:string;instances?:unknown;guard?:unknown;reason?:string}={status:'unchanged'};
 const current=readInp(selected.file),marks={...selected.points};
 for(const record of combinedChains(current.puppet)){
  const side=record.name.slice(-1),keys=record.name.startsWith('Leg')?['hip','knee','ankle']:['shoulder','elbow','wrist'];
  for(let i=0;i<3;i++)marks[keys[i]+side]=record.chain[(['root','joint','tip'] as const)[i]];
 }
 const unbound=inpParts(current.puppet).some(n=>/^(objects|prop)$/.test(semanticLayer(n.name))&&!current.puppet.param.some(p=>p.bindings.some(b=>b.node===n.uuid)));
 if(unbound&&(config.motionOptions?.carrySingleHandProps??DEFAULT_BODY_MOTION.carrySingleHandProps))try{
  const preflight=preparePropInstanceGroups(current.puppet,current.textures,marks,propContactHints(analysis.assessment??{}));
  propRecovery.instances=preflight.report;
  if(Object.keys(preflight.owners).length){
   const result=build(normalizeLimbLayerNames(dump,marks).dump,marks);
   const arms=(file:Buffer)=>readInp(file).puppet.param.filter(p=>/^Arm [LR]$/.test(p.name)).length;
   if(!containsExistingLimbDomains(result.file,selected.file))propRecovery.status='rejected-domain-loss';
   else if(arms(result.file)<=arms(selected.file))propRecovery.status='unchanged-no-new-arm';
   else {
    const guarded=guardCoupledLegMotion(result.file,selected.file);propRecovery.guard=guarded.report;
    if(guarded.report.rejectedToOriginal||guarded.report.after.status!=='passed')propRecovery.status='rejected-coupled-gate';
    else{selected={...selected,...result,file:guarded.file,points:marks};propRecovery.status='recovered';}
   }
  }
 }catch(error){propRecovery.status='rejected';propRecovery.reason=String(error);}
 const home=resolve(config.out);mkdirSync(home,{recursive:true});writeFileSync(resolve(home,'character.inp'),selected.file);
 const final=readInp(selected.file).puppet;
 const report={...selected.report,methodVersion:'prop-instance-ownership-20261008',propRecovery,carrierAudit:expectedPropCarriers(final,propContactHints(analysis.assessment??{}),analysis.assessment?.reasons??[]),source:config.sourcePoses,sourceSha256:hash(sourceBytes),outputSha256:hash(selected.file),landmarks:config.landmarks,reference:config.reference,motionCapabilities:final.meta.motionCapabilities,chains:(final.meta.combined as {chains:unknown[]}).chains,layerMotion:{selected:selected.variant,baselineScore,score:selected.score,attempts,estimatedLandmarksAreGroundTruth:false,selection:'Source-only: preserve existing control domains, reject crossed inferred hips, pass ownership and mesh/coupled gates, maximize moving legs then accepted spans.'}};
 writeFileSync(resolve(home,'build.json'),JSON.stringify(report,null,2)+'\n');
 return {file:selected.file,report};
}
