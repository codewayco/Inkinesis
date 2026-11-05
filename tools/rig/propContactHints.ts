/** Optional semantic guard from the source analysis already supplied to the
 * pipeline. No new external call and no character-specific names or overrides. */
export interface PropContactHint {mode:'held'|'resting'|'unknown';evidence:string[]}
export function propContactHints(assessment:{regions?:Record<string,{reason?:string}>;reasons?:string[]}) {
 const out:Record<string,PropContactHint>={};
 for(const [side,word] of [['L','left'],['R','right']]){
  const name='Arm '+side,local=assessment.regions?.[name]?.reason??'';
  const lateral=new RegExp('\\b'+word+'\\s+(?:arm|forearm|hand)\\b','i');
  const evidence=[local,...(assessment.reasons??[]).filter(s=>lateral.test(s))].filter(Boolean);
  const resting=evidence.some(s=>/\brest(?:s|ing|ed)?\b.{0,55}\b(?:thigh|hip|lap|seat|chair|stool|table|surface)\b/i.test(s)||/\bhand\b.{0,35}\b(?:overlaps?|on|against)\b.{0,25}\b(?:thigh|hip|lap|seat|chair|stool|table)\b/i.test(s));
  const held=evidence.some(s=>/\b(?:hold(?:ing|s)?|grip(?:ping|s)?|grasp(?:ing|s)?|carr(?:y|ies|ying))\b/i.test(s)&&!/\b(?:not|without)\s+(?:holding|gripping|grasping)\b/i.test(s));
  out[name]={mode:resting&&!held?'resting':held&&!resting?'held':'unknown',evidence};
 }
 return out;
}
