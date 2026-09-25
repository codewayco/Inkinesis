import {beforeEach, afterAll, afterEach, describe, expect, it, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ViteDevServer} from 'vite';
import {combinedDevServer} from '../combinedDevServer';

const mocks = vi.hoisted(() => ({run:vi.fn().mockResolvedValue(undefined), root:{path:''}}));
vi.mock('../../tools/imageToRig/pipeline', () => ({runPipeline:mocks.run, get RUN_ROOT(){return mocks.root.path;}}));
vi.mock('../../tools/imageToRig/config', () => ({loadEnvironment:()=>{},preflight:()=>({available:true,missing:[]}),outputRoot:()=>mocks.root.path}));
vi.mock('../../tools/imageToRig/lock', () => ({activeRun:()=>null}));
mocks.root.path = mkdtempSync(join(tmpdir(),'ui-backend-'));
beforeEach(()=>vi.stubEnv('RIG_GPU_BACKEND','h100-first'));
afterEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();});
afterAll(()=>rmSync(mocks.root.path,{recursive:true,force:true}));

function request(method:string, type:string, body:Buffer) {
    let handler!:(req:IncomingMessage,res:ServerResponse)=>void;
    const plugin=combinedDevServer(), configure=plugin.configureServer!;
    const server={middlewares:{use:(_path:string,fn:typeof handler)=>{handler=fn;}}} as unknown as ViteDevServer;
    if(typeof configure==='function')configure.call({} as never,server);
    const req=Object.assign(new EventEmitter(),{url:'/',method,headers:{'content-type':type,host:'localhost:5173'}});
    const response={statusCode:0,setHeader:vi.fn(),end:vi.fn()};
    handler(req as IncomingMessage,response as unknown as ServerResponse);
    req.emit('data',body);req.emit('end');
    return response;
}

describe('Generate API backend selection',()=>{
    it('routes prompt generation through H100-first with local fallback',()=>{
        vi.stubEnv('RIG_H100_QUEUE','');
        const response=request('POST','application/json',Buffer.from(JSON.stringify({prompt:'An original character'})));
        expect(response.statusCode).toBe(202);
        expect(mocks.run.mock.calls[0][0].out).toContain('inkinesis-preview-');
        expect(mocks.run.mock.calls[0][0].out).not.toContain(mocks.root.path);
        expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({prompt:'An original character',image:undefined,remoteQueue:'.cache/rig/h100-queue',allowLocalFallback:true}),expect.any(Function));
    });
    it('routes image uploads through the same policy and preserves input bytes',()=>{
        vi.stubEnv('RIG_H100_QUEUE','/tmp/custom-h100-queue');
        const bytes=Buffer.from('upload fixture'),response=request('POST','image/png',bytes);
        expect(response.statusCode).toBe(202);
        const options=mocks.run.mock.calls[0][0];
        expect(options).toMatchObject({prompt:undefined,remoteQueue:'/tmp/custom-h100-queue',allowLocalFallback:true});
        expect(readFileSync(options.image)).toEqual(bytes);
    });
    it('reports local fallback availability when the bridge is absent',()=>{
        vi.stubEnv('RIG_H100_QUEUE',join(mocks.root.path,'absent'));
        const response=request('GET','',Buffer.alloc(0));
        expect(JSON.parse(response.end.mock.calls[0][0])).toMatchObject({available:true,decomposition:{policy:'h100-first',ready:false}});
        expect(mocks.run).not.toHaveBeenCalled();
    });
});
