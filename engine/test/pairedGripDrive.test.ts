import {it,expect} from 'vitest';
import {solveGripDrive,poseGripObject,poseGripDriveFrame} from '../src/body/pairedGripDrive';
import {poseGripFrame} from '../src/body/pairedGrip';
import type {ContinuousLimb} from '../src/body/continuousLimb';
const source=(sign:number):ContinuousLimb=>({root:{x:sign*80,y:0},joint:{x:sign*100,y:100},tip:{x:sign*30,y:160},rootBlend:60,jointBlend:45,blendMode:'angle',weightMode:'bisector'});
it('keeps both physical grasp frames on one rigid object while driving either wrist',()=>{
 const cs:[ContinuousLimb,ContinuousLimb]=[source(-1),source(1)];
 for(const driver of [0,1] as const)for(const root of [-5,0,5])for(const bend of [-8,0,8]){
  const s=solveGripDrive(cs,driver,root,bend);expect(s.ok).toBe(true);if(!s.ok)continue;
  expect(Math.hypot(s.targets[0].x-s.targets[1].x,s.targets[0].y-s.targets[1].y)).toBeCloseTo(60,8);
  for(const side of [0,1]){const c=cs[side],a=s.arms[side];expect(a.ok).toBe(true);if(!a.ok)continue;
   const p={x:c.tip.x+2,y:c.tip.y+3},hand=poseGripDriveFrame(p,c,a.proximal,a.distal,s.theta),object=poseGripObject(p,cs[driver].tip,s.target,s.theta);
   expect(Math.hypot(hand.x-object.x,hand.y-object.y)).toBeLessThan(1e-6);
  }
 }
});
it('is neutral at zero and rejects nonfinite or out-of-source-range commands',()=>{
 const cs:[ContinuousLimb,ContinuousLimb]=[source(-1),source(1)],s=solveGripDrive(cs,0,0,0);expect(s.ok).toBe(true);if(s.ok){expect(s.theta).toBe(0);expect(s.target.x).toBeCloseTo(cs[0].tip.x,10);expect(s.target.y).toBeCloseTo(cs[0].tip.y,10);}
 for(const v of [NaN,Infinity,31])expect(solveGripDrive(cs,0,v,0).ok).toBe(false);
});
it('rotating hand frame leaves the proximal elbow field and smooth transition intact',()=>{
 const c=source(1),a=poseGripFrame(c.joint,c,5,-10),b=poseGripFrame(c.joint,c,5,-10,12);expect(b).toEqual(a);
 const point=(t:number)=>({x:c.joint.x+(c.tip.x-c.joint.x)*t,y:c.joint.y+(c.tip.y-c.joint.y)*t});
 for(const t of [0,.5]){const left=poseGripFrame(point(t-1e-6),c,5,-10,12),right=poseGripFrame(point(t+1e-6),c,5,-10,12);expect(Math.hypot(left.x-right.x,left.y-right.y)).toBeLessThan(.001);}
});

it('keeps a folded shoulder fixed even when it projects beyond the distal half of the forearm',()=>{
 const c:ContinuousLimb={root:{x:0,y:0},joint:{x:45,y:160},tip:{x:90,y:90},rootBlend:100,jointBlend:75,blendMode:'angle',weightMode:'bisector'};
 for(const theta of [-12,0,12]){expect(poseGripDriveFrame(c.root,c,8,-14,theta)).toEqual(c.root);
 const p={x:c.tip.x+3,y:c.tip.y+2},a=poseGripDriveFrame(p,c,8,-14,theta),b=poseGripFrame(p,c,8,-14,theta);expect(a.x).toBeCloseTo(b.x,10);expect(a.y).toBeCloseTo(b.y,10);}
});
