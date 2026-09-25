/** Renders the actual INP textures at Inochi2D-evaluated poses, never a rebuilt PSD. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inpParts, inpTextures, readInp } from '../rig/inp';
import { renderTextured, type TexturedMesh } from '../../engine/src/render/textured';
import { decodePNG } from '../generate/png';
import { encodePNG } from '../shared/encodePNG';

export interface RuntimeFrame {
  label: string; parameter: string; value: number; valueY?: number;
  parts: { uuid: number; name: string; xy: number[]; opacity?: number; enabled?: boolean }[];
}
/** Sign-safe frame filename: '-' becomes 'neg' and '.' becomes 'p' so opposite poses never collide. */
export function poseFilename(label:string){return label.replace(/-/g,'neg').replace(/\./g,'p').replace(/\W+/g,'_')+'.png';}
export function measurePuppet(inp: string, poses: string, source: string, out: string) {
  mkdirSync(out, { recursive: true });
  const { puppet, textures: raw } = readInp(readFileSync(inp));
  const textures = inpTextures(raw), nodes = inpParts(puppet);
  const ref = decodePNG(new Uint8Array(readFileSync(source)));
  const canvas = (puppet.meta.canvas as { width: number; height: number } | undefined)
    ?? { width: ref.width, height: ref.height };
  const { width, height } = canvas;
  const frames = (JSON.parse(readFileSync(poses, 'utf8')) as { frames: RuntimeFrame[] }).frames;
  const byId = new Map(nodes.map(n => [n.uuid,n]));
  const draw = (frame: RuntimeFrame) => {
    if (frame.parts.length !== nodes.length) throw new Error('Runtime/export part inventory differs');
    const meshes: TexturedMesh[] = frame.parts.map((p,i) => {
      const n = byId.get(p.uuid);
      if (!n?.mesh || p.xy.length !== n.mesh.uvs.length || !p.xy.every(Number.isFinite)) throw new Error('Runtime vertex mismatch');
      return { xy: new Float64Array(p.xy.map((v,k) => v + (k%2 ? height : width)/2)),
        uv: new Float64Array(n.mesh.uvs), indices: new Uint32Array(n.mesh.indices),
        depth: new Float64Array(p.xy.length/2).fill(-i), depthOffset: 0,
        texture: textures[n.textures![0]], opacity: p.enabled === false ? 0 : p.opacity ?? n.opacity ?? 1,
        sampling: 'bilinear' } as TexturedMesh;
    });
    const masks = new Map<number, ReturnType<typeof renderTextured>>();
    for (let i=0;i<meshes.length;i++) for (const m of byId.get(frame.parts[i].uuid)!.masks ?? []) {
      if (m.mode !== 'Mask') throw new Error('Only native Mask is supported by this measurement');
      if (!masks.has(m.source)) {
        const j = frame.parts.findIndex(p => p.uuid === m.source);
        if (j<0) throw new Error('Unresolved runtime mask');
        const mask = renderTextured([{ ...meshes[j], opacity: 1 }], width,height,[0,0,0,0],{selfOverlap:'count'});
        const threshold = byId.get(m.source)?.mask_threshold ?? 0.5;
        for (let k=3;k<mask.rgba.length;k+=4) mask.rgba[k] = mask.rgba[k]/255 > threshold ? 255 : 0;
        masks.set(m.source,mask);
      }
      meshes[i].mask = { texture: { width,height,rgba:masks.get(m.source)!.rgba },
        screenToUv: [1/width,0,0,1/height,0,0], sampling:'nearest',channel:'alpha',outsideValue:0,invert:false };
    }
    return renderTextured(meshes,width,height,[0,0,0,0],{selfOverlap:'count'});
  };
  const restFrame = frames.find(f=>f.label==='rest');
  if (!restFrame) throw new Error('No runtime rest');
  const rest = draw(restFrame);
  const scale = Math.max(width,height)/Math.max(ref.width,ref.height);
  const offX=(width-ref.width*scale)/2,offY=(height-ref.height*scale)/2;
  let shared=0,union=0,different=0,restOpaque=0,layered=0;
  const attribution: Record<string,number> = {};
  const figure = (r:number,g:number,b:number,a:number) => a>24 && !(r>238 && g>238 && b>238);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const px=y*width+x,i=px*4,sx=Math.round((x-offX)/scale),sy=Math.round((y-offY)/scale);
    const j=(sy*ref.width+sx)*4,inside=sx>=0&&sy>=0&&sx<ref.width&&sy<ref.height;
    const alpha=rest.rgba[i+3]/255;
    const rgb=[0,1,2].map(c=>Math.round(rest.rgba[i+c]*alpha+255*(1-alpha)));
    const a=figure(rgb[0],rgb[1],rgb[2],255);
    const b=inside&&figure(ref.rgba[j],ref.rgba[j+1],ref.rgba[j+2],ref.rgba[j+3]);
    if(a||b)union++;
    if(rest.rgba[i+3]>24) { restOpaque++; if(rest.alphaCoverageCount[px]>=2)layered++; }
    if(!a||!b)continue;
    shared++;
    if(Math.max(...rgb.map((v,c)=>Math.abs(v-ref.rgba[j+c])))>40) {
      different++;const name=restFrame.parts[rest.frontPart[px]]?.name??'none';
      attribution[name]=(attribution[name]??0)+1;
    }
  }
  if(!restOpaque||!shared||!union)throw new Error('Blank or non-overlapping rest frame cannot score');
  const filenames=new Map<string,string>();
  for(const f of frames){const name=poseFilename(f.label),previous=filenames.get(name);if(previous&&previous!==f.label)throw new Error('Pose filename collision');filenames.set(name,f.label);}
  const save=(label:string,rgba:Uint8ClampedArray)=>writeFileSync(resolve(out,poseFilename(label)),encodePNG(rgba,width,height));
  save('rest',rest.rgba);
  const rows=frames.filter(f=>f.parameter).map(frame=>{
    const posed=draw(frame); let swept=0,uncovered=0,changedPixels=0;
    let maxVertexDisplacement=0;
    for(const part of frame.parts) {
      const original=restFrame.parts.find(p=>p.uuid===part.uuid)!;
      for(let i=0;i<part.xy.length;i+=2)maxVertexDisplacement=Math.max(maxVertexDisplacement,Math.hypot(part.xy[i]-original.xy[i],part.xy[i+1]-original.xy[i+1]));
    }
    const openedBy:Record<string,number>={};
    for(let px=0;px<width*height;px++) {
      if([0,1,2,3].some(c=>Math.abs(rest.rgba[px*4+c]-posed.rgba[px*4+c])>2))changedPixels++;
      if(rest.rgba[px*4+3]<=24||posed.rgba[px*4+3]>24)continue;
      swept++; if(rest.alphaCoverageCount[px]<2)continue;
      uncovered++;const name=restFrame.parts[rest.frontPart[px]]?.name??'none';
      openedBy[name]=(openedBy[name]??0)+1;
    }
    save(frame.label,posed.rgba);
    return { channel:frame.parameter,frame:frame.label,file:poseFilename(frame.label),value:frame.value,valueY:frame.valueY,changedPixels,maxVertexDisplacement,
      opacityChangedParts:frame.parts.filter(p=>p.opacity!==restFrame.parts.find(r=>r.uuid===p.uuid)?.opacity).map(p=>p.name),
      sweptPixels:swept,restOpaquePixels:restOpaque,sweptFractionOfSilhouette:swept/restOpaque,
      uncoveredPixels:uncovered,layeredRestPixels:layered,uncoveredFractionOfLayered:layered?uncovered/layered:null,
      openedBy:Object.entries(openedBy).map(([frontPart,pixels])=>({frontPart,pixels})) };
  });
  const report={ input:inp,poses,source,canvas,rest:{silhouetteIoU:shared/union,sharedPixels:shared,
    unionPixels:union,differingPixels:different,colourDisagreementFraction:different/shared,attribution},frames:rows,
    whatThisDoesNotMeasure:'Native GPU pixel parity, correctness of revealed artwork, coupled-channel behavior or human acceptance. Geometry and opacity come from Inochi2D; pixels are rasterized by this repository.' };
  writeFileSync(resolve(out,'measurement.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [inp,poses,source,out]=process.argv.slice(2);
  if(!inp||!poses||!source||!out)throw new Error('usage: measurePuppet input.inp poses.json source.png output-directory');
  measurePuppet(inp,poses,source,out);
}
