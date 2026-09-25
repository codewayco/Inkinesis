/** Serialize CPU-evaluated psd2live face motion onto our exported parts. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readInp, writeInp, inpParts, type InpParameter, type InpBinding, type InpNode } from './inp';
import { sampleAt } from './sampleMesh';
import type { TexturedMesh } from '../../engine/src/render/textured';

export interface PosePosition { id: string; xy: number[]; opacity?: number; drawOrder?: number }
export interface PoseDump {
  coordinateSystem?: 'world-y-up' | 'canvas-y-down';
  canvas: { width: number; height: number };
  drawables: { id: string; layer: string; indices: number[]; uvs?: number[]; rest?: number[];
    textureFile?: string; opacity?: number; drawOrder?: number; maskedBy?: string[]; invertMask?: boolean }[];
  headLattice?: { x: string; y: string; cells: { x: number; y: number; positions: PosePosition[] }[] };
  parameters: { id: string; name: string; min: number; max: number; default: number;
    keypoints: { value: number; positions: PosePosition[] }[] }[];
}
const PHYSICS = new Set(['ParamHairFront', 'ParamHairBack', 'ParamEyeBallForm']);
const LIMBS = /^(Shoulder|Elbow|Hip|Knee) [LR]$/;
const FACE = /^(hair_|face_|ear_|nose$|eye_|iris_|highlight_|lash_|brow_|mouth_|lip_|neck_)/;
const ALIASES: Record<string, string> = { hair_front: 'front hair', hair_back: 'back hair',
  face_skin: 'face', neck_skin: 'neck', nose: 'nose' };
export function sourceLayer(name: string) {
  if (ALIASES[name]) return ALIASES[name];
  const match = /^(brow|iris|eye_white_clipping_base|lash_upper|lash_lower|ear|highlight)_([LR])$/.exec(name);
  if (match) return `${({ brow: 'eyebrow', iris: 'irides', eye_white_clipping_base: 'eyewhite',
    lash_upper: 'eyelash', lash_lower: 'eyelash', ear: 'ears', highlight: 'irides' } as Record<string,string>)[match[1]]}-${match[2].toLowerCase()}`;
  if (/^mouth_interior_/.test(name)) return 'mouth_open';
  return name;
}
/** Classify native split meshes without changing their unique names or drawable IDs. */
export function semanticLayer(name: string) { return name.replace(/#\d+:[lr]$/, ''); }
export interface CarryOptions { nativeMouth?: boolean; sourceOrder?: boolean; faceControlsOnly?: boolean; splitFaceLayers?: boolean }
export function carryPoses(input: Buffer, dump: PoseDump, nativeTextures?: Map<string, Buffer>, options: CarryOptions = {}) {
  const { puppet, textures } = readInp(input);
  const toCanvas = (xy: number[]) => xy.map((v, i) =>
    i % 2 && dump.coordinateSystem !== 'canvas-y-down' ? -v : v);
  const nativeByNode = new Map<number, PoseDump['drawables'][number]>();
  if (nativeTextures) {
    const old = inpParts(puppet), mouth = (name: string) => /^(mouth_|lip_)/.test(name);
    const upstreamFace = /^(front hair|back hair|side hair|hair|headwear|eyewear|earwear(?:-[lr])?|face|neck|nose|ears?(?:-[lr])?|eyebrow-[lr]|irides-[lr]|eyewhite-[lr]|eyelash-[lr]|eye_close-[lr])$/;
    const sourceMouth = /^(mouth(?:_open|_close)?|lip_upper|lip_lower|tooth-[tb]|tongue)$/;
    const selected = dump.drawables.filter(d => {
      const layer = options.splitFaceLayers ? semanticLayer(d.layer) : d.layer;
      return upstreamFace.test(layer) || (FACE.test(layer) && !mouth(layer)) || (options.nativeMouth && sourceMouth.test(layer));
    });
    if (!selected.some(d => /^(face|face_skin)$/.test(d.layer))) throw new Error('Native bust has no face');
    const retained = old.filter(n => !FACE.test(n.name) || (!options.nativeMouth && mouth(n.name)));
    const removed = new Set(old.filter(n => !retained.includes(n)).map(n => n.uuid));
    for (const parameter of puppet.param) parameter.bindings = parameter.bindings.filter(b => !removed.has(b.node));
    let nodeId = Math.max(...old.map(n => n.uuid)) + 1;
    const textureIds = new Map<string, number>();
    const faceZ = old.find(n => n.name === 'face_skin')?.zsort ?? 100;
    const ordered = [...selected].sort((a,b) => (a.drawOrder ?? 0)-(b.drawOrder ?? 0));
    const native = ordered.map((d,i) => {
      if (!d.rest?.length || !d.uvs || !d.textureFile || d.rest.length !== d.uvs.length)
        throw new Error(`Incomplete native mesh ${d.layer}`);
      if (d.invertMask) throw new Error('Inverted native mask requires explicit support');
      if (!textureIds.has(d.textureFile)) {
        const bytes = nativeTextures.get(d.textureFile);
        if (!bytes) throw new Error(`Missing native atlas ${d.textureFile}`);
        textureIds.set(d.textureFile,textures.length); textures.push(bytes);
      }
      const alias = old.find(n => sourceLayer(n.name) === d.layer);
      const back = /^(back hair|hair_back)$/.test(d.layer);
      // Native neck must retain its order relative to the source topwear.
      // The old contract neck is behind the shirt, which hides c1's entire neck.
      const neck = /^(neck|neck_skin)$/.test(d.layer);
      const topwear = dump.drawables.find(p=>p.layer==='topwear');
      const neckZ = topwear && (d.drawOrder??0)>(topwear.drawOrder??0)
        ? faceZ-.005 : alias?.zsort ?? faceZ-1;
      const node: InpNode = { ...old[0], children: undefined, uuid: nodeId++, name: d.layer,
        enabled: true, opacity: 1, masks: [], zsort: options.sourceOrder ? d.drawOrder??0 : neck ? neckZ : back ? alias?.zsort ?? faceZ-1 : faceZ+i/100,
        textures: [textureIds.get(d.textureFile)!,0xffffffff,0xffffffff],
        mesh: { verts: toCanvas(d.rest).map((v,k)=>v-(k%2?dump.canvas.height:dump.canvas.width)/2),
          uvs: d.uvs, indices: d.indices, origin: [0,0] } };
      nativeByNode.set(node.uuid,d); return node;
    });
    for (const node of native) {
      const d = nativeByNode.get(node.uuid)!;
      node.masks = (d.maskedBy ?? []).map(id => {
        const source = native.find(n => nativeByNode.get(n.uuid)!.id === id);
        if (!source) throw new Error(`Native mask references excluded layer ${id}`);
        return {source:source.uuid,mode:'Mask'};
      });
    }
    // Keep authored mouths, above the face and below eye/forehead layers.
    for (const node of retained.filter(n=>mouth(n.name))) node.zsort = faceZ + .005;
    puppet.nodes.children = [...retained,...native].sort((a,b)=>a.zsort-b.zsort);
    puppet.meta.nativeBust = { layers: selected.map(d=>d.layer), source: 'psd2live atlas and CPU rest mesh' };
  }
  const parts = inpParts(puppet).filter(p => FACE.test(p.name) || nativeByNode.has(p.uuid));
  const names = new Map<string, PoseDump['drawables'][number]>();
  for (const d of dump.drawables) {
    const name = d.layer.replace(/#\d+$/, '');
    if (names.has(name)) throw new Error(`Ambiguous source drawable: ${name}`);
    names.set(name, d);
  }
  const kept = puppet.param.filter(p => LIMBS.test(p.name) || (!options.nativeMouth && p.name === 'Viseme'));
  let uuid = Math.max(...puppet.param.map(p => p.uuid), 10000) + 1;
  const channels = [];
  for (const p of dump.parameters) {
    if(options.faceControlsOnly && !/^Param(Angle[XYZ]|Eye[LR]Open|EyeBall[XY]|Brow[LR]Y|MouthForm|MouthOpenY)$/.test(p.id))continue;
    if (dump.headLattice && [dump.headLattice.x,dump.headLattice.y].includes(p.id)) continue;
    if (PHYSICS.has(p.id) || /^(ParamArm|ParamSkirt)/.test(p.id)) continue;
    const keys = [...p.keypoints].sort((a,b) => a.value - b.value);
    const rest = keys.find(k => k.value === p.default);
    if (!rest || !(p.max > p.min)) throw new Error(`No valid default for ${p.id}`);
    let samples = 0, clampedSamples = 0, maxOffsetPixels = 0;
    const missing: string[] = [];
    const bindings: InpBinding[] = parts.flatMap(part => {
      const d = nativeByNode.get(part.uuid) ?? names.get(part.name) ?? names.get(sourceLayer(part.name));
      if (!d) { missing.push(part.name); return []; }
      const rawRest = rest.positions.find(v => v.id === d.id)?.xy;
      const r = rawRest ? toCanvas(rawRest) : undefined;
      if (!r?.length || !d.indices.length) throw new Error(`Empty source mesh ${d.layer}`);
      let moved = false;
      const values = keys.map(k => {
        const raw = k.positions.find(v => v.id === d.id)?.xy;
        const xy = raw ? toCanvas(raw) : undefined;
        if (!xy || xy.length !== r.length || !xy.every(Number.isFinite)) throw new Error(`Invalid pose ${p.id}/${d.id}`);
        const delta = xy.map((x,i) => x - r[i]);
        const mesh = { uv: new Float64Array(r), xy: new Float64Array(delta),
          indices: new Uint32Array(d.indices) } as TexturedMesh;
        const offsets: number[][] = [];
        for (let v = 0; v < part.mesh!.verts.length; v += 2) {
          const sample = nativeByNode.has(part.uuid) ? {x:delta[v],y:delta[v+1],clamped:false}
            : sampleAt(mesh, part.mesh!.verts[v] + dump.canvas.width / 2,
              part.mesh!.verts[v+1] + dump.canvas.height / 2);
          if (k !== rest) { samples++; if (sample.clamped) clampedSamples++; }
          const size = Math.hypot(sample.x, sample.y);
          if (!Number.isFinite(size)) throw new Error('Non-finite imported deformation');
          moved ||= size > 0.05; maxOffsetPixels = Math.max(maxOffsetPixels, size);
          offsets.push([sample.x, sample.y]);
        }
        return [offsets];
      });
      const result: InpBinding[] = moved ? [{ node: part.uuid, param_name: 'deform', values,
        isSet: keys.map(() => [true]), interpolate_mode: 'Linear' }] : [];
      const opacity = keys.map(k => k.positions.find(v=>v.id===d.id)?.opacity ?? 1);
      if (nativeByNode.has(part.uuid) && opacity.some(v=>Math.abs(v-1)>1e-6)) {
        // Assign the absolute opacity to the owning eye-open control. Other
        // channels must not multiply a closed-eye default of zero into it.
        const changes = opacity.some(v=>Math.abs(v-opacity[0])>1e-6);
        if (changes) result.push({node:part.uuid,param_name:'opacity',values:opacity.map(v=>[v]),
          isSet:keys.map(()=>[true]),interpolate_mode:'Linear'});
      }
      return result;
    });
    const parameter: InpParameter = { uuid: uuid++, name: p.id, is_vec2: false,
      min: [p.min,0], max: [p.max,0], defaults: [p.default,0],
      axis_points: [keys.map(k => (k.value-p.min)/(p.max-p.min)),[0]],
      merge_mode: 'Passthrough', bindings };
    if (bindings.length) kept.push(parameter);
    channels.push({ name: p.id, written: bindings.length > 0, partsMoved: bindings.length,
      maxOffsetPixels, samples, clampedSamples, unmatchedParts: missing,
      provenance: 'psd2live CPU evaluator; canvas-space barycentric transfer; face parts only' });
  }
  if (dump.headLattice) {
    const lattice = dump.headLattice;
    const xp = dump.parameters.find(p=>p.id===lattice.x)!, yp = dump.parameters.find(p=>p.id===lattice.y)!;
    if (!xp || !yp) throw new Error('Lattice parameter missing');
    const xs = [...new Set(lattice.cells.map(c=>c.x))].sort((a,b)=>a-b);
    const ys = [...new Set(lattice.cells.map(c=>c.y))].sort((a,b)=>a-b);
    const rest = lattice.cells.find(c=>c.x===xp.default && c.y===yp.default);
    if (!rest || lattice.cells.length!==xs.length*ys.length) throw new Error('Incomplete head lattice');
    let samples=0,clampedSamples=0,maxOffsetPixels=0;
    const bindings: InpBinding[] = parts.flatMap(part=>{
      const d = nativeByNode.get(part.uuid) ?? names.get(part.name) ?? names.get(sourceLayer(part.name));
      if (!d) return [];
      const r = toCanvas(rest.positions.find(v=>v.id===d.id)!.xy);
      const values = xs.map(x=>ys.map(y=>{
        const cell = lattice.cells.find(c=>c.x===x&&c.y===y);
        const raw = cell?.positions.find(v=>v.id===d.id)?.xy;
        if (!raw || raw.length!==r.length) throw new Error('Missing coupled pose');
        const delta=toCanvas(raw).map((v,i)=>v-r[i]);
        const mesh={uv:new Float64Array(r),xy:new Float64Array(delta),indices:new Uint32Array(d.indices)} as TexturedMesh;
        const offsets=[];
        for(let i=0;i<part.mesh!.verts.length;i+=2) {
          const sample=nativeByNode.has(part.uuid)?{x:delta[i],y:delta[i+1],clamped:false}
            :sampleAt(mesh,part.mesh!.verts[i]+dump.canvas.width/2,part.mesh!.verts[i+1]+dump.canvas.height/2);
          if (!Number.isFinite(sample.x+sample.y)) throw new Error('Non-finite coupled pose');
          samples++;if(sample.clamped)clampedSamples++;
          maxOffsetPixels=Math.max(maxOffsetPixels,Math.hypot(sample.x,sample.y));
          offsets.push([sample.x,sample.y]);
        }
        return offsets;
      }));
      const result: InpBinding[] = [{node:part.uuid,param_name:'deform',values,isSet:xs.map(()=>ys.map(()=>true)),interpolate_mode:'Linear'}];
      if(nativeByNode.has(part.uuid)) {
        const baseline=rest.positions.find(v=>v.id===d.id)?.opacity??1;
        const opacity=xs.map(x=>ys.map(y=>lattice.cells.find(c=>c.x===x&&c.y===y)!.positions.find(v=>v.id===d.id)?.opacity??1));
        if(opacity.some(row=>row.some(v=>Math.abs(v-baseline)>1e-6))) {
          const otherOwner=kept.some(p=>p.bindings.some(b=>b.node===part.uuid&&b.param_name==='opacity'));
          if(otherOwner && baseline===0)throw new Error('Coupled opacity with zero default needs an explicit combined expression lattice');
          result.push({node:part.uuid,param_name:'opacity',values:opacity.map(row=>row.map(v=>otherOwner?v/baseline:v)),
            isSet:xs.map(()=>ys.map(()=>true)),interpolate_mode:'Linear'});
        }
      }
      return result;
    });
    kept.push({uuid:uuid++,name:'Head Angles',is_vec2:true,min:[xp.min,yp.min],max:[xp.max,yp.max],
      defaults:[xp.default,yp.default],axis_points:[xs.map(x=>(x-xp.min)/(xp.max-xp.min)),ys.map(y=>(y-yp.min)/(yp.max-yp.min))],
      merge_mode:'Passthrough',bindings});
    channels.push({name:'Head Angles',written:true,partsMoved:bindings.length,maxOffsetPixels,samples,clampedSamples,
      unmatchedParts:[],provenance:'Coupled psd2live head lattice; native vertices where available'});
  }
  // Static visibility belongs on the part only if no imported opacity track owns it.
  for (const part of parts) {
    const d=nativeByNode.get(part.uuid);
    if(d && !kept.some(p=>p.bindings.some(b=>b.node===part.uuid&&b.param_name==='opacity'))) part.opacity=d.opacity??1;
  }
  puppet.param = kept;
  puppet.meta.rigger = options.nativeMouth ? 'Source psd2live bust including measured mouth; body rig supplied separately. No physics or Cubism Core.' : 'psd2live CPU face poses plus engine limb joints and exclusive visemes. No physics or Cubism Core.';
  return { file: writeInp(puppet,textures), channels };
}
export function carryFiles(inp: string, poses: string, output: string) {
  const bytes = readFileSync(inp), dump = JSON.parse(readFileSync(poses,'utf8')) as PoseDump;
  const nativeTextures = dump.drawables.every(d=>d.textureFile)
    ? new Map([...new Set(dump.drawables.map(d=>d.textureFile!))].map(filename=>{
      if (basename(filename)!==filename) throw new Error('Atlas must be a sibling file');
      return [filename,readFileSync(resolve(dirname(poses),filename))];
    })) : undefined;
  const result = carryPoses(bytes, dump, nativeTextures);
  writeFileSync(output,result.file);
  const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  writeFileSync(output.replace(/\.inp$/, '-import.json'), JSON.stringify({
    source: { inp, poses, inputDigest: digest(bytes), poseDigest: digest(readFileSync(poses)) },
    digest: digest(result.file), channels: result.channels,
    nativeBust: !!nativeTextures, coupledHead: !!dump.headLattice,
    whatThisDoesNotMeasure: 'Arbitrary simultaneous non-head expressions, physics, native GPU pixels or human acceptance. Coupled head cells and eye opacity keyforms are carried when present.',
  },null,2)+'\n');
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [inp,poses,out] = process.argv.slice(2);
  if (!inp || !poses || !out) throw new Error('usage: carryPsd2Live input.inp poses.json output.inp');
  carryFiles(inp,poses,out);
}
