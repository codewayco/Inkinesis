import {describe,it,expect} from 'vitest';
import {poseContinuousLimb,continuousLimbWeights,type ContinuousLimb} from '../src/body/continuousLimb';
const c:ContinuousLimb={root:{x:0,y:0},joint:{x:0,y:100},tip:{x:0,y:200},rootBlend:28,jointBlend:18};
describe('continuous articulated limb',()=>{
 it('pins the root, preserves rest and composes both rotations at the distal tip',()=>{
  expect(poseContinuousLimb(c.root,c,30,60)).toEqual(c.root);
  expect(poseContinuousLimb({x:7,y:135},c,0,0)).toEqual({x:7,y:135});
  const p=poseContinuousLimb(c.tip,c,30,60);
  expect(p.x).toBeCloseTo(-150,8);expect(p.y).toBeCloseTo(100*Math.cos(Math.PI/6),8);
 });
 it('has no positional discontinuity across the joint or root blend',()=>{
  for(const y of [0,28,82,100,118]){
   const a=poseContinuousLimb({x:10,y:y-1e-5},c,30,60);
   const b=poseContinuousLimb({x:10,y:y+1e-5},c,30,60);
   expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(.0001);
  }
 });
 it('rejects degenerate landmarks and zero blend widths',()=>{
  expect(()=>poseContinuousLimb(c.tip,{...c,joint:c.root},10,10)).toThrow('Degenerate');
  expect(()=>poseContinuousLimb(c.tip,{...c,rootBlend:0},10,10)).toThrow('Positive');
 });
 it('keeps a folded-back wrist distal while keeping its shoulder anchored',()=>{
  const folded:ContinuousLimb={root:{x:0,y:0},joint:{x:60,y:120},tip:{x:25,y:-10},rootBlend:70,jointBlend:25,weightMode:'segments',blendMode:'angle'};
  expect(continuousLimbWeights(folded.tip,folded).distal).toBeCloseTo(1,10);
  expect(continuousLimbWeights(folded.root,folded).root).toBeCloseTo(0,10);
  const tip=poseContinuousLimb(folded.tip,folded,0,30);
  expect(Math.hypot(tip.x-folded.joint.x,tip.y-folded.joint.y)).toBeCloseTo(Math.hypot(folded.tip.x-folded.joint.x,folded.tip.y-folded.joint.y),8);
  expect(Math.hypot(tip.x-folded.tip.x,tip.y-folded.tip.y)).toBeGreaterThan(50);
 });
 it('angle blending preserves hinge radius under a partial distal weight',()=>{
  const p={x:10,y:100},posed=poseContinuousLimb(p,{...c,blendMode:'angle'},0,60);
  expect(Math.hypot(posed.x,posed.y-100)).toBeCloseTo(10,10);
 });
});
