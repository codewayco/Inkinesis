/** Exercise the three observation hooks on saved artifacts, with no regeneration. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {sourceQuality} from './source';
import {preparedQuality} from './prepared';
import {motionQuality} from './motion';
import {sha} from './vision';
const [runArg,inpArg,outArg]=process.argv.slice(2);
if(!runArg||!inpArg||!outArg)throw Error('Usage: checkRun.ts saved-run candidate.inp isolated-output');
const run=resolve(runArg),inp=resolve(inpArg),out=resolve(outArg);
if(out===run||out.startsWith(run+'/'))throw Error('Use a separate observation output directory');
mkdirSync(out,{recursive:true});
const files=[run+'/input.png',run+'/assets/character.psd',inp],hashes=files.map(p=>sha(readFileSync(p)));
try{
 const results=await Promise.allSettled([
  sourceQuality(files[0],out+'/source','observe','Preserve existing character identity and design',false),
  preparedQuality(files[0],files[1],out+'/layers'),
  motionQuality(files[0],inp,out+'/motion','tools/verify/inochi-puppet/inochi-puppet-check')
 ]);
 writeFileSync(out+'/result.json',JSON.stringify(results.map((r,i)=>({stage:['source','layers','motion'][i],status:r.status,...(r.status==='fulfilled'?{assessment:r.value}:{error:String(r.reason)})})),null,2));
 if(results.some(r=>r.status==='rejected'))process.exitCode=1;
}finally{
 const unchanged=files.every((p,i)=>sha(readFileSync(p))===hashes[i]);writeFileSync(out+'/integrity.json',JSON.stringify({unchanged,files:files.map((p,i)=>({path:p,sha256:hashes[i]}))},null,2));if(!unchanged){console.error('Protected artifact changed');process.exitCode=1;}
}
