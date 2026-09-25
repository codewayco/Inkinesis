/// <reference types="vite/client" />
import { readCombined, parameterByName, type CombinedAsset } from './combinedRuntime';
import { createCombinedRenderer } from './combinedRenderer';
import { createRecorder } from './recordClip';
import { espeakServiceBackend } from './story/tts';
import { mouthOpenness, type VisemeTrack } from '../../engine/src/lipsync/visemes';
import type { RunReport } from '../../tools/imageToRig/pipeline';
import type {MotionCapabilities} from '../../tools/imageToRig/capabilities';
import { installAvatarLibrary } from './avatarLibrary';
import { motionDemoValues, blinkOpenness } from './previewMotion';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const state = (text: string) => { el('generateState').textContent = text; };
const saveButton=el<HTMLButtonElement>('saveGenerated');
const recentGenerations=el<HTMLSelectElement>('recentGenerations');
let saveTarget='',saving=false;
function showSave(id:string,saved:boolean,ready:boolean) {
    saveTarget=id;
    saveButton.textContent=saved?'Saved':'Save';saveButton.disabled=!id||saved||!ready||saving;
    el('saveState').textContent=id?(saved?'Saved locally.':'Temporary preview — click Save to keep the image and rig files. Unsaved previews last for this server session.') : '';
    recentGenerations.value=id;
}
async function refreshGenerations() {
    const response=await fetch('/api/rig/session');if(!response.ok)return;
    const result=await response.json();
    recentGenerations.replaceChildren(new Option('Session previews',''));
    for(const [i,entry] of (result.entries??[]).entries()){
        recentGenerations.add(new Option(`Avatar ${i+1}${entry.saved?' · Saved':''}`,entry.id));
    }
    el('generatedActions').hidden=recentGenerations.options.length<=1&&capabilityButton.hidden;
    recentGenerations.value=saveTarget;
}
saveButton.onclick=()=>{void guard(async()=>{
    if(!saveTarget||saving)return;
    const id=saveTarget;saving=true;recentGenerations.disabled=true;saveButton.disabled=true;el('saveState').textContent='Saving all generated files…';
    try {
        const response=await fetch(`/api/rig/${id}/save`,{method:'POST'}),result=await response.json();
        if(!response.ok)throw new Error(result.error);
        if(saveTarget===id){showSave(id,true,true);el('saveState').textContent=`Saved to ${result.folder}`;}
        await refreshGenerations();
    } catch(error) {
        if(saveTarget===id){saveButton.disabled=false;el('saveState').textContent=error instanceof Error?error.message:String(error);}
    } finally {saving=false;recentGenerations.disabled=busy;}
});};
recentGenerations.onchange=()=>{if(recentGenerations.value&&!busy&&!saving)void guard(()=>poll(recentGenerations.value));};
const status = (text: string) => { el('status').textContent = text; };
const stageLabels: Record<string, string> = {draw:'Drawing character',normalize:'Preparing image','support-and-landmarks':'Analyzing support and joints',plan:'Preparing layers','see-through':'Separating character layers on local GPU','see-through-h100':'Separating character layers on H100','see-through-fallback':'H100 unavailable; switching to local GPU','measured-expressions':'Creating and measuring expressions','source-bust':'Building face motion','combined-rig':'Rigging arms and legs','native-validation':'Validating the rig','geometry-audit':'Checking motion','render-evidence':'Rendering previews',demo:'Finishing files'};
const mappings: Record<string, [
    string,
    number,
    number
]> = { yaw: ['Head Angles', 0, 1], pitch: ['Head Angles', 1, 1], roll: ['ParamAngleZ', 0, 1], jaw: ['ParamMouthOpenY', 0, 100], body_shoulderL: ['Arm L', 0, 1], body_elbowL: ['Arm L', 1, 1], body_shoulderR: ['Arm R', 0, 1], body_elbowR: ['Arm R', 1, 1], body_hipL: ['Leg L', 0, 1], body_kneeL: ['Leg L', 1, 1], body_hipR: ['Leg R', 0, 1], body_kneeR: ['Leg R', 1, 1] };
let asset: CombinedAsset | undefined, renderer: Awaited<ReturnType<typeof createCombinedRenderer>> | undefined;
let values: Record<string, number[]> = {}, clip = '', clipStart = 0, loading = 0, busy = false, canBlink = false;
let speech: {
    track: VisemeTrack;
    audio: HTMLAudioElement | null;
    start: number;
    url?: string;
} | null = null;
let blinkStarted: number | null = null, speechTicket = 0;
const motionButton = el<HTMLButtonElement>('motionDemo');
const canvas = el<HTMLCanvasElement>('frame');
const referencePreview = document.createElement('img');
referencePreview.alt = 'Generated source image — rig preparation is still running';
referencePreview.hidden = true;
referencePreview.style.cssText = 'position:absolute;inset:24px;width:calc(100% - 48px);height:calc(100% - 48px);object-fit:contain;background:var(--stage-background)';
el('stage').style.position = 'relative';
el('stage').append(referencePreview);
let previewedJob = '';
const capabilityButton=document.createElement('button');
capabilityButton.type='button';capabilityButton.textContent='Movement details';capabilityButton.hidden=true;
capabilityButton.style.flexBasis='100%';capabilityButton.setAttribute('aria-haspopup','dialog');
recentGenerations.after(capabilityButton);
const capabilityDialog=document.createElement('dialog');
capabilityDialog.id='movementDetails';capabilityDialog.setAttribute('aria-labelledby','movementDetailsTitle');
const capabilityTitle=document.createElement('h2');capabilityTitle.id='movementDetailsTitle';capabilityTitle.textContent='Movement details';
const capabilityPanel=document.createElement('div');
const capabilityClose=document.createElement('button');capabilityClose.type='button';capabilityClose.textContent='Close';
capabilityDialog.append(capabilityTitle,capabilityPanel,capabilityClose);document.body.append(capabilityDialog);
capabilityButton.onclick=()=>capabilityDialog.showModal();
capabilityClose.onclick=()=>capabilityDialog.close();
capabilityDialog.addEventListener('click',event=>{if(event.target===capabilityDialog){const r=capabilityDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)capabilityDialog.close();}});
function showCapabilities(caps?:MotionCapabilities, ready=true) {
    capabilityPanel.replaceChildren();capabilityButton.hidden=!caps;
    if(!caps){capabilityDialog.close();return;}
    el('generatedActions').hidden=false;
    const intro=document.createElement('p');intro.textContent=ready?'Your character design is preserved. Only supported movements are enabled; other regions stay in their drawn pose. Preview the result before saving.':'Source assessment only — no animated rig is available. Candidate movements still require layer and geometry checks.';capabilityPanel.append(intro);
    const labels:Record<string,string>={'Arm L':'Left arm','Arm R':'Right arm','Leg L':'Left leg','Leg R':'Right leg',yaw:'Head turn (yaw)',pitch:'Head tilt (pitch)',roll:'Head lean (roll)',head:'Head',blink:'Blink',mouth:'Mouth'};
    for(const [name,c] of [...Object.entries(caps.headAxes??{head:caps.face.head}),...Object.entries({blink:caps.face.blink,mouth:caps.face.mouth}),...Object.entries(caps.chains)]) {
        const row=document.createElement('p');row.style.margin='5px 0';
        row.textContent=`${labels[name]}: ${c.mode==='fixed'?'held still':!ready?'candidate, not validated':c.mode==='limited'?'reduced movement range':'movement enabled'}${c.reasons.length?' — '+c.reasons.filter(r=>!r.startsWith('Body foldover:')).join(' '):''}`;
        capabilityPanel.append(row);
        for(const check of c.checks??[]){const detail=document.createElement('small');detail.style.display='block';detail.textContent=`${check.name}: ${check.status}${check.samples?' ('+check.samples+' poses)':''}. ${check.detail}`;capabilityPanel.append(detail);}
    }
}
const garmentControls = document.createElement('div');
garmentControls.className = 'grid';
garmentControls.style.marginTop = '5px';
garmentControls.hidden = true;
el('bodyRest').parentElement!.before(garmentControls);
for (const [name, label] of [['ParamGarmentSway','Cloth'],['ParamBodySway','Sway'],['ParamBreath','Breath']]) {
    const row = document.createElement('label'); row.className = 'slider';
    const title = document.createElement('span'); title.textContent = label;
    const input = document.createElement('input'); input.type = 'range'; input.id = name; input.step = '.01';
    const output = document.createElement('output'); output.id = name + 'Out';
    row.append(title, input, output); garmentControls.append(row);
    mappings[name] = [name,0,1];
}

function syncControls(displayValues = values) { for (const [id, [name, axis, multiplier]] of Object.entries(mappings)) {
    const input = el<HTMLInputElement>(id), p = asset && parameterByName(asset, name);
    input.disabled = !p;
    const caps=asset?.puppet.meta.motionCapabilities as MotionCapabilities|undefined;
    const c=caps?.chains[name as keyof MotionCapabilities['chains']]??(name==='ParamMouthOpenY'?caps?.face.mouth:(name==='Head Angles'||name==='ParamAngleZ')?(caps?.headAxes?.[id as 'yaw'|'pitch'|'roll']??caps?.face.head):undefined);
    input.disabled=!p||c?.mode==='fixed';
    input.title=c?.reasons.join(' ')??(!p?'This rig has no independent control for this movement.':'');
    input.parentElement!.title=input.title;
    if (id.startsWith('Param')) input.parentElement!.style.display = p ? '' : 'none';
    if (p) {
        input.min = String(p.min[axis] * multiplier);
        input.max = String(p.max[axis] * multiplier);
        input.value = String(displayValues[name][axis] * multiplier);
    }
    el(id + 'Out').textContent = id === 'jaw' ? (Number(input.value) / multiplier).toFixed(2) : input.value;
}
    garmentControls.hidden = false;
    garmentControls.style.display = ['ParamGarmentSway','ParamBodySway','ParamBreath'].some(name => values[name]) ? '' : 'none';
    const caps=asset?.puppet.meta.motionCapabilities as MotionCapabilities|undefined;
    motionButton.disabled = !asset || !Object.keys(motionDemoValues(asset.puppet.param,caps,1)).length;
    motionButton.textContent = clip ? 'Stop Motion Demo' : 'Motion Demo';
    motionButton.setAttribute('aria-pressed', String(Boolean(clip)));
    motionButton.title = motionButton.disabled ? 'This avatar has no supported body movement.' : 'Preview supported arm, elbow, hip and knee motion.';
}
for (const [id, [name, axis, multiplier]] of Object.entries(mappings))
    el<HTMLInputElement>(id).oninput = () => { clip = ''; if (values[name])
        values[name][axis] = Number(el<HTMLInputElement>(id).value) / multiplier; syncControls(); };
function resetBody() { clip = ''; for (const name of ['Arm L', 'Arm R', 'Leg L', 'Leg R','ParamGarmentSway','ParamBodySway','ParamBreath'])
    if (values[name])
        values[name] = [...parameterByName(asset!, name)!.defaults]; syncControls(); }
function resetHead() { blinkStarted = null; for (const p of asset?.puppet.param ?? [])
    if (!/^(Arm|Leg) /.test(p.name))
        values[p.name] = [...p.defaults]; syncControls(); }
el('bodyRest').onclick = resetBody;
el('headReset').onclick = resetHead;
function downloads(base: string, files: Record<string, string>, preparedOnly = false) {
    const container = el('downloads');
    container.replaceChildren();
    const rig = files['Download rig'];
    if (rig) {
        const formats = document.createElement('div');
        formats.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%';
        const title = document.createElement('span');
        title.textContent = 'Download rig:';
        title.style.fontSize = '12px';
        const inp = document.createElement('a');
        inp.textContent = 'Inochi (.inp)';
        inp.href = base + '/' + rig;
        inp.download = 'character.inp';
        inp.dataset.format = 'inochi';
        inp.style.cssText = 'color:var(--text-muted);font-size:12px';
        const live = document.createElement('button');
        live.textContent = 'Live2D (.zip)';
        live.dataset.format = 'live2d';
        live.style.cssText = 'font-size:12px;padding:5px 10px;flex:0 0 auto';
        const note = document.createElement('span');
        note.style.cssText = 'font-size:11px;color:var(--text-muted);width:100%';
        note.setAttribute('role', 'status');
        live.onclick = async () => {
            live.disabled = true;
            note.textContent = 'Preparing Live2D package… First export may take a few minutes.';
            try {
                const response = await fetch('/api/live2d/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: base + '/' + rig }) });
                const started = await response.json();
                if (!response.ok) throw new Error(started.error);
                while (live.isConnected) {
                    const progress = await fetch('/api/live2d/' + started.id);
                    const result = await progress.json();
                    if (!progress.ok || result.status === 'failed') throw new Error(result.error);
                    if (!live.isConnected) return;
                    if (result.status === 'ready') {
                        const link = document.createElement('a');
                        link.href = result.url;
                        link.download = 'Live2D.zip';
                        link.textContent = 'Live2D (.zip)';
                        link.dataset.format = 'live2d';
                        link.style.cssText = inp.style.cssText;
                        live.replaceWith(link);
                        note.textContent = 'Extract the ZIP, then open the .model3.json file in Cubism Viewer.';
                        link.click();
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                if (live.isConnected) {
                    note.textContent = error instanceof Error ? error.message : String(error);
                    live.disabled = false;
                }
            }
        };
        formats.append(title, inp, live, note);
        if (files['Live2D package']) {
            const packaged = document.createElement('a');
            packaged.href = base + '/' + files['Live2D package'];
            packaged.textContent = 'Live2D (.zip)'; packaged.download = 'Live2D.zip';
            packaged.dataset.format = 'live2d'; packaged.style.cssText = inp.style.cssText;
            live.replaceWith(packaged);
            note.textContent = 'Extract the ZIP, then open the .model3.json file in Cubism Viewer.';
        }
        if (preparedOnly && !files['Live2D package']) { live.remove(); note.textContent = 'Live2D package unavailable; see report.'; }
        container.append(formats);
    }
    for (const [label, file] of Object.entries(files)) {
        if (label === 'Download rig' || label === 'Live2D package' || !file) continue;
        const a = document.createElement('a');
        a.textContent = label;
        a.href = base + '/' + file;
        a.style.cssText = 'color:var(--text-muted);font-size:11px';
        a.target = '_blank';
        container.append(a);
    }
}
function stopSpeech() { ++speechTicket; el<HTMLButtonElement>('say').disabled = false; el('speechStatus').hidden = true; if (speech) {
    speech.audio?.pause();
    if (speech.url)
        URL.revokeObjectURL(speech.url);
} speech = null; }
async function load(bytes: Uint8Array, label: string) {
    showSave('',false,false);
    referencePreview.hidden = true;
    el<HTMLButtonElement>('record').disabled = false;
    const ticket = ++loading;
    status('Loading ' + label + '…');
    stopSpeech();
    clip = '';
    renderer?.dispose();
    renderer = undefined;
    const next = readCombined(bytes), draw = await createCombinedRenderer(canvas, next, {background:[0,0,0]});
    if (ticket !== loading) {
        draw.dispose();
        return;
    }
    asset = next;
    showCapabilities(next.puppet.meta.motionCapabilities as MotionCapabilities|undefined);
    renderer = draw;
    values = Object.fromEntries(next.puppet.param.map(p => [p.name, [...p.defaults]]));
    blinkStarted = null;
    for (const id of ['head', 'body', 'speak'])
        el<HTMLFieldSetElement>(id).disabled = false;
    syncControls();
    const blink = canBlink = Boolean(parameterByName(next, 'ParamEyeLOpen') && parameterByName(next, 'ParamEyeROpen') && next.parts.some(p => /^eyewhite-/.test(p.name)));
    const blinkButton = [...el('expressions').querySelectorAll('button')].find(b => b.textContent === 'Blink');
    if (blinkButton)
        blinkButton.disabled = !blink;
    const garment = (next.puppet.meta.combined as {mode?:string}).mode === 'garment-v1';
    el('bodyNote').textContent = [garment ? 'Limited garment motion. Hidden joints stay in their drawn pose.' : '', blink ? '' : 'This source has no independent blink controls.'].filter(Boolean).join(' ');
    status(label);
}
async function loadUrl(url: string, label: string) {
    const res = await fetch(url); if (!res.ok)
    throw new Error(`Cannot load ${label} (${res.status})`); await load(new Uint8Array(await res.arrayBuffer()), label); }
function guard(work: () => Promise<void>) { void work().catch(e => { status(e instanceof Error ? e.message : String(e)); }); }
el('pickAvatar').onclick = () => {
    const samples = el('avatarSamples');
    samples.hidden = !samples.hidden;
    el('pickAvatar').setAttribute('aria-expanded', String(!samples.hidden));
};
motionButton.onclick = () => {
    if (clip) { resetBody(); return; }
    clip = 'demo'; clipStart = performance.now(); syncControls();
};
for (const name of ['Neutral', 'Blink']) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => { blinkStarted = name === 'Blink' && canBlink ? performance.now() : null; };
    el('expressions').append(b);
}
const tts = espeakServiceBackend();
async function speak() {
    const text = el<HTMLTextAreaElement>('speech').value.trim();
    if (!text) return;
    stopSpeech();
    const ticket = speechTicket;
    el<HTMLButtonElement>('say').disabled = true;
    const message = el('speechStatus');
    try {
        const result = await tts.speak(text);
        if (ticket !== speechTicket) return;
        const url = result.audio ? URL.createObjectURL(new Blob([new Uint8Array(result.audio.bytes)], {type:result.audio.mimeType})) : undefined;
        const audio = url ? new Audio(url) : null;
        speech = {track:result.track,audio,url,start:performance.now()};
        if (audio) await audio.play();
    } catch (error) {
        if (ticket !== speechTicket) return;
        stopSpeech();
        message.textContent = error instanceof Error ? error.message : String(error);
        message.hidden = false;
    } finally {
        if (ticket === speechTicket) el<HTMLButtonElement>('say').disabled = false;
    }
}
el('say').onclick = () => { void speak(); };
el('stopSpeaking').onclick = stopSpeech;
const recorder = createRecorder(canvas, (recording, message) => { el('record').textContent = recording ? 'Stop recording' : 'Record a clip'; el('recordState').textContent = message; });
el('record').onclick = () => recorder.toggle();
function setBusy(value: boolean) { busy = value; recentGenerations.disabled=value; if(value)showSave('',false,false); el<HTMLButtonElement>('generate').disabled = value; el<HTMLInputElement>('source').disabled = value; }
async function poll(id: string) {
    setBusy(true);
    localStorage.setItem('combined-job', id);
    try {
        for (;;) {
            const r = await fetch('/api/rig/' + id);
            if (!r.ok) {
                if(r.status===404)localStorage.removeItem('combined-job');
                throw new Error('Preview unavailable. Unsaved previews expire when the server restarts; use Load last saved for saved rigs.');
            }
            const { report, base, saved } = await r.json() as {
                saved?:boolean;
                report: RunReport;
                base: string;
            };
            if (report.status === 'running' && report.files.input && previewedJob !== id) {
                previewedJob = id;
                referencePreview.src = base + '/' + report.files.input;
                referencePreview.hidden = false;
                downloads(base, { 'Source image': report.files.input });
                if (recorder.recording) recorder.toggle();
                el<HTMLButtonElement>('record').disabled = true;
                for (const group of ['head','body','speak']) el<HTMLFieldSetElement>(group).disabled = true;
                status('Source image ready — preparing the animated rig');
            }
            const backendNote=report.decomposition?.fallbackReason ? 'H100 unavailable; using local GPU. ' : report.decomposition?.used==='h100' ? 'See-through: H100. ' : '';
            if(report.status==='running')showCapabilities(undefined);
            state(backendNote + (report.status === 'running' ? `Working: ${report.detail ?? stageLabels[report.stage] ?? report.stage}… (${Math.floor((Date.now()-Date.parse(report.started))/60000)} min)` : (report.files.rig ? 'Rig ready — open Report for review findings.' : `${report.status.replaceAll('_', ' ')} — ${report.reasons.join(' ')}`)));
            if (report.status !== 'running') {
                localStorage.removeItem('combined-job');
                downloads(base, { 'Report': 'REPORT.md', ...(report.files.rig ? { 'Download rig': report.files.rig, 'Demo': report.files.demo } : {}) });
                if (report.files.rig)
                    await loadUrl(base + '/' + report.files.rig, 'Generated character');
                else {
                    referencePreview.src=base+'/'+(report.files.input??'input.png');referencePreview.hidden=false;
                    for(const group of ['head','body','speak'])el<HTMLFieldSetElement>(group).disabled=true;
                    showCapabilities(report.motionCapabilities,false);
                    status('Source image only — ' + report.status.replaceAll('_', ' ') + '. See the report.');
                }
                showSave(id,Boolean(saved),Boolean(report.files.input));
                await refreshGenerations();
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
    finally {
        setBusy(false);
    }
}
async function generate(body: BodyInit, type: string) { if (busy)
    return; setBusy(true); state('Starting…'); try {
    const res = await fetch('/api/rig/', { method: 'POST', headers: { 'content-type': type }, body });
    const result = await res.json();
    if (!res.ok)
        throw new Error([result.error, ...(result.missing ?? [])].join(' '));
    await refreshGenerations();
    await poll(result.id);
}
catch (e) {
    state(e instanceof Error ? e.message : String(e));
    setBusy(false);
} }
el('generate').onclick = () => { const prompt = el<HTMLTextAreaElement>('generatePrompt').value.trim(); if (!prompt) {
    state('Describe a character first.');
    return;
} void generate(JSON.stringify({ prompt }), 'application/json'); };
el<HTMLInputElement>('source').onchange = () => guard(async () => { const file = el<HTMLInputElement>('source').files?.[0]; if (!file)
    return; if (file.name.toLowerCase().endsWith('.inp')) {
    await load(new Uint8Array(await file.arrayBuffer()), file.name);
    el('downloads').replaceChildren();
}
else
    await generate(file, file.type); });
el('loadGenerated').onclick = () => guard(async () => { const response = await fetch('/api/rig/last'); const r = await response.json(); if (!response.ok)
    throw new Error(r.error); await loadUrl(r.base + '/' + r.report.files.rig, 'Last generated character'); downloads(r.base, { 'Download rig': r.report.files.rig, 'Report': 'REPORT.md' }); state('Rig ready — open Report for review findings.'); });
function frame(now: number) {
    if (asset && renderer && referencePreview.hidden) {
        const posed = structuredClone(values), t = (now - clipStart) / 1000;
        const put = (name: string, v: number[]) => { if (values[name])
            posed[name] = v; };
        if (clip) {
            const demo = motionDemoValues(asset.puppet.param, asset.puppet.meta.motionCapabilities as MotionCapabilities|undefined, t);
            const fade = Math.min(1, Math.max(0,t/.45));
            for (const [name,v] of Object.entries(demo))
                put(name,v.map((n,i)=>values[name][i]+(n-values[name][i])*fade));
        }
        if (el<HTMLInputElement>('idle').checked) {
            const tick = now / 1000, blink = Math.max(0, 1 - Math.abs((tick % 4.8) - 4.5) / .12);
            if (canBlink) {
                put('ParamEyeLOpen', [1 - blink]);
                put('ParamEyeROpen', [1 - blink]);
            }
            if (posed['Head Angles'])
                posed['Head Angles'][0] += 1.5 * Math.sin(tick * .8);
            for (const [name, offset] of [['ParamGarmentSway', .45*Math.sin(tick*.65)],['ParamBodySway', .35*Math.sin(tick*.5)],['ParamBreath', .35*(1+Math.sin(tick*1.3))]] as [string,number][]) {
                const p = parameterByName(asset,name);
                if (p) posed[name][0] = Math.max(p.min[0],Math.min(p.max[0],posed[name][0]+offset));
            }
        }
        if (blinkStarted !== null && canBlink) {
            const openness = blinkOpenness(now-blinkStarted);
            put('ParamEyeLOpen',[openness]); put('ParamEyeROpen',[openness]);
            if (now-blinkStarted >= 340) blinkStarted = null;
        }
        if (speech) {
            const time = speech.audio?.currentTime ?? (now - speech.start) / 1000;
            put('ParamMouthOpenY', [mouthOpenness(speech.track, time)]);
            if (time >= speech.track.durationSec)
                stopSpeech();
        }
        if (clip) syncControls(posed);
        try {
            renderer.draw(posed);
        }
        catch (e) {
            status(String(e));
            renderer.dispose();
            renderer = undefined;
        }
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
void installAvatarLibrary(el('avatarSamples'), async entry => {
    await loadUrl(entry.base+'/'+entry.files['Download rig'],entry.label);
    downloads(entry.base,entry.files,true);
});
void refreshGenerations().catch(()=>{});
status('Describe a character, upload an image, or choose a saved avatar.');
syncControls();
guard(async () => { const r = await fetch('/api/rig/'); if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) {
    state('Generation and export preparation are available through npm run dev.');
    el<HTMLButtonElement>('generate').disabled = true;
    el<HTMLButtonElement>('loadGenerated').disabled = true;
    return;
 } const p = await r.json();
    el('generationSetup').hidden=Boolean(p.available);
    el('generationMissing').replaceChildren(...(p.missing??[]).map((reason:string)=>{const li=document.createElement('li');li.textContent=reason;return li;}));
    state(p.available ? `Ready: upload an image or describe a character. See-through: ${p.decomposition?.policy==='local'?'local GPU selected.':p.decomposition?.policy==='h100'?'H100 selected; local fallback disabled.':p.decomposition?.ready?'H100 connected, with local fallback.':'H100 unavailable; local fallback selected.'} Image and expression APIs run separately.` : 'Generation setup incomplete. You can still use example avatars or upload a rig.'); const pending = localStorage.getItem('combined-job') ?? p.running; if (pending)
    await poll(pending); });
