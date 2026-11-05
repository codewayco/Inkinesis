import type {InpNode} from './inp';import type {ContinuousLimb} from '../../engine/src/body/continuousLimb';
/** Tessellate across the distal-half boundary without cutting the connected
 * surface. New edge vertices are shared and UVs interpolated on the old edge.
 * Triangles wholly in the rigid grasp region then translate exactly instead
 * of interpolating a proximal forearm vertex into an otherwise rigid hand. */
export function refineGripBoundary(mesh:NonNullable<InpNode['mesh']>,chain:ContinuousLimb,width:number,height:number) {
 const verts=[...mesh.verts],uvs=[...mesh.uvs],indices:number[]=[],edgeCache=new Map<string,number>();
 const dx=chain.tip.x-chain.joint.x,dy=chain.tip.y-chain.joint.y,l2=dx*dx+dy*dy;
 if(l2<1)throw Error('Cannot refine a degenerate forearm');
 const distance=Array.from({length:verts.length/2},(_,i)=>((verts[i*2]+width/2-chain.joint.x)*dx+(verts[i*2+1]+height/2-chain.joint.y)*dy)/l2-.5);
 const edge=(a:number,b:number)=>{
  if(Math.abs(distance[a])<1e-10)return a;if(Math.abs(distance[b])<1e-10)return b;
  const key=[Math.min(a,b),Math.max(a,b)].join(':');if(edgeCache.has(key))return edgeCache.get(key)!;
  const t=distance[a]/(distance[a]-distance[b]),id=verts.length/2;
  for(let k=0;k<2;k++){verts.push(mesh.verts[a*2+k]+t*(mesh.verts[b*2+k]-mesh.verts[a*2+k]));uvs.push(mesh.uvs[a*2+k]+t*(mesh.uvs[b*2+k]-mesh.uvs[a*2+k]));}
  distance.push(0);edgeCache.set(key,id);return id;
 };
 for(let i=0;i<mesh.indices.length;i+=3){const tri=mesh.indices.slice(i,i+3),ds=tri.map(i=>distance[i]);
  if(Math.min(...ds)>=-1e-10||Math.max(...ds)<=1e-10){indices.push(...tri);continue;}
  for(const sign of [-1,1]){
   const polygon:number[]=[];
   for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],insideA=distance[a]*sign>=0,insideB=distance[b]*sign>=0;if(insideA)polygon.push(a);if(insideA!==insideB)polygon.push(edge(a,b));}
   const clean=polygon.filter((id,j)=>j===0||id!==polygon[j-1]);if(clean.length>1&&clean[0]===clean.at(-1))clean.pop();
   for(let j=1;j+1<clean.length;j++){const [a,b,c]=[clean[0],clean[j],clean[j+1]],area=(verts[2*b]-verts[2*a])*(verts[2*c+1]-verts[2*a+1])-(verts[2*b+1]-verts[2*a+1])*(verts[2*c]-verts[2*a]);if(Math.abs(area)>1e-12)indices.push(a,b,c);}
  }
 }
 return {mesh:{...mesh,verts,uvs,indices},addedVertices:verts.length/2-mesh.verts.length/2,addedTriangles:(indices.length-mesh.indices.length)/3};
}
