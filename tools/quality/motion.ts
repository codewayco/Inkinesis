/** Isolated post-build pose review. Requires no browser or running UI server. */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readInp,inpParts} from '../rig/inp';
import {measurePuppet} from '../verify/measurePuppet';
import {judge,sha,POLICY} from './vision';
import {Ledger} from './ledger';
export function qualityPoses(){
 const head:{label:string;values:Record<string,number[]>}[]=[{label:'rest',values:{}}];
 for(const [name,axis,limit] of [['yaw',0,45],['pitch',1,30],['roll',2,30]] as const)for(const t of [-1,-.5,.5,1])head.push({label:name+' '+limit*t,values:axis===2?{ParamAngleZ:[limit*t]}:{'Head Angles':axis===0?[limit*t,0]:[0,limit*t]}});
 for(const x of [-45,45])for(const y of [-30,30])for(const z of [-30,30])head.push({label:`Y${x} P${y} R${z}`,values:{'Head Angles':[x,y],ParamAngleZ:[z]}});
 for(const p of [-30,0,30])for(const e of ['jaw','blink'])head.push({label:`P${p} ${e}`,values:{'Head Angles':[0,p],...(e==='jaw'?{ParamMouthOpenY:[1]}:{ParamEyeLOpen:[0],ParamEyeROpen:[0]})}});
 head.push({label:'moderate combined',values:{'Head Angles':[20,15],ParamAngleZ:[-15],ParamMouthOpenY:[.5],'Arm L':[15,30],'Leg R':[-10,20],ParamBodySway:[.5],ParamGarmentSway:[.5]}});
 const body=[{label:'body rest',values:{}},{label:'arms in',values:{'Arm L':[30,60],'Arm R':[-30,-60]}},{label:'arms out',values:{'Arm L':[-30,-60],'Arm R':[30,60]}},{label:'legs flex',values:{'Leg L':[25,60],'Leg R':[-25,60]}},{label:'opposite legs',values:{'Leg L':[-25,30],'Leg R':[25,30]}},{label:'garment left',values:{ParamGarmentSway:[-1],ParamBodySway:[-1],ParamBreath:[1]}},{label:'garment right',values:{ParamGarmentSway:[1],ParamBodySway:[1],ParamBreath:[1]}},{...head.at(-1)!,label:'body moderate'}];
 return {head,body};
}
export async function motionQuality(source:string,inp:string,home:string,verifier:string){
 mkdirSync(home,{recursive:true});const {puppet}=readInp(readFileSync(inp)),samples=qualityPoses(),controls=new Set(puppet.param.map(p=>p.name));
 const requested=[...samples.head,...samples.body];
 const evaluated=requested.map(p=>({...p,values:Object.fromEntries(Object.entries(p.values).filter(([name])=>controls.has(name)).map(([name,v])=>[name,[v![0],v![1]??0]]))}));
 writeFileSync(join(home,'samples.json'),JSON.stringify(evaluated));
 writeFileSync(join(home,'protocol.json'),JSON.stringify({...samples,note:'Discrete native poses. Unsupported controls omitted explicitly; no continuous-motion guarantee.',omittedControls:[...new Set(requested.flatMap(p=>Object.keys(p.values)).filter(k=>!controls.has(k)))]},null,2));
 const r=spawnSync(verifier,['--pose',join(home,'poses.json'),inp,join(home,'samples.json')],{encoding:'utf8'});writeFileSync(join(home,'native.log'),(r.stdout??'')+'\n'+(r.stderr??''));if(r.status!==0)throw Error('Isolated native motion capture failed');
 const native=JSON.parse(readFileSync(join(home,'poses.json'),'utf8')),labels=new Set(requested.map(p=>p.label));
 native.frames=native.frames.filter((f:{label:string})=>labels.has(f.label));
 if(new Set(native.frames.map((f:{label:string})=>f.label)).size!==labels.size)throw Error('Native review poses are incomplete');
 writeFileSync(join(home,'review-poses.json'),JSON.stringify(native));
 measurePuppet(inp,join(home,'review-poses.json'),source,join(home,'frames'));
 const face=inpParts(puppet).find(p=>p.name==='face');if(!face?.mesh)throw Error('No face mesh for motion review framing');
 const canvas=puppet.meta.canvas as {width:number;height:number},xs=face.mesh.verts.filter((_,i)=>!(i%2)),ys=face.mesh.verts.filter((_,i)=>i%2),fh=Math.max(...ys)-Math.min(...ys),fw=Math.max(...xs)-Math.min(...xs);
 writeFileSync(join(home,'crop.json'),JSON.stringify({cx:(Math.min(...xs)+Math.max(...xs))/2+canvas.width/2,cy:Math.min(...ys)+fh*.85+canvas.height/2,width:Math.max(fw*2.8,fh*1.8),height:fh*2.3}));
 const python=spawnSync('.venv/bin/python',['tools/quality/motionEvidence.py',home],{encoding:'utf8'});if(python.status!==0)throw Error('Motion contact sheet failed: '+python.stderr);
 const ledger=new Ledger(join(home,'journal.json'),sha(readFileSync(inp))+sha(readFileSync(source))+sha(POLICY));
 try{return await judge([{label:'Original source',path:source},{label:'Native runtime head pose samples',path:join(home,'head.png')},{label:'Native runtime body stress samples',path:join(home,'body.png')}],join(home,'assessment.json'),ledger,'Motion review only. Describe observed artwork/seam failures separately from suspected causes. No prior model assessment is supplied. Discrete samples do not certify continuous motion.');}finally{ledger.close();}
}
