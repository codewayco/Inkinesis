/** Exercise a fresh checkout, corrupt transfer, retry, local installation and playback without GitHub. */
import {createServer,type Plugin} from 'vite';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdtempSync,realpathSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {ExampleDownloads} from '../../player/exampleDownloads';
import {exampleDevServer} from '../../player/exampleDevServer';
import type {AvatarCatalog} from '../../player/avatarCatalog';
import {rigFixture} from '../test/rigFixture';
const root=realpathSync(mkdtempSync(join(tmpdir(),'inkinesis-example-ui-'))),id='01-download-fixture';
const rig=rigFixture(),zip=Buffer.from('fixture zip payload'),payloads=[rig,zip];let damaged=true,requests=0;
const catalog:AvatarCatalog={release:{baseUrl:'https://github.com/example/inkinesis/releases/download/test'},entries:[{
    id,label:'Download fixture',base:'/example-avatars/'+id,preview:`/example-avatars/previews/${id}.webp`,files:{'Download rig':'character.inp','Live2D package':'Live2D.zip'},
    artifacts:payloads.map((b,i)=>({file:i?'Live2D.zip':'character.inp',asset:i?'fixture.zip':'fixture.inp',bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})),
}]};
const store=new ExampleDownloads(root,catalog,undefined,async url=>{
    requests++;const bytes=url.endsWith('.zip')?(damaged?Buffer.alloc(zip.length):zip):rig;let at=0;
    return new Response(new ReadableStream({async pull(controller){
        await new Promise(resolve=>setTimeout(resolve,90));
        if(at===bytes.length){controller.close();return;}
        const end=Math.min(bytes.length,at+Math.ceil(bytes.length/8));controller.enqueue(bytes.subarray(at,end));at=end;
    }}));
});
const fixture:Plugin={name:'local-release-fixture',configureServer(server){
    server.middlewares.use((req,res,next)=>{
        if(req.url==='/example-avatars/catalog.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(catalog));return;}
        for(const name of ['character.inp','Live2D.zip'])if(req.url===`/example-avatars/${id}/${name}`){
            const path=join(root,id,name);if(!existsSync(path)){res.statusCode=404;res.end();return;}res.end(readFileSync(path));return;
        }
        next();
    });
}};
const server=await createServer({configFile:false,root:resolve('.'),plugins:[fixture,exampleDevServer(store)],server:{host:'127.0.0.1',port:0,open:false},logLevel:'error'});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('Missing server');
const base=`http://127.0.0.1:${address.port}`,browser=await chromium.launch({headless:true});
try {
    const page=await browser.newPage({viewport:{width:1300,height:950}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.locator('#pickAvatar').click();await page.locator(`#sample-${id} small`).filter({hasText:'Not downloaded'}).waitFor();
    await page.locator('#sample-'+id).click();
    const button=page.locator('#downloadExample');await button.waitFor();
    if(!await button.isEnabled()||requests!==0)throw Error('Selection must not start a download');
    const cross=await page.request.post(`${base}/api/examples/${id}/download`,{headers:{Origin:'https://unrelated.example'}});
    if(cross.status()!==403||requests!==0)throw Error('Cross-origin download allowed');
    await button.click();await page.locator('#downloadExample').filter({hasText:'Downloading'}).waitFor();
    await page.locator('#downloadExample').filter({hasText:'Retry download'}).waitFor({timeout:15000});
    if(existsSync(join(root,id,'character.inp')))throw Error('Failed download installed partial files');
    if(!(await page.locator('#exampleDownloadState').innerText()).includes('integrity'))throw Error('Integrity failure not explained');
    damaged=false;await button.click();await page.locator('#downloadExample').filter({hasText:'Downloaded'}).waitFor({timeout:15000});
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Download fixture');
    if(!readFileSync(join(root,id,'character.inp')).equals(rig)||!readFileSync(join(root,id,'Live2D.zip')).equals(zip))throw Error('Saved files differ');
    await page.locator('#idle').uncheck();const before=await page.locator('canvas').screenshot();await page.locator('#roll').fill('20');const after=await page.locator('canvas').screenshot();if(before.equals(after))throw Error('Downloaded rig does not move');
    const count=requests;await page.reload();await page.locator('#pickAvatar').click();await page.locator(`#sample-${id} small`).filter({hasText:'Downloaded'}).waitFor();await page.locator('#sample-'+id).click();
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Download fixture');if(requests!==count)throw Error('Local avatar downloaded again');
    if(errors.length)throw Error(errors.join('\n'));
    console.log('PASS: explicit Download, progress, hash failure, retry, both local files, playback, reload reuse and same-origin guard. No GitHub calls.');
} finally {await browser.close();await server.close();await store.close();rmSync(root,{recursive:true,force:true});}
