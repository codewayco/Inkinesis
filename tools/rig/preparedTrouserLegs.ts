/** A visible trouser can supply the moving leg surface without a separate skin
 * layer. Require two alpha-separated tubes, supplied joints, native shoes and
 * continuous prepared coverage. Never infer a leg hidden by an intact skirt. */
import {inpParts,inpTextures,type InpDocument,type InpNode} from './inp';
import {legFork} from './clothingAttachments';
import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import type {LimbPoint} from '../../engine/src/body/continuousLimb';
export function preparedTrouserLegs(puppet:InpDocument,textures:Buffer[],marks:Record<string,LimbPoint>) {
 const names=new Set<string>(),report:Record<string,unknown>[]=[];
 if(!['hipL','hipR','kneeL','kneeR','ankleL','ankleR'].every(k=>marks[k]))return {names,report};
 const nodes=inpParts(puppet),bottom=nodes.find(n=>n.name==='bottomwear');if(!bottom)return {names,report};
 const {width,height}=puppet.meta.canvas as {width:number;height:number},decoded=inpTextures(textures);
 const render=(parts:InpNode[])=>renderTextured(parts.map(n=>({xy:new Float64Array(n.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[n.textures![0]],sampling:'bilinear'} as TexturedMesh)),width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
 const rgba=render([bottom]),alpha=(p:LimbPoint)=>{const x=Math.round(p.x),y=Math.round(p.y);return x>=0&&x<width&&y>=0&&y<height?rgba[(y*width+x)*4+3]/255:0;},fork=legFork(alpha,marks);
 if(!fork)return {names,report};
 for(const side of ['L','R']){
  if(nodes.some(n=>n.name==='legwear-'+side.toLowerCase()))continue;
  const shoe=nodes.filter(n=>n.name==='footwear-'+side.toLowerCase());if(!shoe.length)continue;
  const support=render([bottom,...shoe]),points=['hip','knee','ankle'].map(k=>marks[k+side]),radius=Math.max(3,.08*Math.min(Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y),Math.hypot(points[2].x-points[1].x,points[2].y-points[1].y)));
  const probes=[0,1].flatMap(s=>Array.from({length:9},(_,i)=>({x:points[s].x+(points[s+1].x-points[s].x)*i/8,y:points[s].y+(points[s+1].y-points[s].y)*i/8})));
  const supported=probes.every(p=>{for(let y=Math.max(0,Math.floor(p.y-radius));y<Math.min(height,p.y+radius);y++)for(let x=Math.max(0,Math.floor(p.x-radius));x<Math.min(width,p.x+radius);x++)if(support[(y*width+x)*4+3]>128)return true;return false;});
  if(supported){names.add('Leg '+side);report.push({chain:'Leg '+side,source:'bottomwear and native footwear',fork,probes:probes.length,radius,status:'prepared-surface-supported',anatomy:'Supplied joint locations; no hidden anatomy reconstructed'});}
 }
 return {names,report};
}
