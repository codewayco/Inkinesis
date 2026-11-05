/** Source evidence is independent of layer labels. Missing support is a review
 * result, never silently certified by a low motion/foldover score. */
import {inpParts,type InpDocument} from './inp';
import {semanticLayer} from './carryPsd2Live';
import type {PropContactHint} from './propContactHints';
export function expectedPropCarriers(puppet:InpDocument,hints:Record<string,PropContactHint>,sourceReasons:string[]=[]){
 const props=inpParts(puppet).filter(n=>/^(objects|prop)$/.test(semanticLayer(n.name)));
 const active=puppet.param.filter(p=>p.min.some((v,i)=>v!==p.max[i]));
 const bound=new Set(active.flatMap(p=>p.bindings.filter(b=>b.param_name==='deform'&&props.some(n=>n.uuid===b.node)).map(b=>b.node)));
 const supported=new Set(active.filter(p=>p.bindings.some(b=>bound.has(b.node))).map(p=>p.name));
 const held=sourceReasons.filter(s=>/\b(?:hold(?:ing|s)?|grip(?:ping|s)?|grasp(?:ing|s)?|carr(?:y|ies|ying))\b/i.test(s)&&!/\b(?:not|without)\s+(?:holding|gripping|grasping)\b/i.test(s));
 const expected=Object.entries(hints).filter(([,h])=>h.mode==='held').map(([name])=>name);
 const pluralGrasp=held.some(s=>/\b(?:both\s+hands|hands\s+(?:hold(?:ing)?|grip(?:ping)?|grasp(?:ing)?))\b/i.test(s));
 if(pluralGrasp)for(const hand of ['Arm L','Arm R'])if(!expected.includes(hand))expected.push(hand);
 const warnings:{code:string;evidence:string[];hand?:string}[]=[];
 if(held.length&&!bound.size)warnings.push({code:'source-grasp-without-carrier',evidence:held});
 for(const name of expected)if(!supported.has(name)&&!active.some(p=>/paired|grip/i.test(p.name)&&p.bindings.some(b=>bound.has(b.node))))warnings.push({code:'held-hand-without-active-carrier',hand:name,evidence:hints[name]?.evidence??held});
 return {status:warnings.length?'review-required':held.length||expected.length?'supported':'no-explicit-source-expectation',reviewRequired:!!warnings.length,expectedHands:expected,propLayers:props.length,activeCarrierNodes:[...bound],warnings,scope:'Source-evidence consistency check; does not prove every visible held pixel was segmented or carried.'};
}
