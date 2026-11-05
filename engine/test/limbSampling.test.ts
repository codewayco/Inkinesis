import {describe,it,expect} from 'vitest';
import {sampleLimbAxes} from '../src/body/limbSampling';
describe('curvature-bounded angle sampling',()=>{
 const chain={root:{x:0,y:0},joint:{x:0,y:100},tip:{x:0,y:220},rootBlend:50,jointBlend:30};
 it('keeps endpoints and neutral and meets the chord budget when possible',()=>{
  const r=sampleLimbAxes(chain,[chain.tip],[-30,0,30],[-60,0,60],.5,100);
  expect(r.xs).toContain(0);expect(r.ys).toContain(0);expect(r.xs[0]).toBe(-30);expect(r.ys.at(-1)).toBe(60);
  expect(r.chordBoundPixels).toBeLessThanOrEqual(.5);expect(r.budgetLimited).toBe(false);
 });
 it('reports when a key budget prevents the requested accuracy',()=>{
  const r=sampleLimbAxes(chain,[chain.tip],[-30,0,30],[-60,0,60],.0001,7);
  expect(r.xs.length).toBe(7);expect(r.budgetLimited).toBe(true);
 });
 it('does not spend a capped symmetric hip budget on only one side',()=>{
  const original=[-25,-18.75,-12.5,-6.25,0,6.25,12.5,18.75,25];
  const r=sampleLimbAxes(chain,[chain.tip],original,[0,10,20,30,40,50,60],.0001,13,true);
  expect(r.xs.length).toBeLessThanOrEqual(13);
  for(const x of original)expect(r.xs).toContain(x);
  for(const x of r.xs)expect(r.xs.some(y=>Math.abs(x+y)<1e-9)).toBe(true);
  expect(r.budgetLimited).toBe(true);
 });
});

it('retains legacy left-first refinement when symmetry is not requested',()=>{
 const c={root:{x:0,y:0},joint:{x:0,y:100},tip:{x:0,y:220},rootBlend:50,jointBlend:30};
 const r=sampleLimbAxes(c,[c.tip],[-30,0,30],[-60,0,60],.0001,6);
 expect(r.xs).toEqual([-30,-22.5,-15,0,15,30]);
});
