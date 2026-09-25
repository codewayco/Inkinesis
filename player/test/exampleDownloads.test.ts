import {afterEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ExampleDownloads,releaseBase} from '../exampleDownloads';
import {readCatalog,type AvatarCatalog} from '../avatarCatalog';
const payloads=[Buffer.from('rig bytes'),Buffer.from('zip bytes')];
function catalog():AvatarCatalog{return {release:{baseUrl:'https://github.com/example/inkinesis/releases/download/avatars-v1'},entries:[{
    id:'01-demo',label:'Demo',base:'/example-avatars/01-demo',preview:'/example-avatars/previews/01-demo.webp',files:{'Download rig':'character.inp','Live2D package':'Live2D.zip'},
    artifacts:payloads.map((b,i)=>({file:i?'Live2D.zip':'character.inp',asset:i?'01-demo-live2d.zip':'01-demo.inp',bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})),
}]};}
const roots:string[]=[];const stores:ExampleDownloads[]=[];
function root(){const r=realpathSync(mkdtempSync(join(tmpdir(),'inkinesis-download-test-')));roots.push(r);return r;}
function store(r:string,c=catalog(),fetcher=async(url:string)=>new Response(payloads[url.endsWith('.zip')?1:0])){const s=new ExampleDownloads(r,c,undefined,fetcher);stores.push(s);return s;}
afterEach(async()=>{await Promise.all(stores.splice(0).map(s=>s.close()));for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
describe('downloadable examples',()=>{
    it('downloads both files, verifies them, reuses local files after restart without any network',async()=>{
        const r=root(),s=store(r);expect((await s.state('01-demo')).status).toBe('missing');await s.start('01-demo');
        expect((await s.wait('01-demo')).status).toBe('ready');
        expect(readFileSync(join(r,'01-demo','character.inp'))).toEqual(payloads[0]);
        const c=catalog();c.release.baseUrl=null;
        const restarted=store(r,c,async()=>{throw new Error('Unexpected network');});await restarted.start('01-demo');
        expect((await restarted.state('01-demo')).status).toBe('ready');
    });
    it('keeps previous files when a later file has a bad hash, cleans partial files and supports retry',async()=>{
        const r=root();mkdirSync(join(r,'01-demo'));writeFileSync(join(r,'01-demo','character.inp'),'old rig');
        let damaged=true;
        const s=store(r,catalog(),async(url)=>new Response(url.endsWith('.zip')&&damaged?Buffer.from('bad bytes'):payloads[url.endsWith('.zip')?1:0]));
        await s.start('01-demo');expect((await s.wait('01-demo')).status).toBe('failed');
        expect(readFileSync(join(r,'01-demo','character.inp'),'utf8')).toBe('old rig');expect(existsSync(join(r,'01-demo','Live2D.zip'))).toBe(false);
        damaged=false;await s.start('01-demo');expect((await s.wait('01-demo')).status).toBe('ready');
    });
    it('rejects oversized and truncated responses',async()=>{
        for(const b of [Buffer.alloc(20),Buffer.alloc(2)]){
            const s=store(root(),catalog(),async()=>new Response(b));await s.start('01-demo');expect((await s.wait('01-demo')).status).toBe('failed');
        }
    });
    it('reports missing configuration and HTTP errors honestly',async()=>{
        const c=catalog();c.release.baseUrl=null;await expect(store(root(),c).start('01-demo')).rejects.toThrow('not published');
        const s=store(root(),catalog(),async()=>new Response('missing',{status:404}));await s.start('01-demo');expect((await s.wait('01-demo')).error).toContain('HTTP 404');
    });
    it('rejects unknown IDs, unsafe catalog paths, URL credentials and arbitrary download hosts',async()=>{
        await expect(store(root()).start('../escape')).rejects.toThrow('Unknown avatar');
        for(const u of ['http://github.com/x/y/releases/download/v1','https://evil.test/x/y/releases/download/v1','https://user:pass@github.com/x/y/releases/download/v1'])expect(()=>releaseBase(u)).toThrow();
        const c=catalog();c.entries[0].artifacts[0].file='../escape';expect(()=>readCatalog(c)).toThrow();
    });
    it('does not write through a linked avatar directory',async()=>{
        const r=root(),outside=root();symlinkSync(outside,join(r,'01-demo'));
        const s=store(r);await s.start('01-demo');expect((await s.wait('01-demo')).status).toBe('failed');expect(existsSync(join(outside,'character.inp'))).toBe(false);
    });
});
