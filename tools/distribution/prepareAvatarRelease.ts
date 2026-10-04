/** Assemble uniquely named release attachments. Never commits, publishes, or uploads. */
import {createHash} from 'node:crypto';
import {createReadStream,readFileSync,mkdirSync,mkdtempSync,copyFileSync,writeFileSync,existsSync,renameSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {readCatalog} from '../../player/avatarCatalog';
const root=resolve('example-avatars'),catalog=readCatalog(JSON.parse(readFileSync(join(root,'catalog.json'),'utf8')));
const out=resolve('.cache/avatar-release');mkdirSync(resolve('.cache'),{recursive:true});
const staging=mkdtempSync(resolve('.cache/avatar-release-'));
const files:string[]=[];
try {
for(const entry of catalog.entries)for(const a of entry.artifacts){
    const path=join(root,entry.id,a.file);if(!existsSync(path))throw new Error('Missing local avatar file: '+path);
    const hash=createHash('sha256');let size=0;
    for await(const chunk of createReadStream(path)){hash.update(chunk);size+=chunk.length;}
    if(size!==a.bytes||hash.digest('hex')!==a.sha256)throw new Error('Avatar integrity mismatch: '+entry.id+'/'+a.file);
    copyFileSync(path,join(staging,a.asset));files.push(a.asset);
}
writeFileSync(join(staging,'SHA256SUMS'),catalog.entries.flatMap(e=>e.artifacts.map(a=>`${a.sha256}  ${a.asset}`)).join('\n')+'\n');
// Replace the complete generated directory only after every artifact verifies.
// Reusing it in place would leave removed/renamed avatars from older releases.
const previous=staging+'-previous';
if(existsSync(out))renameSync(out,previous);
try {renameSync(staging,out);} catch(error) {if(existsSync(previous))renameSync(previous,out);throw error;}
rmSync(previous,{recursive:true,force:true});
console.log(`Prepared ${files.length} release attachments in .cache/avatar-release/. Nothing was uploaded or committed.`);
} finally {rmSync(staging,{recursive:true,force:true});}
