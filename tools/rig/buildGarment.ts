/** Experimental limited garment motion; the existing articulated builder is untouched. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { carryPoses, semanticLayer, type PoseDump } from './carryPsd2Live';
import { readInp, writeInp, inpParts, type InpDocument, type InpNode, type InpParameter } from './inp';
import { decodePNG } from '../generate/png';
import { constrainClosedEyes, restoreNeutralMouth, restoreMissingEyeDetails } from './combinedExpressions';
import { compactFaceKeys } from './compactFace';
import { assessGarment, type GarmentAssessment, type GarmentRegion } from '../imageToRig/garmentAnalysis';
import { evaluateCombined, readCombined } from '../../player/src/combinedRuntime';
import { preserveBodyCoverage, inferredBackground } from './garmentCoverage';
import {anchorLongHair} from './garmentHair';
import {coherentPitch} from './coherentPitch';

type Point = {x:number;y:number};
export interface GarmentAnalysis {
    source: {width:number;height:number}; points: Record<string,Point>;
    assessment: GarmentAssessment;
}
const faceLayer = /^(front hair|back hair|side hair|hair|headwear|eyewear|earwear(?:-[lr])?|face|neck|nose|ears?(?:-[lr])?|eyebrow-[lr]|irides-[lr]|eyewhite-[lr]|eyelash-[lr]|eye_close-[lr]|mouth(?:_open|_close)?|lip_upper|lip_lower|tooth-[tb]|tongue)$/;
const clothLayer = /^(topwear|bottomwear|handwear|arm)(?:-[lr])?$/;
const hash = (b:Buffer)=>createHash('sha256').update(b).digest('hex');
const smooth = (t:number)=>{const v=Math.max(0,Math.min(1,t)); return v*v*(3-2*v);};
function segmentDistance(p:Point,a:Point,b:Point) {
    const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/Math.max(l,1e-9)));
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
/** C1 attachment falloff; offsets are exactly zero at/above the attachment band. */
export function clothOffset(p:Point, region:GarmentRegion, width:number,height:number,marks:Record<string,Point>):Point {
    const [left,top,right,bottom]=region.box;
    if(p.x<left||p.x>right||p.y<top||p.y>bottom||p.y<=region.anchorY) return {x:0,y:0};
    const free=bottom-region.anchorY;
    const edge=Math.min((p.x-left)/Math.max(1,(right-left)*.08),(right-p.x)/Math.max(1,(right-left)*.08));
    let weight=smooth((p.y-region.anchorY)/Math.max(1,free))*smooth(edge);
    if(region.kind==='sleeve') {
        const side=(left+right)/2>width/2?'L':'R';
        const a=marks['shoulder'+side],b=marks['elbow'+side],c=marks['wrist'+side];
        if(!a||!b||!c) return {x:0,y:0};
        const distance=Math.min(segmentDistance(p,a,b),segmentDistance(p,b,c));
        weight*=smooth((distance-width*.024)/(width*.06));
        // Keep hand/wrist contact fixed even where translucent artwork is merged.
        weight*=smooth((Math.hypot(p.x-c.x,p.y-c.y)-width*.035)/(width*.045));
    }
    const amplitude=Math.min(width*.006,free*.025,height*.008)*(region.kind==='sleeve'?.6:1);
    return {x:amplitude*weight,y:0};
}

export function buildGarment(dump:PoseDump,atlases:Map<string,Buffer>,analysis:GarmentAnalysis,reference?:ReturnType<typeof decodePNG>,preservation?:ReturnType<typeof decodePNG>) {
    const decision=assessGarment(analysis.assessment);
    if(!decision.canBuild) throw new Error('Insufficient visible facial evidence for garment rig');
    const {width,height}=dump.canvas, scale=Math.max(width,height)/Math.max(analysis.source.width,analysis.source.height);
    const ox=(width-analysis.source.width*scale)/2,oy=(height-analysis.source.height*scale)/2;
    const point=(p:Point)=>({x:p.x*scale+ox,y:p.y*scale+oy});
    const marks=Object.fromEntries(Object.entries(analysis.points).map(([k,p])=>[k,point(p)]));
    const regions=decision.regions.map(g=>({...g,box:[g.box[0]*analysis.source.width*scale+ox,g.box[1]*analysis.source.height*scale+oy,g.box[2]*analysis.source.width*scale+ox,g.box[3]*analysis.source.height*scale+oy] as GarmentRegion['box'],anchorY:g.anchorY*analysis.source.height*scale+oy}));
    const textures:Buffer[]=[],textureIds=new Map<string,number>();
    const transform={trans:[0,0,0],rot:[0,0,0],scale:[1,1]};
    const defaults={transform,lockToRoot:false,blend_mode:'Normal',tint:[1,1,1],screenTint:[0,0,0],emissionStrength:1,mask_threshold:.5};
    const body=dump.drawables.filter(d=>!faceLayer.test(semanticLayer(d.layer)));
    const parts:InpNode[]=body.map((d,i)=>{
        if(!d.textureFile||!d.rest||!d.uvs||d.maskedBy?.length) throw new Error('Unsupported garment drawable '+d.layer);
        if(!textureIds.has(d.textureFile)){const b=atlases.get(d.textureFile);if(!b)throw new Error('Missing body atlas');textureIds.set(d.textureFile,textures.length);textures.push(b);}
        return {...defaults,uuid:i+1,name:d.layer,type:'Part',enabled:true,zsort:d.drawOrder??0,opacity:d.opacity??1,textures:[textureIds.get(d.textureFile)!],
            mesh:{verts:d.rest.map((v,k)=>(k%2&&dump.coordinateSystem!=='canvas-y-down'?-v:v)-(k%2?height:width)/2),uvs:d.uvs,indices:d.indices,origin:[0,0]}};
    });
    if(!parts.length)throw new Error('No retained body artwork');
    parts.push({...defaults,uuid:999,name:'face_skin',type:'Part',enabled:true,zsort:dump.drawables.find(d=>d.layer==='face')?.drawOrder??100,textures:[0],mesh:{verts:[0,0,1,0,0,1],uvs:[0,0,1,0,0,1],indices:[0,1,2],origin:[0,0]}});
    const document:InpDocument={meta:{name:'garment-character',version:'1.0-alpha',canvas:{width,height},preservePixels:false,combined:{version:2,mode:'garment-v1'}},nodes:{...defaults,uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:parts},param:[]};
    const carried=carryPoses(writeInp(document,textures),dump,atlases,{nativeMouth:true,sourceOrder:true,faceControlsOnly:true,splitFaceLayers:true});
    const source=readInp(carried.file),puppet=source.puppet;
    const expressionRepairs=constrainClosedEyes(puppet,source.textures);
    if(reference){expressionRepairs.push(restoreNeutralMouth(puppet,source.textures,reference));expressionRepairs.push(...restoreMissingEyeDetails(puppet,source.textures,reference,marks));}
    const hairAttachments=anchorLongHair(puppet,marks.chin.y,height);
    puppet.meta.headAttachments=hairAttachments;
    puppet.meta.pitch=coherentPitch(puppet,marks);
    if(preservation&&(preservation.width!==width||preservation.height!==height))throw new Error('Source preservation canvas differs');
    const coverage=preservation?preserveBodyCoverage(puppet,source.textures,preservation,marks.chin.y+height*.025,reference?inferredBackground(reference):undefined):undefined;
    const nodes=inpParts(puppet), bodyIds=new Set(parts.filter(p=>p.name!=='face_skin').map(p=>p.uuid));
    if(coverage?.node)bodyIds.add(coverage.node.uuid);
    let uuid=Math.max(10000,...puppet.param.map(p=>p.uuid))+1;
    const baseline=writeInp(puppet,source.textures);
    const torso=marks.shoulderL&&marks.shoulderR?(marks.shoulderL.y+marks.shoulderR.y)/2:height*.3;
    const floor=Math.max(...nodes.flatMap(n=>n.mesh!.verts.filter((_,i)=>i%2).map(y=>y+height/2)));
    const waist=regions.filter(r=>r.kind!=='sleeve').map(r=>r.anchorY).sort((a,b)=>a-b)[0]??torso+height*.15;
    const center=marks.shoulderL&&marks.shoulderR?(marks.shoulderL.x+marks.shoulderR.x)/2:width/2;
    const fields = {
        ParamGarmentSway:(n:InpNode,p:Point)=>{
            if(!clothLayer.test(n.name))return {x:0,y:0};
            const relevant=regions.filter(g=>g.kind==='sleeve'?/^(handwear|arm)/.test(n.name):/^(topwear|bottomwear)/.test(n.name));
            // Use one continuous field on merged pixels; never double-apply overlapping masks.
            return relevant.map(r=>clothOffset(p,r,width,height,marks)).reduce((a,b)=>Math.abs(a.x)>Math.abs(b.x)?a:b,{x:0,y:0});
        },
        ParamBodySway:(_n:InpNode,p:Point)=>({x:width*.0025*smooth((floor-p.y)/Math.max(1,floor-torso)),y:0}),
        ParamBreath:(n:InpNode,p:Point)=>{
            if(!bodyIds.has(n.uuid)||p.y<torso||p.y>waist)return {x:0,y:0};
            const t=(p.y-torso)/Math.max(1,waist-torso);
            const edge=1-smooth(Math.abs(p.x-center)/(width*.15));
            return {x:(p.x-center)*.012*Math.sin(Math.PI*t)**2*edge,y:0};
        },
    };
    const generated:InpParameter[]=[];
    for(const [name,field] of Object.entries(fields)) {
        if(name==='ParamGarmentSway'&&!decision.capabilities.garment || name!=='ParamGarmentSway'&&!decision.capabilities.body)continue;
        const keys=name==='ParamBreath'?[0,.5,1]:[-1,0,1];
        const bindings=nodes.flatMap(n=>{
            const offsets:Point[]=[];for(let i=0;i<n.mesh!.verts.length;i+=2)offsets.push(field(n,{x:n.mesh!.verts[i]+width/2,y:n.mesh!.verts[i+1]+height/2}));
            if(!offsets.some(p=>Math.hypot(p.x,p.y)>1e-6))return [];
            return [{node:n.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:keys.map(()=>[true]),values:keys.map(k=>[offsets.map(p=>[p.x*k,p.y*k])])}];
        });
        if(bindings.length)generated.push({uuid:uuid++,name,is_vec2:false,min:[keys[0],0],max:[keys.at(-1)!,0],defaults:[0,0],axis_points:[keys.map(k=>(k-keys[0])/(keys.at(-1)!-keys[0])),[0]],merge_mode:'Passthrough',bindings});
    }
    puppet.param.push(...generated);
    puppet.meta.combined={version:2,mode:'garment-v1',chains:[],scope:'Limited face, body and pinned garment keyforms; no hidden limb animation or physics.'};
    puppet.meta.capabilities={...decision.capabilities,garment:generated.some(p=>p.name==='ParamGarmentSway'),body:generated.some(p=>p.name==='ParamBodySway'),reasons:decision.reasons};
    puppet.meta.garment={regions,bodyParts:[...bodyIds],parameters:generated.map(p=>p.name),attachmentRule:'Cloth offsets are zero at/above anchorY; merged sleeves also pin visible arm chains and wrists.',layerPolicy:'Preserve merged artwork and fixed source draw order; no invented depth or hidden surfaces.'};
    const faceCompression=compactFaceKeys(puppet);
    const file=writeInp(puppet,source.textures), asset=readCombined(file);
    // Compare rest geometry against the face/body assembly before new parameters.
    const before=evaluateCombined(readCombined(baseline)); let neutralError=0;
    const neutral=evaluateCombined(asset);
    for(const n of before) {
        const p=neutral.find(p=>p.uuid===n.uuid)!;
        n.xy.forEach((v,i)=>{neutralError=Math.max(neutralError,Math.abs(p.xy[i]-v));});
    }
    if(neutralError>1e-7)throw new Error('Garment parameters changed the neutral geometry');
    const audit=auditGarment(asset,bodyIds);
    const attachments=auditAttachments(asset,regions);
    return {file,report:{mode:'garment-v1',capabilities:puppet.meta.capabilities,garment:puppet.meta.garment,sourceCoverage:coverage?.report,hairAttachments,faceChannels:carried.channels,faceCompression,expressionRepairs,neutralMaxPositionError:neutralError,geometry:audit,attachments,
        limitations:['No walking, independent arm/leg articulation, hidden-surface completion or dynamic draw-order changes.','Sleeve sway is disabled when its visible arm chain is incomplete.','Geometry checks do not certify alpha overlap or visual quality.']}};
}

/** Verify authored vertex anchors and static non-clothing layers, relative to the assembled neutral rig. */
export function auditAttachments(asset:ReturnType<typeof readCombined>,regions:GarmentRegion[]) {
    const rest=evaluateCombined(asset), param=asset.puppet.param.find(p=>p.name==='ParamGarmentSway');
    const influenced=new Set(param?.bindings.map(b=>b.node)??[]);
    let pinnedVertices=0,maxPinnedError=0,maxUnboundError=0,maxClothDisplacement=0;
    for(const value of [-1,1]) {
        const pose=new Map(evaluateCombined(asset,{ParamGarmentSway:[value]}).map(p=>[p.uuid,p]));
        for(const n of asset.parts){
            const initial=rest.find(p=>p.uuid===n.uuid)!.xy,xy=pose.get(n.uuid)!.xy;
            const relevant=regions.filter(r=>r.kind==='sleeve'?/^(handwear|arm)/.test(n.name):/^(topwear|bottomwear)/.test(n.name));
            const anchor=Math.min(...relevant.map(r=>r.anchorY));
            for(let i=0;i<xy.length;i+=2){
                const error=Math.hypot(xy[i]-initial[i],xy[i+1]-initial[i+1]);
                if(!influenced.has(n.uuid))maxUnboundError=Math.max(maxUnboundError,error);
                else {
                    maxClothDisplacement=Math.max(maxClothDisplacement,error);
                    if(initial[i+1]+asset.height/2<=anchor){pinnedVertices++;maxPinnedError=Math.max(maxPinnedError,error);}
                }
            }
        }
    }
    if(maxPinnedError>1e-7||maxUnboundError>1e-7)throw new Error('Cloth motion moved a pinned vertex or unbound layer');
    return {status:'passed',pinnedVertexChecks:pinnedVertices,maxPinnedError,maxUnboundError,maxClothDisplacement,
        scope:'Authored vertex attachment bands at cloth extrema, relative to neutral; does not certify pixel seams between different topologies.'};
}

export function auditGarment(asset:ReturnType<typeof readCombined>,bodyIds:Set<number>) {
    let samples=0,triangles=0,maxAreaRatio=1,minAreaRatio=1;
    for(const sway of [-1,-.5,0,.5,1])for(const body of [-1,0,1])for(const breath of [0,.5,1]) {
        samples++;
        const posed=new Map(evaluateCombined(asset,{ParamGarmentSway:[sway],ParamBodySway:[body],ParamBreath:[breath]}).map(p=>[p.uuid,p]));
        for(const n of asset.parts.filter(n=>bodyIds.has(n.uuid))) {
            const v=n.mesh!.verts,p=posed.get(n.uuid)!.xy,ids=n.mesh!.indices;
            const area=(xy:number[],a:number,b:number,c:number)=>(xy[b*2]-xy[a*2])*(xy[c*2+1]-xy[a*2+1])-(xy[b*2+1]-xy[a*2+1])*(xy[c*2]-xy[a*2]);
            for(let i=0;i<ids.length;i+=3){const [a,b,c]=ids.slice(i,i+3),r=area(v,a,b,c);if(Math.abs(r)<=.1)continue;triangles++;const ratio=area(p,a,b,c)/r;if(!Number.isFinite(ratio)||ratio<=0)throw new Error(`Garment foldover: ${n.name}`);minAreaRatio=Math.min(minAreaRatio,ratio);maxAreaRatio=Math.max(maxAreaRatio,ratio);}
        }
    }
    if(minAreaRatio<.8||maxAreaRatio>1.2)throw new Error('Garment deformation exceeds the area strain budget');
    return {status:'passed',samples,triangles,minAreaRatio,maxAreaRatio,scope:'All retained body meshes at 45 simultaneous garment/body/breath poses; excludes near-degenerate rest triangles <=0.1 doubled pixel area.'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
    const bytes=readFileSync(config.sourcePoses),dump=JSON.parse(bytes.toString()) as PoseDump;
    const atlases=new Map([...new Set(dump.drawables.map(d=>d.textureFile!))].map(f=>{if(basename(f)!==f)throw new Error('Unsafe atlas path');return [f,readFileSync(resolve(dirname(config.sourcePoses),f))];}));
    const analysis=JSON.parse(readFileSync(config.landmarks,'utf8')) as GarmentAnalysis;
    const result=buildGarment(dump,atlases,analysis,decodePNG(readFileSync(config.reference)),decodePNG(readFileSync(resolve(dirname(config.landmarks),'assets/source-preservation.png'))));
    mkdirSync(config.out,{recursive:true});writeFileSync(resolve(config.out,'character.inp'),result.file);
    writeFileSync(resolve(config.out,'build.json'),JSON.stringify({...result.report,source:config.sourcePoses,sourceSha256:hash(bytes),outputSha256:hash(result.file)},null,2)+'\n');
}
