/** Upgrade a body's rig while retaining its existing face animation.
 * This is allowed only for identical face meshes, textures and parameter grids;
 * it never projects an old face onto a different character. */
import {inpParts,type InpDocument} from './inp';
import {faceLayers} from './motionCapabilities';
import {semanticLayer} from './carryPsd2Live';
export function preserveFaceTracks(puppet:InpDocument,textures:Buffer[],reference:InpDocument,referenceTextures:Buffer[]) {
 const old=inpParts(reference).filter(n=>faceLayers.test(semanticLayer(n.name))),next=inpParts(puppet).filter(n=>faceLayers.test(semanticLayer(n.name)));
 if(old.length!==next.length)throw Error('Face part inventory differs');
 const map=new Map<number,number>();
 for(const p of old){const n=next.find(q=>q.name===p.name);if(!n||JSON.stringify(n.mesh)!==JSON.stringify(p.mesh)||!textures[n.textures![0]].equals(referenceTextures[p.textures![0]]))throw Error('Face reference is not the identical prepared artwork: '+p.name);map.set(p.uuid,n.uuid);}
 const targets=new Set(map.values()),grid=(p:InpDocument['param'][number])=>JSON.stringify([p.is_vec2,p.min,p.max,p.defaults,p.axis_points,p.merge_mode]);
 let changedBindings=0;const controls=[];
 for(const p of reference.param){
  const bindings=p.bindings.filter(b=>map.has(b.node));if(!bindings.length)continue;
  if(!/^(Head Angles|ParamAngle|ParamEye|ParamBrow|ParamMouth|ParamBodySway|Viseme)/.test(p.name))throw Error('Unexpected face control '+p.name);
  const q=puppet.param.find(q=>q.name===p.name);if(!q)throw Error('Missing face reference control: '+p.name);
  if(grid(q)!==grid(p)){if(q.bindings.some(b=>!targets.has(b.node)))throw Error('Cannot change a face grid shared with body bindings: '+p.name);Object.assign(q,{...structuredClone(p),uuid:q.uuid,bindings:q.bindings});changedBindings++;}
  const keys=new Set(bindings.map(b=>map.get(b.node)+'/'+b.param_name));
  const extras=q.bindings.filter(b=>targets.has(b.node)&&!keys.has(b.node+'/'+b.param_name));
  if(extras.length){changedBindings+=extras.length;q.bindings=q.bindings.filter(b=>!extras.includes(b));}
  for(const b of bindings){const copy={...structuredClone(b),node:map.get(b.node)!},at=q.bindings.findIndex(t=>t.node===copy.node&&t.param_name===copy.param_name);if(at<0){q.bindings.push(copy);changedBindings++;continue;}if(JSON.stringify(q.bindings[at])!==JSON.stringify(copy)){q.bindings[at]=copy;changedBindings++;}}
  controls.push(p.name);
 }
 for(const p of puppet.param)if(p.bindings.some(b=>targets.has(b.node))&&!controls.includes(p.name))throw Error('Face has an extra unreferenced control '+p.name);
 return {status:'preserved',parts:old.length,controls,changedBindings,scope:'Exact face texture/mesh identity and reference binding grids; body bindings and topology are retained'};
}
