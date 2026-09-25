/** Preserve disconnected native garment panels as one semantic body layer.
 * Meshes are concatenated, never bridged across the transparent opening.
 * Body motion is assigned later by the shared clothing attachment stage.
 */
import {semanticLayer,type PoseDump} from './carryPsd2Live';
export function mergeGarmentComponents(drawables:PoseDump['drawables']):PoseDump['drawables'] {
  const result:PoseDump['drawables']=[];
  const merged=new Set<string>();
  for(const d of drawables){
    const name=semanticLayer(d.layer);
    if(!['topwear','bottomwear'].includes(name)||name===d.layer){result.push(d);continue;}
    if(merged.has(name))continue;
    const group=drawables.filter(p=>semanticLayer(p.layer)===name);
    if(group.some(p=>!p.rest||!p.uvs||p.rest.length!==p.uvs.length||p.textureFile!==d.textureFile||p.opacity!==d.opacity||p.maskedBy?.length||p.invertMask))
      throw new Error('Cannot safely merge native garment panels: '+name);
    const rest:number[]=[],uvs:number[]=[],indices:number[]=[];
    for(const part of group){const offset=rest.length/2;indices.push(...part.indices.map(i=>i+offset));rest.push(...part.rest!);uvs.push(...part.uvs!);}
    result.push({...d,layer:name,rest,uvs,indices});merged.add(name);
  }
  return result;
}
