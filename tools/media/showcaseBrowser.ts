import { readCombined, type CombinedAsset } from '../../player/src/combinedRuntime';
import { createCombinedRenderer } from '../../player/src/combinedRenderer';
import { recipeFor, showcaseValues, reviewTimes, type Recipe } from './showcaseMotion';

interface Entry { id:string; label:string; base:string }
interface Rig { asset:CombinedAsset; canvas:HTMLCanvasElement; renderer:Awaited<ReturnType<typeof createCombinedRenderer>>; neutral:HTMLCanvasElement; recipe:Recipe }
const canvas=document.querySelector<HTMLCanvasElement>('#composition')!,ctx=canvas.getContext('2d')!;
const cache=new Map<number,Rig>();
let entries:Entry[]=[];
const W=1600,H=1000,stride=320,openingHold=2,closingHold=7,step=2;
const canvasAt=(w:number,h:number)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const text=(s:string,x:number,y:number,size=15,color='#c7c6ca',align:CanvasTextAlign='left')=>{ctx.font=`${size>=20?'600':'400'} ${size}px Arial`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(s,x,y);};
async function get(index:number){
    let rig=cache.get(index);if(rig)return rig;
    const e=entries[index],response=await fetch(`${e.base}/character.inp`);if(!response.ok)throw Error(`Cannot load ${e.id}`);
    const asset=readCombined(new Uint8Array(await response.arrayBuffer()));
    const c=canvasAt(360,416);c.style.width='360px';c.style.height='416px';document.querySelector('#renders')!.append(c);
    const renderer=await createCombinedRenderer(c,asset,{background:[0,0,0]});renderer.draw({});
    const neutral=canvasAt(c.width,c.height);neutral.getContext('2d')!.drawImage(c,0,0);
    rig={asset,canvas:c,renderer,neutral,recipe:recipeFor(asset.puppet)};cache.set(index,rig);return rig;
}
function discard(index:number){const r=cache.get(index);if(!r)return;r.renderer.dispose();r.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();r.canvas.remove();cache.delete(index);}
function label(s:string,x:number,y:number,width=300,size=14){
    ctx.font=`${size}px Arial`;const words=s.split(' ');let line='';const lines:string[]=[];
    for(const word of words){if(ctx.measureText((line+' '+word).trim()).width>width){lines.push(line);line=word;}else line=(line+' '+word).trim();}lines.push(line);
    for(let i=0;i<lines.length;i++)text(lines[i],x,y+i*(size+3),size,'#d9d6ce','center');
}
const api={
    async init(selected?:string[]){
        for(const i of cache.keys())discard(i);
        const catalog=await(await fetch('/example-avatars/catalog.json')).json();entries=catalog.entries;
        if(selected)entries=selected.map(id=>entries.find(e=>e.id===id)!);
        return {count:entries.length,duration:openingHold+closingHold+Math.max(0,entries.length-5)*step};
    },
    async frame(seconds:number){
        canvas.width=W;canvas.height=H;ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
        const travel=Math.min(Math.max(0,(seconds-openingHold)/step),Math.max(0,entries.length-5));
        const visible=entries.map((_,i)=>i).filter(i=>{const x=160+(i-travel)*stride;return x>-185&&x<W+185;});
        for(const i of cache.keys())if(!visible.includes(i))discard(i);
        for(const i of visible){
            const r=await get(i),x=160+(i-travel)*stride;
            r.renderer.draw(showcaseValues(r.asset.puppet,r.recipe,seconds));
            ctx.drawImage(r.neutral,x-180,64,360,416);ctx.drawImage(r.canvas,x-180,524,360,416);
            label(entries[i].label,x,489);label(entries[i].label,x,949);
        }
        // Opaque header bands keep characters clear of the typography.
        ctx.fillStyle='#000';ctx.fillRect(0,0,W,62);ctx.fillRect(0,507,W,17);ctx.fillRect(0,975,W,25);
        text('INKINESIS',28,30,23,'#eee9de');text(`${entries.length} characters · One illustration, many movements`,W-28,29,15,'#c8c2b5','right');
        text('NEUTRAL',28,55,11,'#c8b990');text('IN MOTION',28,523,11,'#c8b990');
        ctx.strokeStyle='#242220';ctx.beginPath();ctx.moveTo(24,507);ctx.lineTo(W-24,507);ctx.stroke();
        text('Arms · Hips and knees · Head and expressions · Actual renderer playback',W/2,992,12,'#88857d','center');
        return canvas.toDataURL('image/png').split(',')[1];
    },
    async gallery(){
        const cols=7,cw=270,ch=365,rows=Math.ceil(entries.length/cols);canvas.width=cols*cw;canvas.height=76+rows*ch+32;
        ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);text('MEET THE CHARACTERS',28,36,24,'#eee9de');text(`${entries.length} original examples · Rendered from their rigs`,28,59,14,'#aaa59b');
        for(let i=0;i<entries.length;i++){const r=await get(i),x=(i%cols)*cw,y=76+Math.floor(i/cols)*ch;ctx.drawImage(r.neutral,x,y,cw,312);label(entries[i].label,x+cw/2,y+331,cw-12,13);discard(i);}
        text('Inkinesis · Neutral poses · Available movements vary by character',canvas.width/2,canvas.height-12,13,'#88857d','center');
        return canvas.toDataURL('image/webp',.94).split(',')[1];
    },
    async review(start:number,count=9){
        const cell=190,ch=292,rows=Math.min(count,entries.length-start);canvas.width=cell*reviewTimes.length;canvas.height=rows*ch;
        ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
        const records=[];
        for(let j=0;j<rows;j++){
            const i=start+j,r=await get(i),y=j*ch;
            for(const [k,t] of reviewTimes.entries()){r.renderer.draw(showcaseValues(r.asset.puppet,r.recipe,t));ctx.drawImage(r.canvas,k*cell,y,cell,250);text(`${t.toFixed(2)}s`,k*cell+8,y+264,12);}
            text(entries[i].id,8,y+284,12,'#eee9de');records.push({id:entries[i].id,...r.recipe});discard(i);
        }
        return {png:canvas.toDataURL('image/png').split(',')[1],records};
    },
    async heads(start:number,count=9){
        const times=[0,2.75,3,3.2,3.6],cell=190,ch=216,rows=Math.min(count,entries.length-start);canvas.width=cell*times.length;canvas.height=rows*ch;
        ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
        for(let j=0;j<rows;j++){
            const i=start+j,r=await get(i),y=j*ch;
            r.canvas.style.width='900px';r.canvas.style.height='1040px';
            for(const [k,t] of times.entries()){
                r.renderer.draw(showcaseValues(r.asset.puppet,r.recipe,t));
                ctx.drawImage(r.canvas,225,30,450,480,k*cell,y,cell,190);
            }
            text(entries[i].id,8,y+209,12,'#eee9de');discard(i);
        }
        return canvas.toDataURL('image/png').split(',')[1];
    },
};
declare global { interface Window { showcase:typeof api } }
window.showcase=api;
