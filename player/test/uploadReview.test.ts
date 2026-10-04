import {describe,it,expect,vi,afterEach} from 'vitest';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {ViteDevServer} from 'vite';
import {attachUploadRoutes,type AcceptedUpload} from '../uploadDevServer';
import {digest,type UploadAssessment} from '../../tools/imageToRig/uploadReview';

const fixtures=vi.hoisted(()=>({original:Buffer.from('original verified pixels'),candidate:Buffer.from('candidate verified pixels'),redrawFails:false}));
vi.mock('../../tools/imageToRig/uploadReview',async importOriginal=>{
    const actual=await importOriginal<typeof import('../../tools/imageToRig/uploadReview')>();
    const assessment=(bytes:Buffer):UploadAssessment=>({width:1024,height:1536,sha256:actual.digest(bytes),kind:'illustration',checks:[],recommendRedraw:false});
    return {...actual,prepareUpload:vi.fn(async(bytes:Buffer,dir:string)=>{mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'original.png'),bytes);return assessment(bytes);}),
        redrawUpload:vi.fn(async(_input:string,output:string)=>{if(fixtures.redrawFails)throw Error('Service unavailable');writeFileSync(output,fixtures.candidate);}),
        assessUpload:vi.fn(async(path:string)=>assessment(readFileSync(path)))};
});
afterEach(()=>{fixtures.redrawFails=false;vi.clearAllMocks();});
async function harness(work:(api:{post:(path:string,body?:unknown)=>Promise<Response>;get:(path:string)=>Promise<Response>;start:ReturnType<typeof vi.fn>})=>Promise<void>){
    let handler!:(req:IncomingMessage,res:ServerResponse)=>void;
    const server=createServer((req,res)=>handler(req,res));
    const start=vi.fn((_accepted:AcceptedUpload)=>({id:'confirmed-job',base:'/files/job',saved:false}));
    const uploads=attachUploadRoutes({middlewares:{use:(_path:string,fn:typeof handler)=>{handler=fn;}},httpServer:server} as unknown as ViteDevServer,{busy:()=>false,start});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address() as {port:number},base=`http://127.0.0.1:${address.port}`;
    const post=(path:string,body?:unknown)=>fetch(base+path,{method:'POST',headers:{'content-type':Buffer.isBuffer(body)?'image/png':'application/json'},body:Buffer.isBuffer(body)?new Uint8Array(body).buffer:JSON.stringify(body)});
    try{await work({post,get:path=>fetch(base+path),start});}
    finally{uploads.dispose();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
async function ready(get:(path:string)=>Promise<Response>,id:string){
    let r;for(let i=0;i<100;i++){r=await(await get('/'+id)).json();if(r.status==='ready')return r;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Not ready');
}
describe('Upload approval boundary',()=>{
    it('rejects oversized bodies with a readable response and releases the upload slot',async()=>harness(async({post,get,start})=>{
        const oversized=await post('/',Buffer.alloc(20*1024*1024+1));
        expect(oversized.status).toBe(400);expect((await oversized.json()).status).toBe('failed');
        const {id}=await(await post('/',fixtures.original)).json();await ready(get,id);
        const badConfirm=await post('/'+id+'/confirm',{padding:'x'.repeat(5000)});
        expect(badConfirm.status).toBe(409);expect((await badConfirm.json()).error).toContain('size limit');
        expect((await post('/'+id+'/confirm',{selection:'original',sha256:digest(fixtures.original)})).status).toBe(202);
        expect(start).toHaveBeenCalledOnce();
    }));
    it('checks and redraws without starting a rig; accepts only the current displayed candidate once',async()=>harness(async({post,get,start})=>{
        const {id}=await(await post('/',fixtures.original)).json();await ready(get,id);expect(start).not.toHaveBeenCalled();
        expect((await post('/'+id+'/redraw')).status).toBe(202);const review=await ready(get,id);expect(start).not.toHaveBeenCalled();
        expect((await post('/'+id+'/confirm',{selection:'redrawn',sha256:'stale'})).status).toBe(409);expect(start).not.toHaveBeenCalled();
        expect((await post('/'+id+'/confirm',{selection:'redrawn',sha256:review.candidate.sha256})).status).toBe(202);
        expect(readFileSync(start.mock.calls[0][0].image)).toEqual(fixtures.candidate);
        expect((await post('/'+id+'/confirm',{selection:'redrawn',sha256:review.candidate.sha256})).status).toBe(409);expect(start).toHaveBeenCalledTimes(1);
    }));
    it('retains the original and allows explicit as-is confirmation after a failed redraw',async()=>harness(async({post,get,start})=>{
        const {id}=await(await post('/',fixtures.original)).json();await ready(get,id);fixtures.redrawFails=true;
        await post('/'+id+'/redraw');const review=await ready(get,id);expect(review.error).toContain('Service unavailable');
        expect((await post('/'+id+'/confirm',{selection:'original',sha256:digest(fixtures.original)})).status).toBe(202);
        expect(readFileSync(start.mock.calls[0][0].image)).toEqual(fixtures.original);
    }));
    it('rejects an ungenerated candidate and expires unknown upload ids',async()=>harness(async({post,get,start})=>{
        const {id}=await(await post('/',fixtures.original)).json();await ready(get,id);
        expect((await post('/'+id+'/confirm',{selection:'redrawn',sha256:digest(fixtures.original)})).status).toBe(409);
        expect((await get('/00000000-0000-0000-0000-000000000000')).status).toBe(404);expect(start).not.toHaveBeenCalled();
    }));
});
