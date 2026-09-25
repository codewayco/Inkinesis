/** Only the combined path: measured source bust + our continuous articulated body. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {carryPoses,type PoseDump} from './carryPsd2Live';
import {readInp,writeInp,inpParts,inpTextures,type InpNode,type InpDocument,type InpParameter} from './inp';
import {poseContinuousLimb,type ContinuousLimb,type LimbPoint} from '../../engine/src/body/continuousLimb';
import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import {decodePNG} from '../generate/png';
import {combinedMeshGate} from './combinedMeshGate';
import {repairFootOwnership} from './combinedFootwear';
import {constrainClosedEyes,restoreNeutralMouth,restoreMissingEyeDetails} from './combinedExpressions';
import {encodePNG} from '../shared/encodePNG';
import {compactFaceKeys} from './compactFace';
import {anchorLongHair} from './garmentHair';
import {clothingAttachments} from './clothingAttachments';
import {coherentPitch} from './coherentPitch';
import {semanticLayer} from './carryPsd2Live';
import {mergeGarmentComponents} from './mergeGarmentComponents';
import {faceLayers,layerCapabilities,finalizeMotionCapabilities} from './motionCapabilities';
import type {MotionCapabilities,ChainName} from '../imageToRig/capabilities';

const body=/^(topwear|bottomwear|arm-[lr]|hand-[lr]|handwear-[lr]|legwear-[lr]|footwear-[lr])$/;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function buildCombined(dump:PoseDump,atlases:Map<string,Buffer>,marks:Record<string,LimbPoint>,visibleLegs:boolean,reference?:ReturnType<typeof decodePNG>,compactFace=false,headAttachmentSafety=false,capabilities?:MotionCapabilities) {
  if(!visibleLegs&&!capabilities)throw new Error('Long/occluding garments are outside combined v1; no garment-to-leg substitution');
  const {width,height}=dump.canvas,rawTextures:Buffer[]=[];const textureIds=new Map<string,number>();
  const transform={trans:[0,0,0],rot:[0,0,0],scale:[1,1]};
  const partDefaults={transform,lockToRoot:false,blend_mode:'Normal',tint:[1,1,1],screenTint:[0,0,0],emissionStrength:1,mask_threshold:.5};
  const bodyDrawables=mergeGarmentComponents(dump.drawables.filter(d=>capabilities?!faceLayers.test(semanticLayer(d.layer)):body.test(semanticLayer(d.layer))));
  if(!bodyDrawables.some(d=>d.layer==='topwear'))throw new Error('Missing torso');
  const parts:InpNode[]=bodyDrawables.map((d,i)=>{
    if(!d.textureFile||!d.rest||!d.uvs||d.maskedBy?.length)throw new Error('Unsupported body source');
    if(!textureIds.has(d.textureFile)){const b=atlases.get(d.textureFile);if(!b)throw new Error('Missing atlas');textureIds.set(d.textureFile,rawTextures.length);rawTextures.push(b);}
    return {...partDefaults,uuid:i+1,name:d.layer,type:'Part',enabled:true,zsort:d.drawOrder??0,opacity:d.opacity??1,textures:[textureIds.get(d.textureFile)!],
      mesh:{verts:d.rest.map((v,k)=>(k%2&&dump.coordinateSystem!=='canvas-y-down'?-v:v)-(k%2?height:width)/2),uvs:d.uvs,indices:d.indices,origin:[0,0]}};
  });
  const face=dump.drawables.find(d=>d.layer==='face')!;
  parts.push({uuid:999,name:'face_skin',type:'Part',enabled:true,zsort:face.drawOrder??100,textures:[0],mesh:{verts:[0,0,1,0,0,1],uvs:[0,0,1,0,0,1],indices:[0,1,2],origin:[0,0]}});
  const document:InpDocument={...{physics:{pixelsPerMeter:1000,gravity:9.8},automation:[],animations:{}},meta:{name:'combined-character',version:'1.0-alpha',canvas:{width,height},preservePixels:false},nodes:{...{transform,lockToRoot:false},uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:parts},param:[]};
  const carried=carryPoses(writeInp(document,rawTextures),dump,atlases,{nativeMouth:true,sourceOrder:true,faceControlsOnly:true,splitFaceLayers:headAttachmentSafety});
  const {puppet,textures}=readInp(carried.file);const nodes=inpParts(puppet);const chains=[];
  const expressionRepairs=constrainClosedEyes(puppet,textures,Boolean(capabilities));
  if(reference){if(!capabilities||nodes.some(n=>n.name==='mouth_close'))expressionRepairs.push(restoreNeutralMouth(puppet,textures,reference));if(!capabilities||['eyeL','eyeR','eyeLOuter','eyeROuter'].every(n=>marks[n]))expressionRepairs.push(...restoreMissingEyeDetails(puppet,textures,reference,marks));}
  const legsReady=!capabilities||['Leg L','Leg R'].every(n=>capabilities.chains[n as ChainName].mode!=='fixed');
  const legOwnershipRepair=legsReady?repairFootOwnership(puppet,textures,marks,'legwear'):{status:'skipped',reason:'Leg attachments are not independently usable'};
  const footwearRepair=legsReady?repairFootOwnership(puppet,textures,marks):{status:'skipped',reason:'Leg attachments are not independently usable'};
  const motion=capabilities?layerCapabilities(puppet,textures,marks,capabilities):undefined;
  const shirt=nodes.find(n=>n.name==='topwear')!;
  const shirtMask=renderTextured([{xy:new Float64Array(shirt.mesh!.verts.map((v,k)=>v+(k%2?height:width)/2)),uv:new Float64Array(shirt.mesh!.uvs),indices:new Uint32Array(shirt.mesh!.indices),depth:new Float64Array(shirt.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:inpTextures(textures)[shirt.textures![0]],sampling:'bilinear'} as TexturedMesh],width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
  let uuid=Math.max(...puppet.param.map(p=>p.uuid))+1;
  for(const kind of ['Arm','Leg'])for(const side of ['L','R']) {
    const capability=motion?.chains[`${kind} ${side}` as ChainName];
    if(capability?.mode==='fixed')continue;
    const root=marks[(kind==='Arm'?'shoulder':'hip')+side],joint=marks[(kind==='Arm'?'elbow':'knee')+side],tip=marks[(kind==='Arm'?'wrist':'ankle')+side];
    if(!root||!joint||!tip)throw new Error(`Missing ${kind} ${side} landmarks`);
    const names=kind==='Arm'?[`arm-${side.toLowerCase()}`,`hand-${side.toLowerCase()}`,`handwear-${side.toLowerCase()}`]:[`legwear-${side.toLowerCase()}`,`footwear-${side.toLowerCase()}`];
    const owned=nodes.filter(n=>names.includes(n.name));
    if(!owned.some(n=>kind==='Arm'?/^(arm|handwear)-/.test(n.name):n.name.startsWith('legwear-')))throw new Error(`No source layer for ${kind} ${side}`);
    const upper=Math.hypot(joint.x-root.x,joint.y-root.y);
    const chain:ContinuousLimb={root,joint,tip,rootBlend:upper*.6,jointBlend:upper*.45};
    // Keep the source's hidden shoulder cap behind the garment. A source-visible
    // overlay shares exactly the same deformation, so no independent elbow seam.
    if(kind==='Arm') {
      const front=(nodes.find(n=>n.name==='topwear')?.zsort??11)+.25;
      for(const node of [...owned]) {
        if(node.name.startsWith('hand-')) {node.zsort=front+.01;continue;}
        const texture=decodePNG(new Uint8Array(textures[node.textures![0]]));
        const uv=node.mesh!.uvs,v=node.mesh!.verts;
        const us=uv.filter((_,i)=>i%2===0),vs=uv.filter((_,i)=>i%2===1);
        const xx=v.filter((_,i)=>i%2===0).map(x=>x+width/2),yy=v.filter((_,i)=>i%2===1).map(y=>y+height/2);
        const u0=Math.min(...us),u1=Math.max(...us),v0=Math.min(...vs),v1=Math.max(...vs);
        const x0=Math.min(...xx),x1=Math.max(...xx),y0=Math.min(...yy),y1=Math.max(...yy);
        for(let py=0;py<texture.height;py++)for(let px=0;px<texture.width;px++) {
          const u=px/texture.width,w=py/texture.height,i=(py*texture.width+px)*4+3;
          if(u<u0||u>u1||w<v0||w>v1){texture.rgba[i]=0;continue;}
          const x=x0+(u-u0)/(u1-u0)*(x1-x0),y=y0+(w-v0)/(v1-v0)*(y1-y0);
          const sx=Math.max(0,Math.min(width-1,Math.round(x))),sy=Math.max(0,Math.min(height-1,Math.round(y)));
          // Preserve the actual source garment edge, instead of a straight cut
          // through the biceps or sleeve. Hidden root stays in the lower copy.
          const visible=1-shirtMask[(sy*width+sx)*4+3]/255;
          texture.rgba[i]=Math.round(texture.rgba[i]*visible);
        }
        const clone={...node,uuid:2000+node.uuid,name:node.name+'__front',zsort:front,textures:[textures.length]};
        textures.push(Buffer.from(encodePNG(texture.rgba,texture.width,texture.height)));
        puppet.nodes.children!.push(clone);owned.push(clone);
      }
    }
    const rangeScale=capability?.mode==='limited'?.5:1;
    const xs=(kind==='Arm'?[-30,-20,-10,0,10,20,30]:[-25,-18.75,-12.5,-6.25,0,6.25,12.5,18.75,25]).map(x=>x*rangeScale);
    const ys=(kind==='Arm'?[-60,-40,-20,0,20,40,60]:[0,10,20,30,40,50,60]).map(y=>y*rangeScale);
    const sign=kind==='Leg'&&side==='R'?-1:1;
    const param:InpParameter={uuid:uuid++,name:`${kind} ${side}`,is_vec2:true,min:[xs[0],ys[0]],max:[xs.at(-1)!,ys.at(-1)!],defaults:[0,0],axis_points:[xs.map(x=>(x-xs[0])/(xs.at(-1)!-xs[0])),ys.map(y=>(y-ys[0])/(ys.at(-1)!-ys[0]))],merge_mode:'Passthrough',bindings:owned.map(node=>({node:node.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:xs.map(()=>ys.map(()=>true)),values:xs.map(x=>ys.map(y=>{
      const v=node.mesh!.verts,delta=[];
      for(let i=0;i<v.length;i+=2){const p={x:v[i]+width/2,y:v[i+1]+height/2};const q=poseContinuousLimb(p,chain,x,y*sign);delta.push([q.x-p.x,q.y-p.y]);}
      return delta;
    }))}))};
    puppet.param.push(param);chains.push({name:param.name,axes:kind==='Arm'?['Shoulder','Elbow']:['Hip','Knee'],parts:owned.map(n=>n.name),chain,range:[param.min,param.max],distalSign:sign});
  }
  puppet.meta.combined={version:1,chains,scope:'Visible separate limbs only; source bust includes measured native mouth. Our coupled body keyforms; no physics.'};
  const hairAttachments=marks.chin?anchorLongHair(puppet,marks.chin.y,height):[];
  puppet.meta.headAttachments=hairAttachments;
  puppet.meta.pitch=(motion?.headAxes?.pitch??motion?.face.head)?.mode==='fixed'?{status:'skipped',reason:'Head remains at its neutral pose'}:coherentPitch(puppet,marks);
  const garmentBindings=clothingAttachments(puppet,textures,marks);
  puppet.nodes.children!.sort((a,b)=>a.zsort-b.zsort);
  if(motion)finalizeMotionCapabilities(puppet,motion,textures,marks);
  const bodyMeshGate=combinedMeshGate(puppet);
  const faceCompression=compactFace?compactFaceKeys(puppet):undefined;
  return {file:writeInp(puppet,textures),report:{motionCapabilities:motion,bodyMeshGate,faceCompression,hairAttachments,garmentBindings,runtimeTopology:Object.fromEntries(inpParts(puppet).filter(p=>body.test(p.name)||/^(topwear|bottomwear)__/.test(p.name)).map(p=>[p.name,p.mesh!.indices])),chains,legOwnershipRepair,footwearRepair,expressionRepairs,faceChannels:carried.channels,sourceMouth:true,sourceDrawOrder:true,bodyTopology:'Whole arm meshes retained; leg/shoe pixels re-owned by connected components and re-meshed continuously, no separate upper/lower limb cuts',whatThisDoesNotMeasure:'Human acceptance, unsupported clothes, source artwork correctness, untested simultaneous face expression interactions.'}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [id]=process.argv.slice(2);
  if(!id)throw new Error('Usage: buildCombined config.json');
  const config=JSON.parse(readFileSync(id,'utf8')) as {sourcePoses:string;landmarks:string;reference:string;out:string;visibleSeparateLimbs:boolean;longGarment:boolean;compactFace?:boolean;headAttachmentSafety?:boolean;capabilities?:MotionCapabilities};
  if(!config.sourcePoses||!config.landmarks||!config.reference||!config.out)throw new Error('Config requires sourcePoses, landmarks, reference, out (paths relative to working directory)');
  if(!config.capabilities&&(config.visibleSeparateLimbs!==true||config.longGarment!==false))throw new Error('Explicit visible-limb/short-clothing support declaration required');
  const posesArg=config.sourcePoses;
  const bytes=readFileSync(posesArg),dump=JSON.parse(bytes.toString()) as PoseDump;
  const atlases=new Map([...new Set(dump.drawables.map(d=>d.textureFile!))].map(f=>{if(basename(f)!==f)throw new Error('Unsafe atlas path');return [f,readFileSync(resolve(dirname(posesArg),f))];}));
  const original=JSON.parse(readFileSync(config.landmarks,'utf8'));
  const scale=Math.max(dump.canvas.width,dump.canvas.height)/Math.max(original.source.width,original.source.height);
  const ox=(dump.canvas.width-original.source.width*scale)/2,oy=(dump.canvas.height-original.source.height*scale)/2;
  const points=Object.fromEntries(Object.entries(original.points as Record<string,LimbPoint|null>).filter(([,p])=>p).map(([k,p])=>[k,{x:p!.x*scale+ox,y:p!.y*scale+oy}]));
  const result=buildCombined(dump,atlases,points,true,decodePNG(new Uint8Array(readFileSync(config.reference))),"compactFace" in config && config.compactFace===true,"headAttachmentSafety" in config && config.headAttachmentSafety===true,config.capabilities);const home=resolve(config.out);mkdirSync(home,{recursive:true});
  writeFileSync(resolve(home,'character.inp'),result.file);
  writeFileSync(resolve(home,'build.json'),JSON.stringify({...result.report,source:posesArg,sourceSha256:sha(bytes),outputSha256:sha(result.file),landmarks:config.landmarks,reference:config.reference,support:{visibleSeparateLimbs:config.visibleSeparateLimbs,longGarment:config.longGarment},landmarkMode:'Supplied anatomical landmarks mapped by long-edge fit; assisted semantics, not unsupervised inference'},null,2)+'\n');
}
