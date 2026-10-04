import {describe,it,expect} from 'vitest';
import {retimeMouth,closedMouthForm,openingCurve,openOpacity,closedOpacity} from '../mouthMotion';
import type {InpDocument,InpNode} from '../inp';
import {evaluateCombined,type CombinedAsset} from '../../../player/src/combinedRuntime';

function fixture():CombinedAsset {
  const part=(uuid:number,name:string,verts:number[]):InpNode=>({uuid,name,type:'Part',enabled:true,zsort:uuid,opacity:1,mesh:{verts,uvs:verts.map(()=>0),indices:[0,1,2],origin:[0,0]}});
  const open=part(1,'mouth_open',[0,0,10,0,0,10]),closed=part(2,'mouth_close',[-20,0,20,0,0,4]);
  const axis=[0,.25,.5,.75,1];
  const puppet:InpDocument={meta:{},nodes:{uuid:0,name:'root',type:'Node',enabled:true,zsort:0,children:[open,closed]},param:[
    {uuid:3,name:'ParamMouthOpenY',is_vec2:false,min:[0,0],max:[1,0],defaults:[0,0],merge_mode:'Passthrough',axis_points:[axis,[0]],bindings:[
      {node:1,param_name:'deform',interpolate_mode:'Linear',isSet:axis.map(()=>[true]),values:axis.map(v=>[[[0,0],[0,0],[0,10*v]]])},
      {node:1,param_name:'opacity',interpolate_mode:'Linear',isSet:axis.map(()=>[true]),values:axis.map(v=>[Math.min(1,v/.15)])},
      {node:2,param_name:'opacity',interpolate_mode:'Linear',isSet:axis.map(()=>[true]),values:axis.map(v=>[1-v])}]},
    {uuid:4,name:'ParamMouthForm',is_vec2:false,min:[-1,0],max:[1,0],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0,.5,1],[0]],bindings:[]}]};
  return {puppet,parts:[open,closed],textures:[],width:100,height:100};
}
describe('mouth timing and closed-mouth form',()=>{
  it('passes the thin-seam stage quickly and cross-fades over a short interval',()=>{
    const asset=fixture();expect(retimeMouth(asset.puppet).status).toBe('applied');
    const at=(v:number)=>evaluateCombined(asset,{ParamMouthOpenY:[v]});
    const rest=at(0);expect(rest[0].opacity).toBe(0);expect(rest[1].opacity).toBe(1);expect(rest[0].xy[5]).toBeCloseTo(10,6);
    const quarter=at(.25);expect(quarter[1].opacity).toBe(0);expect(quarter[0].opacity).toBe(1);
    expect(quarter[0].xy[5]-10).toBeGreaterThan(10*.25);expect(at(1)[0].xy[5]).toBeCloseTo(20,6);
    expect(openingCurve(.25)).toBeGreaterThan(.5);expect(openOpacity(0)).toBe(0);expect(closedOpacity(.2)).toBe(0);
    // No seam stage: the closed lips are alone until the open mouth appears already open.
    expect(openOpacity(.03)).toBe(0);expect(closedOpacity(.03)).toBe(1);expect(openingCurve(.05)).toBeGreaterThanOrEqual(.3);
    for(let v=0;v<1;v+=.01)expect(openingCurve(v+.01)).toBeGreaterThanOrEqual(openingCurve(v));
    // The open mouth is never half transparent over the closed lips: it becomes opaque
    // within a few thousandths, and only then are the closed lips removed. Keys at the
    // swap keep the authored axis interpolation from widening it.
    const half=Array.from({length:1001},(_,i)=>i/1000).filter(v=>at(v)[0].opacity>.05&&at(v)[0].opacity<.95);expect(half.length).toBeLessThanOrEqual(4);
    for(let i=0;i<=1000;i++){const f=at(i/1000);if(f[1].opacity<.999)expect(f[0].opacity).toBeGreaterThan(.999);}
  });
  it('gives the closed lips a bounded corner curve and leaves the rest pose alone',()=>{
    const asset=fixture();const report=closedMouthForm(asset.puppet);expect(report.status).toBe('applied');
    const smile=evaluateCombined(asset,{ParamMouthForm:[1]})[1],rest=evaluateCombined(asset,{ParamMouthForm:[0]})[1];
    expect(rest.xy).toEqual([-20,0,20,0,0,4]);
    expect(smile.xy[1]).toBeLessThan(0);expect(smile.xy[3]).toBeLessThan(0);expect(Math.abs(smile.xy[5]-4)).toBeLessThan(1e-9);
    expect(Math.abs(smile.xy[1])).toBeLessThanOrEqual(.07*40+1e-9);
    expect(closedMouthForm(asset.puppet).status).toBe('skipped');
  });
  it('does nothing without both mouths',()=>{
    const asset=fixture();asset.puppet.nodes.children=[asset.parts[0]];expect(retimeMouth(asset.puppet).status).toBe('skipped');
  });
});
