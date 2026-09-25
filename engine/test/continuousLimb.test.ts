import {describe,it,expect} from 'vitest';
import {poseContinuousLimb,type ContinuousLimb} from '../src/body/continuousLimb';
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
});
