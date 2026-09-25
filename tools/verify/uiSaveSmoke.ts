/** Local fixture-only UI save test: no generation/model calls and no permanent dataset writes. */
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {GeneratedRigStore} from '../../player/generatedRigStore';
import {combinedDevServer} from '../../player/combinedDevServer';
import {rigFixture} from '../test/rigFixture';
import {encodePNG} from '../shared/encodePNG';
const root=realpathSync(mkdtempSync(join(tmpdir(),'inkinesis-save-smoke-'))),saved=join(root,'saved'),store=new GeneratedRigStore(saved);
const id='00000000-0000-4000-8000-000000000009',dir=store.create(id);
writeFileSync(join(dir,'character.inp'),rigFixture());
writeFileSync(join(dir,'input.png'),encodePNG(new Uint8ClampedArray([255,0,0,255]),1,1));
writeFileSync(join(dir,'prompt.txt'),'Fixture preview');writeFileSync(join(dir,'REPORT.md'),'Fixture report');
mkdirSync(join(dir,'assets'));writeFileSync(join(dir,'assets','nested.txt'),'nested artifact');
writeFileSync(join(dir,'report.json'),JSON.stringify({id,status:'needs_review',stage:'complete',started:new Date().toISOString(),reasons:[],stages:[],files:{rig:'character.inp',input:'input.png'}}));
const server=await createServer({configFile:false,root:resolve('.'),plugins:[combinedDevServer(store)],server:{host:'127.0.0.1',port:0,open:false},logLevel:'error'});
await server.listen();const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('No server address');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1300,height:950}}),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 const base=`http://127.0.0.1:${address.port}`;await page.goto(base);
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('Describe a character'));
 await page.locator('#recentGenerations').selectOption(id);
 await page.waitForFunction(()=>!(document.querySelector('#saveGenerated') as HTMLButtonElement)?.disabled);
 if(existsSync(saved))throw Error('Preview created permanent output');
 const inp=await page.request.get(base+store.base(id)+'/character.inp');if(!inp.ok()||!(await inp.body()).equals(readFileSync(join(dir,'character.inp'))))throw Error('Temporary preview bytes differ');
 const blocked=await page.request.post(base+`/api/rig/${id}/save`,{headers:{Origin:'https://unrelated.example'}});if(blocked.status()!==403)throw Error('Cross-origin save accepted');
 await page.locator('#saveGenerated').click();await page.waitForFunction(()=>document.querySelector('#saveState')?.textContent?.startsWith('Saved to '));
 for(const path of ['character.inp','input.png','prompt.txt','REPORT.md','assets/nested.txt'])if(!readFileSync(join(saved,id,path)).equals(readFileSync(join(dir,path))))throw Error('Saved files differ: '+path);
 if(!await page.locator('#saveGenerated').isDisabled())throw Error('Saved button not disabled');
 await page.reload();await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('Describe a character'));await page.locator('#recentGenerations').selectOption(id);
 await page.waitForFunction(()=>document.querySelector('#saveGenerated')?.textContent==='Saved');
 const asset=await page.request.get(base+store.base(id)+'/character.inp');if(!asset.ok())throw Error('Saved preview URL broke');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: session preview, no persistent files before Save, same-origin guard, full saved tree, idempotent saved UI and page reload. No model calls.');
}finally{await browser.close();await server.close();store.dispose();rmSync(root,{recursive:true,force:true});}
