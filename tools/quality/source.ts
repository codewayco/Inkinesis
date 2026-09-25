/** Opt-in pipeline source assessment/repair; original input is always retained. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {sha,judge,POLICY} from './vision';
import {Ledger} from './ledger';
import {compareAssessments,decision} from './schema';
import {editCandidate} from './edit';
export async function sourceQuality(input:string,home:string,mode:'observe'|'repair',intent:string,allowEdit:boolean){
 mkdirSync(home,{recursive:true});const signature=sha(JSON.stringify({input:sha(readFileSync(input)),mode,intent,allowEdit,policy:POLICY})),resultPath=home+'/result.json';
 if(existsSync(resultPath)){const r=JSON.parse(readFileSync(resultPath,'utf8'));if(r.signature!==signature||sha(readFileSync(r.selected))!==r.selectedSha256)throw Error('Source quality cache mismatch');return r;}
 const ledger=new Ledger(home+'/journal.json',signature);let selected=input;
 try{
 let current=await judge([{label:'Original character source',path:input}],home+'/initial.json',ledger,'Source suitability only; no prepared layers or motion are shown. Intent to preserve: '+intent);
 const original=current,attempts=[];
 while(mode==='repair'&&allowEdit){
  const target=current.issues.find(i=>i.stage==='source'&&i.certainty==='clear'&&i.severity!=='minor'&&i.repair==='source_edit'&&!['multiple_characters','hidden_joints'].includes(i.code));
  if(!target)break;
  const n=ledger.snapshot().entries.filter(e=>e.operation==='source').length;if(n>=2)break;
  const candidate=home+'/candidate-'+n+'.png';
  try{
   await editCandidate(selected,candidate,target.region,target.instruction+' Preserve this requested intent: '+intent,'source',ledger);
   const after=await judge([{label:'Immutable original identity/reference',path:input},{label:'Current source before correction',path:selected},{label:'Proposed corrected source',path:candidate}],home+'/candidate-'+n+'.json',ledger,'Source comparison only. Target: '+JSON.stringify(target));
   const acceptance=compareAssessments(current,after,target);attempts.push({candidate,target,acceptance});
   if(!acceptance.eligibleForReview)break;
   selected=candidate;current=after;
  }catch(error){attempts.push({target,status:'failed',reason:error instanceof Error?error.message:'Error'});break;}
 }
 const result={signature,mode,originalInput:input,selected,selectedSha256:sha(readFileSync(selected)),status:decision(current),initial:original,assessment:current,attempts,humanApproved:false,requiresRigReview:selected!==input,stopBeforeRig:mode==='repair'&&current.issues.some(i=>i.stage==='source'&&i.severity==='blocking'&&i.certainty==='clear'),limits:ledger.snapshot().limits};
 writeFileSync(resultPath,JSON.stringify(result,null,2)+'\n');return result;
 }finally{ledger.close();}
}
