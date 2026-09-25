/** Check every packaged example in the browser without generation or inference. */
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const base=process.argv[2]??'http://127.0.0.1:5200';
const catalog=JSON.parse(readFileSync('example-avatars/catalog.json','utf8')).entries as {id:string;label:string;base:string;files:Record<string,string>}[];
const hashes=JSON.parse(readFileSync('example-avatars/checksums.json','utf8'));
const browser=await chromium.launch({headless:true});
const errors:string[]=[];const tested:string[]=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('#pickAvatar').click();await page.locator('#idle').uncheck();
 for(const entry of catalog){
  await page.locator('#sample-'+entry.id+' small').filter({hasText:'Downloaded'}).waitFor({timeout:60000});
  await page.locator('#sample-'+entry.id).click();
  await page.waitForFunction(label=>document.querySelector('#status')?.textContent===label,entry.label,{timeout:60000});
  for(const [format,key] of [['inochi','Download rig'],['live2d','Live2D package']]){
   const href=await page.locator(`#downloads a[data-format="${format}"]`).getAttribute('href');
   const r=await page.request.get(base+href);const bytes=await r.body();
   if(!r.ok()||createHash('sha256').update(bytes).digest('hex')!==hashes[entry.id+'/'+entry.files[key]])throw new Error('Example download differs: '+entry.id+' '+format);
   await r.dispose();
  }
  for(const id of ['yaw','pitch','roll','jaw','body_shoulderL','body_elbowL','body_shoulderR','body_elbowR','body_hipL','body_kneeL','body_hipR','body_kneeR']){
   const control=page.locator('#'+id);
   if(await control.isEnabled())await control.fill(id==='jaw'?'25':'10');
  }
  await page.locator('#headReset').click();await page.locator('#bodyRest').click();
  if(entry.id==='04-purple-couture'){
   mkdirSync('.cache/ui-check',{recursive:true});
   await page.screenshot({path:resolve('.cache/ui-check/example.png')});
  }
  tested.push(entry.id);
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({status:'passed',examples:tested.length,tested,scope:'Every example loads; downloads match hashes; available controls and neutral resets execute. No new perceptual certification.'}));
} finally {await browser.close();}
