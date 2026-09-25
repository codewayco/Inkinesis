import {mkdirSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {judge,sha,POLICY} from './vision';
import {Ledger} from './ledger';
export async function preparedQuality(source:string,psd:string,home:string){
 mkdirSync(home,{recursive:true});const signature=sha(readFileSync(source))+sha(readFileSync(psd))+sha(POLICY),ledger=new Ledger(home+'/journal.json',signature);
 try{
 const r=spawnSync('.venv/bin/python',['tools/quality/preparedEvidence.py',source,psd,home],{encoding:'utf8'});if(r.status)throw Error('Prepared evidence failed: '+r.stderr);
 return await judge([{label:'Source normalized to preparation canvas',path:home+'/reference.png'},{label:'Diagnostic neutral composite; expression alternates excluded, final runtime not yet built',path:home+'/neutral.png'},{label:'Isolated semantic parts; hidden support pixels can be intentional',path:home+'/parts.png'}],home+'/assessment.json',ledger,'Layer preparation review only. Do not diagnose source suitability or head motion without corresponding evidence. Report uncertainty for mismatches that depend on final runtime masks. Numeric diagnostics: '+readFileSync(home+'/metrics.json','utf8'));
 }finally{ledger.close();}
}
