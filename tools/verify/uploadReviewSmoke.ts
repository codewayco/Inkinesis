/** Browser regression for image review and prompt isolation. All APIs are local fixtures. */
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {encodePNG} from '../shared/encodePNG';
import {rigFixture} from '../test/rigFixture';
import type {UploadReview,UploadAssessment} from '../imageToRig/uploadReview';
const server=await createServer({configFile:false,root:resolve('.'),server:{host:'127.0.0.1',port:0,open:false,watch:null},logLevel:'error'});
await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('No server address');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const png=Buffer.from(encodePNG(new Uint8ClampedArray([70,140,210,255]),1,1));
 const assessment:UploadAssessment={width:417,height:626,sha256:'original-hash',kind:'photo',recommendRedraw:true,checks:[{code:'background',status:'warning',message:'No transparent background.'}]};
 let review:UploadReview={id:'fixture-upload',status:'ready',original:assessment},redrawFails=false,confirmations=0,prompts=0;
 const approved:string[]=[];
 await page.route('**/api/rig/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,post=request.method()==='POST';
  const reply=(value:unknown,status=200)=>route.fulfill({status,json:value});
  if(path.endsWith('.png'))return route.fulfill({contentType:'image/png',body:png});
  if(path==='/api/rig/uploads/'&&post){review={id:'fixture-upload',status:'ready',original:assessment};return reply(review,202);}
  if(path==='/api/rig/uploads/fixture-upload')return reply(review);
  if(path.endsWith('/redraw')&&post){review=redrawFails?{...review,candidate:undefined,error:'Redraw service unavailable.'}:{...review,error:undefined,candidate:{...assessment,sha256:'candidate-hash',kind:'illustration',recommendRedraw:false,checks:[]}};return reply(review,202);}
  if(path.endsWith('/confirm')&&post){const body=request.postDataJSON();approved.push(body.selection+':'+body.sha256);confirmations++;return reply({id:'fixture-job'},202);}
  if(path==='/api/rig/session')return reply({entries:[]});
  if(path==='/api/rig/fixture-job')return reply({base:'/fixture',saved:false,report:{status:'success',files:{rig:'character.inp',input:'input.png'},reasons:[],uploadReview:{technical:'complete',visual:'needs_review',source:'redrawn',notes:['Inspect the redrawn identity.'],limitations:[{region:'Leg L',reason:'Leg hidden by clothing.'}]}}});
  if(path==='/api/rig/'&&post){prompts++;if(JSON.stringify(request.postDataJSON())!==JSON.stringify({prompt:'A test character'}))errors.push('Prompt payload changed');return reply({error:'Fixture prompt received'},503);}
  if(path==='/api/rig/')return reply({available:true,running:null,decomposition:{policy:'local'}});
  errors.push('Unexpected API request: '+path);return reply({error:'Unexpected fixture request'},404);
 });
 await page.route('**/fixture/character.inp',route=>route.fulfill({contentType:'application/octet-stream',body:rigFixture()}));
 await page.goto(`http://127.0.0.1:${address.port}`);
 const upload=()=>page.locator('#source').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});
 const ready=()=>page.waitForFunction(()=>!(document.querySelector('#uploadConfirm') as HTMLButtonElement)?.disabled);
 await upload();await ready();
 if(!(await page.locator('#uploadChecks').innerText()).includes('No transparent'))throw Error('Source warning missing');
 await page.locator('#uploadRedraw').click();await ready();
 if(confirmations!==0||!await page.locator('#uploadCandidate').isVisible())throw Error('Redraw must be previewed without starting a rig');
 await page.reload();await ready();
 // Restoring a preview does not imply accepting its proposed redraw.
 await page.locator('input[name=uploadChoice][value=redrawn]').check();
 await page.locator('#uploadConfirm').click();
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Generated character');
 if(approved.join()!=='redrawn:candidate-hash')throw Error('Confirmation did not use the selected preview hash');
 const result=await page.locator('#uploadResult').innerText();
 if(!result.includes('review')||!result.includes('Leg hidden by clothing'))throw Error('Result quality or movement limit missing');
 await upload();await ready();redrawFails=true;await page.locator('#uploadRedraw').click();await ready();
 if(!(await page.locator('#uploadProgress').innerText()).includes('unavailable')||await page.locator('#uploadCandidate').isVisible())throw Error('Failed redraw leaves a stale candidate');
 await page.locator('#uploadConfirm').click();
 await page.waitForFunction(()=>!(document.querySelector('#generate') as HTMLButtonElement)?.disabled);
 if(approved.join()!=='redrawn:candidate-hash,original:original-hash')throw Error('As-is confirmation changed the source');
 await upload();await ready();await page.locator('#uploadCancel').click();
 await page.locator('#generatePrompt').fill('A test character');await page.locator('#generate').click();
 await page.waitForFunction(()=>document.querySelector('#generateState')?.textContent==='Fixture prompt received');
 if(prompts!==1||Number(confirmations)!==2||await page.locator('#uploadReview').isVisible()||await page.locator('#generate').isDisabled())throw Error('Prompt flow was affected by image review');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: source warning, redraw preview, reload, explicit hash confirmation, quality/limitation result, failed-redraw recovery, as-is, cancel and unchanged prompt payload. No model calls.');
} finally {await browser.close();await server.close();}
