import {inpParts,type InpDocument,type InpParameter} from './inp';
import {poseContinuousLimb,type ContinuousLimb,type LimbPoint} from '../../engine/src/body/continuousLimb';
import {poseHeldProp} from './heldPropAttachments';
/** Keep the source-material cut attached to stationary torso pixels. The same
 * continuous pin field is applied to skin and garment; no hidden pixels added.
 * Subsequent full mesh, attachment and visual gates are required. */
export function pinRecoveredSeams(puppet:InpDocument,labels:Uint8Array,rgba:Uint8ClampedArray,width:number,height:number,owners:{label:number;param:InpParameter;record:{chain:ContinuousLimb;distalSign:number}}[]) {
 const nodes=inpParts(puppet),report=[];
 for(const owner of owners){
  const cells=new Map<string,LimbPoint>(),step=4;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
   const i=y*width+x;if(labels[i]!==owner.label||rgba[4*i+3]<128)continue;
   if(![i-1,i+1,i-width,i+width].some(j=>labels[j]===0&&rgba[4*j+3]>128))continue;
   cells.set(Math.floor(x/2)+'/'+Math.floor(y/2),{x,y});
  }
  if(!cells.size)continue;
  const points=[...cells.values()],prior=owner.record.chain,upper=Math.hypot(prior.root.x-prior.joint.x,prior.root.y-prior.joint.y);
  const tipDistance=Math.min(...points.map(p=>Math.hypot(p.x-prior.tip.x,p.y-prior.tip.y)));
  const pins={points,fixedRadius:step*1.5,blendRadius:Math.max(step*3,Math.min(.3*upper,.8*tipDistance))};
  const chain={...prior,attachmentPins:pins};owner.record.chain=chain;
  const param=owner.param;
  for(const bind of param.bindings){
   if(bind.param_name!=='deform')throw Error('Seam pin field needs deform bindings');
   const node=nodes.find(n=>n.uuid===bind.node)!;
   bind.values=param.axis_points[0].map(t=>param.axis_points[1].map(u=>{
    const x=param.min[0]+t*(param.max[0]-param.min[0]),y=(param.min[1]+u*(param.max[1]-param.min[1]))*owner.record.distalSign;
    return node.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>{
     const p={x:node.mesh!.verts[2*i]+width/2,y:node.mesh!.verts[2*i+1]+height/2},q=/^(objects|prop)(?:#|__|$)/.test(node.name)?poseHeldProp(p,chain,x,y):poseContinuousLimb(p,chain,x,y);
     return [q.x-p.x,q.y-p.y];
    });
   }));
  }
  report.push({owner:param.name,pins:pins.points.length,fixedRadius:pins.fixedRadius,blendRadius:pins.blendRadius,source:'Opaque sleeve/torso cut boundary; source geometry only.'});
 }
 return report;
}
