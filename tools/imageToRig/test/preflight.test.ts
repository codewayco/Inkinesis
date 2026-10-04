import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runPipeline} from '../pipeline';

const mocks=vi.hoisted(()=>({preflight:vi.fn(()=>({available:false,missing:['fixture: stop before paid work'],config:{}})),release:vi.fn()}));
vi.mock('../config',()=>({preflight:mocks.preflight,outputRoot:()=>'/unused-test-output',imageApiKey:()=>undefined}));
vi.mock('../lock',()=>({acquireRun:()=>mocks.release}));
const dirs:string[]=[];
afterEach(()=>{dirs.forEach(dir=>rmSync(dir,{recursive:true,force:true}));dirs.length=0;vi.clearAllMocks();});

it.each([
    [{remoteQueue:'/fixture/queue'},false],
    [{remoteQueue:'/fixture/queue',allowLocalFallback:true},true],
    [{},true],
])('checks only the dependencies required by the selected GPU policy: %j',async(policy,local)=>{
    const out=mkdtempSync(join(tmpdir(),'rig-preflight-test-'));dirs.push(out);
    const report=await runPipeline({prompt:'Fixture character',out,...policy});
    expect(mocks.preflight).toHaveBeenCalledWith({local});
    expect(report.status).toBe('failed');
    expect(report.reasons).toEqual(['Missing requirements: fixture: stop before paid work']);
    expect(mocks.release).toHaveBeenCalledOnce();
});
