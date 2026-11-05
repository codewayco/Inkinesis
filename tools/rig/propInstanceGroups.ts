/** Source-only instance recovery. Layer identity is not physical object identity.
 * Never infer a grasp from proximity alone; require material contact plus a
 * semantic grasp or isolation. Ambiguous shared objects remain with the paired gate. */
import {inpParts,inpTextures,type InpDocument,type InpNode} from './inp';
import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import {canvasMesh} from './clothingAttachments';
import {heldPropComponents} from './motionCapabilities';
import {isolatedPropContact} from './isolatedPropContact';
import {semanticLayer} from './carryPsd2Live';
import {encodePNG} from '../shared/encodePNG';
import type {LimbPoint} from '../../engine/src/body/continuousLimb';
import type {PropContactHint} from './propContactHints';

export function alphaInstanceGroups(rgba:Uint8ClampedArray,w:number,h:number,gap:number) {
 const labels=new Int32Array(w*h),queue=new Int32Array(w*h),parent=[0];let count=0;
 const find=(n:number):number=>parent[n]===n?n:(parent[n]=find(parent[n]));
 for(let start=0;start<labels.length;start++){
  if(labels[start]||rgba[4*start+3]<=8)continue;
  const id=++count;parent[id]=id;labels[start]=id;let rd=0,wr=1;queue[0]=start;
  while(rd<wr){const p=queue[rd++],x=p%w,y=Math.floor(p/w);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;const q=yy*w+xx;if(!labels[q]&&rgba[4*q+3]>8){labels[q]=id;queue[wr++]=q;}}
  }
 }
 // Join only short pixel gaps; never merge the two sides just because the PSD
 // contains both in one layer. The radius scales with canvas resolution.
 const grown=labels.slice(),dist=new Int16Array(w*h);let rd=0,wr=0;
 for(let p=0;p<labels.length;p++)if(labels[p])queue[wr++]=p;
 while(rd<wr){const p=queue[rd++],x=p%w,y=Math.floor(p/w);if(dist[p]>=gap)continue;
  for(const q of [x?p-1:-1,x+1<w?p+1:-1,y?p-w:-1,y+1<h?p+w:-1]){if(q<0)continue;if(!grown[q]){grown[q]=grown[p];dist[q]=dist[p]+1;queue[wr++]=q;}else if(grown[q]!==grown[p]&&dist[p]+dist[q]<gap){const a=find(grown[p]),b=find(grown[q]);if(a!==b)parent[b]=a;}}
 }
 const groups=new Map<number,number[]>();
 for(let p=0;p<labels.length;p++)if(rgba[4*p+3]>0){const k=grown[p]?find(grown[p]):0;if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(p);}
 return [...groups.values()];
}

export function preparePropInstanceGroups(puppet:InpDocument,textures:Buffer[],marks:Record<string,LimbPoint>,hints?:Record<string,PropContactHint>) {
 const nodes=inpParts(puppet),decoded=inpTextures(textures),{width,height}=puppet.meta.canvas as {width:number;height:number};
 const render=(parts:InpNode[])=>renderTextured(parts.map(n=>({xy:new Float64Array(n.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[n.textures![0]],sampling:'bilinear'} as TexturedMesh)),width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
 const arms=['L','R'].filter(s=>marks['shoulder'+s]&&marks['elbow'+s]&&marks['wrist'+s]).map(side=>({side,rgba:render(nodes.filter(n=>new RegExp(`^(arm|hand|handwear)-${side.toLowerCase()}$`).test(n.name)))}));
 const owners:Record<number,string>={},report:Record<string,unknown>[]=[];let uuid=Math.max(...nodes.map(n=>n.uuid))+1;
 const sources=nodes.filter(n=>/^(objects|prop)$/.test(semanticLayer(n.name))&&n.mesh?.indices.length);
 for(const node of sources){
  const rgba=render([node]);
  const held=arms.map(a=>({...a,r:heldPropComponents(a.rgba,rgba,width,height,marks['elbow'+a.side],marks['wrist'+a.side])})).filter(a=>a.r.matches.length);
  if(held.length===1&&held[0].r.pieces.every((p,i)=>p.area<=8||held[0].r.matches.some(m=>m.component===i+1)))continue;
  const clusters=alphaInstanceGroups(rgba,width,height,Math.max(2,Math.round(Math.min(width,height)*.004)));
  const accepted:{pixels:number[];owner:string;detail:Record<string,unknown>}[]=[];
  for(const pixels of clusters){
   if(pixels.length<=8)continue;
   const mask=new Uint8ClampedArray(rgba.length);for(const p of pixels)mask.set(rgba.subarray(4*p,4*p+4),4*p);
   const contacts=arms.map(a=>({...a,r:heldPropComponents(a.rgba,mask,width,height,marks['elbow'+a.side],marks['wrist'+a.side])})).filter(a=>a.r.matches.length);
   if(contacts.length!==1)continue;
   const side=contacts[0].side,owner='Arm '+side,hint=hints?.[owner];if(hint?.mode==='resting')continue;
   const root=marks['shoulder'+side],joint=marks['elbow'+side],tip=marks['wrist'+side],length=Math.hypot(joint.x-root.x,joint.y-root.y)+Math.hypot(tip.x-joint.x,tip.y-joint.y);
   const other=nodes.filter(n=>n!==node&&!/^(objects|prop)$/.test(semanticLayer(n.name))&&!new RegExp(`^(arm|hand|handwear)-${side.toLowerCase()}$`).test(n.name)&&n.enabled!==false&&(n.opacity??1)>.05);
   const isolated=isolatedPropContact(mask,render(other),.6*length*length);
   if(hint?.mode!=='held'&&!isolated.passed)continue;
   accepted.push({pixels,owner,detail:{area:pixels.length,isolated,semantic:hint?.mode,contact:contacts[0].r.matches.reduce((s,m)=>s+m.contact,0)}});
  }
  if(!accepted.length)continue;
  // No texture or face-driver mutation on unusual source topologies.
  if(node.masks?.length||nodes.some(n=>n.masks?.some(m=>m.source===node.uuid))||puppet.param.some(p=>p.bindings.some(b=>b.node===node.uuid))) {report.push({node:node.name,status:'rejected-bound-or-masked-source'});continue;}
  const assigned=new Set(accepted.flatMap(a=>a.pixels)),remainder=new Uint8ClampedArray(rgba);
  for(const p of assigned)remainder.fill(0,4*p,4*p+4);
  if(accepted.length===1&&assigned.size===rgba.filter((_,i)=>i%4===3).filter(a=>a>0).length){
   const a=accepted[0];owners[node.uuid]=a.owner;
   report.push({source:node.name,node:node.name,owner:a.owner,status:'physical-instance-carrier',preservesOriginalGeometry:true,...a.detail});
   continue;
  }
  const replacements:InpNode[]=[];
  const add=(pixels:Uint8ClampedArray,name:string,id:number)=>{const n={...node,uuid:id,name,mesh:canvasMesh(pixels,width,height),textures:[textures.length]};textures.push(Buffer.from(encodePNG(pixels,width,height)));replacements.push(n);return n;};
  const hasRest=remainder.some((v,i)=>i%4===3&&v>0);
  if(hasRest)add(remainder,node.name,node.uuid);
  for(const [i,a] of accepted.entries()){
   const mask=new Uint8ClampedArray(rgba.length);for(const p of a.pixels)mask.set(rgba.subarray(4*p,4*p+4),4*p);
   const n=add(mask,`objects#${10000+node.uuid*100+i}:${a.owner.endsWith('L')?'l':'r'}`,!hasRest&&i===0?node.uuid:uuid++);owners[n.uuid]=a.owner;
   report.push({source:node.name,node:n.name,owner:a.owner,status:'physical-instance-carrier',...a.detail});
  }
  const at=puppet.nodes.children!.indexOf(node);if(at<0)throw Error('Instance grouping requires a flat document');puppet.nodes.children!.splice(at,1,...replacements);
 }
 return {owners,report};
}
