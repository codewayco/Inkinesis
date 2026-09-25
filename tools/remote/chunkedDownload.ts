/** Recover existing artifacts through small Contents API responses; never rerun inference. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,dirname} from 'node:path';
type Transfer={remote:string;local:string};
type Part={name:string;sha256:string};
type ManifestFile={remote:string;size:number;sha256:string;parts:Part[]};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

export function assembleDownload(file:ManifestFile,partsFolder:string):Buffer {
 const parts=file.parts.map(part=>{
  if(!/^\d+-\d+\.bin$/.test(part.name))throw new Error('Invalid transfer part name');
  const bytes=readFileSync(join(partsFolder,part.name));
  if(sha(bytes)!==part.sha256)throw new Error('Transfer part hash mismatch: '+part.name);
  return bytes;
 });
 const bytes=Buffer.concat(parts);
 if(bytes.length!==file.size||sha(bytes)!==file.sha256)throw new Error('Assembled artifact hash/length mismatch');
 return bytes;
}

export async function chunkedDownload(queue:string,downloads:Transfer[],contentsRoot:string) {
 const id='000-chunks-'+randomUUID(),folder=join(dirname(downloads[0].local),id);
 mkdirSync(folder,{recursive:true});
 const remoteDir=dirname(downloads[0].remote)+'/'+id;
 if(!contentsRoot.startsWith('/')||downloads.some(d=>d.remote.startsWith('/')||d.remote.includes('..')))throw new Error('Invalid remote artifact path');
 const submit=async(suffix:string,spec:unknown)=>{
  const path=join(queue,id+'-'+suffix+'.request.json');
  writeFileSync(path+'.pending',JSON.stringify(spec));renameSync(path+'.pending',path);
  const result=path.replace('.request.json','.result.json'),start=Date.now();
  while(!existsSync(result)&&Date.now()-start<360_000)await new Promise(r=>setTimeout(r,1000));
  if(!existsSync(result)){
   writeFileSync(path.replace('.request.json','.cancelled.json'),JSON.stringify({reason:'Chunk transfer deadline expired'}));
   throw new Error('Chunk transfer deadline expired');
  }
  return JSON.parse(readFileSync(result,'utf8'));
 };
 const manifestPath=join(folder,'manifest.json');
 const code=`import json, hashlib\nfrom pathlib import Path\nbase=Path(${JSON.stringify(contentsRoot)})\nfolder=base/${JSON.stringify(remoteDir)}\nfolder.mkdir(parents=True,exist_ok=True)\nrecords=[]\nfor i,relative in enumerate(${JSON.stringify(downloads.map(d=>d.remote))}):\n data=(base/relative).read_bytes()\n parts=[]\n for j,start in enumerate(range(0,len(data),512*1024)):\n  block=data[start:start+512*1024]\n  name=f'{i}-{j}.bin'\n  (folder/name).write_bytes(block)\n  parts.append({'name':name,'sha256':hashlib.sha256(block).hexdigest()})\n records.append({'remote':relative,'size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'parts':parts})\n(folder/'manifest.json').write_text(json.dumps(records))\nprint('Prepared small transfer parts from existing artifacts; no inference rerun',flush=True)`;
 const prepared=await submit('prepare',{code,downloads:[{remote:remoteDir+'/manifest.json',local:manifestPath}],timeout:120});
 if(prepared.status!=='complete')throw new Error('Chunk preparation failed: '+prepared.error);
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as ManifestFile[];
 if(manifest.length!==downloads.length||manifest.some((f,i)=>f.remote!==downloads[i].remote))throw new Error('Chunk manifest identity mismatch');
 for(let attempt=1;attempt<=4;attempt++){
  const missing=manifest.flatMap(f=>f.parts).filter(part=>{
   if(!/^\d+-\d+\.bin$/.test(part.name))throw new Error('Invalid transfer part name');
   const p=join(folder,part.name);return !existsSync(p)||sha(readFileSync(p))!==part.sha256;
  });
  if(!missing.length)break;
  await submit('fetch-'+attempt,{code:'print("Resuming verified artifact part download",flush=True)',downloads:missing.map(p=>({remote:remoteDir+'/'+p.name,local:join(folder,p.name)})),timeout:120});
 }
 // Validate all files before replacing any isolated attempt output.
 const assembled=manifest.map(f=>assembleDownload(f,folder));
 downloads.forEach((d,i)=>{writeFileSync(d.local+'.chunk-pending',assembled[i]);renameSync(d.local+'.chunk-pending',d.local);});
 return {id,manifest:manifestPath,inferenceRepeated:false,chunkBytes:512*1024};
}
