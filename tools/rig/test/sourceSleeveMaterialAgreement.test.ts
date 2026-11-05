import {describe,it,expect} from 'vitest';
import {sleeveMaterialMatch,sourceSleeveMaterialAgreement} from '../sourceSleeveMaterialAgreement';
describe('source sleeve material evidence',()=>{
 it('matches saturated fabric hue under brightness changes',()=>{
  expect(sleeveMaterialMatch([20,140,160],[10,70,80],0)).toBe(true);
  expect(sleeveMaterialMatch([20,140,160],[160,80,20],0)).toBe(false);
 });
 it('does not treat different neutral shades as hue matches',()=>{
  expect(sleeveMaterialMatch([220,220,220],[80,80,80],0)).toBe(false);
  expect(sleeveMaterialMatch([20,20,20],[40,40,40],0)).toBe(false);
 });
 it('requires eligibility and rejects competing claims',()=>{
  const w=16,h=16,g=new Uint8ClampedArray(w*h*4),a=new Uint8ClampedArray(g.length);for(let i=0;i<w*h;i++){g.set([20,140,160,255],i*4);a.set([10,70,80,255],i*4);}
  const chain={root:{x:8,y:0},joint:{x:8,y:15},tip:{x:8,y:30},rootBlend:8,jointBlend:4};const arm={name:'Arm L',rgba:a,chain,eligible:true};
  expect(sourceSleeveMaterialAgreement(g,[{...arm,eligible:false}],w,h).components).toHaveLength(0);
  expect(sourceSleeveMaterialAgreement(g,[arm],w,h).components[0].accepted).toBe(true);
  expect(Array.from(sourceSleeveMaterialAgreement(g,[arm,{...arm,name:'Arm R'}],w,h).owners).every(n=>n===0)).toBe(true);
 });
});
