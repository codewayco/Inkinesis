/** Upload review is separate from rig jobs: GPU work starts only on confirmation. */
import type {ViteDevServer} from 'vite';
import type {IncomingMessage} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,createReadStream,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareUpload,assessUpload,redrawUpload,digest,type UploadReview} from '../tools/imageToRig/uploadReview';

export interface AcceptedUpload {dir:string;image:string;selection:'original'|'redrawn';review:UploadReview}
async function requestBytes(req:IncomingMessage,limit=20*1024*1024) {
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req.iterator({destroyOnReturn:false})){
        size+=chunk.length;
        if(size>limit){req.resume();throw Error('Upload exceeds the size limit.');}
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
export function attachUploadRoutes(server:ViteDevServer,options:{busy:()=>boolean;start:(upload:AcceptedUpload)=>{id:string;base:string;saved:boolean}}) {
    const sessions=new Map<string,{dir:string;review:UploadReview}>();let temporary:string|undefined;
    const busy=()=>[...sessions.values()].some(s=>['checking','redrawing'].includes(s.review.status));
    const dispose=()=>{if(temporary)rmSync(temporary,{recursive:true,force:true});sessions.clear();};
    server.httpServer?.once('close',dispose);
    server.middlewares.use('/api/rig/uploads',(req,res)=>{
        const send=(status:number,value:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
        const path=(req.url??'/').split('?')[0];
        if(req.method==='POST'&&req.headers.origin&&!['http://'+req.headers.host,'https://'+req.headers.host].includes(req.headers.origin))return send(403,{error:'Same-origin requests only'});
        const match=path.match(/^\/([a-f0-9-]{36})(?:\/(original\.png|candidate\.png|redraw|confirm))?$/);
        if(req.method==='GET'){
            const entry=match&&sessions.get(match[1]);if(!entry)return send(404,{error:'Upload preview expired. Please select the image again.'});
            if(!match![2])return send(200,entry.review);
            if(!['original.png','candidate.png'].includes(match![2]))return send(404,{error:'Unknown preview'});
            const file=join(entry.dir,match![2]);if(!existsSync(file))return send(404,{error:'Preview is not ready'});
            res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
            const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return;
        }
        if(req.method!=='POST')return send(405,{error:'Method not allowed'});
        if(options.busy()||busy())return send(409,{error:'Wait for the current image check, redraw or generation to finish.'});
        if(path==='/'||path===''){
            const type=(req.headers['content-type']??'').split(';')[0];
            if(!['image/png','image/jpeg','image/webp'].includes(type))return send(415,{error:'Choose a PNG, JPEG or WebP image.'});
            // Reserve while receiving the body, so concurrent uploads cannot start paid work.
            const id=randomUUID(),dir=join(temporary??=mkdtempSync(join(tmpdir(),'inkinesis-uploads-')),id);
            const entry={dir,review:{id,status:'checking'} as UploadReview};sessions.set(id,entry);
            void requestBytes(req).then(bytes=>{
                send(202,entry.review);
                return prepareUpload(bytes,dir).then(original=>{entry.review={id,status:'ready',original};});
            }).catch(()=>{entry.review={id,status:'failed',error:'The image could not be opened or checked. Choose a valid PNG, JPEG or WebP under 20 MB and 36 megapixels.'};if(!res.writableEnded)send(400,entry.review);});return;
        }
        const entry=match&&sessions.get(match[1]);
        if(!entry)return send(404,{error:'Upload preview expired. Please select the image again.'});
        if(entry.review.status!=='ready')return send(409,{error:'This upload is not ready or was already used.'});
        if(match![2]==='redraw'){
            entry.review.status='redrawing';entry.review.error=undefined;entry.review.candidate=undefined;
            send(202,entry.review);
            void redrawUpload(join(entry.dir,'original.png'),join(entry.dir,'candidate.png'),join(entry.dir,'redraw.json'))
                .then(()=>assessUpload(join(entry.dir,'candidate.png'),join(entry.dir,'candidate-check.json')))
                .then(candidate=>{entry.review.candidate=candidate;})
                .catch(error=>{entry.review.error=error instanceof Error?error.message:'Redraw failed. The original is unchanged.';})
                .finally(()=>{entry.review.status='ready';});return;
        }
        if(match![2]==='confirm'){
            // Reserve synchronously; duplicate confirmation must never launch two rigs.
            entry.review.status='used';
            void requestBytes(req,4096).then(bytes=>{
                const body=JSON.parse(bytes.toString());
                if(!['original','redrawn'].includes(body.selection))throw Error('Choose the original or the redraw.');
                const assessment=body.selection==='original'?entry.review.original:entry.review.candidate;
                const image=join(entry.dir,body.selection==='original'?'original.png':'candidate.png');
                if(!assessment||body.sha256!==assessment.sha256||digest(readFileSync(image))!==body.sha256)throw Error('The preview changed. Review the current image before confirming.');
                if(options.busy()||busy())throw Error('Another job started. Please try again when it finishes.');
                send(202,options.start({dir:entry.dir,image,selection:body.selection,review:structuredClone(entry.review)}));
            }).catch(error=>{entry.review.status='ready';send(409,{error:error instanceof Error?error.message:'Invalid confirmation'});});return;
        }
        send(404,{error:'Unknown upload action'});
    });
    return {busy,dispose};
}
