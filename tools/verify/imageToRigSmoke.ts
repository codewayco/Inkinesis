/** Public-checkout UI smoke test. Synthetic geometry; no credentials or GPU required. */
import { chromium } from 'playwright';
import { rigFixture } from '../test/rigFixture';
const base=process.argv[2]??'http://127.0.0.1:5200';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const checks:string[]=[];
const check=(ok:boolean,message:string)=>{if(!ok)throw new Error(message);checks.push(message);};
try {
    await page.goto(base+'/');
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('Describe a character'));
    check(await page.locator('#generatePrompt').isVisible(),'Prompt entry is visible');
    check((await page.locator('#downloads').innerText()).trim()==='','No unavailable preset download on startup');
    await page.locator('#pickAvatar').click();
    check(await page.locator('#avatarSamples').isVisible(),'Optional avatar picker expands');
    await page.locator('#source').setInputFiles({name:'fixture.inp',mimeType:'application/octet-stream',buffer:rigFixture()});
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='fixture.inp');
    await page.locator('#idle').uncheck();
    const before=await page.locator('canvas').screenshot();
    await page.locator('#roll').fill('20');
    const after=await page.locator('canvas').screenshot();
    check(!before.equals(after),'Uploaded INP renders and responds to a control');
    await page.locator('#headReset').click();
    check(await page.locator('#roll').inputValue()==='0','Neutral resets the control');
    const bad=await page.request.post(base+'/api/live2d/',{data:{source:'/.env'}});
    check(bad.status()===400,'Arbitrary export sources are rejected');
    const cross=await page.request.post(base+'/api/rig/',{headers:{origin:'https://unrelated.example'},data:{prompt:'No call should be made'}});
    check(cross.status()===403,'Cross-origin generation is refused before API usage');
    check(errors.length===0,'No browser JavaScript errors');
    console.log(JSON.stringify({status:'passed',checks,scope:'Empty startup, optional library, synthetic INP render/control, request boundaries. No model generation.'},null,2));
} finally {await browser.close();}
