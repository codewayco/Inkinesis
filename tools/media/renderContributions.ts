/** README contribution figures from installed example rigs. No generation, upload or rig edits.
 * Usage: tsx tools/media/renderContributions.ts [figures [ownership|carriers|export ...]|poses <id> <json pose list>] */
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {} from './contributionsBrowser';

const [mode='figures',...rest]=process.argv.slice(2);
const arms=(shoulder:number,elbow:number)=>({'Arm L':[-shoulder,-elbow],'Arm R':[shoulder,elbow]});
/** Figure casts differ from the project website; poses stay inside each rig's exported ranges. */
const figures={
    ownership:[
        {id:'22-saffron-orbit',label:'Saffron Orbit',pose:{...arms(28,40),'Leg L':[-16,30],'Leg R':[16,30]}},
        {id:'45-papaya-broadcaster',label:'Papaya Broadcaster',pose:{...arms(28,40),'Leg L':[-16,30],'Leg R':[16,30]}},
    ],
    carriers:{id:'03-cedar-ridge-ranger',label:'Cedar Ridge Ranger',pose:arms(30,55)},
    export:{id:'13-emerald-star-wand',label:'Emerald Star Wand',pose:{...arms(24,45),'Leg L':[-12,30],'Head Angles':[14,0]}},
};
const out=resolve(mode==='figures'?'docs/media':'.cache/readme-media');mkdirSync(out,{recursive:true});
const server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:5208,strictPort:true,hmr:false,watch:null,fs:{deny:['.env','.env.*','**/.git/**']}}});
await server.listen();
const browser=await chromium.launch({headless:true});const errors:string[]=[];
try{
    const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:5208/tools/media/contributions.html');await page.waitForFunction(()=>Boolean(window.contributions));
    const save=(name:string,base64:string)=>{writeFileSync(`${out}/${name}`,Buffer.from(base64,'base64'));console.log(`Saved ${out}/${name}`);};
    if(mode==='owners')save('owners.png',await page.evaluate(ids=>window.contributions.ownerSheet(ids),rest));
    else if(mode==='poses')save(`poses-${rest[0]}.png`,await page.evaluate(([id,list])=>window.contributions.poses(id,JSON.parse(list)),[rest[0],rest[1]] as const));
    else{
        const only=(name:string)=>!rest.length||rest.includes(name);
        if(only('ownership'))save('ownership.webp',await page.evaluate(rows=>window.contributions.ownership(rows),figures.ownership));
        if(only('carriers'))save('carriers.webp',await page.evaluate(f=>window.contributions.carriers(f.id,f.label,f.pose),figures.carriers));
        if(only('export'))save('export.webp',await page.evaluate(f=>window.contributions.export(f.id,f.label,f.pose),figures.export));
    }
    if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();await server.close();}
