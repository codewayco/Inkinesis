/** Reproducible, offline media from installed rigs. No generation, upload or rig edits. */
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readInp} from '../rig/inp';
import {motionLimits,motionTiming,reviewTimes,recipeFor,showcaseValues,showcaseOrder,showcaseCast,OUTPUT_SCALE} from './showcaseMotion';
import type {} from './showcaseBrowser';

// Range checks sample the motion at 24 fps; videos are encoded at 60 fps so the scrolling camera moves in small steps.
const mode=process.argv[2]??'preview',fps=24,videoFps=60;
if(!['preview','review','full','video','gif'].includes(mode))throw Error('Use preview, review, video, gif or full');
/** Cast of docs/media/motion.gif. */
const motionGifCast=['20-purple-couture','06-ember-forge-smith','08-asphalt-comet-skater'];
const ffmpeg=process.env.FFMPEG??'ffmpeg';
// Media cover every evaluated avatar: the shipped catalog plus the local other-avatars catalog when it exists.
const catalog=['example-avatars/catalog.json','other-avatars/catalog.json'].filter(existsSync)
    .flatMap(path=>JSON.parse(readFileSync(path,'utf8')).entries as {id:string;label:string;base:string}[]).sort((a,b)=>a.id.localeCompare(b.id));
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const output=resolve((mode==='full'||mode==='video'||mode==='gif')?'docs/media':'.cache/readme-media');mkdirSync(output,{recursive:true});
const cache=resolve('.cache/readme-media');mkdirSync(cache,{recursive:true});
// Range and neutral checks cover every authored sample, including limited channels.
const assets=catalog.map(e=>{
    const bytes=readFileSync(`.${e.base}/character.inp`),{puppet}=readInp(bytes),recipe=recipeFor(puppet,e.id);
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
    if(mode==='gif'){
        const frames=await page.evaluate(ids=>window.showcase.motionGif(ids),motionGifCast),dir=`${cache}/motion-gif`;mkdirSync(dir,{recursive:true});
        frames.forEach((png,i)=>writeFileSync(`${dir}/${String(i).padStart(2,'0')}.png`,Buffer.from(png,'base64')));
        const gif=spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','warning','-framerate','12','-i',`${dir}/%02d.png`,'-vf','split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a','-loop','0',`${output}/motion.gif`],{encoding:'utf8'});
        if(gif.status!==0)throw Error(`FFmpeg ${gif.status}: ${gif.stderr}`);
        console.log(`Saved ${output}/motion.gif`);
    }
    const selected=mode==='preview'?showcaseCast.filter(id=>catalog.some(e=>e.id===id)).slice(0,7):undefined;
    let info=await page.evaluate(ids=>window.showcase.init(ids),selected);
    if(mode!=='preview'&&mode!=='gif'){
        for(let start=0;start<catalog.length;start+=9){
            const sheet=await page.evaluate(i=>window.showcase.review(i),start);writeFileSync(`${cache}/review-${String(start).padStart(2,'0')}.png`,Buffer.from(sheet.png,'base64'));
            const heads=await page.evaluate(i=>window.showcase.heads(i),start);writeFileSync(`${cache}/heads-${String(start).padStart(2,'0')}.png`,Buffer.from(heads,'base64'));
            console.log(`Reviewed poses ${start+1}–${Math.min(start+9,catalog.length)}`);
        }
        if(mode==='full'){writeFileSync(`${output}/gallery.webp`,Buffer.from(await page.evaluate(()=>window.showcase.gallery()),'base64'));console.log('Gallery rendered');}
    }
    if(mode!=='review'&&mode!=='gif'){
        if(mode!=='preview')info=await page.evaluate(ids=>window.showcase.init(ids),showcaseOrder(assets).map(e=>e.id));
        const name=mode==='full'||mode==='video'?'showcase':'preview',frames=Math.round(info.duration*videoFps);
        const encoder=process.env.SHOWCASE_ENCODER??'libopenh264';
        const encoderArgs=encoder==='libx264'?['-crf','24','-preset','slow','-tune','animation']:['-b:v','2500k'];
        const args=['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-framerate',String(videoFps),'-i','pipe:0','-an','-c:v',encoder,...encoderArgs,'-pix_fmt','yuv420p','-movflags','+faststart',`${output}/${name}.mp4`];
        const encoderProcess=spawn(ffmpeg,args,{stdio:['pipe','ignore','pipe']});let encoderLog='';encoderProcess.stderr.on('data',b=>encoderLog+=b);const done=once(encoderProcess,'close');
        for(let frame=0;frame<frames;frame++){
            const png=Buffer.from(await page.evaluate(t=>window.showcase.frame(t),frame/videoFps),'base64');
            if(frame===0)writeFileSync(`${output}/${name}-poster.png`,png);
            if(frame%(videoFps*10)===0){writeFileSync(`${cache}/${name}-${String(frame/videoFps).padStart(3,'0')}s.png`,png);console.log(`${name}: ${frame/videoFps}s / ${info.duration}s`);}
            if(!encoderProcess.stdin.write(png))await once(encoderProcess.stdin,'drain');
        }
        encoderProcess.stdin.end();const [code]=await done;if(code!==0)throw Error(`FFmpeg ${code}: ${encoderLog}`);
        const probe=spawnSync(ffmpeg,['-hide_banner','-i',`${output}/${name}.mp4`],{encoding:'utf8'});writeFileSync(`${cache}/${name}-probe.txt`,probe.stderr);
        if(mode==='full'||mode==='video'){
            const sources=['player/src/combinedRuntime.ts','player/src/combinedRenderer.ts','tools/media/showcaseMotion.ts','tools/media/showcaseBrowser.ts','tools/media/renderReadme.ts'];
            writeFileSync(`${output}/showcase-provenance.json`,JSON.stringify({width:1600*OUTPUT_SCALE,height:1000*OUTPUT_SCALE,fps:videoFps,rangeCheckFps:fps,durationSeconds:info.duration,frameCount:frames,layout:'Aligned neutral and animated rows; 2-second opening and 5-second closing holds; one character every 2.5 seconds',motionLimits,motionTiming,reference:'docs/media/motion.gif',trajectory:'Repeating four-second GIF sequence: both arms, right leg, left leg, head and face, return to neutral. Shared time, no per-avatar delay or amplitude multiplier.',rangeClamping:'Actual exported min/max only; missing and fixed channels omitted',reviewSampleSeconds:reviewTimes,videoOrder:showcaseOrder(assets).map(e=>e.id),rangeCheckSamplesPerRig:8*fps+1,assets,rendererSources:Object.fromEntries(sources.map(p=>[p,hash(readFileSync(p))])),errors,encoding:{encoder,pixelFormat:'yuv420p',audio:false,args:args.map(arg=>arg.startsWith(output+'/')?'docs/media/'+arg.slice(output.length+1):arg)},files:Object.fromEntries(['showcase.mp4','showcase-poster.png','gallery.webp'].map(name=>{const b=readFileSync(`${output}/${name}`);return [name,{bytes:b.length,sha256:hash(b)}];}))},null,2)+'\n');
        }
        console.log(`Saved ${output}/${name}.mp4`);
    }
    if(errors.length)throw Error(errors.join('\n'));
    if(!existsSync(output))throw Error('Missing output');
}finally{await browser.close();await server.close();}
