/** Pixel-scope guards for explicit isolated repair candidates. */
import {decodePNG} from '../generate/png';
import {encodePNG} from '../shared/encodePNG';
import {readInp,writeInp,inpParts} from '../rig/inp';
export type Region=[number,number,number,number];
export function scopedEdit(original:Buffer,edited:Buffer,region:Region){
 const a=decodePNG(original),b=decodePNG(edited);if(a.width!==b.width||a.height!==b.height)throw Error('Edit changed image dimensions');
 const [x0,y0,x1,y1]=region;if(!region.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||x0>=x1||y0>=y1)throw Error('Invalid scope');
 const out=new Uint8ClampedArray(a.rgba);let changed=0,allowed=0;
 for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)if(x/a.width>=x0&&(x+1)/a.width<=x1&&y/a.height>=y0&&(y+1)/a.height<=y1){
  allowed++;const at=(y*a.width+x)*4;if([0,1,2,3].some(k=>a.rgba[at+k]!==b.rgba[at+k]))changed++;
  out.set(b.rgba.subarray(at,at+4),at);
 }
 return {png:encodePNG(out,a.width,a.height),changedPixels:changed,allowedPixels:allowed,outsideScopeChanged:0};
}
export function editMask(image:Buffer,region:Region){const im=decodePNG(image),v=new Uint8ClampedArray(im.rgba.length);for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){const inside=x/im.width>=region[0]&&(x+1)/im.width<=region[2]&&y/im.height>=region[1]&&(y+1)/im.height<=region[3];v[(y*im.width+x)*4+3]=inside?0:255;}return encodePNG(v,im.width,im.height);}
/** Copy only changed prepared-layer pixels into a PRIVATE copy of that part's atlas.
 * All parameters, meshes, draw order and other textures stay byte-identical. */
export function replaceLayerPixels(inp:Buffer,partName:string,originalLayer:Buffer,editedLayer:Buffer){
 const {puppet,textures}=readInp(inp),before=structuredClone(puppet),matches=inpParts(puppet).filter(n=>n.name===partName);
 if(matches.length!==1)throw Error('Repair needs exactly one semantic part');
 const part=matches[0],mesh=part.mesh!,canvas=puppet.meta.canvas as {width:number;height:number};
 const original=decodePNG(originalLayer),edited=decodePNG(editedLayer);
 if(original.width!==edited.width||original.height!==edited.height)throw Error('Layer size changed');
 const atlas=decodePNG(textures[part.textures![0]]),out=new Uint8ClampedArray(atlas.rgba);let changed=0;
 const edge=(ax:number,ay:number,bx:number,by:number,x:number,y:number)=>(bx-ax)*(y-ay)-(by-ay)*(x-ax);
 for(let t=0;t<mesh.indices.length;t+=3){
  const ids=mesh.indices.slice(t,t+3),p=ids.map(i=>[mesh.uvs[i*2]*atlas.width,mesh.uvs[i*2+1]*atlas.height]);
  const area=edge(...p[0] as [number,number],...p[1] as [number,number],...p[2] as [number,number]);if(Math.abs(area)<1e-8)continue;
  const lowX=Math.max(0,Math.floor(Math.min(...p.map(v=>v[0])))),hiX=Math.min(atlas.width-1,Math.ceil(Math.max(...p.map(v=>v[0]))));
  const lowY=Math.max(0,Math.floor(Math.min(...p.map(v=>v[1])))),hiY=Math.min(atlas.height-1,Math.ceil(Math.max(...p.map(v=>v[1]))));
  for(let y=lowY;y<=hiY;y++)for(let x=lowX;x<=hiX;x++){
   const w=[edge(...p[1] as [number,number],...p[2] as [number,number],x+.5,y+.5)/area,edge(...p[2] as [number,number],...p[0] as [number,number],x+.5,y+.5)/area,edge(...p[0] as [number,number],...p[1] as [number,number],x+.5,y+.5)/area];
   if(w.some(v=>v< -1e-6))continue;
   const sx=Math.max(0,Math.min(original.width-1,Math.floor((w.reduce((s,v,k)=>s+v*mesh.verts[ids[k]*2],0)+canvas.width/2)/canvas.width*original.width)));
   const sy=Math.max(0,Math.min(original.height-1,Math.floor((w.reduce((s,v,k)=>s+v*mesh.verts[ids[k]*2+1],0)+canvas.height/2)/canvas.height*original.height)));
   const from=(sy*original.width+sx)*4,to=(y*atlas.width+x)*4;
   if([0,1,2,3].some(k=>original.rgba[from+k]!==edited.rgba[from+k])){out.set(edited.rgba.subarray(from,from+4),to);changed++;}
  }
 }
 if(!changed)throw Error('Repair did not affect represented part pixels');
 part.textures=[textures.length,...part.textures!.slice(1)];textures.push(encodePNG(out,atlas.width,atlas.height));
 const normalized=structuredClone(puppet);inpParts(normalized).find(n=>n.uuid===part.uuid)!.textures=inpParts(before).find(n=>n.uuid===part.uuid)!.textures;
 if(JSON.stringify(before)!==JSON.stringify(normalized))throw Error('Protected motion/geometry changed');
 return {file:writeInp(puppet,textures),changedAtlasPixels:changed,allParametersAndGeometryUnchanged:true,otherTexturesUnchanged:true};
}
