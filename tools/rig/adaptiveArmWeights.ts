/** Per-arm choice between the original axis and two-link bisector fields.
 * Selection uses source geometry and the requested authoring range. The ordinary garment and
 * mesh gates remain in force for both alternatives. */
import {inpParts,type InpDocument} from './inp';
import {sourceGripProbes,sourceGripSlip} from './sourceGripConstraint';
import {continuousLimbWeights,poseContinuousLimb,type ContinuousLimb,type LimbPoint} from '../../engine/src/body/continuousLimb';
import {poseHeldProp} from './heldPropAttachments';
import {finalizeMotionCapabilities} from './motionCapabilities';
import {drawsNoTexture} from './combinedMeshGate';
import {evaluateCombined} from '../../player/src/combinedRuntime';
import type {MotionCapabilities,ChainName} from '../imageToRig/capabilities';
export function adaptiveArmWeights(puppet:InpDocument,textures:Buffer[],caps:MotionCapabilities,options:{exactRestrictedGrid?:boolean;armMatteCoverage?:boolean;adaptiveHingeWidth?:boolean}={}){
 const nodes=inpParts(puppet),{width,height}=puppet.meta.canvas as {width:number;height:number};
 const combined=puppet.meta.combined as {chains:{name:string;chain:ContinuousLimb;range:number[][];sampling?:unknown}[]},report=[];
 const rotate=(p:LimbPoint,c:LimbPoint,a:number)=>{const t=a*Math.PI/180,x=p.x-c.x,y=p.y-c.y;return {x:c.x+x*Math.cos(t)-y*Math.sin(t),y:c.y+x*Math.sin(t)+y*Math.cos(t)};};
 for(const record of combined.chains.filter(r=>r.name.startsWith('Arm '))){
  const original=puppet.param.find(p=>p.name===record.name);if(!original||record.chain.weightField||record.chain.blendMode!=='angle')continue;
  const tip=continuousLimbWeights(record.chain.tip,record.chain);if(tip.root>.999&&tip.distal>.999)continue;
  const contact=options.adaptiveHingeWidth?sourceGripProbes(puppet,textures,record.name,record.chain):{hasCarrier:false,probes:[]};
  const trial=(bandFraction:number|null)=>{
   const bisector=bandFraction!==null;
   const chain={...record.chain,weightMode:bisector?'bisector' as const:record.chain.weightMode,...(bisector&&bandFraction!==.45?{bisectorBandFraction:bandFraction!}:{})},param=structuredClone(original);
   if(bisector)for(const bind of param.bindings){if(bind.param_name!=='deform')throw Error('Arm selection requires deformation-only bindings');const node=nodes.find(n=>n.uuid===bind.node)!;
    bind.values=param.axis_points[0].map(t=>param.axis_points[1].map(u=>{const x=param.min[0]+t*(param.max[0]-param.min[0]),y=param.min[1]+u*(param.max[1]-param.min[1]);return node.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>{const p={x:node.mesh!.verts[i*2]+width/2,y:node.mesh!.verts[i*2+1]+height/2},q=/^(objects|prop)(?:#|__|$)/.test(node.name)?poseHeldProp(p,chain,x,y):poseContinuousLimb(p,chain,x,y);return [q.x-p.x,q.y-p.y];});}));
   }
   const trialCaps=structuredClone(caps);delete trialCaps.headAxes;for(const c of Object.values(trialCaps.face))c.mode='fixed';
   const doc:InpDocument={...puppet,param:[param],meta:{...puppet.meta,combined:{...combined,chains:combined.chains.map(r=>r===record?{...r,chain}:r)}}};
   finalizeMotionCapabilities(doc,trialCaps,textures,undefined,{adaptiveRanges:true,exactRestrictedGrid:options.exactRestrictedGrid,armMatteCoverage:options.armMatteCoverage});const kept=doc.param.find(p=>p.name===record.name);
   if(!kept)return {chain,param:null,caps:trialCaps.chains[record.name as ChainName],error:Infinity,area:Infinity,contactMean:Infinity,contactMax:Infinity};
   let error=0,area=0,denom=0,count=0,contactSum=0,contactCount=0,contactMax=0;
   const cross=(a:number[],i:number,j:number,k:number)=>(a[2*j]-a[2*i])*(a[2*k+1]-a[2*i+1])-(a[2*j+1]-a[2*i+1])*(a[2*k]-a[2*i]);
   for(const tx of [0,.25,.5,.75,1])for(const ty of [0,.25,.5,.75,1]){
    const x=original.min[0]+tx*(original.max[0]-original.min[0]),y=original.min[1]+ty*(original.max[1]-original.min[1]);
    const expected=rotate(rotate(chain.tip,chain.joint,y),chain.root,x),actual=poseContinuousLimb(chain.tip,chain,Math.max(kept.min[0],Math.min(kept.max[0],x)),Math.max(kept.min[1],Math.min(kept.max[1],y)));error+=Math.hypot(actual.x-expected.x,actual.y-expected.y);count++;
    const posed=new Map(evaluateCombined({puppet:doc,parts:nodes,width,height,textures:[]},{[record.name]:[x,y]}).map(p=>[p.uuid,p.xy]));
    const slip=sourceGripSlip(contact.probes,posed);contactSum+=slip.sum;contactCount+=slip.count;contactMax=Math.max(contactMax,slip.max);
    for(const bind of kept.bindings){const n=nodes.find(n=>n.uuid===bind.node)!,m=n.mesh!,xy=posed.get(n.uuid)!;for(let i=0;i<m.indices.length;i+=3){const [a,c,d]=m.indices.slice(i,i+3),rest=cross(m.verts,a,c,d);if(Math.abs(rest)<=.1||drawsNoTexture(m.uvs,a,c,d))continue;const moved=cross(xy,a,c,d);area+=Math.abs(rest)*Math.abs(Math.log(Math.max(1e-12,Math.abs(moved/rest))));denom+=Math.abs(rest);}}
   }
   return {chain,param:kept,caps:trialCaps.chains[record.name as ChainName],error:error/count,area:area/Math.max(1,denom),contactMean:contactSum/Math.max(1,contactCount),contactMax};
  };
  const axis=trial(null),fractions=options.adaptiveHingeWidth&&!record.chain.attachmentPins?[.45,.6,.75,.9,1.05,1.3]:[.45];
  const alternatives=fractions.map(fraction=>({fraction,...trial(fraction)})),standard=alternatives[0];
  const qualifies=(t:typeof axis)=>!!t.param&&t.error+1<axis.error&&(t.area<=axis.area||!!record.chain.attachmentPins);
  const legacy=qualifies(standard)?standard:axis;
  const preservesContact=(t:typeof standard)=>t.fraction===.45||!contact.hasCarrier||(contact.probes.length>0&&t.contactMean<=legacy.contactMean+.001&&t.contactMax<=legacy.contactMax+.001);
  const viable=alternatives.filter(t=>qualifies(t)&&preservesContact(t)).sort((a,b)=>a.error-b.error||a.area-b.area);
  const chosen=viable.length>0,bisector=viable[0]??standard;
  report.push({name:record.name,axis:{endpointPx:axis.error,area:axis.area,range:axis.param?[axis.param.min,axis.param.max]:null},bisector:{endpointPx:bisector.error,area:bisector.area,range:bisector.param?[bisector.param.min,bisector.param.max]:null},selected:chosen?'bisector':'unchanged',...(options.adaptiveHingeWidth?{selectedBandFraction:chosen?bisector.fraction:null,sourceGrip:{hasCarrier:contact.hasCarrier,probes:contact.probes.length,baselineMean:legacy.contactMean,baselineMax:legacy.contactMax},alternatives:alternatives.map(a=>({fraction:a.fraction,endpointPx:a.error,area:a.area,contactMean:a.contactMean,contactMax:a.contactMax,contactPreserved:preservesContact(a),range:a.param?[a.param.min,a.param.max]:null}))}:{}),selectionObjective:record.chain.attachmentPins?'Tip tracking after unchanged fold/attachment gates; source area tradeoff explicitly reported.':'Tip tracking with no source-area increase',scope:'25 source authoring-range samples; analytical tip error and rest-area-weighted deformation, after unchanged garment/mesh gates. Expanded hinge candidates must preserve mean/max baked source hand-carrier contact against legacy selection.'});
  if(chosen){puppet.param[puppet.param.indexOf(original)]=bisector.param!;record.chain=bisector.chain;record.range=[bisector.param!.min,bisector.param!.max];record.sampling={status:'reused dense grid after field selection; full key/half-grid gate passed',prior:record.sampling};caps.chains[record.name as ChainName]=bisector.caps;}
 }
 return report;
}
