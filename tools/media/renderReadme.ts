/** Reproducible, offline media from installed rigs. No generation, upload or rig edits. */
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readInp} from '../rig/inp';
import {motionLimits,motionTiming,reviewTimes,recipeFor,showcaseValues,showcaseOrder} from './showcaseMotion';
import type {} from './showcaseBrowser';

const mode=process.argv[2]??'preview',fps=24;
if(!['preview','review','full','video'].includes(mode))throw Error('Use preview, review, video or full');
const ffmpeg=process.env.FFMPEG??'ffmpeg';
const catalog=JSON.parse(readFileSync('example-avatars/catalog.json','utf8')).entries as {id:string;label:string}[];
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const output=resolve((mode==='full'||mode==='video')?'docs/media':'.cache/readme-media');mkdirSync(output,{recursive:true});
const cache=resolve('.cache/readme-media');mkdirSync(cache,{recursive:true});
// Range and neutral checks cover every authored sample, including limited channels.
const assets=catalog.map(e=>{
    const bytes=readFileSync(`example-avatars/${e.id}/character.inp`),{puppet}=readInp(bytes),recipe=recipeFor(puppet);
    for(let frame=0;frame<=8*fps;frame++)for(const [name,v] of Object.entries(showcaseValues(puppet,recipe,frame/fps))){
        const p=puppet.param.find(p=>p.name===name)!;
        if(v.some((x,a)=>!Number.isFinite(x)||x<p.min[a]-1e-8||x>p.max[a]+1e-8))throw Error(`Range failure: ${e.id} ${name}`);
    }
    if(Object.keys(showcaseValues(puppet,recipe,8)).length)throw Error('Gesture did not return to neutral');
    return {...e,sourceSha256:hash(bytes),recipe};
});
const server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:5207,strictPort:true,hmr:false,watch:null,fs:{deny:['.env','.env.*','**/.git/**']}}});
await server.listen();
const browser=await chromium.launch({headless:true});
const errors:string[]=[];
try{
    const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:5207/tools/media/showcase.html');await page.waitForFunction(()=>Boolean(window.showcase));
    const selected=mode==='preview'?['04-purple-couture','03-solstice-mosaic','06-saffron-orbit','05-ultramarine-tempo','09-desert-ranger','25-cobalt-otter-cartographer','41-salt-quartz-antelope']:undefined;
    let info=await page.evaluate(ids=>window.showcase.init(ids),selected);
    if(mode!=='preview'){
        for(let start=0;start<catalog.length;start+=9){
            const sheet=await page.evaluate(i=>window.showcase.review(i),start);writeFileSync(`${cache}/review-${String(start).padStart(2,'0')}.png`,Buffer.from(sheet.png,'base64'));
            const heads=await page.evaluate(i=>window.showcase.heads(i),start);writeFileSync(`${cache}/heads-${String(start).padStart(2,'0')}.png`,Buffer.from(heads,'base64'));
            console.log(`Reviewed poses ${start+1}–${Math.min(start+9,catalog.length)}`);
        }
        if(mode==='full'){writeFileSync(`${output}/gallery.webp`,Buffer.from(await page.evaluate(()=>window.showcase.gallery()),'base64'));console.log('Gallery rendered');}
    }
    if(mode!=='review'){
        if(mode!=='preview')info=await page.evaluate(ids=>window.showcase.init(ids),showcaseOrder(assets).map(e=>e.id));
        const name=mode==='full'||mode==='video'?'showcase':'preview',frames=Math.round(info.duration*fps);
        const encoder=process.env.SHOWCASE_ENCODER??'libopenh264';
        const encoderArgs=encoder==='libx264'?['-crf','21','-preset','medium']:['-b:v','3500k'];
        const args=['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-an','-c:v',encoder,...encoderArgs,'-pix_fmt','yuv420p','-movflags','+faststart',`${output}/${name}.mp4`];
        const encoderProcess=spawn(ffmpeg,args,{stdio:['pipe','ignore','pipe']});let encoderLog='';encoderProcess.stderr.on('data',b=>encoderLog+=b);const done=once(encoderProcess,'close');
        for(let frame=0;frame<frames;frame++){
            const png=Buffer.from(await page.evaluate(t=>window.showcase.frame(t),frame/fps),'base64');
            if(frame===0)writeFileSync(`${output}/${name}-poster.png`,png);
            if(frame%(fps*10)===0){writeFileSync(`${cache}/${name}-${String(frame/fps).padStart(3,'0')}s.png`,png);console.log(`${name}: ${frame/fps}s / ${info.duration}s`);}
            if(!encoderProcess.stdin.write(png))await once(encoderProcess.stdin,'drain');
        }
        encoderProcess.stdin.end();const [code]=await done;if(code!==0)throw Error(`FFmpeg ${code}: ${encoderLog}`);
        const probe=spawnSync(ffmpeg,['-hide_banner','-i',`${output}/${name}.mp4`],{encoding:'utf8'});writeFileSync(`${cache}/${name}-probe.txt`,probe.stderr);
        if(mode==='full'||mode==='video'){
            const sources=['player/src/combinedRuntime.ts','player/src/combinedRenderer.ts','tools/media/showcaseMotion.ts','tools/media/showcaseBrowser.ts','tools/media/renderReadme.ts'];
            writeFileSync(`${output}/showcase-provenance.json`,JSON.stringify({width:1600,height:1000,fps,durationSeconds:info.duration,frameCount:frames,layout:'Aligned neutral and animated rows; 2-second opening and 7-second closing holds; one character every 2 seconds',motionLimits,motionTiming,reference:'docs/media/motion.gif',trajectory:'Repeating four-second GIF sequence: both arms, right leg, left leg, head and face, return to neutral. Shared time, no per-avatar delay or amplitude multiplier.',rangeClamping:'Actual exported min/max only; missing and fixed channels omitted',reviewSampleSeconds:reviewTimes,videoOrder:showcaseOrder(assets).map(e=>e.id),rangeCheckSamplesPerRig:8*fps+1,assets,rendererSources:Object.fromEntries(sources.map(p=>[p,hash(readFileSync(p))])),errors,encoding:{encoder,pixelFormat:'yuv420p',audio:false,args:args.map(arg=>arg.startsWith(output+'/')?'docs/media/'+arg.slice(output.length+1):arg)},files:Object.fromEntries(['showcase.mp4','showcase-poster.png','gallery.webp'].map(name=>{const b=readFileSync(`${output}/${name}`);return [name,{bytes:b.length,sha256:hash(b)}];}))},null,2)+'\n');
        }
        console.log(`Saved ${output}/${name}.mp4`);
    }
    if(errors.length)throw Error(errors.join('\n'));
    if(!existsSync(output))throw Error('Missing output');
}finally{await browser.close();await server.close();}
