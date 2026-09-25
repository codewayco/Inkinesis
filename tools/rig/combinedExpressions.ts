/** Local, declared expression repair: keep closed-eye edits inside the actual eye region. */
import {decodePNG} from '../generate/png';
import {encodePNG} from '../shared/encodePNG';
import {inpParts,type InpDocument} from './inp';
export interface ExpressionRepair {part:string;kind:string;roi?:number[];padding?:number;feather?:number;geometryUnchanged?:boolean}
export function constrainClosedEyes(puppet:InpDocument,textures:Buffer[],allowMissing=false) {
  const parts=inpParts(puppet),canvas=puppet.meta.canvas as {width:number;height:number};
  const reports:ExpressionRepair[]=[];
  for(const side of ['l','r']) {
    const closed=parts.find(p=>p.name===`eye_close-${side}`);
    const open=parts.filter(p=>new RegExp(`^(eyelash|eyewhite|irides)-${side}$`).test(p.name));
    if(!closed?.mesh){
      if(open.length&&!allowMissing)throw new Error('Missing measured closed-eye geometry');
      reports.push({part:`eye_close-${side}`,kind:'No independent open or closed eye artwork; source appearance only, blink unsupported'});
      continue;
    }
    if(!open.length){reports.push({part:closed.name,kind:'unchanged: eye artwork baked into source face; no independent feature ROI'});continue;}
    const bounds=(v:number[])=>[Math.min(...v.filter((_,i)=>i%2===0)),Math.min(...v.filter((_,i)=>i%2===1)),Math.max(...v.filter((_,i)=>i%2===0)),Math.max(...v.filter((_,i)=>i%2===1))];
    const box=bounds(open.flatMap(p=>p.mesh!.verts));
    const roi=[box[0]-4,box[1]-4,box[2]+4,box[3]+4];
    const b=bounds(closed.mesh.verts),uv=bounds(closed.mesh.uvs);
    const texture=decodePNG(new Uint8Array(textures[closed.textures![0]]));
    for(let y=0;y<texture.height;y++)for(let x=0;x<texture.width;x++) {
      const u=x/texture.width,v=y/texture.height,i=(y*texture.width+x)*4+3;
      if(u<uv[0]||u>uv[2]||v<uv[1]||v>uv[3]){texture.rgba[i]=0;continue;}
      const px=b[0]+(u-uv[0])/(uv[2]-uv[0])*(b[2]-b[0]),py=b[1]+(v-uv[1])/(uv[3]-uv[1])*(b[3]-b[1]);
      const edge=Math.min(px-roi[0],roi[2]-px,py-roi[1],roi[3]-py);
      texture.rgba[i]=Math.round(texture.rgba[i]*Math.min(1,Math.max(0,edge/3)));
    }
    closed.textures=[textures.length,0xffffffff,0xffffffff];
    textures.push(Buffer.from(encodePNG(texture.rgba,texture.width,texture.height)));
    reports.push({part:closed.name,kind:'alpha-only eye ROI constraint',roi:roi.map((v,i)=>v+(i%2?canvas.height:canvas.width)/2),padding:4,feather:3,geometryUnchanged:true});
  }
  return reports;
}

/** Restore the neutral lip mark from the supplied drawing, after decomposition erased it. */
export function restoreNeutralMouth(puppet:InpDocument,textures:Buffer[],reference:ReturnType<typeof decodePNG>) {
  const part=inpParts(puppet).find(p=>p.name==='mouth_close');
  if(!part?.mesh)throw new Error('Missing native neutral mouth');
  const canvas=puppet.meta.canvas as {width:number;height:number};
  const scale=Math.max(canvas.width,canvas.height)/Math.max(reference.width,reference.height);
  const ox=(canvas.width-reference.width*scale)/2,oy=(canvas.height-reference.height*scale)/2;
  const bounds=(v:number[])=>[Math.min(...v.filter((_,i)=>i%2===0)),Math.min(...v.filter((_,i)=>i%2===1)),Math.max(...v.filter((_,i)=>i%2===0)),Math.max(...v.filter((_,i)=>i%2===1))];
  const b=bounds(part.mesh.verts),uv=bounds(part.mesh.uvs),texture=decodePNG(new Uint8Array(textures[part.textures![0]]));
  for(let y=0;y<texture.height;y++)for(let x=0;x<texture.width;x++){
    const u=(x+.5)/texture.width,v=(y+.5)/texture.height,i=(y*texture.width+x)*4;
    if(u<uv[0]||u>uv[2]||v<uv[1]||v>uv[3]){texture.rgba[i+3]=0;continue;}
    const px=b[0]+(u-uv[0])/(uv[2]-uv[0])*(b[2]-b[0])+canvas.width/2;
    const py=b[1]+(v-uv[1])/(uv[3]-uv[1])*(b[3]-b[1])+canvas.height/2;
    const sx=Math.max(0,Math.min(reference.width-1,Math.round((px-ox)/scale))),sy=Math.max(0,Math.min(reference.height-1,Math.round((py-oy)/scale)));
    const j=(sy*reference.width+sx)*4;
    for(let c=0;c<4;c++)texture.rgba[i+c]=reference.rgba[j+c];
  }
  part.textures=[textures.length,0xffffffff,0xffffffff];textures.push(Buffer.from(encodePNG(texture.rgba,texture.width,texture.height)));
  return {part:part.name,kind:'Neutral mouth raster restored from original drawing inside native mouth bounds',geometryUnchanged:true};
}

/** When See-through omitted independent eye layers, retain the drawing's eye/brow identity.
 * This is NOT an open-eye generator or a successful blink channel.
 */
export function restoreMissingEyeDetails(puppet:InpDocument,textures:Buffer[],reference:ReturnType<typeof decodePNG>,marks:Record<string,{x:number;y:number}>) {
  const parts=inpParts(puppet),face=parts.find(p=>p.name==='face')!;
  const missing=['L','R'].filter(s=>!parts.some(p=>p.name===`eyewhite-${s.toLowerCase()}`));
  if(!missing.length)return [];
  const canvas=puppet.meta.canvas as {width:number;height:number};
  const scale=Math.max(canvas.width,canvas.height)/Math.max(reference.width,reference.height),ox=(canvas.width-reference.width*scale)/2,oy=(canvas.height-reference.height*scale)/2;
  const boxes=missing.map(s=>{const eye=marks['eye'+s],outer=marks['eye'+s+'Outer'];if(!eye||!outer)throw new Error('Missing eye identity landmarks');const radius=Math.max(12,Math.abs(eye.x-outer.x)*1.3);return [eye.x-radius,eye.y-radius*.6,eye.x+radius,eye.y+radius*.6];});
  const bounds=(v:number[])=>[Math.min(...v.filter((_,i)=>i%2===0)),Math.min(...v.filter((_,i)=>i%2===1)),Math.max(...v.filter((_,i)=>i%2===0)),Math.max(...v.filter((_,i)=>i%2===1))];
  const b=bounds(face.mesh!.verts),uv=bounds(face.mesh!.uvs),texture=decodePNG(new Uint8Array(textures[face.textures![0]]));
  for(let y=Math.floor(uv[1]*texture.height);y<=Math.ceil(uv[3]*texture.height);y++)for(let x=Math.floor(uv[0]*texture.width);x<=Math.ceil(uv[2]*texture.width);x++){
    const u=(x+.5)/texture.width,v=(y+.5)/texture.height,i=(y*texture.width+x)*4;
    const px=b[0]+(u-uv[0])/(uv[2]-uv[0])*(b[2]-b[0])+canvas.width/2,py=b[1]+(v-uv[1])/(uv[3]-uv[1])*(b[3]-b[1])+canvas.height/2;
    const weight=Math.max(...boxes.map(box=>Math.min(1,Math.max(0,Math.min(px-box[0],box[2]-px,py-box[1],box[3]-py)/3))));
    if(!weight)continue;
    const sx=Math.max(0,Math.min(reference.width-1,Math.round((px-ox)/scale))),sy=Math.max(0,Math.min(reference.height-1,Math.round((py-oy)/scale))),j=(sy*reference.width+sx)*4;
    for(let c=0;c<3;c++)texture.rgba[i+c]=Math.round(texture.rgba[i+c]*(1-weight)+reference.rgba[j+c]*weight);
  }
  face.textures=[textures.length,0xffffffff,0xffffffff];textures.push(Buffer.from(encodePNG(texture.rgba,texture.width,texture.height)));
  const reports:ExpressionRepair[]=[{part:'face',kind:'Original eye/brow pixels restored where independent source eye layers were absent; baked source expression only',geometryUnchanged:true}];
  for(const side of missing){
    const closed=parts.find(p=>p.name===`eye_close-${side.toLowerCase()}`);
    if(!closed)continue;
    // Without independent open-eye features, an off-feature edit must not
    // overwrite the forehead. Preserve the supplied drawing; expose limitation.
    const box=bounds(closed.mesh!.verts),eye=marks['eye'+side];
    const cx=(box[0]+box[2])/2+canvas.width/2,cy=(box[1]+box[3])/2+canvas.height/2;
    if(Math.hypot(cx-eye.x,cy-eye.y)>Math.max(box[2]-box[0],box[3]-box[1])){
      closed.textures=[textures.length,0xffffffff,0xffffffff];textures.push(Buffer.from(encodePNG(new Uint8ClampedArray(4),1,1)));
      reports.push({part:closed.name,kind:'Rejected misregistered closed-eye raster; no independent blink support',geometryUnchanged:true});
    }
  }
  return reports;
}
