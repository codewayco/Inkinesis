/** Optional second output backend. Reads a combined INP; never rewrites it. */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { rigConfig } from '../../imageToRig/config';
import { readCombined, type CombinedAsset } from '../../../player/src/combinedRuntime';

const mapping: Record<string, string[]> = {
  'Head Angles': ['ParamAngleX','ParamAngleY'],
  'Arm L': ['ParamShoulderL','ParamElbowL'], 'Arm R': ['ParamShoulderR','ParamElbowR'],
  'Leg L': ['ParamHipL','ParamKneeL'], 'Leg R': ['ParamHipR','ParamKneeR'],
};
const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
export function prepareLive2D(asset: CombinedAsset, name: string) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) throw new Error('Use a simple model name');
  // This backend intentionally only accepts our flat, identity-transformed subset.
  const checkTransform = (node: unknown) => {
    const n = node as {transform?: {trans?:number[];rot?:number[];scale?:number[]};children?:unknown[];type?:string;blend_mode?:string;mesh?:{origin:number[]};tint?:number[];screenTint?:number[]};
    if (n.transform && (n.transform.trans?.some(v=>v!==0) || n.transform.rot?.some(v=>v!==0) || n.transform.scale?.some(v=>v!==1))) throw new Error('Nonidentity node transform is unsupported');
    if (n.type!=='Node' && n.type!=='Part') throw new Error('Unsupported node type');
    if (n.blend_mode && n.blend_mode!=='Normal' || n.mesh?.origin.some(v=>v!==0) || n.tint?.some(v=>v!==1) || n.screenTint?.some(v=>v!==0)) throw new Error('Unsupported part rendering state');
    n.children?.forEach(checkTransform);
  };
  checkTransform(asset.puppet.nodes);
  const parameters = asset.puppet.param.flatMap(p => {
    const ids=mapping[p.name] ?? [p.name];
    if (ids.length !== (p.is_vec2?2:1) || ids.some(id=>!/^Param[A-Za-z0-9_]+$/.test(id))) throw new Error(`Unmapped parameter ${p.name}`);
    return ids.map((id,axis)=>({id,name: id.replace(/^Param/,''),min:p.min[axis],max:p.max[axis],default:p.defaults[axis],source:p.name,axis}));
  });
  if(new Set(parameters.map(p=>p.id)).size!==parameters.length) throw new Error('Duplicate mapped parameter');
  const links = asset.puppet.param.filter(p=>p.is_vec2).map(p=>mapping[p.name]);
  const drawables = [...asset.parts].sort((a,b)=>a.zsort-b.zsort).map((node,order)=>{
    const owners=asset.puppet.param.map(p=>({p,bindings:p.bindings.filter(b=>b.node===node.uuid)})).filter(o=>o.bindings.length);
    const axes=owners.flatMap(({p})=>(mapping[p.name]??[p.name]).map((id,i)=>({id,keys:p.axis_points[i].map(t=>p.min[i]+t*(p.max[i]-p.min[i]))})));
    const keyCount=axes.reduce((n,a)=>n*a.keys.length,1);
    if(keyCount>100000) throw new Error(`Excessive keyform product for ${node.name}: ${keyCount}`);
    const cells = [];
    for(let k=0; k<(axes.length?keyCount:0); k++) {
      let rest=k; const coordinate=axes.map(a=>{const c=rest%a.keys.length;rest=Math.floor(rest/a.keys.length);return c;});
      const delta=new Array<number>(node.mesh!.verts.length).fill(0); let opacity=node.opacity??1,hasOpacity=false,axis=0;
      for(const {p,bindings} of owners) {
        const x=coordinate[axis++],y=p.is_vec2?coordinate[axis++]:0;
        for(const b of bindings) {
          const v=b.values[x]?.[y];
          if(b.param_name==='deform') {
            const flat=(v as number[][]).flat();
            if(flat.length!==delta.length||!flat.every(Number.isFinite)) throw new Error('Invalid deformation');
            flat.forEach((n,i)=>{delta[i]+=n;});
          } else {
            if(typeof v!=='number'||!Number.isFinite(v))throw new Error('Invalid opacity');
            opacity=hasOpacity?opacity*v:v;hasOpacity=true;
          }
        }
      }
      cells.push({coordinate,delta,opacity});
    }
    return {id:`ArtMesh${node.uuid}`,uuid:node.uuid,name:node.name,
      positions:node.mesh!.verts.map((v,i)=>v+(i%2?asset.height:asset.width)/2),
      uvs:node.mesh!.uvs,indices:node.mesh!.indices,texture:node.textures![0],
      masks:(node.masks??[]).map(m=>`ArtMesh${m.source}`),order:order*10,
      opacity:node.opacity??1,enabled:node.enabled,axes,cells};
  });
  return {name,width:asset.width,height:asset.height,parameters,links,drawables,
    textures:asset.textures.map((_,i)=>`textures/texture_${String(i).padStart(2,'0')}.png`)};
}

export function exportLive2D(input: string, output: string, name='Character') {
  const source=resolve(input),out=resolve(output),model=resolve(out,'model');
  if(source.startsWith(out+'/'))throw new Error('Keep the source outside the export directory');
  mkdirSync(out,{recursive:true});
  if(readdirSync(out).length)throw new Error('Use a new empty output directory');
  const bytes=readFileSync(source),asset=readCombined(bytes),bridge=prepareLive2D(asset,name);
  const work=mkdtempSync(resolve(tmpdir(),'combined-live2d-'));
  mkdirSync(resolve(work,'textures'));
  asset.textures.forEach((b,i)=>writeFileSync(resolve(work,bridge.textures[i]),b));
  const json=JSON.stringify(bridge);writeFileSync(resolve(work,'bridge.json'),json);
  const config=rigConfig(),engine=resolve(config.engine);
  const pin=spawnSync('git',['rev-parse','HEAD'],{cwd:engine,encoding:'utf8'});
  if(pin.status!==0||pin.stdout.trim()!=='5526f2e16b57e5f83d34f33730d6fa26d8bc8695')throw new Error('Expected the pinned psd2live engine; see the component runbook');
  const adapter=dirname(fileURLToPath(import.meta.url));
  const java=resolve(config.java);
  const result=spawnSync('bash',['./gradlew','--offline','--no-daemon','--console=plain','-Pkotlin.incremental=false','--init-script',resolve(adapter,'export.gradle'),'exportCombinedLive2D',`-PcombinedAdapterDir=${adapter}`,`-PcombinedInput=${resolve(work,'bridge.json')}`,`-PcombinedOutput=${model}`],
    {cwd:engine,env:{...process.env,JAVA_HOME:java,PATH:java+'/bin:'+process.env.PATH},encoding:'utf8',maxBuffer:32*1024*1024});
  writeFileSync(resolve(out,'build.log'),(result.stdout??'')+(result.stderr??''));
  if(result.status!==0)throw new Error(`Live2D exporter failed; see ${out}/build.log`);
  if(hash(readFileSync(source))!==hash(bytes))throw new Error('Source INP changed during export');
  // Standard viewer associations; custom limb controls remain separately adjustable.
  const manifest=resolve(model,name+'.model3.json'),description=JSON.parse(readFileSync(manifest,'utf8'));
  const ids=new Set(bridge.parameters.map(p=>p.id));
  description.Groups=[{Target:'Parameter',Name:'EyeBlink',Ids:['ParamEyeLOpen','ParamEyeROpen'].filter(id=>ids.has(id))},{Target:'Parameter',Name:'LipSync',Ids:['ParamMouthOpenY'].filter(id=>ids.has(id))}];
  writeFileSync(manifest,JSON.stringify(description,null,2)+'\n');
  const files: Record<string,string> = {};
  const inventory = (dir: string, prefix='') => {
    for (const entry of readdirSync(dir,{withFileTypes:true})) {
      const path=resolve(dir,entry.name),key=prefix+entry.name;
      if(entry.isDirectory())inventory(path,key+'/');else files[key]=hash(readFileSync(path));
    }
  };
  inventory(model);
  const report={status:'needs_review',files,adapterSha256:hash(readFileSync(resolve(adapter,'CombinedExport.kt'))),source,sourceSha256:hash(bytes),sourceUnchanged:true,engineCommit:pin.stdout.trim(),bridgeSha256:hash(json),
    parameters:bridge.parameters,drawables:bridge.drawables.map(({cells,axes,...d})=>({id:d.id,sourceUuid:d.uuid,name:d.name,keyforms:cells.length,axes:axes.map(a=>a.id)})),
    limitations:['Cubism uses soft clipping; Inochi uses thresholded stencil masks. Raster edge parity is not guaranteed.','No physics or animation clips synthesized.','CMO3 is reconstructed from final mesh textures; it is not the original layered authoring project.','Official Core validation is required separately.'],
    runtimeManifest:'model/'+name+'.model3.json',editorProject:'model/'+name+'.cmo3'};
  writeFileSync(resolve(out,'export.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [input,out,name]=process.argv.slice(2);
  if(!input||!out)throw new Error('Usage: npm run export:live2d -- combined.inp new-output-directory [ModelName]');
  const report=exportLive2D(input,out,name);
  console.log(JSON.stringify({status:report.status,runtimeManifest:resolve(out,report.runtimeManifest),editorProject:resolve(out,report.editorProject),sourceUnchanged:report.sourceUnchanged},null,2));
}
