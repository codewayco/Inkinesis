/** Independent official Core evaluation of the optional combined Live2D export. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readCombined, evaluateCombined } from '../../player/src/combinedRuntime';
import type { ReferenceHarness } from './src/main';
import { coreKeyValues } from './coreKeyValues';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: reference:combined source.inp export-directory');
const nearKeys=process.argv.includes('--near-keys');
const out=resolve(output),model=resolve(out,'model'),evidence=resolve(out,nearKeys?'validation-near-keys':'validation');
const report=JSON.parse(readFileSync(resolve(out,'export.json'),'utf8')) as {sourceSha256:string;runtimeManifest:string;parameters:{id:string;source:string;axis:number;min:number;max:number;default:number}[]};
const bytes=readFileSync(input),asset=readCombined(bytes);
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
if(hash(bytes)!==report.sourceSha256)throw new Error('Source hash mismatch');
mkdirSync(evidence,{recursive:true});
const requests:{label:string;values:Record<string,number>;picture?:boolean}[]=[{label:'rest',values:{},picture:true}];
for(const p of asset.puppet.param){
 const mapping=report.parameters.filter(a=>a.source===p.name);
 for(const x of p.axis_points[0])for(const y of p.axis_points[1]){
  const key=[x,y];requests.push({label:p.name+' keys '+key.join(','),values:Object.fromEntries(mapping.map(a=>[a.id,p.min[a.axis]+key[a.axis]*(p.max[a.axis]-p.min[a.axis])]))});
 }
}
for(const p of report.parameters)for(const value of [p.min,p.max])requests.push({label:p.id+(value===p.min?' min':' max'),values:{[p.id]:value},picture:true});
requests.push({label:'coupled-pose',picture:true,values:Object.fromEntries(Object.entries({ParamAngleX:15,ParamAngleY:10,ParamAngleZ:8,ParamMouthOpenY:.65,ParamShoulderL:18,ParamElbowL:35,ParamHipR:10,ParamKneeR:20,ParamGarmentSway:.8,ParamBodySway:-.7,ParamBreath:.6}).filter(([id])=>report.parameters.some(p=>p.id===id)))});
const blinkControls=report.parameters.filter(p=>['ParamEyeLOpen','ParamEyeROpen'].includes(p.id));
if(blinkControls.length)requests.push({label:'blink',picture:true,values:Object.fromEntries(blinkControls.map(p=>[p.id,0]))});
const unsupportedControls=['ParamEyeLOpen','ParamEyeROpen'].filter(id=>!blinkControls.some(p=>p.id===id));
let seed=7123;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
for(let i=0;i<64;i++)requests.push({label:`mixed-${i}`,values:Object.fromEntries(report.parameters.map(p=>[p.id,p.min+random()*(p.max-p.min)]))});
if(nearKeys)for(const p of asset.puppet.param)for(const mapping of report.parameters.filter(a=>a.source===p.name)){
 for(const t of p.axis_points[mapping.axis])for(const offset of [-.0012,-.0005,.0005,.0012]){
  const value=p.min[mapping.axis]+t*(p.max[mapping.axis]-p.min[mapping.axis])+offset;
  if(value>mapping.min&&value<mapping.max)requests.push({label:`near-key ${mapping.id} ${value}`,values:{[mapping.id]:value}});
 }
}
process.env.CUBISM_REFERENCE_MODEL=model;process.env.CUBISM_REFERENCE_PORT='5192';
const server=await createServer({configFile:resolve('reference/cubism/vite.config.ts')});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try {
 await server.listen();browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1024,height:1024}});const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5192/?size=1024');
 await page.waitForFunction(()=>window.referenceHarness||window.referenceError);
 const core=await page.evaluate(async requests=>{
  if(window.referenceError)throw new Error(window.referenceError);
  const m=await(await fetch('/model-manifest')).json();const url=new URL(m.url,location.href);
  const manifest=await(await fetch(url)).json();
  const bytes=await(await fetch(new URL(manifest.FileReferences.Moc,url))).arrayBuffer();
  const moc=Live2DCubismCore.Moc.fromArrayBuffer(bytes);if(!moc)throw new Error('Core rejected MOC');
  const model=Live2DCubismCore.Model.fromMoc(moc);if(!model)throw new Error('Core rejected model');
  const frames=requests.map(request=>{
   model.parameters.values.set(model.parameters.defaultValues);
   for(const [id,value]of Object.entries(request.values)){
    const i=model.parameters.ids.indexOf(id);if(i<0)throw new Error('Missing '+id);model.parameters.values[i]=value;
   }
   model.update();
   return model.drawables.ids.map((id,i)=>({id,xy:Array.from(model.drawables.vertexPositions[i]),opacity:model.drawables.opacities[i],renderOrder:model.getRenderOrders()[i]}));
  });
  const result={frames,ids:model.drawables.ids,masks:model.drawables.masks.map(m=>Array.from(m).map(i=>model.drawables.ids[i])),textures:Array.from(model.drawables.textureIndices),indices:model.drawables.indices.map(v=>Array.from(v)),canvas:{width:model.canvasinfo.CanvasWidth,height:model.canvasinfo.CanvasHeight,ppu:model.canvasinfo.PixelsPerUnit},parameters:model.parameters.ids};
  model.release();moc._release();return result;
 },requests);
 for(const part of asset.parts){
  const i=core.ids.indexOf(`ArtMesh${part.uuid}`);
  if(i<0||JSON.stringify(core.masks[i])!==JSON.stringify((part.masks??[]).map(m=>`ArtMesh${m.source}`))||core.textures[i]!==part.textures![0]||core.indices[i].length!==part.mesh!.indices.length||core.indices[i].some((v,k)=>v!==part.mesh!.indices[Math.floor(k/3)*3+2-k%3]))throw new Error(JSON.stringify({reason:'Core masks, textures or triangles differ from source',part:part.name,masks:core.masks[i],sourceMasks:part.masks,texture:core.textures[i],sourceTexture:part.textures![0],indices:core.indices[i]?.slice(0,12),sourceIndices:part.mesh!.indices.slice(0,12)}));
 }
 let maxPositionError=0,maxOpacityError=0;const mismatches:{label:string;id:string;position:number;opacity:number}[]=[];
 let maxCorePositionError=0,maxCoreOpacityError=0;const coreMismatches:{label:string;id:string;position:number;opacity:number}[]=[];
 for(let f=0;f<requests.length;f++){
  const values:Record<string,number[]>={};
  for(const p of asset.puppet.param)values[p.name]=[...p.defaults];
  for(const p of report.parameters)if(requests[f].values[p.id]!==undefined)values[p.source][p.axis]=requests[f].values[p.id];
  const expected=evaluateCombined(asset,values);
  const coreExpected=evaluateCombined(asset,coreKeyValues(asset.puppet.param,values));
  const orders=core.frames[f].map(d=>d.renderOrder).sort((a,b)=>a-b);
  if(orders.some((n,i)=>n!==i))throw new Error('Core render order must include every mesh exactly once');
  const sorted=[...asset.parts].sort((a,b)=>a.zsort-b.zsort);
  if(sorted.some((p,i)=>core.frames[f].find(d=>d.id===`ArtMesh${p.uuid}`)?.renderOrder!==i))throw new Error('Core layer order differs from source');
  for(const p of expected){
   const actual=core.frames[f].find(d=>d.id===`ArtMesh${p.uuid}`);if(!actual||actual.xy.length!==p.xy.length)throw new Error('Missing or changed topology');
   const position=Math.max(...p.xy.map((n,i)=>Math.abs(n-actual.xy[i]*core.canvas.ppu*(i%2?-1:1))));
   const opacity=Math.abs(p.opacity-actual.opacity);
   maxPositionError=Math.max(maxPositionError,position);maxOpacityError=Math.max(maxOpacityError,opacity);
   if(position>.005||opacity>1e-5)mismatches.push({label:requests[f].label,id:actual.id,position,opacity});
   const target=coreExpected.find(d=>d.uuid===p.uuid)!;
   const corePosition=Math.max(...target.xy.map((n,i)=>Math.abs(n-actual.xy[i]*core.canvas.ppu*(i%2?-1:1))));
   const coreOpacity=Math.abs(target.opacity-actual.opacity);
   maxCorePositionError=Math.max(maxCorePositionError,corePosition);maxCoreOpacityError=Math.max(maxCoreOpacityError,coreOpacity);
   if(corePosition>.005||coreOpacity>1e-5)coreMismatches.push({label:requests[f].label,id:actual.id,position:corePosition,opacity:coreOpacity});
  }
 }
 const captures=[];
 for(const request of requests.filter(r=>r.picture)){
  const png=await page.evaluate(({values,scale})=>{
   const h=window.referenceHarness as ReferenceHarness;h.resetTrial({alignment:{scale,offsetX:0,offsetY:0,background:[.125,.13,.14,1]}});
   h.frame({frame:0,fps:60,values});return h.capture();
  },{values:request.values,scale:.9});
  const file=request.label.replace(/[^a-zA-Z0-9_-]/g,'_')+'.png';const data=Buffer.from(png.split(',')[1],'base64');
  writeFileSync(resolve(evidence,file),data);captures.push({label:request.label,file,sha256:hash(data)});
 }
 const result={status:coreMismatches.length||errors.length?'failed':mismatches.length?'passed_with_runtime_differences':'passed',strictSourceParity:!mismatches.length?'passed':'failed',sourceSha256:hash(bytes),mocSha256:hash(readFileSync(resolve(model,JSON.parse(readFileSync(resolve(out,report.runtimeManifest),'utf8')).FileReferences.Moc))),frames:requests.length,meshes:core.ids.length,parameters:core.parameters,canvas:core.canvas,maxPositionError,maxOpacityError,
   coreSampling:{epsilon:.001,maxPositionError:maxCorePositionError,maxOpacityError:maxCoreOpacityError,mismatchCount:coreMismatches.length,mismatches:coreMismatches.slice(0,20)},nearKeys,
   mismatches:mismatches.slice(0,20),mismatchCount:mismatches.length,errors,captures,unsupportedControls,
   scope:'Official Cubism Core vs source combined INP evaluator, strict source values and separately the 0.001-physical-unit key-snapped reference; including full render order, clipping-source assignments, texture assignments and triangle topology (Core reverses each triangle winding): all authored parameter grids, individual limits, simultaneous pose, blink and 64 seeded mixed poses; optional near-key probes at +/-0.0005 and +/-0.0012 physical units. Geometry/opacity only; soft clipping differs from thresholded Inochi stencil. No physics or human acceptance claim.'};
 writeFileSync(resolve(evidence,'validation.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({...result,captures:captures.length}));
 if(result.status==='failed')process.exitCode=1;
}finally{await browser?.close();await server.close();}
