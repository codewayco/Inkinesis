import { describe, it, expect } from 'vitest';
import { rigFixture } from '../../test/rigFixture';
import { prepareLive2D } from '../live2d/export';
import { readCombined, evaluateCombined } from '../../../player/src/combinedRuntime';

describe('combined Live2D bridge',()=>{
 it('preserves the synthetic geometry and multiplicative opacity at mixed values',()=>{
  const asset=readCombined(rigFixture()),bridge=prepareLive2D(asset,'Fixture');
  const value:Record<string,number>={};
  bridge.parameters.forEach((p,i)=>value[p.id]=p.min+(p.max-p.min)*((i*37%89+5)/100));
  const source=Object.fromEntries(asset.puppet.param.map(p=>[p.name,[...p.defaults]]));
  bridge.parameters.forEach(p=>source[p.source][p.axis]=value[p.id]);
  const expected=evaluateCombined(asset,source);
  for(const d of bridge.drawables){
   const actual=[...d.positions];let opacity=0;
   const brackets=d.axes.map(a=>{
    const n=value[a.id];let hi=1;while(hi<a.keys.length-1&&a.keys[hi]<n)hi++;
    if(a.keys.length===1)return [[0,1]];
    const t=(n-a.keys[hi-1])/(a.keys[hi]-a.keys[hi-1]);return [[hi-1,1-t],[hi,t]];
   });
   for(const c of d.cells){
    const weight=brackets.reduce((w,b,i)=>w*(b.find(([idx])=>idx===c.coordinate[i])?.[1]??0),1);
    c.delta.forEach((v,i)=>actual[i]+=v*weight);opacity+=c.opacity*weight;
   }
   const e=expected.find(p=>p.uuid===d.uuid)!;
   actual.forEach((n,i)=>expect(n-(i%2?asset.height:asset.width)/2).toBeCloseTo(e.xy[i],6));
   expect(d.cells.length?opacity:d.opacity).toBeCloseTo(e.opacity,6);
  }
  expect(bridge.parameters).toHaveLength(19);
  expect(bridge.drawables).toHaveLength(asset.parts.length);
 });
 it('refuses nonidentity transforms rather than silently dropping them',()=>{
  const asset=readCombined(rigFixture());
  (asset.puppet.nodes as unknown as {transform:unknown}).transform={trans:[1,0,0],rot:[0,0,0],scale:[1,1]};
  expect(()=>prepareLive2D(asset,'Test')).toThrow(/Nonidentity/);
 });
});
