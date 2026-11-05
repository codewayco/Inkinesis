import { describe, it, expect } from 'vitest';
import { rigFixture } from '../../test/rigFixture';
import { prepareLive2D } from '../live2d/export';
import { readCombined, evaluateCombined } from '../../../player/src/combinedRuntime';

function channelFixture(){
 const a=readCombined(rigFixture());
 for(const p of a.puppet.param)p.bindings=p.bindings.filter(b=>b.param_name!=='opacity');
 for(const [i,name] of ['ParamMouthOpenY','ParamEyeLOpen','ParamEyeROpen'].entries()){
  const node=structuredClone(a.parts[0]);node.uuid=100+i;node.name=name;node.opacity=i===0?0:1;a.parts.push(node);a.puppet.nodes.children!.push(node);
  const p=a.puppet.param.find(p=>p.name===name)!;p.min=[0,0];p.max=[1,0];p.defaults=[i===0?0:1,0];p.axis_points=[[0,.375,1],[0]];
  p.bindings=[{node:node.uuid,param_name:'opacity',interpolate_mode:'Linear',isSet:[[true],[true],[true]],values:[[0],[.375],[1]]},{node:node.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:[[true],[true],[true]],values:[0,.375,1].map(x=>[Array.from({length:4},()=>[(x-p.defaults[0])*16,(x-p.defaults[0])**2*9])])}];
 }
 return a;
}

describe('combined Live2D bridge',()=>{
 it.each([[false,false],[true,false],[true,true]])('preserves geometry and opacity at mixed values with additive mode %s/channel mode %s',(additiveMorphs,channelMorphs)=>{
  const asset=channelFixture(),bridge=prepareLive2D(asset,'Fixture',{additiveMorphs,channelMorphs});
  const value:Record<string,number>={};
  bridge.parameters.forEach((p,i)=>value[p.id]=p.min+(p.max-p.min)*((i*37%89+5)/100));
  const source=Object.fromEntries(asset.puppet.param.map(p=>[p.name,[...p.defaults]]));
  bridge.parameters.forEach(p=>source[p.source][p.axis]=value[p.id]);
  const expected=evaluateCombined(asset,source);
  for(const d of bridge.drawables){
   const actual=[...d.positions];let opacity=d.cells.length?0:d.opacity;
   const brackets=d.axes.map(a=>{
    const n=value[a.id];let hi=1;while(hi<a.keys.length-1&&a.keys[hi]<n)hi++;
    if(a.keys.length===1)return [[0,1]];
    const t=(n-a.keys[hi-1])/(a.keys[hi]-a.keys[hi-1]);return [[hi-1,1-t],[hi,t]];
   });
   for(const c of d.cells){
    const weight=brackets.reduce((w,b,i)=>w*(b.find(([idx])=>idx===c.coordinate[i])?.[1]??0),1);
    c.delta.forEach((v,i)=>actual[i]+=v*weight);opacity+=c.opacity*weight;
   }
   const neutral=evaluateCombined(asset,{}).find(p=>p.uuid===d.uuid)!;
   for(const morph of d.morphs){let hi=1;while(hi<morph.keys.length-1&&morph.keys[hi]<value[morph.id])hi++;const t=(value[morph.id]-morph.keys[hi-1])/(morph.keys[hi]-morph.keys[hi-1]);for(const [j,w] of [[hi-1,1-t],[hi,t]])if(j!==morph.neutral)for(let k=0;k<actual.length;k++){const rest=d.positions[k]-(k%2?asset.height:asset.width)/2;actual[k]+=(morph.forms[j][k]-(neutral.xy[k]-rest))*w;} for(const [j,w] of [[hi-1,1-t],[hi,t]])if(j!==morph.neutral)opacity+=(morph.opacities[j]-d.neutralOpacity)*w;}
   const e=expected.find(p=>p.uuid===d.uuid)!;
   actual.forEach((n,i)=>expect(n-(i%2?asset.height:asset.width)/2).toBeCloseTo(e.xy[i],5));
   expect(opacity).toBeCloseTo(e.opacity,6);
  }
  expect(bridge.parameters).toHaveLength(19);
  expect(bridge.drawables).toHaveLength(asset.parts.length);
 });
 it('defaults to Cubism 5.0 channel morphs and retains an explicit legacy test path',()=>{
  const a=channelFixture();
  expect(prepareLive2D(a,'Default').runtimeTarget).toBe(50);
  expect(prepareLive2D(a,'Default')).toEqual(prepareLive2D(a,'Default',{additiveMorphs:true,channelMorphs:true}));
  expect(prepareLive2D(a,'Legacy',{additiveMorphs:true,channelMorphs:false}).runtimeTarget).toBe(42);
  expect(prepareLive2D(a,'Channels',{additiveMorphs:true,channelMorphs:true}).runtimeTarget).toBe(50);
 });
 it('keeps standard mouth/eye IDs and ranges while moving single opacity owners to morph channels',()=>{
  const a=channelFixture(),b=prepareLive2D(a,'Channels',{additiveMorphs:true,channelMorphs:true});
  for(const name of ['ParamMouthOpenY','ParamEyeLOpen','ParamEyeROpen']){
   const source=a.puppet.param.find(p=>p.name===name)!,target=b.parameters.find(p=>p.id===name)!;
   expect(target.min).toBe(source.min[0]);expect(target.max).toBe(source.max[0]);expect(target.default).toBe(source.defaults[0]);expect(target.kind).toBe('blend_shape');
   for(const d of b.drawables.filter(d=>d.morphs.some(m=>m.id===name)))expect(d.axes.some(x=>x.id===name)).toBe(false);
  }
 });
 it('keeps multiplicative opacity owners in the grid instead of silently adding them',()=>{
  const a=channelFixture(),p=a.puppet.param.find(p=>p.name==='ParamMouthOpenY')!,bind=p.bindings.find(b=>b.param_name==='opacity')!;
  a.puppet.param.push({...structuredClone(p),uuid:999999,name:'ParamExtraOpacity',bindings:[structuredClone(bind)]});
  const b=prepareLive2D(a,'Product',{additiveMorphs:true,channelMorphs:true});
  for(const name of ['ParamMouthOpenY','ParamExtraOpacity'])expect(b.parameters.find(p=>p.id===name)!.kind).toBe('normal');
 });
 it('refuses nonidentity transforms rather than silently dropping them',()=>{
  const asset=readCombined(rigFixture());
  (asset.puppet.nodes as unknown as {transform:unknown}).transform={trans:[1,0,0],rot:[0,0,0],scale:[1,1]};
  expect(()=>prepareLive2D(asset,'Test')).toThrow(/Nonidentity/);
 });
});
