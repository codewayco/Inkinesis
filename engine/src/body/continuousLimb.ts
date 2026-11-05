import {sampleLimbWeightField,type LimbWeightField} from './limbWeightField';
/** Planar, continuous two-joint skinning. Uses known blended rotations, not a new skinning algorithm. */
export interface LimbPoint { x:number; y:number }
export interface ContinuousLimb { root:LimbPoint; joint:LimbPoint; tip:LimbPoint; rootBlend:number; jointBlend:number; rootMode?:'rigid'|'radial'; radialRadius?:number; rootBoundary?:{points:LimbPoint[];fixedRadius:number;blendRadius:number}; bisectorBandFraction?:number; hingeProfile?:'smoothstep'|'linear'; attachmentPins?:{points:LimbPoint[];fixedRadius:number;blendRadius:number}; blendMode?:'position'|'angle'; weightMode?:'axis'|'segments'|'geodesic'|'bisector';weightField?:LimbWeightField }
const smooth=(a:number,b:number,v:number)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
function rotate(p:LimbPoint,c:LimbPoint,degrees:number):LimbPoint {
  const a=degrees*Math.PI/180,co=Math.cos(a),si=Math.sin(a),x=p.x-c.x,y=p.y-c.y;
  return {x:c.x+x*co-y*si,y:c.y+x*si+y*co};
}
function mix(a:LimbPoint,b:LimbPoint,w:number):LimbPoint {return {x:a.x+(b.x-a.x)*w,y:a.y+(b.y-a.y)*w};}
/** Segment-aware hinge coordinate. The two links, rather than an infinite
 * shoulder-axis projection, identify a folded-back forearm. The shared joint
 * has the same arc coordinate on both links, so the field remains continuous.
 * Source-compatible axis weights remain the default for existing documents. */
function baseLimbWeights(p:LimbPoint,chain:ContinuousLimb) {
  if(chain.weightField)return sampleLimbWeightField(p,chain.weightField);
  const hinge=(a:number,b:number,v:number)=>chain.hingeProfile==='linear'?Math.min(1,Math.max(0,(v-a)/(b-a))):smooth(a,b,v);
  const {root,joint,tip}=chain,dx=joint.x-root.x,dy=joint.y-root.y,length=Math.hypot(dx,dy);
  const along=((p.x-root.x)*dx+(p.y-root.y)*dy)/length;
  if(chain.weightMode==='bisector'){
    const fraction=chain.bisectorBandFraction??.45;
    if(!Number.isFinite(fraction)||fraction<=0)throw new Error('Positive finite bisector band fraction required');
    const lx=tip.x-joint.x,ly=tip.y-joint.y,lower=Math.hypot(lx,ly),bx=dx/length+lx/lower,by=dy/length+ly/lower,norm=Math.hypot(bx,by);
    if(norm>1e-3){const signed=((p.x-joint.x)*bx+(p.y-joint.y)*by)/norm,half=norm/2,band=Math.max(.5,Math.min(chain.jointBlend,fraction*Math.min(length,lower)*half)),distal=hinge(-band,band,signed);return {root:Math.max(smooth(0,chain.rootBlend,along),distal),distal};}
  }
  if(chain.weightMode!=='segments')return {root:smooth(0,chain.rootBlend,along),distal:hinge(length-chain.jointBlend,length+chain.jointBlend,along)};
  const project=(a:LimbPoint,b:LimbPoint)=>{
    const x=b.x-a.x,y=b.y-a.y,len=Math.hypot(x,y),t=((p.x-a.x)*x+(p.y-a.y)*y)/(len*len),c=Math.max(0,Math.min(1,t));
    return {t,len,d:Math.hypot(p.x-a.x-x*c,p.y-a.y-y*c)};
  };
  const upper=project(root,joint),lower=project(joint,tip);
  // Blend nearest-segment ownership across a narrow distance band instead of
  // introducing a Voronoi discontinuity. Close to the hinge both arc estimates
  // converge to its coordinate. Beyond the wrist the lower link stays rigid.
  const band=Math.max(1,Math.min(length,lower.len)*.08);
  const ownLower=smooth(-band,band,upper.d-lower.d);
  const arcUpper=Math.min(1,upper.t)*length;
  const arcLower=length+Math.max(0,lower.t)*lower.len;
  const arc=arcUpper*(1-ownLower)+arcLower*ownLower;
  const distal=hinge(length-chain.jointBlend,length+chain.jointBlend,arc);
  return {root:Math.max(smooth(0,chain.rootBlend,arc),distal),distal};
}
export function continuousLimbWeights(p:LimbPoint,chain:ContinuousLimb) {
 const w=baseLimbWeights(p,chain),root=chain.rootMode==='rigid'?1:chain.rootMode==='radial'?smooth(0,chain.radialRadius??chain.rootBlend,Math.hypot(p.x-chain.root.x,p.y-chain.root.y)):w.root;
 const boundary=chain.rootBoundary;
 const rootWeight=boundary?w.root+(root-w.root)*smooth(boundary.fixedRadius,boundary.blendRadius,Math.min(...boundary.points.map(q=>Math.hypot(p.x-q.x,p.y-q.y)))):root;
 if(!chain.attachmentPins)return {...w,root:rootWeight};
 const pins=chain.attachmentPins,d=Math.min(...pins.points.map(q=>Math.hypot(p.x-q.x,p.y-q.y))),f=smooth(pins.fixedRadius,pins.blendRadius,d);
 return {root:rootWeight*f,distal:w.distal*f};
}
export function poseContinuousLimb(p:LimbPoint,chain:ContinuousLimb,proximal:number,distal:number):LimbPoint {
  const dx=chain.joint.x-chain.root.x,dy=chain.joint.y-chain.root.y,length=Math.hypot(dx,dy);
  if(length<1||Math.hypot(chain.tip.x-chain.joint.x,chain.tip.y-chain.joint.y)<1)throw new Error('Degenerate limb');
  if(chain.rootBlend<=0||chain.jointBlend<=0)throw new Error('Positive blend widths required');
  const weights=continuousLimbWeights(p,chain);
  if(chain.blendMode==='angle') {
    const lower=rotate(p,chain.joint,distal*weights.distal);
    return rotate(lower,chain.root,proximal*weights.root);
  }
  const lower=mix(p,rotate(p,chain.joint,distal),weights.distal);
  return mix(p,rotate(lower,chain.root,proximal),weights.root);
}
