import {describe,it,expect} from 'vitest';
import {continuousLimbWeights,poseContinuousLimb,type ContinuousLimb} from '../src/body/continuousLimb';
describe('source garment seam pins',()=>{
 const base:ContinuousLimb={root:{x:0,y:0},joint:{x:100,y:0},tip:{x:200,y:0},rootBlend:60,jointBlend:30,blendMode:'angle'};
 const pinned:ContinuousLimb={...base,attachmentPins:{points:[{x:50,y:0}],fixedRadius:5,blendRadius:30}};
 it('keeps the opaque cut seam fixed under combined joint commands',()=>{
  for(const p of [{x:50,y:0},{x:53,y:3}])for(const x of [-30,30])for(const y of [-60,60])expect(poseContinuousLimb(p,pinned,x,y)).toEqual(p);
  expect(poseContinuousLimb({x:50,y:0},base,30,60)).not.toEqual({x:50,y:0});
 });
 it('preserves unpinned wrist motion and bounded continuous transition weights',()=>{
  for(const x of [-30,0,30])for(const y of [-60,0,60])expect(poseContinuousLimb(base.tip,pinned,x,y)).toEqual(poseContinuousLimb(base.tip,base,x,y));
  let prior=0;for(let d=5;d<=30;d+=.1){const w=continuousLimbWeights({x:50+d,y:0},pinned).root;expect(w).toBeGreaterThanOrEqual(prior-1e-12);expect(w).toBeLessThanOrEqual(1);expect(w-prior).toBeLessThan(.01);prior=w;}
 });
});
