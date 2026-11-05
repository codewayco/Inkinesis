import {continuousLimbWeights,poseContinuousLimb,type ContinuousLimb,type LimbPoint} from './continuousLimb';

/** Offline authoring primitive. Rigid object targets drive both wrists; this
 * neither grants independent arm motion nor changes other commands. */
export function rigidGripTarget(p:LimbPoint,center:LimbPoint,angle:number,lift:number):LimbPoint {
  const a=angle*Math.PI/180,x=p.x-center.x,y=p.y-center.y;
  return {x:center.x+x*Math.cos(a)-y*Math.sin(a),y:center.y+x*Math.sin(a)+y*Math.cos(a)+lift};
}
const wrap=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
/** Vertical-grip authoring field: retain the source hand frame, joining it to
 * the articulated proximal forearm continuously. All garment owners use this
 * same field. The distal half is defined by the existing grasp detector. */
export function poseGripFrame(p:LimbPoint,chain:ContinuousLimb,proximal:number,distal:number,handAngle=0,transitionStart=0):LimbPoint {
  const q=poseContinuousLimb(p,chain,proximal,distal),tip=poseContinuousLimb(chain.tip,chain,proximal,distal);
  const dx=chain.tip.x-chain.joint.x,dy=chain.tip.y-chain.joint.y,t=((p.x-chain.joint.x)*dx+(p.y-chain.joint.y)*dy)/(dx*dx+dy*dy);
  // A folded forearm may project the shoulder into its distal half.
  // Suppress the hand correction at the root, reaching full strength before
  // the wrist; both the lift and linked driver use the same anchored field.
  const radius=Math.max(1,Math.min(chain.rootBlend,.25*Math.hypot(chain.tip.x-chain.root.x,chain.tip.y-chain.root.y),.25*Math.hypot(chain.joint.x-chain.root.x,chain.joint.y-chain.root.y)));
  const rootT=Math.max(0,Math.min(1,Math.hypot(p.x-chain.root.x,p.y-chain.root.y)/radius));
  const u=Math.max(0,Math.min(1,(t-transitionStart)/(.5-transitionStart))),weight=u*u*(3-2*u)*rootT*rootT*(3-2*rootT);
  const a=handAngle*Math.PI/180,dxh=p.x-chain.tip.x,dyh=p.y-chain.tip.y;
  const rigid=handAngle===0?{x:p.x+tip.x-chain.tip.x,y:p.y+tip.y-chain.tip.y}:{x:tip.x+dxh*Math.cos(a)-dyh*Math.sin(a),y:tip.y+dxh*Math.sin(a)+dyh*Math.cos(a)};
  return {x:q.x+(rigid.x-q.x)*weight,y:q.y+(rigid.y-q.y)*weight};
}
export function solveGripWrist(chain:ContinuousLimb,target:LimbPoint) {
  if(chain.blendMode!=='angle')return {ok:false as const,reason:'Angle skinning required'};
  const u={x:chain.joint.x-chain.root.x,y:chain.joint.y-chain.root.y},v={x:chain.tip.x-chain.joint.x,y:chain.tip.y-chain.joint.y};
  const l1=Math.hypot(u.x,u.y),l2=Math.hypot(v.x,v.y),dx=target.x-chain.root.x,dy=target.y-chain.root.y,d=Math.hypot(dx,dy);
  if(l1<1||l2<1||!Number.isFinite(d))return {ok:false as const,reason:'Degenerate source or target'};
  if(d>l1+l2+1e-8||d<Math.abs(l1-l2)-1e-8||d<1e-8)return {ok:false as const,reason:'Unreachable wrist; no target clamping'};
  const weights=continuousLimbWeights(chain.tip,chain);
  if(weights.root<.05||weights.distal<.05)return {ok:false as const,reason:'Wrist skin weights are ill-conditioned'};
  const alpha0=Math.atan2(u.y,u.x),beta0=wrap(Math.atan2(v.y,v.x)-alpha0);
  const bend=(beta0<0?-1:1)*Math.acos(Math.max(-1,Math.min(1,(d*d-l1*l1-l2*l2)/(2*l1*l2))));
  const shoulder=Math.atan2(dy,dx)-Math.atan2(l2*Math.sin(bend),l1+l2*Math.cos(bend));
  const proximal=wrap(shoulder-alpha0)*180/Math.PI/weights.root,distal=wrap(bend-beta0)*180/Math.PI/weights.distal;
  const actual=poseContinuousLimb(chain.tip,chain,proximal,distal),residual=Math.hypot(actual.x-target.x,actual.y-target.y);
  if(!Number.isFinite(residual)||residual>1e-6)return {ok:false as const,reason:'Inverse/forward wrist mismatch'};
  return {ok:true as const,proximal,distal,residual};
}
export function solvePairedGrip(chains:[ContinuousLimb,ContinuousLimb],angle:number,lift:number) {
  const center={x:(chains[0].tip.x+chains[1].tip.x)/2,y:(chains[0].tip.y+chains[1].tip.y)/2};
  const targets=chains.map(c=>rigidGripTarget(c.tip,center,angle,lift));
  const arms=chains.map((c,i)=>solveGripWrist(c,targets[i]));
  return {ok:arms.every(a=>a.ok),center,targets,arms};
}
