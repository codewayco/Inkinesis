import {describe,it,expect} from 'vitest';
import {blinkOpenness,motionDemoValues} from '../src/previewMotion';
import type {MotionCapabilities} from '../../tools/imageToRig/capabilities';
const params=['Arm L','Arm R','Leg L','Leg R'].map(name=>({name,min:[-30,name.startsWith('Leg')?0:-60],max:[30,60],defaults:[0,0]}));
describe('preview actions',()=>{
 it('demonstrates every available shoulder, elbow, hip and knee within rig limits',()=>{
  const observed=new Map<string,Set<number>>();
  for(let t=0;t<8;t+=.1){
   const v=motionDemoValues(params,undefined,t);
   for(const p of params)for(let axis=0;axis<2;axis++){
    const n=v[p.name][axis];expect(n).toBeGreaterThanOrEqual(p.min[axis]);expect(n).toBeLessThanOrEqual(p.max[axis]);
    const key=p.name+axis;const set=observed.get(key)??new Set();set.add(Math.round(n));observed.set(key,set);
   }
  }
  for(const values of observed.values())expect(values.size).toBeGreaterThan(10);
 });
 it('does not enable fixed chains or add absent parameters, including face motion',()=>{
  const caps={chains:{'Arm L':{mode:'fixed'}}} as MotionCapabilities;
  const v=motionDemoValues(params.slice(0,2),caps,1);
  expect(Object.keys(v)).toEqual(['Arm R']);
 });
 it('respects reduced and one-sided ranges',()=>{
  const p={name:'Arm L',min:[-2,0],max:[3,4],defaults:[0,0]};
  for(let t=0;t<8;t+=.1){const v=motionDemoValues([p],undefined,t)['Arm L'];expect(v[0]).toBeGreaterThanOrEqual(-2);expect(v[0]).toBeLessThanOrEqual(3);expect(v[1]).toBeGreaterThanOrEqual(0);expect(v[1]).toBeLessThanOrEqual(4);}
 });
 it('closes and reopens a blink without retaining a closed expression',()=>{
  expect([0,50,100,130,240,340,1000].map(blinkOpenness)).toEqual([1,.5,0,0,.5,1,1]);
 });
 it('demonstrates a shared held-object control without inventing independent arm commands',()=>{
  const p={name:'ParamGripLift',min:[-12.8,0],max:[0,0],defaults:[0,0]};
  const caps={chains:{'Arm L':{mode:'fixed'},'Arm R':{mode:'fixed'}}} as MotionCapabilities;
  expect(motionDemoValues([p],caps,0)).toEqual({ParamGripLift:[0,0]});
  let minimum=0;
  for(let t=0;t<8;t+=.1){const v=motionDemoValues([p],caps,t);expect(Object.keys(v)).toEqual(['ParamGripLift']);expect(v[p.name][0]).toBeGreaterThanOrEqual(p.min[0]);expect(v[p.name][0]).toBeLessThanOrEqual(0);minimum=Math.min(minimum,v[p.name][0]);}
  expect(minimum).toBeLessThan(-6);
 });
});
