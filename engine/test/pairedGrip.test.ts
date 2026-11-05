import {it,expect} from 'vitest';
import {rigidGripTarget,solveGripWrist,solvePairedGrip,poseGripFrame} from '../src/body/pairedGrip';
import {poseContinuousLimb,type ContinuousLimb} from '../src/body/continuousLimb';
const source=(mirror=1):ContinuousLimb=>({root:{x:mirror*80,y:0},joint:{x:mirror*100,y:100},tip:{x:mirror*30,y:160},rootBlend:60,jointBlend:45,blendMode:'angle',weightMode:'bisector'});
it('preserves the hand frame at grasp material points, keeping neutral and the elbow intact',()=>{
 const c=source(),r=solveGripWrist(c,{x:c.tip.x,y:c.tip.y-15});expect(r.ok).toBe(true);if(!r.ok)return;
 for(const t of [.5,.8,1,1.3]){const p={x:c.joint.x+(c.tip.x-c.joint.x)*t+3,y:c.joint.y+(c.tip.y-c.joint.y)*t+4};
  const q=poseGripFrame(p,c,r.proximal,r.distal);expect(q.x).toBeCloseTo(p.x,8);expect(q.y).toBeCloseTo(p.y-15,8);
  const n=poseGripFrame(p,c,0,0);expect(n.x).toBeCloseTo(p.x,10);expect(n.y).toBeCloseTo(p.y,10);
 }
 expect(poseGripFrame(c.joint,c,r.proximal,r.distal)).toEqual(poseContinuousLimb(c.joint,c,r.proximal,r.distal));
});
it('recovers both mirrored elbow branches and the original neutral',()=>{
 for(const sign of [-1,1]){const c=source(sign);for(const x of [-12,0,12])for(const y of [-15,0,15]){
  const target=poseContinuousLimb(c.tip,c,x,y),r=solveGripWrist(c,target);expect(r.ok).toBe(true);
  if(r.ok){expect(r.proximal).toBeCloseTo(x,9);expect(r.distal).toBeCloseTo(y,9);}
 }}
});
it('keeps both grip targets on one rigid object across feasible poses',()=>{
 const cs:[ContinuousLimb,ContinuousLimb]=[source(-1),source(1)];
 for(const a of [-8,0,8])for(const h of [-10,0,10]){const r=solvePairedGrip(cs,a,h);expect(r.ok).toBe(true);
  expect(Math.hypot(r.targets[0].x-r.targets[1].x,r.targets[0].y-r.targets[1].y)).toBeCloseTo(60,10);
  for(const arm of r.arms)if(arm.ok)expect(arm.residual).toBeLessThan(1e-9);
 }
});
it('rejects unreachable targets and ill-conditioned wrist weights rather than faking contact',()=>{
 const c=source();expect(solveGripWrist(c,{x:1000,y:1000}).ok).toBe(false);
 const folded={...c,joint:{x:80,y:100},tip:{x:80,y:20},weightMode:'axis' as const};
 expect(solveGripWrist(folded,folded.tip).ok).toBe(false);
});
it('rigid transform preserves arbitrary object distances and neutral exactly',()=>{
 const a={x:-91,y:230},b={x:140,y:192},center={x:25,y:170};
 expect(rigidGripTarget(a,center,0,0)).toEqual(a);
 const u=rigidGripTarget(a,center,17,-12),v=rigidGripTarget(b,center,17,-12);
 expect(Math.hypot(u.x-v.x,u.y-v.y)).toBeCloseTo(Math.hypot(a.x-b.x,a.y-b.y),10);
});

it('anchors the shoulder when a folded forearm projects its distal frame over the root',()=>{
 const c:ContinuousLimb={root:{x:0,y:0},joint:{x:80,y:100},tip:{x:20,y:10},rootBlend:45,jointBlend:40,blendMode:'angle',weightMode:'bisector'};
 const moved=poseGripFrame(c.root,c,7,-12);
 expect(moved.x).toBeCloseTo(c.root.x,10);expect(moved.y).toBeCloseTo(c.root.y,10);
 const target=poseContinuousLimb(c.tip,c,7,-12),tip=poseGripFrame(c.tip,c,7,-12);
 expect(tip.x).toBeCloseTo(target.x,10);expect(tip.y).toBeCloseTo(target.y,10);
 const near={x:1e-6,y:0},q=poseGripFrame(near,c,7,-12);
 expect(Math.hypot(q.x-moved.x,q.y-moved.y)).toBeLessThan(1e-5);
});

it('wider hand-frame blending keeps roots and distal material rigid for both mirrored arms',()=>{
 for(const sign of [-1,1]){const c=source(sign);for(const a of [-5,0,5])for(const b of [-10,0,10]){
  const root=poseGripFrame(c.root,c,a,b,12,-.25);expect(root.x).toBeCloseTo(c.root.x,9);expect(root.y).toBeCloseTo(c.root.y,9);
  const tip=poseContinuousLimb(c.tip,c,a,b),theta=12*Math.PI/180;
  for(const t of [.55,.8,1,1.2]){const p={x:c.joint.x+t*(c.tip.x-c.joint.x),y:c.joint.y+t*(c.tip.y-c.joint.y)},q=poseGripFrame(p,c,a,b,12,-.25),dx=p.x-c.tip.x,dy=p.y-c.tip.y;
   expect(q.x).toBeCloseTo(tip.x+dx*Math.cos(theta)-dy*Math.sin(theta),9);expect(q.y).toBeCloseTo(tip.y+dx*Math.sin(theta)+dy*Math.cos(theta),9);
   const neutral=poseGripFrame(p,c,0,0,0,-.25);expect(neutral.x).toBeCloseTo(p.x,9);expect(neutral.y).toBeCloseTo(p.y,9);
  }
 }}
});
