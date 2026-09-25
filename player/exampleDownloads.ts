/** Verified, bounded release downloads. Existing local rigs remain intact on failure. */
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,mkdir,open,realpath,readdir,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {AvatarCatalog,AvatarEntry} from './avatarCatalog';

export interface DownloadState { status:'missing'|'ready'|'downloading'|'failed'; received:number; total:number; error?:string }
type Fetcher=(url:string,signal:AbortSignal)=>Promise<Response>;
export function releaseBase(value:string|null|undefined):string|undefined {
    if(!value)return undefined;
    const u=new URL(value);
    if(u.protocol!=='https:'||u.hostname!=='github.com'||u.port||u.username||u.password||u.search||u.hash||
        !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[A-Za-z0-9_.-]+\/?$/.test(u.pathname))
        throw new Error('Use an HTTPS GitHub release URL: https://github.com/OWNER/REPO/releases/download/TAG');
    return u.href.replace(/\/$/,'');
}
async function githubFetch(url:string,signal:AbortSignal):Promise<Response> {
    for(let n=0;n<6;n++) {
        const u=new URL(url);
        if(u.protocol!=='https:'||u.username||u.password||u.port||!(u.hostname==='github.com'||u.hostname.endsWith('.githubusercontent.com')))
            throw new Error('Release redirected to an unsupported host');
        const response=await fetch(u,{signal,redirect:'manual'});
        if([301,302,303,307,308].includes(response.status)) {
            const location=response.headers.get('location');await response.body?.cancel();
            if(!location)throw new Error('Invalid release redirect');
            url=new URL(location,url).href;continue;
        }
        return response;
    }
    throw new Error('Too many release redirects');
}
async function plain(path:string,directory=false) {
    const s=await lstat(path);
    if(s.isSymbolicLink()||!(directory?s.isDirectory():s.isFile()))throw new Error('Linked or invalid avatar path');
    return s;
}
export class ExampleDownloads {
    private jobs=new Map<string,DownloadState>();
    private tasks=new Map<string,Promise<void>>();
    private controllers=new Set<AbortController>();
    private verified=new Map<string,string>();
    readonly base?:string;
    constructor(readonly root:string,readonly catalog:AvatarCatalog,base?:string,private fetcher:Fetcher=githubFetch) {
        this.root=resolve(root);this.base=releaseBase(base??catalog.release.baseUrl);
    }
    private entry(id:string):AvatarEntry {
        const entry=this.catalog.entries.find(e=>e.id===id);if(!entry)throw new Error('Unknown avatar');return entry;
    }
    private async safeRoot() {
        await plain(this.root,true);
        if(await realpath(this.root)!==this.root)throw new Error('Linked avatar root is unsupported');
    }
    private async installed(e:AvatarEntry):Promise<boolean> {
        try {
            await this.safeRoot();await plain(join(this.root,e.id),true);
            for(const a of e.artifacts) {
                const path=join(this.root,e.id,a.file),s=await plain(path);
                if(s.size!==a.bytes)return false;
                const stamp=`${s.size}:${s.mtimeMs}:${s.ctimeMs}:${a.sha256}`;
                if(this.verified.get(path)!==stamp) {
                    const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
                    if(hash.digest('hex')!==a.sha256)return false;this.verified.set(path,stamp);
                }
            }
            return true;
        } catch {return false;}
    }
    async state(id:string):Promise<DownloadState> {
        const e=this.entry(id),job=this.jobs.get(id),total=e.artifacts.reduce((s,a)=>s+a.bytes,0);
        if(job?.status==='downloading')return {...job};
        if(await this.installed(e))return {status:'ready',received:total,total};
        return job?.status==='failed'?{...job}:{status:'missing',received:0,total};
    }
    async start(id:string) {
        const e=this.entry(id),current=await this.state(id);
        if(current.status==='ready'||this.tasks.has(id))return;
        if(!this.base)throw new Error('Example downloads are not published yet. Set INKINESIS_AVATAR_RELEASE_URL after uploading the release assets.');
        if(this.tasks.size>=2)throw new Error('Two avatar downloads are already running. Wait for one to finish.');
        const job:DownloadState={status:'downloading',received:0,total:current.total};this.jobs.set(id,job);
        const task=this.download(e,job).catch(error=>{job.status='failed';job.error=String(error.message??error);}).finally(()=>{this.tasks.delete(id);});
        this.tasks.set(id,task);
    }
    async wait(id:string) {await this.tasks.get(id);return this.state(id);}
    async close() {for(const c of this.controllers)c.abort();await Promise.all(this.tasks.values());}
    private async download(e:AvatarEntry,job:DownloadState) {
        await this.safeRoot();
        const temporary=join(this.root,'.downloads');await mkdir(temporary,{recursive:true});await plain(temporary,true);
        const stage=join(temporary,e.id+'-'+randomUUID()),backup=stage+'-previous',dest=join(this.root,e.id);
        const controller=new AbortController();this.controllers.add(controller);
        const timer=setTimeout(()=>controller.abort(),10*60*1000);
        let backedUp=false;
        try {
            await mkdir(stage);
            for(const a of e.artifacts) {
                const response=await this.fetcher(`${this.base}/${a.asset}`,controller.signal);
                if(!response.ok||!response.body){await response.body?.cancel();throw new Error(`Release asset unavailable (HTTP ${response.status}). Retry after the release is published.`);}
                const handle=await open(join(stage,a.file),'wx');let bytes=0;const hash=createHash('sha256');
                const reader=response.body.getReader();
                try {
                    for(;;) {
                        const {done,value:chunk}=await reader.read();if(done)break;
                        if(controller.signal.aborted)throw new Error('Download cancelled');
                        bytes+=chunk.byteLength;if(bytes>a.bytes)throw new Error('Release asset is larger than the catalog size');
                        hash.update(chunk);await handle.writeFile(chunk);job.received+=chunk.byteLength;
                    }
                } finally {await reader.cancel().catch(()=>{});await handle.close();}
                if(bytes!==a.bytes||hash.digest('hex')!==a.sha256)throw new Error('Download integrity check failed. Existing local files were preserved; retry the download.');
            }
            try {await plain(dest,true);if((await readdir(dest)).some(name=>!e.artifacts.some(a=>a.file===name)))throw new Error('Avatar folder contains additional files; move them before replacing this avatar.');await rename(dest,backup);backedUp=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
            try {await rename(stage,dest);}catch(error){if(backedUp)await rename(backup,dest);throw error;}
            await rm(backup,{recursive:true,force:true});job.status='ready';
        } finally {clearTimeout(timer);this.controllers.delete(controller);await rm(stage,{recursive:true,force:true});}
    }
}
