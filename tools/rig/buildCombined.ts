import {preparePropInstanceGroups} from './propInstanceGroups';
import {refineMotion} from './refineMotion';
import {applyExactRestrictedGrids} from './exactRestrictedGrid';
import {bakePairedGripDrive} from './pairedGripDrive';
import {optimizeRootRadial} from './optimizeRootRadial';
/** Only the combined path: measured source bust + our continuous articulated body. */
import {bakePairedGripLift} from './pairedGripLift';
import {refineGripBoundary} from './refineGripBoundary';
import {optimizeLimbWidths} from './optimizeLimbWidths';
import {adaptiveArmWeights} from './adaptiveArmWeights';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {carryPoses,type PoseDump} from './carryPsd2Live';
import {readInp,writeInp,inpParts,inpTextures,type InpNode,type InpDocument,type InpParameter} from './inp';
import {continuousLimbWeights,poseContinuousLimb,type ContinuousLimb,type LimbPoint} from '../../engine/src/body/continuousLimb';
import {partitionLimbBindings} from './partitionLimbBindings';
import {buildLimbWeightField} from '../../engine/src/body/limbWeightField';
import {preparedTrouserLegs} from './preparedTrouserLegs';
import {type PropContactHint} from './propContactHints';
import {prepareHeldProps,bindHeldProp} from './heldPropAttachments';
import {sampleLimbAxes} from '../../engine/src/body/limbSampling';
import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import {decodePNG} from '../generate/png';
import {combinedMeshGate} from './combinedMeshGate';
import {repairFootOwnership} from './combinedFootwear';
import {constrainClosedEyes,restoreNeutralMouth,restoreMissingEyeDetails} from './combinedExpressions';
import {encodePNG} from '../shared/encodePNG';
import {compactFaceKeys} from './compactFace';
import {retimeMouth,closedMouthForm} from './mouthMotion';
import {anchorLongHair} from './garmentHair';
import {clothingAttachmentsWithRecovery} from './clothingAttachmentsWithRecovery';
import {coherentPitch} from './coherentPitch';
import {semanticLayer} from './carryPsd2Live';
import {mergeGarmentComponents} from './mergeGarmentComponents';
import {faceLayers,layerCapabilities,finalizeMotionCapabilities,preparedMotionCandidates} from './motionCapabilities';
import type {MotionCapabilities,ChainName} from '../imageToRig/capabilities';

const body=/^(topwear|bottomwear|arm-[lr]|hand-[lr]|handwear-[lr]|legwear-[lr]|footwear-[lr])$/;
export interface BodyMotionOptions { refinePairedGripRange?:boolean; exactRestrictedGrid?:boolean; pairedGripDrive?:boolean; optimizeShoulderTransition?:boolean; adaptiveHingeWidth?:boolean; optimizeLimbWidths?:boolean; recoverSleeveMaterial?:boolean; rigidFoldedRoot?:boolean; carrySharedProps?:boolean; detachedSleeves?:boolean;adaptiveArmWeights?:boolean;sustainedSleeveSupport?:boolean;armMatteCoverage?:boolean;foldedLegWeights?:boolean;geometricPropFallback?:boolean;blendMode?:'position'|'angle';weightMode?:'axis'|'segments'|'geodesic';samplingTolerancePixels?:number;maxArmKeys?:number;maxLegKeys?:number;jointBlendFraction?:number;rootBlendFraction?:number;carrySingleHandProps?:boolean;partitionLimbBindings?:boolean;adaptiveRanges?:boolean;reassessPreparedLimbs?:boolean;semanticPropGuard?:boolean;garmentOnlyLegs?:boolean;sourceContactHints?:Record<string,PropContactHint>}
export const DEFAULT_BODY_MOTION: Readonly<BodyMotionOptions> = Object.freeze({
  "blendMode": "angle",
  "samplingTolerancePixels": 0.15,
  "carrySingleHandProps": true,
  "adaptiveRanges": true,
  "partitionLimbBindings": true,
  "reassessPreparedLimbs": true,
  "semanticPropGuard": true,
  "garmentOnlyLegs": true,
  "detachedSleeves": true,
  "foldedLegWeights": true,
  "geometricPropFallback": true,
  "sustainedSleeveSupport": true,
  "adaptiveArmWeights": true,
  "armMatteCoverage": true,
  "carrySharedProps": true,
  "rigidFoldedRoot": true,
  "recoverSleeveMaterial": true,
  "optimizeLimbWidths": true,
  "adaptiveHingeWidth": true,
  "optimizeShoulderTransition": true,
  "pairedGripDrive": true,
  "exactRestrictedGrid": true,
  "refinePairedGripRange": true,
  "maxLegKeys": 25
});
export function buildCombined(dump:PoseDump,atlases:Map<string,Buffer>,marks:Record<string,LimbPoint>,reference?:ReturnType<typeof decodePNG>,compactFace=false,headAttachmentSafety=false,capabilities?:MotionCapabilities,motionOptions:BodyMotionOptions={}) {
  motionOptions={...DEFAULT_BODY_MOTION,...Object.fromEntries(Object.entries(motionOptions).filter(([,v])=>v!==undefined))};
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
  const {puppet,textures}=readInp(carried.file);let nodes=inpParts(puppet);const chains=[];
  const expressionRepairs=constrainClosedEyes(puppet,textures,Boolean(capabilities));
  if(reference){if(!capabilities||nodes.some(n=>n.name==='mouth_close'))expressionRepairs.push(restoreNeutralMouth(puppet,textures,reference));if(!capabilities||['eyeL','eyeR','eyeLOuter','eyeROuter'].every(n=>marks[n]))expressionRepairs.push(...restoreMissingEyeDetails(puppet,textures,reference,marks));}
  const mouthMotion={timing:retimeMouth(puppet),form:closedMouthForm(puppet)};
  const propInstances=motionOptions.carrySingleHandProps?preparePropInstanceGroups(puppet,textures,marks,motionOptions.sourceContactHints):undefined;
  nodes=inpParts(puppet);
  const legsReady=!capabilities||['Leg L','Leg R'].every(n=>capabilities.chains[n as ChainName].mode!=='fixed');
  const legOwnershipRepair=legsReady?repairFootOwnership(puppet,textures,marks,'legwear'):{status:'skipped',reason:'Leg attachments are not independently usable'};
  const footwearRepair=legsReady?repairFootOwnership(puppet,textures,marks):{status:'skipped',reason:'Leg attachments are not independently usable'};
  const garmentLegs=motionOptions.garmentOnlyLegs?preparedTrouserLegs(puppet,textures,marks):undefined;
  const sourceCandidates=capabilities&&motionOptions.reassessPreparedLimbs?preparedMotionCandidates(capabilities,marks,width,height):capabilities;
  const heldProps=motionOptions.carrySingleHandProps?prepareHeldProps(puppet,textures,marks,sourceCandidates,motionOptions.semanticPropGuard?motionOptions.sourceContactHints:undefined,{geometricFallback:motionOptions.geometricPropFallback,carrySharedProps:motionOptions.carrySharedProps,instanceOwners:propInstances?.owners}):undefined;
  const motion=sourceCandidates?layerCapabilities(puppet,textures,marks,sourceCandidates,heldProps?.carriedArms,{garmentLegs:garmentLegs?.names}):undefined;
  const decoded=inpTextures(textures);
  const coverage=(parts:InpNode[])=>renderTextured(parts.map(n=>({xy:new Float64Array(n.mesh!.verts.map((v,k)=>v+(k%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[n.textures![0]],sampling:'bilinear'} as TexturedMesh)),width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
  let uuid=Math.max(...puppet.param.map(p=>p.uuid))+1;
  for(const kind of ['Arm','Leg'])for(const side of ['L','R']) {
    const capability=motion?.chains[`${kind} ${side}` as ChainName];
    if(capability?.mode==='fixed')continue;
    const root=marks[(kind==='Arm'?'shoulder':'hip')+side],joint=marks[(kind==='Arm'?'elbow':'knee')+side],tip=marks[(kind==='Arm'?'wrist':'ankle')+side];
    if(!root||!joint||!tip)throw new Error(`Missing ${kind} ${side} landmarks`);
    const names=kind==='Arm'?[`arm-${side.toLowerCase()}`,`hand-${side.toLowerCase()}`,`handwear-${side.toLowerCase()}`]:[`legwear-${side.toLowerCase()}`,`footwear-${side.toLowerCase()}`];
    const owned=nodes.filter(n=>names.includes(n.name));
    if(!owned.some(n=>kind==='Arm'?/^(arm|handwear)-/.test(n.name):n.name.startsWith('legwear-'))&&!garmentLegs?.names.has(`${kind} ${side}`))throw new Error(`No source layer for ${kind} ${side}`);
    const upper=Math.hypot(joint.x-root.x,joint.y-root.y);
    const chain:ContinuousLimb={root,joint,tip,rootBlend:upper*(motionOptions.rootBlendFraction??.6),jointBlend:upper*(motionOptions.jointBlendFraction??.45),blendMode:motionOptions.blendMode,weightMode:motionOptions.weightMode};
    if(kind==='Arm'&&motionOptions.rigidFoldedRoot){
      const u={x:joint.x-root.x,y:joint.y-root.y},v={x:tip.x-joint.x,y:tip.y-joint.y},cosine=(u.x*v.x+u.y*v.y)/Math.hypot(u.x,u.y)/Math.hypot(v.x,v.y);
      if(continuousLimbWeights(tip,chain).root<.05&&cosine<-.9)chain.rootMode='rigid';
    }
    if(kind==='Arm'&&heldProps?.pairedProps.length)chain.weightMode='bisector';
    // A deeply folded knee places the ankle behind the hip-to-knee axis.
    // Only these legs opt into the two-link bisector; arm behavior is unchanged.
    if(kind==='Leg'&&motionOptions.foldedLegWeights){
      const ux=joint.x-root.x,uy=joint.y-root.y,vx=tip.x-joint.x,vy=tip.y-joint.y;
      if(ux*vx+uy*vy<0)chain.weightMode='bisector';
    }
    if(motionOptions.weightMode==='geodesic'){
      try{chain.weightField=buildLimbWeightField(coverage(owned),width,height,chain);}catch(error){throw new Error(`${kind} ${side}: ${String(error)}`);}
    }
    // Keep the source's hidden shoulder cap behind the garment. A source-visible
    // overlay shares exactly the same deformation, so no independent elbow seam.
    if(kind==='Arm') {
      // The source-visible arm is drawn in front of every torso, lower-body and
      // prop layer, so an arm swinging inward passes over trousers, tunic, tail
      // or scarf instead of behind them. Rest coverage of every layer it jumps
      // over clips the overlay, so the rest pose and every source occlusion
      // (a sash over the sleeve, a prop over the palm) are unchanged.
      const own=Math.min(...owned.map(n=>n.zsort));
      const bodyLayers=nodes.filter(n=>!faceLayers.test(semanticLayer(n.name))&&!/^(arm|hand|handwear)-/.test(n.name)&&!n.name.includes('__front'));
      const front=Math.max(nodes.find(n=>n.name==='topwear')?.zsort??11,...bodyLayers.map(n=>n.zsort))+.25;
      const jumped=nodes.filter(n=>n.zsort>own&&n.zsort<front&&!owned.includes(n)&&n.mesh?.indices.length);
      const shirtMask=coverage(jumped.length?jumped:[nodes.find(n=>n.name==='topwear')!]);
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
    if(kind==='Arm'&&heldProps?.pairedProps.length)for(const node of owned)node.mesh=refineGripBoundary(node.mesh!,chain,width,height).mesh;
    const rangeScale=capability?.mode==='limited'?.5:1;
    let xs=(kind==='Arm'?[-30,-20,-10,0,10,20,30]:[-25,-18.75,-12.5,-6.25,0,6.25,12.5,18.75,25]).map(x=>x*rangeScale);
    let ys=(kind==='Arm'?[-60,-40,-20,0,20,40,60]:[0,10,20,30,40,50,60]).map(y=>y*rangeScale);
    const sampling=motionOptions.samplingTolerancePixels?sampleLimbAxes(chain,owned.flatMap(n=>n.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>({x:n.mesh!.verts[2*i]+width/2,y:n.mesh!.verts[2*i+1]+height/2}))),xs,ys,motionOptions.samplingTolerancePixels,kind==='Arm'?(motionOptions.maxArmKeys??33):(motionOptions.maxLegKeys!),kind==='Leg'):undefined;
    if(sampling){xs=sampling.xs;ys=sampling.ys;}
    const sign=kind==='Leg'&&side==='R'?-1:1;
    const param:InpParameter={uuid:uuid++,name:`${kind} ${side}`,is_vec2:true,min:[xs[0],ys[0]],max:[xs.at(-1)!,ys.at(-1)!],defaults:[0,0],axis_points:[xs.map(x=>(x-xs[0])/(xs.at(-1)!-xs[0])),ys.map(y=>(y-ys[0])/(ys.at(-1)!-ys[0]))],merge_mode:'Passthrough',bindings:owned.map(node=>({node:node.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:xs.map(()=>ys.map(()=>true)),values:xs.map(x=>ys.map(y=>{
      const v=node.mesh!.verts,delta=[];
      for(let i=0;i<v.length;i+=2){const p={x:v[i]+width/2,y:v[i+1]+height/2};const q=poseContinuousLimb(p,chain,x,y*sign);delta.push([q.x-p.x,q.y-p.y]);}
      return delta;
    }))}))};
    for(const carrier of heldProps?.carriers.filter(c=>c.owner===param.name)??[])bindHeldProp(carrier.node,param,chain,width,height);
    puppet.param.push(param);chains.push({name:param.name,axes:kind==='Arm'?['Shoulder','Elbow']:['Hip','Knee'],parts:owned.map(n=>n.name),chain,range:[param.min,param.max],distalSign:sign,sampling});
  }
  puppet.meta.combined={version:1,chains,scope:'Visible separate limbs only; source bust includes measured native mouth. Our coupled body keyforms; no physics.'};
  const hairAttachments=marks.chin?anchorLongHair(puppet,marks.chin.y,height):[];
  puppet.meta.headAttachments=hairAttachments;
  puppet.meta.pitch=(motion?.headAxes?.pitch??motion?.face.head)?.mode==='fixed'?{status:'skipped',reason:'Head remains at its neutral pose'}:coherentPitch(puppet,marks);
  const garmentBindings=clothingAttachmentsWithRecovery(puppet,textures,marks,{recoverSleeveMaterial:motionOptions.recoverSleeveMaterial,detachedSleeves:motionOptions.detachedSleeves,sustainedSleeveSupport:motionOptions.sustainedSleeveSupport});
  puppet.nodes.children!.sort((a,b)=>a.zsort-b.zsort);
  const pairedDriveSource=motionOptions.pairedGripDrive&&heldProps?.pairedProps.length?puppet.param.filter(p=>/^Arm [LR]$/.test(p.name)).map(p=>structuredClone(p)):[];
  const pairedGrip=heldProps?.pairedProps.length?bakePairedGripLift(puppet,textures,heldProps.pairedProps):undefined;
  const armWeightSelection=motion&&motionOptions.adaptiveArmWeights?adaptiveArmWeights(puppet,textures,motion,{exactRestrictedGrid:motionOptions.exactRestrictedGrid,armMatteCoverage:motionOptions.armMatteCoverage,adaptiveHingeWidth:motionOptions.adaptiveHingeWidth}):undefined;
  if(motion)finalizeMotionCapabilities(puppet,motion,textures,marks,{exactRestrictedGrid:motionOptions.exactRestrictedGrid,adaptiveRanges:motionOptions.adaptiveRanges,armMatteCoverage:motionOptions.armMatteCoverage});
  const widthOptimization=motionOptions.optimizeLimbWidths?optimizeLimbWidths(puppet,textures,{armMatteCoverage:motionOptions.armMatteCoverage}):undefined;
  const shoulderOptimization=motionOptions.optimizeShoulderTransition?optimizeRootRadial(puppet,textures,{armMatteCoverage:motionOptions.armMatteCoverage}):undefined;
  if(motion)for(const record of chains){
    if(record.chain.rootMode!=='rigid'||continuousLimbWeights(record.chain.tip,record.chain).distal>=.05)continue;
    const capability=motion.chains[record.name as ChainName];
    if(capability.mode!=='fixed'){capability.mode='limited';capability.reasons.push('Folded artwork limits elbow control; shoulder motion remains available.');}
  }
  const pairedDrive=motionOptions.pairedGripDrive&&heldProps?.pairedProps.length?bakePairedGripDrive(puppet,textures,heldProps.pairedProps,pairedDriveSource,motion,{refineRange:motionOptions.refinePairedGripRange}):undefined;
  const exactRestrictedGrids=motionOptions.exactRestrictedGrid?applyExactRestrictedGrids(puppet,textures,{armMatteCoverage:motionOptions.armMatteCoverage}):undefined;
  const limbPartition=motionOptions.partitionLimbBindings?partitionLimbBindings(puppet):undefined;
  const refinement=refineMotion(puppet,textures);
  const bodyMeshGate=combinedMeshGate(puppet);
  const faceCompression=compactFace?compactFaceKeys(puppet):undefined;
  return {file:writeInp(puppet,textures),report:{propInstances:propInstances?.report,refinement,exactRestrictedGrids,pairedDrive,motionOptions,widthOptimization,shoulderOptimization,pairedGrip,armWeightSelection,garmentLegs:garmentLegs?.report,limbPartition,heldProps:heldProps?.report,motionCapabilities:motion,bodyMeshGate,faceCompression,hairAttachments,garmentBindings,runtimeTopology:Object.fromEntries(inpParts(puppet).filter(p=>body.test(p.name)||/^(topwear|bottomwear)__/.test(p.name)).map(p=>[p.name,p.mesh!.indices])),chains,legOwnershipRepair,footwearRepair,expressionRepairs,mouthMotion,faceChannels:carried.channels,sourceMouth:true,sourceDrawOrder:true,bodyTopology:'Whole arm meshes retained; leg/shoe pixels re-owned by connected components and re-meshed continuously, no separate upper/lower limb cuts',whatThisDoesNotMeasure:'Human acceptance, unsupported clothes, source artwork correctness, untested simultaneous face expression interactions.'}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [file]=process.argv.slice(2);
  if(!file)throw new Error('Usage: buildCombined config.json');
  // Finish this module before loading the wrapper, which imports buildCombined.
  import('./adaptiveLayerMotion').then(({buildAdaptiveConfig})=>{
    buildAdaptiveConfig(JSON.parse(readFileSync(file,'utf8')));
  }).catch(error=>{console.error(error);process.exitCode=1;});
}
