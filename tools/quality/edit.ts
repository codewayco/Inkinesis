import {imageApiKey} from '../imageToRig/config';
/** Hosted edit with an immutable outside-mask composite; never publishes a rig. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {Ledger} from './ledger';
import {editMask,scopedEdit,type Region} from './pixels';
import {decodePNG} from '../generate/png';
import {sha} from './vision';
export async function editCandidate(input:string,out:string,region:Region,instruction:string,kind:'source'|'layers',ledger:Ledger,reference?:string){
 if(existsSync('.env'))process.loadEnvFile('.env');
 const key=imageApiKey();if(!key)throw Error('Missing image API key');
 const model=process.env.IMAGE_MODEL??'',original=readFileSync(input),mask=editMask(original,region),size=decodePNG(original);
 if((region[2]-region[0])*(region[3]-region[1])>.4)throw Error('Repair scope is too broad; manual review required');
 const prompt=`Repair only the transparent masked region of the FIRST image. Preserve the character identity, drawing style, age, anatomy, colors and all unmasked content exactly. Keep the same canvas, framing and placement. ${kind==='layers'?'This is ONE isolated RGBA semantic layer of a layered 2D character, not a complete illustration. Preserve the original alpha silhouette. Facial features such as eyes, eyebrows and mouth are separate layers: do not paint those onto a featureless face-skin layer. Preserve transparency outside that part, do not add a costume or background.':'Keep the requested character design. Do not remove accessories or change clothing to simplify the rig.'} ${reference?'The SECOND image is the original complete character for identity, color and style reference ONLY; do not copy its other layers into the first image.':''} Specific repair: ${instruction}`;
 const id=ledger.reserve(kind),raw=out+'.raw.png';
 writeFileSync(out+'.request.json',JSON.stringify({id,model,prompt,region,inputSha256:sha(original),referenceSha256:reference?sha(readFileSync(reference)):undefined,maskSha256:sha(mask),kind},null,2));writeFileSync(out+'.mask.png',mask);
 try{
 const f=new FormData();f.set('model',model);f.set('prompt',prompt);f.set('size',size.width===size.height?'1024x1024':'1024x1536');
 f.append(reference?'image[]':'image',new Blob([original],{type:'image/png'}),'layer.png');
 if(reference)f.append('image[]',new Blob([readFileSync(reference)],{type:'image/png'}),'identity-reference.png');
 f.set('mask',new Blob([new Uint8Array(mask)],{type:'image/png'}),'mask.png');
 if(kind==='layers')f.set('background','transparent');
 const response=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{authorization:'Bearer '+key},body:f,signal:AbortSignal.timeout(240000)});
 if(!response.ok)throw Error('Image service answered '+response.status);
 const body=await response.json() as {data?:{b64_json?:string}[];usage?:unknown};if(!body.data?.[0]?.b64_json)throw Error('No image returned');
 writeFileSync(raw,Buffer.from(body.data[0].b64_json,'base64'));
 // Normalize returned canvas resolution only; outside-scope pixels are restored from original.
 const normalized=out+'.normalized.png';const p=spawnSync('.venv/bin/python',['-c','from PIL import Image;import sys;Image.open(sys.argv[1]).convert("RGBA").resize((int(sys.argv[3]),int(sys.argv[4])),Image.Resampling.LANCZOS).save(sys.argv[2])',raw,normalized,String(size.width),String(size.height)],{encoding:'utf8'});if(p.status)throw Error('Image normalization failed');
 const scoped=scopedEdit(original,readFileSync(normalized),region);if(!scoped.changedPixels)throw Error('Image edit made no change');
 writeFileSync(out,scoped.png);writeFileSync(out+'.result.json',JSON.stringify({id,model,usage:body.usage,inputSha256:sha(original),outputSha256:sha(scoped.png),changedPixels:scoped.changedPixels,allowedPixels:scoped.allowedPixels,outsideScopeChanged:0},null,2));ledger.finish(id,'complete',body.usage,out);return scoped;
 }catch(e){ledger.finish(id,'failed',undefined,e instanceof Error?e.message:'Error');throw e;}
}
