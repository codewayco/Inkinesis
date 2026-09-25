/** Preserve source-visible body regions lost by semantic decomposition. No new artwork or joints. */
import { inpParts, type InpDocument, type InpNode } from './inp';
import { decodePNG, type DecodedImage } from '../generate/png';
import { encodePNG } from '../shared/encodePNG';
import { renderTextured, type TexturedMesh } from '../../engine/src/render/textured';

/** Large connected omissions only; small alpha/antialias differences are not repairs. */
export function missingBodyRegions(source:DecodedImage, coverage:Uint8ClampedArray, cutY:number, minimum=256,background?:number[]) {
    const {width:w,height:h}=source, missing=new Uint8Array(w*h),visited=new Uint8Array(w*h),selected=new Uint8Array(w*h);
    for(let y=Math.ceil(cutY);y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;missing[i]=Number(source.rgba[i*4+3]>128&&coverage[i*4+3]<24);}
    const queue=new Int32Array(w*h);const components:number[]=[],ambiguousComponents:number[]=[];
    for(let start=0;start<missing.length;start++)if(missing[start]&&!visited[start]){
        let at=0,end=1;queue[0]=start;visited[start]=1;
        while(at<end){const i=queue[at++],x=i%w,y=Math.floor(i/w);
            for(const j of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1])if(j>=0&&missing[j]&&!visited[j]){visited[j]=1;queue[end++]=j;}}
        if(end>=minimum){
            // An inferred silhouette includes enclosed backdrop and cast shadows.
            // Require chromatic evidence for automatic recovery; grayscale omissions
            // are reported for review instead of being misrepresented as anatomy.
            let confident=0;
            if(background)for(let k=0;k<end;k++){const i=queue[k]*4,r=source.rgba[i]-background[0],g=source.rgba[i+1]-background[1],b=source.rgba[i+2]-background[2];if(Math.max(r,g,b)-Math.min(r,g,b)>18)confident++;}
            if(background&&confident/end<.25){ambiguousComponents.push(end);continue;}
            components.push(end);for(let k=0;k<end;k++)selected[queue[k]]=1;
        }
    }
    return {selected,components,ambiguousComponents};
}
/** Genuine source alpha is trusted; an inferred opaque-image mask is not. */
export function inferredBackground(original:DecodedImage) {
    for(let i=3;i<original.rgba.length;i+=4)if(original.rgba[i]<250)return undefined;
    const values:number[][]=[[],[],[]];
    for(let y=0;y<original.height;y++)for(let x=0;x<original.width;x++)if(!x||!y||x===original.width-1||y===original.height-1)for(let c=0;c<3;c++)values[c].push(original.rgba[(y*original.width+x)*4+c]);
    return values.map(v=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)]);
}
export function preserveBodyCoverage(puppet:InpDocument,textures:Buffer[],source:DecodedImage,cutY:number,background?:number[]) {
    const {width,height}=source,parts=inpParts(puppet),decoded=textures.map(t=>decodePNG(t));
    const meshes:TexturedMesh[]=parts.map(n=>({xy:new Float64Array(n.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2).fill(-n.zsort),depthOffset:0,texture:decoded[n.textures![0]],opacity:n.opacity??1,sampling:'bilinear'}));
    // This union is conservative: overcoverage never invents a missing-region repair.
    const rendered=renderTextured(meshes,width,height,[0,0,0,0],{selfOverlap:'count'});
    // Do not reinterpret small enclosed background holes around hair as missing anatomy.
    const {selected,components,ambiguousComponents}=missingBodyRegions(source,rendered.rgba,cutY,Math.max(256,Math.round(width*height*.0025)),background);
    const policy={ambiguousComponents,background,minimumComponentFraction:.0025,minimumChromaticFraction:.25,chromaticThreshold:18,limitation:'Inferred masks can contain enclosed background or shadows. Ambiguous neutral-color components and small omissions are not automatically restored; visual review is required.'};
    if(!components.length)return {node:undefined,report:{...policy,components,restoredSourcePixels:0,scope:'No high-confidence large source-visible body omission restored'}};
    const rgba=new Uint8ClampedArray(source.rgba.length);let minX=width,minY=height,maxX=0,maxY=0;
    // Small overlap lies behind existing artwork and prevents a seam at the repair boundary.
    for(let y=Math.ceil(cutY);y<height;y++)for(let x=0;x<width;x++){
        let nearby=false;
        for(let dy=-3;dy<=3&&!nearby;dy++)for(let dx=-3;dx<=3;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<width&&yy>=0&&yy<height&&selected[yy*width+xx]){nearby=true;break;}}
        const i=(y*width+x)*4;if(!nearby||source.rgba[i+3]===0)continue;
        rgba.set(source.rgba.subarray(i,i+4),i);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
    const xs:number[]=[],ys:number[]=[];for(let x=minX;x<maxX+1;x+=24)xs.push(x);xs.push(maxX+1);for(let y=minY;y<maxY+1;y+=24)ys.push(y);ys.push(maxY+1);
    const verts:number[]=[],uvs:number[]=[],indices:number[]=[];
    for(const y of ys)for(const x of xs){verts.push(x-width/2,y-height/2);uvs.push(x/width,y/height);}
    for(let y=0;y<ys.length-1;y++)for(let x=0;x<xs.length-1;x++){const a=y*xs.length+x,b=a+1,c=a+xs.length,d=c+1;indices.push(a,b,c,b,d,c);}
    const defaults={transform:{trans:[0,0,0],rot:[0,0,0],scale:[1,1]},lockToRoot:false,blend_mode:'Normal',tint:[1,1,1],screenTint:[0,0,0],emissionStrength:1,mask_threshold:.5};
    const node:InpNode={...defaults,uuid:Math.max(...parts.map(n=>n.uuid))+1,name:'source-visible-body',type:'Part',enabled:true,zsort:Math.min(...parts.map(n=>n.zsort))-1,opacity:1,textures:[textures.length],mesh:{verts,uvs,indices,origin:[0,0]}};
    textures.push(encodePNG(rgba,width,height));puppet.nodes.children!.push(node);
    puppet.nodes.children!.sort((a,b)=>a.zsort-b.zsort);
    return {node,report:{...policy,components,restoredSourcePixels:components.reduce((a,b)=>a+b,0),bounds:[minX,minY,maxX+1,maxY+1],cutY,scope:'Source-visible missing body pixels retained behind semantic layers. No hidden anatomy synthesis or independent limb/cloth articulation on this fallback.'}};
}
