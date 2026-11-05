import {describe,it,expect} from 'vitest';
import {continuousLimbWeights,poseContinuousLimb,type ContinuousLimb} from '../src/body/continuousLimb';
const base:ContinuousLimb={root:{x:0,y:0},joint:{x:70,y:130},tip:{x:30,y:-15},rootBlend:90,jointBlend:68,blendMode:'angle'};
describe('rigid proximal carrier',()=>{
 it('transports a folded wrist with the shoulder without moving the shoulder pivot',()=>{
  const c={...base,rootMode:'rigid' as const};expect(continuousLimbWeights(base.tip,base).root).toBeLessThan(.05);
  expect(continuousLimbWeights(c.tip,c).root).toBe(1);expect(poseContinuousLimb(c.root,c,24,0)).toEqual(c.root);
  const q=poseContinuousLimb(c.tip,c,24,0),angle=24*Math.PI/180;
  expect(q.x).toBeCloseTo(30*Math.cos(angle)+15*Math.sin(angle),10);expect(q.y).toBeCloseTo(30*Math.sin(angle)-15*Math.cos(angle),10);
 });
 it('retains the distal field and makes root-only motion an isometry',()=>{
  const c={...base,rootMode:'rigid' as const},a={x:60,y:90},b={x:90,y:120};
  expect(continuousLimbWeights(a,c).distal).toBe(continuousLimbWeights(a,base).distal);
  const p=poseContinuousLimb(a,c,-30,0),q=poseContinuousLimb(b,c,-30,0);
  expect(Math.hypot(q.x-p.x,q.y-p.y)).toBeCloseTo(Math.hypot(b.x-a.x,b.y-a.y),10);
 });
});
