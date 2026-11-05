import {clothingAttachments,type ClothingAttachmentOptions} from './clothingAttachments';
import {attachmentMotionGate} from './attachmentMotionGate';
import type {InpDocument} from './inp';
import type {LimbPoint} from '../../engine/src/body/continuousLimb';
/** Retry only a failed static-garment ownership check. Existing owner labels
 * take precedence; matching source material is evidence, not a relaxed gate. */
export function clothingAttachmentsWithRecovery(puppet:InpDocument,textures:Buffer[],marks:Record<string,LimbPoint>,options:ClothingAttachmentOptions&{recoverSleeveMaterial?:boolean}){
 const before=options.recoverSleeveMaterial?structuredClone(puppet):undefined,beforeTextures=options.recoverSleeveMaterial?[...textures]:undefined;
 const original=clothingAttachments(puppet,textures,marks,options);
 if(!before)return original;
 const names=puppet.param.filter(p=>/^Arm [LR]$/.test(p.name)).map(p=>p.name as 'Arm L'|'Arm R');
 const first=names.map(name=>({name,result:attachmentMotionGate(puppet,textures,name,{armMatteCoverage:true})}));
 const failed=first.filter(r=>r.result.maxUnownedDisplacement>r.result.tolerance).map(r=>r.name);
 if(!failed.length)return {...original,recovery:{status:'not-needed',candidates:[]}};
 const trialTextures=[...beforeTextures!],trial=clothingAttachments(before,trialTextures,marks,{...options,recoveryArms:failed});
 const after=names.map(name=>({name,result:attachmentMotionGate(before,trialTextures,name,{armMatteCoverage:true})}));
 const accepted=after.every(r=>r.result.status==='passed'||!failed.includes(r.name)&&first.find(q=>q.name===r.name)!.result.status!=='passed');
 if(!accepted)return {...original,recovery:{status:'rejected',candidates:failed,before:first,after}};
 const oldCombined=puppet.meta.combined as {chains:Record<string,unknown>[]},newCombined=before.meta.combined as {chains:Record<string,unknown>[]};
 for(const record of oldCombined.chains){const replacement=newCombined.chains.find(r=>r.name===record.name);if(replacement)Object.assign(record,replacement);}
 puppet.nodes=before.nodes;puppet.param=before.param;puppet.meta.clothingAttachments=before.meta.clothingAttachments;textures.splice(0,textures.length,...trialTextures);
 return {...trial,recovery:{status:'needs-review',candidates:failed,before:first,after,scope:'Source RGB or saturated hue agreement; unchanged attachment gate. Mesh,runtime and appearance checks still required.'}};
}
