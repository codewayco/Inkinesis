/** Repair canvas-midline ownership of visible leg/shoe components, without generating pixels. */
import {inpParts,inpTextures,type InpDocument} from './inp';
import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import {encodePNG} from '../shared/encodePNG';
import type {LimbPoint} from '../../engine/src/body/continuousLimb';
export function repairFootOwnership(puppet:InpDocument,textures:Buffer[],marks:Record<string,LimbPoint>,family:'footwear'|'legwear'='footwear') {
  const feet=inpParts(puppet).filter(p=>new RegExp(`^${family}-[lr]$`).test(p.name));
  if(feet.length!==2)return {status:'skipped',reason:`Two independent ${family} layers required`};
  const {width,height}=puppet.meta.canvas as {width:number;height:number};const tex=inpTextures(textures);
  const meshes=feet.map((n,i)=>({xy:new Float64Array(n.mesh!.verts.map((v,k)=>v+(k%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2).fill(-i),depthOffset:0,opacity:1,texture:tex[n.textures![0]],sampling:'bilinear'} as TexturedMesh));
  const cutoff=family==='legwear'?Math.floor(Math.max(...['L','R'].map(s=>marks['hip'+s].y+.45*(marks['knee'+s].y-marks['hip'+s].y)))):0;
  const originals=family==='legwear'?meshes.map(m=>renderTextured([m],width,height,[0,0,0,0],{selfOverlap:'count'}).rgba):[];
  const rgba=renderTextured(meshes,width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
  const labels=new Int32Array(width*height),queue=new Int32Array(width*height),components:{id:number;count:number;x:number;y:number;owner:string}[]=[];
  for(let start=cutoff*width;start<labels.length;start++) {
    if(labels[start]||rgba[start*4+3]<=8)continue;
    const id=components.length+1;let read=0,write=1,sx=0,sy=0;queue[0]=start;labels[start]=id;
    while(read<write) {
      const p=queue[read++],x=p%width,y=Math.floor(p/width);sx+=x;sy+=y;
      for(const q of [x>0?p-1:-1,x+1<width?p+1:-1,y>0?p-width:-1,y+1<height?p+width:-1])if(q>=cutoff*width&&!labels[q]&&rgba[q*4+3]>8){labels[q]=id;queue[write++]=q;}
    }
    const x=sx/write,y=sy/write;
    const dist=(p:LimbPoint)=>(p.x-x)**2+(p.y-y)**2;
    components.push({id,count:write,x,y,owner:dist(marks.ankleL)<dist(marks.ankleR)?'l':'r'});
  }
  if(!['l','r'].every(s=>components.some(c=>c.owner===s&&c.count>50)))return {status:'skipped',reason:`${family} components touch or ownership is ambiguous`};
  for(const [partIndex,part] of feet.entries()) {
    const side=part.name.at(-1),out=new Uint8ClampedArray(rgba.length);let x0=width,y0=height,x1=0,y1=0;
    for(let p=0;p<labels.length;p++)if((p<cutoff*width&&originals[partIndex][p*4+3]>0)||(labels[p]&&components[labels[p]-1].owner===side)){const src=p<cutoff*width?originals[partIndex]:rgba;out.set(src.subarray(p*4,p*4+4),p*4);const x=p%width,y=Math.floor(p/width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    x0--;y0--;x1++;y1++;
    const nx=Math.ceil((x1-x0)/16),ny=Math.ceil((y1-y0)/16),verts:number[]=[],uvs:number[]=[],indices:number[]=[];
    for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){const px=x0+(x1-x0)*x/nx,py=y0+(y1-y0)*y/ny;verts.push(px-width/2,py-height/2);uvs.push(px/width,py/height);}
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=y*(nx+1)+x,b=a+1,c=a+nx+1,d=c+1;indices.push(a,b,c,b,d,c);}
    part.mesh={verts,uvs,indices,origin:[0,0]};part.textures=[textures.length];textures.push(Buffer.from(encodePNG(out,width,height)));
  }
  return {status:'reassigned',method:'Connected visible semantic components assigned to nearest ankle; upper leg ownership retained above cutoff',family,cutoff,components};
}
