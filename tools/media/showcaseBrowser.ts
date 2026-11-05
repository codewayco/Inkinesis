import { readCombined, type CombinedAsset } from '../../player/src/combinedRuntime';
import { createCombinedRenderer } from '../../player/src/combinedRenderer';
import { recipeFor, showcaseValues, reviewTimes, SUPERSAMPLE, OUTPUT_SCALE, type Recipe } from './showcaseMotion';

interface Entry { id:string; label:string; base:string }
interface Rig { asset:CombinedAsset; canvas:HTMLCanvasElement; renderer:Awaited<ReturnType<typeof createCombinedRenderer>>; neutral:HTMLCanvasElement; recipe:Recipe }
const canvas=document.querySelector<HTMLCanvasElement>('#composition')!,ctx=canvas.getContext('2d')!;
const cache=new Map<number,Rig>();
let entries:Entry[]=[];
const W=1600,H=1000,stride=320,openingHold=2,closingHold=5,step=2.5;
const CELL_W=360,CELL_H=416;
const canvasAt=(w:number,h:number)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const text=(s:string,x:number,y:number,size=15,color='#c7c6ca',align:CanvasTextAlign='left')=>{ctx.font=`${size>=20?'600':'400'} ${size}px Arial`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(s,x,y);};
async function get(index:number){
    let rig=cache.get(index);if(rig)return rig;
    const e=entries[index],response=await fetch(`${e.base}/character.inp`);if(!response.ok)throw Error(`Cannot load ${e.id}`);
    const asset=readCombined(new Uint8Array(await response.arrayBuffer()));
    const c=canvasAt(CELL_W*SUPERSAMPLE,CELL_H*SUPERSAMPLE);c.style.width=`${c.width}px`;c.style.height=`${c.height}px`;document.querySelector('#renders')!.append(c);
    const renderer=await createCombinedRenderer(c,asset,{background:[0,0,0]});renderer.draw({});
    const neutral=canvasAt(c.width,c.height);neutral.getContext('2d')!.drawImage(c,0,0);
    rig={asset,canvas:c,renderer,neutral,recipe:recipeFor(asset.puppet,e.id)};cache.set(index,rig);return rig;
}
/** Media cover every evaluated avatar: the shipped catalog plus the local other-avatars catalog when it exists. */
async function mediaCatalog():Promise<Entry[]>{
    const read=async(path:string)=>{const r=await fetch(path);return r.ok&&r.headers.get('content-type')?.includes('json')?(await r.json()).entries as Entry[]:[];};
    const shipped=await read('/example-avatars/catalog.json');if(!shipped.length)throw Error('Missing example-avatars/catalog.json');
    return [...shipped,...await read('/other-avatars/catalog.json')].sort((a,b)=>a.id.localeCompare(b.id));
}
/** Resizing a canvas resets its 2D state, so smoothing is restored after every resize. */
function resize(w:number,h:number,scale=1){canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);ctx.setTransform(scale,0,0,scale,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';}
function discard(index:number){const r=cache.get(index);if(!r)return;r.renderer.dispose();r.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();r.canvas.remove();cache.delete(index);}
function label(s:string,x:number,y:number,width=300,size=14){
    ctx.font=`${size}px Arial`;const words=s.split(' ');let line='';const lines:string[]=[];
    for(const word of words){if(ctx.measureText((line+' '+word).trim()).width>width){lines.push(line);line=word;}else line=(line+' '+word).trim();}lines.push(line);
    for(let i=0;i<lines.length;i++)text(lines[i],x,y+i*(size+3),size,'#d9d6ce','center');
}
const api={
    async init(selected?:string[]){
        for(const i of cache.keys())discard(i);
        entries=await mediaCatalog();
        if(selected)entries=selected.map(id=>entries.find(e=>e.id===id)!);
        return {count:entries.length,duration:openingHold+closingHold+Math.max(0,entries.length-5)*step};
    },
    async frame(seconds:number){
        resize(W,H,OUTPUT_SCALE);ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
        const travel=Math.min(Math.max(0,(seconds-openingHold)/step),Math.max(0,entries.length-5));
        const visible=entries.map((_,i)=>i).filter(i=>{const x=160+(i-travel)*stride;return x>-185&&x<W+185;});
        for(const i of cache.keys())if(!visible.includes(i))discard(i);
        // Cells are wider than the stride; lighten keeps a neighbour's black background from cutting off outstretched arms and held objects.
        ctx.globalCompositeOperation='lighten';
        for(const i of visible){
            const r=await get(i),x=160+(i-travel)*stride;
            r.renderer.draw(showcaseValues(r.asset.puppet,r.recipe,seconds));
            ctx.drawImage(r.neutral,x-180,64,CELL_W,CELL_H);ctx.drawImage(r.canvas,x-180,524,CELL_W,CELL_H);
        }
        ctx.globalCompositeOperation='source-over';
        for(const i of visible){const x=160+(i-travel)*stride;label(entries[i].label,x,489);label(entries[i].label,x,949);}
        // Opaque header bands keep characters clear of the typography.
        ctx.fillStyle='#000';ctx.fillRect(0,0,W,62);ctx.fillRect(0,507,W,17);ctx.fillRect(0,975,W,25);
        text('INKINESIS',28,30,23,'#eee9de');text(`${entries.length} characters · One illustration, many movements`,W-28,29,15,'#c8c2b5','right');
        text('NEUTRAL',28,55,11,'#c8b990');text('IN MOTION',28,523,11,'#c8b990');
        ctx.strokeStyle='#242220';ctx.beginPath();ctx.moveTo(24,507);ctx.lineTo(W-24,507);ctx.stroke();
        text('Arms · Hips and knees · Head and expressions · Actual renderer playback',W/2,992,12,'#88857d','center');
        return canvas.toDataURL('image/png').split(',')[1];
    },
    async gallery(){
        const cols=10,cw=270,ch=365,rows=Math.ceil(entries.length/cols);resize(cols*cw,76+rows*ch+32);
        ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);text('MEET THE CHARACTERS',28,36,24,'#eee9de');text(`${entries.length} original examples · Rendered from their rigs`,28,59,14,'#aaa59b');
        for(let i=0;i<entries.length;i++){const r=await get(i),x=(i%cols)*cw,y=76+Math.floor(i/cols)*ch;ctx.drawImage(r.neutral,x,y,cw,312);label(entries[i].label,x+cw/2,y+331,cw-12,13);discard(i);}
        text('Inkinesis · Neutral poses · Available movements vary by character',canvas.width/2,canvas.height-12,13,'#88857d','center');
        return canvas.toDataURL('image/webp',.94).split(',')[1];
    },
    /** Frames of the README motion GIF: three rigs at a shared figure height, one 4-second loop at 12 fps. */
    async motionGif(ids:string[]){
        const size=1400,bg=[20,24,32],centers=[188,505,826],top=75,bottom=443,fps=12;
        const catalog=await mediaCatalog();
        const rigs=[];
        for(const id of ids){
            const e=catalog.find(e=>e.id===id)!,asset=readCombined(new Uint8Array(await(await fetch(`${e.base}/character.inp`)).arrayBuffer()));
            const c=canvasAt(size,size);c.style.width=c.style.height=size+'px';document.querySelector('#renders')!.append(c);
            // A margin around the rig canvas keeps raised arms and held objects inside the render.
            const renderer=await createCombinedRenderer(c,{...asset,width:asset.width*1.6,height:asset.height*1.6},{background:bg.map(v=>v/255) as [number,number,number]});
            renderer.draw({});
            const probe=canvasAt(size,size).getContext('2d')!;probe.drawImage(c,0,0);const d=probe.getImageData(0,0,size,size).data;
            let x0=size,x1=0,y0=size,y1=0;
            for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=4*(y*size+x);if(Math.abs(d[i]-bg[0])+Math.abs(d[i+1]-bg[1])+Math.abs(d[i+2]-bg[2])>18){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
            rigs.push({e,asset,c,renderer,recipe:recipeFor(asset.puppet),scale:(bottom-top)/(y1-y0),cx:(x0+x1)/2,y0});
        }
        const frames:string[]=[],keyed=canvasAt(size,size);
        for(let f=0;f<4*fps;f++){
            canvas.width=1040;canvas.height=524;ctx.fillStyle=`rgb(${bg})`;ctx.fillRect(0,0,canvas.width,canvas.height);
            rigs.forEach((r,i)=>{
                r.renderer.draw(showcaseValues(r.asset.puppet,r.recipe,f/fps));
                // Key out the shared background so neighbours' outstretched arms and objects overlap cleanly.
                const g=keyed.getContext('2d')!;g.drawImage(r.c,0,0);const image=g.getImageData(0,0,size,size);
                for(let k=0;k<image.data.length;k+=4)if(image.data[k]===bg[0]&&image.data[k+1]===bg[1]&&image.data[k+2]===bg[2])image.data[k+3]=0;
                g.putImageData(image,0,0);ctx.drawImage(keyed,centers[i]-r.cx*r.scale,top-r.y0*r.scale,size*r.scale,size*r.scale);label(r.e.label,centers[i],476,300,13);
            });
            ctx.font='700 26px Arial';ctx.fillStyle='#f4f5f7';ctx.textAlign='left';ctx.fillText('One rig. Many poses.',34,50);
            frames.push(canvas.toDataURL('image/png').split(',')[1]);
        }
        for(const r of rigs){r.renderer.dispose();r.c.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();r.c.remove();}
        return frames;
    },
    async review(start:number,count=9){
        const cell=190,ch=292,rows=Math.min(count,entries.length-start);resize(cell*reviewTimes.length,rows*ch);
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
        const times=[0,2.75,3,3.2,3.6],cell=190,ch=216,rows=Math.min(count,entries.length-start);resize(cell*times.length,rows*ch);
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
