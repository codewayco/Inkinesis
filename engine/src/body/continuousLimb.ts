/** Planar, continuous two-joint skinning. Uses known blended rotations, not a new skinning algorithm. */
export interface LimbPoint { x:number; y:number }
export interface ContinuousLimb { root:LimbPoint; joint:LimbPoint; tip:LimbPoint; rootBlend:number; jointBlend:number }
const smooth=(a:number,b:number,v:number)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
function rotate(p:LimbPoint,c:LimbPoint,degrees:number):LimbPoint {
  const a=degrees*Math.PI/180,co=Math.cos(a),si=Math.sin(a),x=p.x-c.x,y=p.y-c.y;
  return {x:c.x+x*co-y*si,y:c.y+x*si+y*co};
}
function mix(a:LimbPoint,b:LimbPoint,w:number):LimbPoint {return {x:a.x+(b.x-a.x)*w,y:a.y+(b.y-a.y)*w};}
export function poseContinuousLimb(p:LimbPoint,chain:ContinuousLimb,proximal:number,distal:number):LimbPoint {
  const dx=chain.joint.x-chain.root.x,dy=chain.joint.y-chain.root.y,length=Math.hypot(dx,dy);
  if(length<1||Math.hypot(chain.tip.x-chain.joint.x,chain.tip.y-chain.joint.y)<1)throw new Error('Degenerate limb');
  if(chain.rootBlend<=0||chain.jointBlend<=0)throw new Error('Positive blend widths required');
  const along=((p.x-chain.root.x)*dx+(p.y-chain.root.y)*dy)/length;
  const elbowWeight=smooth(length-chain.jointBlend,length+chain.jointBlend,along);
  const lower=mix(p,rotate(p,chain.joint,distal),elbowWeight);
  return mix(p,rotate(lower,chain.root,proximal),smooth(0,chain.rootBlend,along));
}
