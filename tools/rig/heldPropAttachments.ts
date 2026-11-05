/** Conservative single-hand rigid carriers. Original mesh, textures, UVs and
 * draw order are retained. Ambiguous/shared or multi-object layers stay gated. */
import {isolatedPropContact} from './isolatedPropContact';
import {sharedPropGroup} from './sharedPropGroup';
import {inpParts,inpTextures,type InpDocument,type InpNode,type InpParameter} from './inp';
import {heldPropComponents} from './motionCapabilities';
import {semanticLayer} from './carryPsd2Live';
import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import {poseContinuousLimb,continuousLimbWeights,type ContinuousLimb,type LimbPoint} from '../../engine/src/body/continuousLimb';
import type {PropContactHint} from './propContactHints';
import type {MotionCapabilities} from '../imageToRig/capabilities';
export function prepareHeldProps(puppet:InpDocument,textures:Buffer[],marks:Record<string,LimbPoint>,source?:MotionCapabilities,hints?:Record<string,PropContactHint>,options:{geometricFallback?:boolean;carrySharedProps?:boolean;instanceOwners?:Record<number,string>}={}) {
 const nodes=inpParts(puppet),decoded=inpTextures(textures),{width,height}=puppet.meta.canvas as {width:number;height:number};
 const render=(parts:InpNode[])=>renderTextured(parts.map(n=>({xy:new Float64Array(n.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[n.textures![0]],sampling:'bilinear'} as TexturedMesh)),width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
 const props=nodes.filter(n=>/^(objects|prop)$/.test(semanticLayer(n.name))&&n.mesh?.indices.length);
 const carriers:{node:InpNode;owner:string;contact:number;area:number}[]=[],report:Record<string,unknown>[]=[],blocked=new Set<string>();
 const arms=['L','R'].filter(s=>marks['elbow'+s]&&marks['wrist'+s]).map(side=>({side,rgba:render(nodes.filter(n=>[`arm-${side.toLowerCase()}`,`hand-${side.toLowerCase()}`,`handwear-${side.toLowerCase()}`].includes(n.name)))}));
 for(const prop of props){
  const rgba=render([prop]);const contacts=arms.map(a=>({...a,result:heldPropComponents(a.rgba,rgba,width,height,marks['elbow'+a.side],marks['wrist'+a.side])}));
  const held=contacts.filter(a=>a.result.matches.length);if(!held.length)continue;
  const significant=contacts[0].result.pieces.map((p,i)=>({area:p.area,id:i+1})).filter(p=>p.area>8);
  const preparedOwner=options.instanceOwners?.[prop.uuid];
  const candidate=preparedOwner?contacts.find(a=>'Arm '+a.side===preparedOwner):held.length===1?held[0]:undefined;
  const whole=!!candidate&&(!!preparedOwner||significant.every(p=>candidate.result.matches.some(m=>m.component===p.id)));
  const owner=candidate?'Arm '+candidate.side:undefined;
  const hint=owner?hints?.[owner]:undefined;
  let isolated:ReturnType<typeof isolatedPropContact>|undefined;
  if(options.geometricFallback&&whole&&owner&&hint?.mode==='unknown'){
   const side=candidate!.side,root=marks['shoulder'+side],joint=marks['elbow'+side],tip=marks['wrist'+side];
   if(root&&joint&&tip){
   const length=Math.hypot(joint.x-root.x,joint.y-root.y)+Math.hypot(tip.x-joint.x,tip.y-joint.y);
   const own=new Set(['arm-'+side.toLowerCase(),'hand-'+side.toLowerCase(),'handwear-'+side.toLowerCase()]);
   const other=nodes.filter(n=>!props.includes(n)&&!own.has(n.name.split('__')[0])&&n.enabled!==false&&(n.opacity??1)>.05);
   isolated=isolatedPropContact(rgba,render(other),.6*length*length);
   }
  }
  if(whole&&owner&&(!hints||hint?.mode==='held'||isolated?.passed)&&source?.chains[owner as 'Arm L'|'Arm R'].mode!=='fixed'){
   carriers.push({node:prop,owner,contact:candidate!.result.matches.reduce((n,m)=>n+m.contact,0),area:significant.reduce((n,p)=>n+p.area,0)});
   report.push({node:prop.name,nodeId:prop.uuid,owner,status:'single-hand-carrier',preservesOriginalGeometry:true,contactEvidence:isolated?.passed?'isolated geometric fallback':'existing semantic evidence',isolatedContact:isolated});
  }else{
   for(const a of held)blocked.add('Arm '+a.side);
   report.push({node:prop.name,nodeId:prop.uuid,status:'kept-static',hands:held.map(a=>a.side),wholeLayerSupported:whole,semanticHint:hint?.mode,isolatedContact:isolated,reason:held.length>1?'Shared contact requires a two-hand constraint':'Layer includes unheld pieces or the source chain is unavailable'});
  }
 }
 let pairedProps:InpNode[]=[];
 // Detect shared connected objects across native split mesh boundaries too.
 if(props.length&&arms.length>1){
  const all=render(props),global=arms.map(a=>({side:a.side,matches:heldPropComponents(a.rgba,all,width,height,marks['elbow'+a.side],marks['wrist'+a.side]).matches}));
  const shared=global[0].matches.filter(m=>global[1].matches.some(n=>n.component===m.component));
  if(shared.length&&options.carrySharedProps&&arms.every(a=>hints?.['Arm '+a.side]?.mode!=='resting')){
   const detail=heldPropComponents(arms[0].rgba,all,width,height,marks['elbow'+arms[0].side],marks['wrist'+arms[0].side]);
   const group=sharedPropGroup(detail.pieces,global.map(g=>g.matches));
   if(group.supported)pairedProps=props;
   report.push({status:group.supported?'paired-group-candidate':'kept-static',sharedComponents:group.shared,unsupportedComponents:group.unsupported,reason:'Every significant component must touch at least one linked hand; a shared component must connect both hands.'});
  }
  if(shared.length){for(const a of arms)blocked.add('Arm '+a.side);report.push({status:'kept-static',reason:'Connected prop has two-hand contact across source meshes',components:shared.map(m=>m.component)});}
 }
 for(const a of arms){
  const remainder=props.filter(p=>!carriers.some(c=>c.node===p&&c.owner==='Arm '+a.side));
  if(remainder.length&&heldPropComponents(a.rgba,render(remainder),width,height,marks['elbow'+a.side],marks['wrist'+a.side]).matches.length)blocked.add('Arm '+a.side);
 }
 // An arm is released only if every prop it touches can follow it.
 const safe=carriers.filter(c=>!blocked.has(c.owner));
 const restingArms=arms.filter(a=>hints?.['Arm '+a.side]?.mode==='resting').map(a=>'Arm '+a.side);
 for(const owner of restingArms)report.push({owner,status:'resting-contact',reason:'Existing source analysis identifies contact with the body or a support, not a grasp; contacted objects stay static.',evidence:hints![owner].evidence});
 return {carriers:safe,pairedProps,carriedArms:new Set([...safe.map(c=>c.owner),...restingArms,...(pairedProps.length?['Arm L','Arm R']:[])]),report};
}
export function poseHeldProp(p:LimbPoint,chain:ContinuousLimb,x:number,y:number) {
 const wrist=poseContinuousLimb(chain.tip,chain,x,y),weights=continuousLimbWeights(chain.tip,chain);
 const radians=(x*weights.root+y*weights.distal)*Math.PI/180,co=Math.cos(radians),si=Math.sin(radians),dx=p.x-chain.tip.x,dy=p.y-chain.tip.y;
 return {x:wrist.x+co*dx-si*dy,y:wrist.y+si*dx+co*dy};
}
export function bindHeldProp(node:InpNode,param:InpParameter,chain:ContinuousLimb,width:number,height:number) {
 const xs=param.axis_points[0].map(t=>param.min[0]+t*(param.max[0]-param.min[0])),ys=param.axis_points[1].map(t=>param.min[1]+t*(param.max[1]-param.min[1]));
 param.bindings.push({node:node.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:xs.map(()=>ys.map(()=>true)),values:xs.map(x=>ys.map(y=>node.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>{const p={x:node.mesh!.verts[2*i]+width/2,y:node.mesh!.verts[2*i+1]+height/2},q=poseHeldProp(p,chain,x,y);return [q.x-p.x,q.y-p.y];})))});
}
