/** Small public catalog with explicitly downloaded, verified local example rigs. */
import {readCatalog,type AvatarEntry} from '../avatarCatalog';
import type {DownloadState} from '../exampleDownloads';
export type {AvatarEntry} from '../avatarCatalog';
export async function installAvatarLibrary(container:HTMLElement,load:(entry:AvatarEntry)=>Promise<void>) {
    try {
        const response=await fetch('/example-avatars/catalog.json');
        if(!response.ok)throw new Error('Example catalog unavailable');
        const catalog=readCatalog(await response.json());
        container.replaceChildren();
        const panel=document.createElement('section');panel.className='avatar-install';panel.hidden=true;
        const title=document.createElement('strong'),button=document.createElement('button'),message=document.createElement('div'),progress=document.createElement('progress');
        button.type='button';button.id='downloadExample';message.id='exampleDownloadState';message.className='hint';message.setAttribute('aria-live','polite');progress.max=100;progress.hidden=true;
        panel.append(title,button,progress,message);container.append(panel);
        let selected:AvatarEntry|undefined,configured=false,service=false;
        const states=new Map<string,DownloadState>(),badges=new Map<string,HTMLElement>();
        const api=async(path:string,method='GET')=>{
            const r=await fetch('/api/examples'+path,{method});
            if(!r.headers.get('content-type')?.includes('application/json'))throw new Error('Run npm run dev to download examples into this checkout.');
            const data=await r.json();if(!r.ok)throw new Error(data.error??'Example request failed');return data;
        };
        const render=(entry:AvatarEntry,state:DownloadState)=>{
            states.set(entry.id,state);
            const pct=Math.min(100,Math.floor(100*state.received/Math.max(1,state.total)));
            const label=state.status==='ready'?'Downloaded':state.status==='downloading'?`Downloading… ${pct}%`:state.status==='failed'?'Retry download':'Download';
            const badge=badges.get(entry.id);if(badge)badge.textContent=state.status==='ready'?'Downloaded':state.status==='downloading'?`${pct}%`:'Not downloaded';
            if(selected?.id!==entry.id)return;
            button.textContent=label;button.disabled=state.status==='ready'||state.status==='downloading'||!configured||!service;
            progress.hidden=state.status!=='downloading';progress.value=pct;
            message.textContent=state.status==='ready'?`Available locally in example-avatars/${entry.id}/.`:
                state.status==='downloading'?`${(state.received/1048576).toFixed(1)} / ${(state.total/1048576).toFixed(1)} MB — verifying files before opening.`:
                state.error??(!service?'Start npm run dev to install examples locally.':!configured?'Example downloads are not published yet. Existing local avatars remain available.':`Download rig and Live2D files (${(state.total/1048576).toFixed(1)} MB). No GPU or API key required.`);
        };
        const monitor=async(entry:AvatarEntry)=>{
            for(;;){
                const state=await api('/'+entry.id) as DownloadState;render(entry,state);
                if(state.status!=='downloading'){
                    if(state.status==='ready'&&selected?.id===entry.id)await load(entry);
                    return;
                }
                await new Promise(resolve=>setTimeout(resolve,700));
            }
        };
        for(const entry of catalog.entries){
            const card=document.createElement('button');card.type='button';card.id='sample-'+entry.id;card.className='avatar-card';
            const img=document.createElement('img');img.src=entry.preview;img.alt='';img.loading='lazy';img.width=100;img.height=120;
            const name=document.createElement('span'),badge=document.createElement('small');name.textContent=`${entry.id.slice(0,2)} · ${entry.label}`;badge.textContent='Checking…';
            card.append(img,name,badge);container.append(card);badges.set(entry.id,badge);
            card.onclick=()=>{
                selected=entry;panel.hidden=false;title.textContent=entry.label;
                for(const other of container.querySelectorAll('.avatar-card'))other.setAttribute('aria-pressed',String(other===card));
                const state=states.get(entry.id)??{status:'missing',received:0,total:entry.artifacts.reduce((s,a)=>s+a.bytes,0)};
                render(entry,state);panel.scrollIntoView({block:'nearest'});
                if(state.status==='ready')void load(entry).catch(error=>{message.textContent=String(error);});
            };
        }
        button.onclick=()=>{
            if(!selected)return;const entry=selected;
            button.disabled=true;button.textContent='Downloading…';
            void api('/'+entry.id+'/download','POST').then(()=>monitor(entry)).catch(error=>{
                render(entry,{status:'failed',received:0,total:entry.artifacts.reduce((s,a)=>s+a.bytes,0),error:String(error.message??error)});
            });
        };
        try {
            const result=await api('/');service=true;configured=result.configured;
            for(const entry of catalog.entries){
                const state=result.entries.find((s:{id:string})=>s.id===entry.id) as DownloadState;
                render(entry,state);
                if(state.status==='downloading')void monitor(entry).catch(error=>{message.textContent=String(error);});
            }
        } catch {for(const entry of catalog.entries)render(entry,{status:'missing',received:0,total:entry.artifacts.reduce((s,a)=>s+a.bytes,0)});}
    } catch {container.textContent='Example catalog unavailable. You can still generate a character or upload an Inkinesis INP file.';}
}
