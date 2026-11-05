import {it,expect} from 'vitest';import {refineGripBoundary} from '../refineGripBoundary';import type {ContinuousLimb} from '../../../engine/src/body/continuousLimb';
const chain:ContinuousLimb={root:{x:-10,y:0},joint:{x:0,y:0},tip:{x:10,y:0},rootBlend:6,jointBlend:4.5};
const mesh={verts:[0,0,10,0,10,10,0,10],uvs:[0,0,1,0,1,1,0,1],indices:[0,1,2,0,2,3],origin:[0,0]};
it('retains area,winding and affine UV mapping while triangles stop crossing the grip boundary',()=>{
 const r=refineGripBoundary(mesh,chain,0,0),m=r.mesh;let area=0;
 for(let i=0;i<m.verts.length/2;i++){expect(m.uvs[2*i]).toBeCloseTo(m.verts[2*i]/10,12);expect(m.uvs[2*i+1]).toBeCloseTo(m.verts[2*i+1]/10,12);}
 for(let i=0;i<m.indices.length;i+=3){const [a,b,c]=m.indices.slice(i,i+3),xs=[a,b,c].map(i=>m.verts[2*i]);expect(Math.min(...xs)>=5||Math.max(...xs)<=5).toBe(true);const v=m.verts,signed=(v[2*b]-v[2*a])*(v[2*c+1]-v[2*a+1])-(v[2*b+1]-v[2*a+1])*(v[2*c]-v[2*a]);expect(signed).toBeGreaterThan(0);area+=signed/2;}
 expect(area).toBeCloseTo(100,12);expect(r.addedVertices).toBe(3);expect(mesh.verts).toHaveLength(8);
});
it('shares intersections across neighboring triangles and preserves a connected surface',()=>{
 const m=refineGripBoundary(mesh,chain,0,0).mesh,edges=new Map<string,number>();
 for(let i=0;i<m.indices.length;i+=3){const t=m.indices.slice(i,i+3);for(let j=0;j<3;j++){const key=[t[j],t[(j+1)%3]].sort((a,b)=>a-b).join(':');edges.set(key,(edges.get(key)??0)+1);}}
 expect([...edges.values()].every(n=>n===1||n===2)).toBe(true);
 const boundaryEdges=[...edges].filter(([key])=>key.split(':').every(i=>m.verts[Number(i)*2]===5));expect(boundaryEdges).toHaveLength(2);expect(boundaryEdges.every(([,n])=>n===2)).toBe(true);
});
it('does not duplicate boundary vertices or change an already refined mesh',()=>{
 const a=refineGripBoundary(mesh,chain,0,0),b=refineGripBoundary(a.mesh,chain,0,0);expect(b.addedVertices).toBe(0);expect(b.mesh).toEqual(a.mesh);
});
