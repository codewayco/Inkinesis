import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {bridgeStatus,decomposeH100,remoteMkdirPath} from '../decompose';
import {RemoteArtifactError,runDecomposition,uiGpuOptions} from '../../imageToRig/decompositionBackend';
beforeEach(()=>{vi.stubEnv('RIG_REMOTE_KERNEL_ROOT','');vi.stubEnv('RIG_GPU_BACKEND','h100-first');vi.stubEnv('RIG_REMOTE_ROOT','/home/test/inkinesis-gpu');vi.stubEnv('RIG_REMOTE_CONTENTS_ROOT','/home');});
const dirs:string[]=[];
function fixture(){const root=mkdtempSync(join(tmpdir(),'rig-backend-'));dirs.push(root);const queue=join(root,'queue'),out=join(root,'out'),input=join(root,'input.png');mkdirSync(queue);mkdirSync(out);writeFileSync(input,'input fixture');writeFileSync(join(queue,'bridge.json'),JSON.stringify({status:'ready'}));writeFileSync(join(queue,'heartbeat.json'),JSON.stringify({time:Date.now()/1000}));return {queue,out,input};}
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});vi.unstubAllEnvs();});
describe('UI H100-first policy',()=>{
 it('selects the existing queue by default and accepts a server-side override',()=>{vi.stubEnv('RIG_H100_QUEUE','');expect(uiGpuOptions()).toEqual({remoteQueue:'.cache/rig/h100-queue',allowLocalFallback:true});vi.stubEnv('RIG_H100_QUEUE','/tmp/private-queue');expect(uiGpuOptions().remoteQueue).toBe('/tmp/private-queue');});
 it('uses H100 without running local inference on success',async()=>{const work={remote:vi.fn().mockResolvedValue({}),local:vi.fn(),fallback:vi.fn()};expect(await runDecomposition(uiGpuOptions(),work)).toBe('h100');expect(work.local).not.toHaveBeenCalled();});
 it.each(['H100 bridge is not connected','401: token expired','socket disconnected','CUDA worker failed'])('falls back once for %s',async message=>{const order:string[]=[];const work={remote:async()=>{order.push('remote');throw new Error(message);},local:async()=>{order.push('local');},fallback:vi.fn(()=>order.push('fallback'))};expect(await runDecomposition(uiGpuOptions(),work)).toBe('local');expect(order).toEqual(['remote','fallback','local']);expect(work.fallback).toHaveBeenCalledWith(message);});
 it('does not hide a failed local fallback',async()=>{const work={remote:async()=>{throw new Error('offline');},local:async()=>{throw new Error('local failed');},fallback:vi.fn()};await expect(runDecomposition(uiGpuOptions(),work)).rejects.toThrow('local failed');});
 it('keeps explicit H100 CLI jobs strict and integrity failures visible',async()=>{const local=vi.fn(),fallback=vi.fn();await expect(runDecomposition({remoteQueue:'queue'},{remote:async()=>{throw new Error('offline');},local,fallback})).rejects.toThrow('offline');await expect(runDecomposition(uiGpuOptions(),{remote:async()=>{throw new RemoteArtifactError('bad hash');},local,fallback})).rejects.toThrow('bad hash');expect(local).not.toHaveBeenCalled();});
});
describe('queue availability and artifact isolation',()=>{
 it('rejects absent, stale, stopped and malformed heartbeats before scheduling',async()=>{const f=fixture();expect(bridgeStatus(f.queue).ready).toBe(true);writeFileSync(join(f.queue,'heartbeat.json'),JSON.stringify({time:Date.now()/1000-60}));expect(bridgeStatus(f.queue).ready).toBe(false);await expect(decomposeH100(f.input,f.out,f.queue)).rejects.toThrow('heartbeat');expect(readdirSync(f.queue).some(p=>p.endsWith('.request.json'))).toBe(false);writeFileSync(join(f.queue,'heartbeat.json'),'broken');expect(bridgeStatus(f.queue).ready).toBe(false);});
 it('a late remote download cannot overwrite the local fallback',async()=>{const f=fixture();writeFileSync(join(f.out,'decomposition.psd'),'local output');await expect(decomposeH100(f.input,f.out,f.queue,{pickupMs:5,pollMs:1})).rejects.toThrow('connection deadline');const name=readdirSync(f.queue).find(p=>p.endsWith('.request.json'))!;const request=JSON.parse(readFileSync(join(f.queue,name),'utf8'));for(const d of request.downloads)writeFileSync(d.local,'late remote output');expect(readFileSync(join(f.out,'decomposition.psd'),'utf8')).toBe('local output');expect(readdirSync(f.queue).some(p=>p.endsWith('.cancelled.json'))).toBe(true);});
 it('promotes only complete identity-verified remote artifacts',async()=>{const f=fixture(),sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');const pending=decomposeH100(f.input,f.out,f.queue,{pollMs:1});const name=readdirSync(f.queue).find(p=>p.endsWith('.request.json'))!,spec=JSON.parse(readFileSync(join(f.queue,name),'utf8'));const paths=Object.fromEntries(spec.downloads.map((d:{local:string})=>[d.local.split('/').at(-1),d.local]));writeFileSync(paths['decomposition.psd'],'verified remote output');const record={gpu:'NVIDIA H100',inputSha256:sha(f.input),outputSha256:sha(paths['decomposition.psd']),runnerSha256:sha('tools/generate/localSeeThrough.py')};writeFileSync(paths['remote-execution.json'],JSON.stringify(record));writeFileSync(paths['local-decomposition.json'],JSON.stringify({...record,status:'complete',manifestSha256:sha('tools/generate/models/see-through.json')}));writeFileSync(paths['inference.log'],'done');writeFileSync(join(f.queue,name.replace('.request.json','.result.json')),JSON.stringify({status:'complete'}));await pending;expect(readFileSync(join(f.out,'decomposition.psd'),'utf8')).toBe('verified remote output');});
 it('recovers an interrupted download without uploading or rerunning GPU inference',async()=>{
  const f=fixture(),sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
  const pending=decomposeH100(f.input,f.out,f.queue,{pollMs:1});
  const initial=readdirSync(f.queue).find(p=>p.endsWith('.request.json'))!;
  writeFileSync(join(f.queue,initial.replace('.request.json','.result.json')),JSON.stringify({status:'failed',error:'IncompleteRead(100 bytes read, 200 more expected)'}));
  let recovery:string|undefined;
  for(let i=0;i<100&&!recovery;i++){await new Promise(r=>setTimeout(r,5));recovery=readdirSync(f.queue).find(p=>p.endsWith('-download-1.request.json'));}
  expect(recovery).toBeDefined();
  const spec=JSON.parse(readFileSync(join(f.queue,recovery!),'utf8'));
  expect(spec.uploads).toBeUndefined();expect(spec.code).not.toContain('subprocess');
  const paths=Object.fromEntries(spec.downloads.map((d:{local:string})=>[d.local.split('/').at(-1),d.local]));
  writeFileSync(paths['decomposition.psd'],'recovered output');
  const record={gpu:'NVIDIA H100',inputSha256:sha(f.input),outputSha256:sha(paths['decomposition.psd']),runnerSha256:sha('tools/generate/localSeeThrough.py')};
  writeFileSync(paths['remote-execution.json'],JSON.stringify(record));
  writeFileSync(paths['local-decomposition.json'],JSON.stringify({...record,status:'complete',manifestSha256:sha('tools/generate/models/see-through.json')}));
  writeFileSync(paths['inference.log'],'inference completed before transfer failure');
  writeFileSync(join(f.queue,recovery!.replace('.request.json','.result.json')),JSON.stringify({status:'complete'}));
  await pending;
  expect(readFileSync(join(f.out,'decomposition.psd'),'utf8')).toBe('recovered output');
  expect(JSON.parse(readFileSync(join(f.out,'remote-transfer-recovery.json'),'utf8')).inferenceRepeated).toBe(false);
  expect(JSON.parse(readFileSync(join(f.queue,initial.replace('.request.json','.result.json')),'utf8')).status).toBe('failed');
 });

});

describe('kernel directory compatibility',()=>{
 it('distinguishes kernel mkdir paths from Contents API paths',()=>{
  expect(remoteMkdirPath('/home/alex/rig/jobs/id/input.png','/home/alex')).toBe('rig/jobs/id/input.png');
  expect(remoteMkdirPath('/home/alex/rig/jobs/id/input.png','')).toBe('/home/alex/rig/jobs/id/input.png');
  expect(()=>remoteMkdirPath('/home/other/file','/home/alex')).toThrow('inside');
  expect(()=>remoteMkdirPath('/home/alex/../file','/home/alex')).toThrow();
 });
});
