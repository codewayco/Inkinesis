/** Split triangles by their actually nonzero limb owners. Geometry and all
 * evaluated vertex positions are identical; disjoint lower legs no longer pay
 * the four-axis Cartesian product required only by the blended seat. */
import {inpParts,type InpDocument,type InpNode} from './inp';
export function partitionLimbBindings(puppet:InpDocument) {
 const nodes=inpParts(puppet);let uuid=Math.max(...nodes.map(n=>n.uuid))+1;const report=[];
 for(const node of nodes){
  const owners=puppet.param.filter(p=>p.bindings.some(b=>b.node===node.uuid&&b.param_name==='deform'));
  if(!owners.some(p=>p.name==='Leg L')||!owners.some(p=>p.name==='Leg R'))continue;
  const mesh=node.mesh!,active=owners.map(p=>{const bits=new Uint8Array(mesh.verts.length/2);for(const b of p.bindings.filter(b=>b.node===node.uuid&&b.param_name==='deform'))for(const col of b.values)for(const cell of col)for(const [i,d] of (cell as number[][]).entries())if(d[0]!==0||d[1]!==0)bits[i]=1;return bits;});
  const groups=new Map<string,number[]>();
  for(let t=0;t<mesh.indices.length;t+=3){const tri=mesh.indices.slice(t,t+3),key=active.map(v=>Number(tri.some(i=>v[i]))).join('');if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(...tri);}
  if(groups.size===1){
    const key=[...groups.keys()][0],removed:string[]=[];
    owners.forEach((p,i)=>{if(key[i]==='0'){p.bindings=p.bindings.filter(b=>b.node!==node.uuid||b.param_name!=='deform');removed.push(p.name);}});
    if(removed.length)report.push({source:node.name,originalVertices:mesh.verts.length/2,triangles:mesh.indices.length/3,removedZeroOwners:removed,exactTrianglePartition:true});
    continue;
  }
  const oldBindings=puppet.param.map(p=>({p,bs:p.bindings.filter(b=>b.node===node.uuid)}));
  for(const {p} of oldBindings)p.bindings=p.bindings.filter(b=>b.node!==node.uuid);
  const replacements:InpNode[]=[];
  for(const [key,tris] of groups){
   const ids=[...new Set(tris)],map=new Map(ids.map((v,i)=>[v,i]));
   const clone:InpNode={...node,uuid:replacements.length?uuid++:node.uuid,name:node.name+'__influence_'+key,mesh:{...mesh,verts:ids.flatMap(i=>mesh.verts.slice(2*i,2*i+2)),uvs:ids.flatMap(i=>mesh.uvs.slice(2*i,2*i+2)),indices:tris.map(i=>map.get(i)!)}};
   replacements.push(clone);
   for(const {p,bs} of oldBindings)for(const b of bs){
    const oi=owners.indexOf(p);if(b.param_name==='deform'&&oi>=0&&key[oi]==='0')continue;
    p.bindings.push({...b,node:clone.uuid,values:b.param_name==='deform'?b.values.map(col=>col.map(cell=>ids.map(i=>(cell as number[][])[i]))):b.values});
   }
  }
  // Combined documents are flat. Refuse other topologies instead of silently
  // moving a descendant or invalidating masks.
  const at=puppet.nodes.children!.indexOf(node);if(at<0)throw Error('Limb partition requires a flat document');
  if(nodes.some(n=>n.masks?.some(m=>m.source===node.uuid)))throw Error('Cannot split a clipping source');
  puppet.nodes.children!.splice(at,1,...replacements);
  report.push({source:node.name,originalVertices:mesh.verts.length/2,triangles:mesh.indices.length/3,parts:replacements.map(p=>({id:p.uuid,name:p.name,vertices:p.mesh!.verts.length/2,triangles:p.mesh!.indices.length/3})),exactTrianglePartition:true});
 }
 return report;
}
