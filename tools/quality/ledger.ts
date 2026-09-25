/** Persistent attempt reservation, no counter reset on resume and no hidden retries. */
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
export type Operation='analysis'|'source'|'layers';
interface Entry {id:number;operation:Operation;state:'reserved'|'complete'|'failed';started:string;seconds?:number;usage?:unknown;result?:string}
interface State {version:1;inputSignature:string;started:string;limits:{source:number;layers:number;analysis:number;wallSeconds:number};entries:Entry[]}
export class Ledger {
 private state:State;private lock:string;
 constructor(private file:string,signature:string){
  mkdirSync(dirname(file),{recursive:true});this.lock=file+'.lock';const fd=openSync(this.lock,'wx');closeSync(fd);
  try{
   this.state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:1,inputSignature:signature,started:new Date().toISOString(),limits:{source:2,layers:2,analysis:12,wallSeconds:3600},entries:[]};
   if(this.state.version!==1||this.state.inputSignature!==signature)throw Error('Quality journal belongs to different evidence or policy');
  }catch(e){unlinkSync(this.lock);throw e;}
 }
 private save(){writeFileSync(this.file+'.tmp',JSON.stringify(this.state,null,2)+'\n');renameSync(this.file+'.tmp',this.file);}
 reserve(operation:Operation){
  if((Date.now()-Date.parse(this.state.started))/1000>this.state.limits.wallSeconds)throw Error('Quality job deadline exhausted');
  if(this.state.entries.filter(e=>e.operation===operation).length>=this.state.limits[operation])throw Error(operation+' attempt budget exhausted');
  const entry:Entry={id:this.state.entries.length,operation,state:'reserved',started:new Date().toISOString()};this.state.entries.push(entry);this.save();return entry.id;
 }
 finish(id:number,state:'complete'|'failed',usage?:unknown,result?:string){const e=this.state.entries[id];if(!e||e.state!=='reserved')throw Error('Invalid attempt completion');Object.assign(e,{state,usage,result,seconds:(Date.now()-Date.parse(e.started))/1000});this.save();}
 snapshot(){return structuredClone(this.state);}
 close(){unlinkSync(this.lock);}
}
