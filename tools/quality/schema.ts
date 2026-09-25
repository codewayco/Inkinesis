/** Uncalibrated visual findings are evidence for review, never automatic rejection. */
export const codes=['cropped_figure','non_frontal','merged_limbs','multiple_characters','hidden_joints','neutral_mismatch','occluder_fill','expression_patch','missing_artwork','seam_exposure','motion_distortion','identity_change','other'] as const;
export type Stage='source'|'layers'|'motion';
export interface Issue {code:typeof codes[number];stage:Stage;severity:'minor'|'major'|'blocking';evidence:string;region:[number,number,number,number];part:string;certainty:'clear'|'uncertain';repair:'source_edit'|'layer_edit'|'mask_or_order'|'none';instruction:string}
export interface Assessment {issues:Issue[];preservedIdentity:'yes'|'no'|'uncertain'|'not_compared';summary:string}
export function parseAssessment(value:unknown):Assessment {
 const a=value as Assessment;
 if(!a||!Array.isArray(a.issues)||a.issues.length>30||typeof a.summary!=='string'||!['yes','no','uncertain','not_compared'].includes(a.preservedIdentity))throw Error('Malformed visual assessment');
 for(const i of a.issues){
  if(!codes.includes(i.code)||!['source','layers','motion'].includes(i.stage)||!['minor','major','blocking'].includes(i.severity)||!['clear','uncertain'].includes(i.certainty)||!['source_edit','layer_edit','mask_or_order','none'].includes(i.repair))throw Error('Invalid issue category');
  if(['evidence','part','instruction'].some(k=>typeof i[k as keyof Issue]!=='string'||String(i[k as keyof Issue]).length>3000))throw Error('Invalid issue text');
  if(!Array.isArray(i.region)||i.region.length!==4||!i.region.every(n=>Number.isFinite(n)&&n>=0&&n<=1)||i.region[0]>=i.region[2]||i.region[1]>=i.region[3])throw Error('Invalid issue region');
  if(i.stage==='source'&&!['source_edit','none'].includes(i.repair))throw Error('Source/layer scope mismatch');
  if(i.stage!=='source'&&i.repair==='source_edit')throw Error('Layer/motion failure cannot trigger a source redraw');
 }
 return a;
}
export function decision(a:Assessment){return a.issues.length?'needs_review':'pass_checks';}
/** Candidate acceptance is provisional: no publication or human-approved status. */
export function compareAssessments(before:Assessment,after:Assessment,target:Issue){
 const key=(i:Issue)=>[i.stage,i.code,i.part].join(':');
 const rank={minor:1,major:2,blocking:3};
 const originals=new Map(before.issues.map(i=>[key(i),rank[i.severity]]));
 const targetBefore=before.issues.filter(i=>key(i)===key(target)).reduce((s,i)=>Math.max(s,rank[i.severity]),0);
 const targetAfter=after.issues.filter(i=>key(i)===key(target)).reduce((s,i)=>Math.max(s,rank[i.severity]),0);
 const reasons=[];
 if(after.preservedIdentity!=='yes')reasons.push('Identity preservation is not established');
 if(targetAfter>=targetBefore)reasons.push('Targeted defect did not improve');
 if(after.issues.some(i=>!originals.has(key(i))||rank[i.severity]>originals.get(key(i))!))reasons.push('New or worsened defect');
 if(after.issues.some(i=>i.certainty==='uncertain'))reasons.push('Candidate has uncertain evidence');
 return {eligibleForReview:reasons.length===0,reasons};
}
