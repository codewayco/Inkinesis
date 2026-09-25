import {attachmentMotionGate} from '../attachmentMotionGate';
import {describe,it,expect} from 'vitest';
import {layerCapabilities,finalizeMotionCapabilities} from '../motionCapabilities';
import {type MotionCapabilities} from '../../imageToRig/capabilities';
import {encodePNG} from '../../shared/encodePNG';
import type {InpDocument,InpParameter} from '../inp';
import {evaluateCombined,type CombinedAsset} from '../../../player/src/combinedRuntime';
const capability=()=>({mode:'articulated' as const,reasons:[],stage:'source' as const});
function caps():MotionCapabilities{return {version:1,chains:{'Arm L':capability(),'Arm R':capability(),'Leg L':capability(),'Leg R':capability()},face:{head:capability(),blink:capability(),mouth:capability()},reviewRequired:true};}
function document():InpDocument{return {meta:{canvas:{width:64,height:64}},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[{uuid:1,name:'arm-l',type:'Part',enabled:true,zsort:1,textures:[0],mesh:{verts:[-32,-32,32,-32,-32,32,32,32],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}}]},param:[]};}
describe('prepared regional motion',()=>{
  it('does not enable a limb merely because a layer with its name exists',()=>{
    const doc=document(),marks={shoulderL:{x:16,y:5},elbowL:{x:16,y:25},wristL:{x:16,y:50}};
    const rgba=new Uint8ClampedArray(64*64*4);rgba.set([255,255,255,255],0);
    const result=layerCapabilities(doc,[Buffer.from(encodePNG(rgba,64,64))],marks,caps());expect(result.chains['Arm L'].mode).toBe('fixed');
    rgba.fill(255);const supported=layerCapabilities(doc,[Buffer.from(encodePNG(rgba,64,64))],marks,caps());expect(supported.chains['Arm L'].mode).toBe('articulated');expect(supported.chains['Arm R'].mode).toBe('fixed');
  });
  it('restricts only the chain whose mesh folds and leaves face tracks intact',()=>{
    const doc=document(),zero=Array.from({length:4},()=>[0,0]);
    const parameter:InpParameter={uuid:2,name:'Arm L',is_vec2:true,min:[0,0],max:[1,1],defaults:[0,0],axis_points:[[0,1],[0,1]],merge_mode:'Passthrough',bindings:[{node:1,param_name:'deform',interpolate_mode:'Linear',isSet:[[true,true],[true,true]],values:[[zero,zero],[zero,[[0,0],[-128,0],[0,0],[-128,0]]]]}]};
    const healthy={...structuredClone(parameter),uuid:3,name:'Arm R'};healthy.bindings[0].values=[[zero,zero],[zero,zero]];
    const roll={...structuredClone(healthy),uuid:4,name:'ParamAngleZ'},head={...structuredClone(healthy),uuid:5,name:'Head Angles'};
    doc.param=[parameter,healthy,roll,head];const before=structuredClone([roll,head]);const c=caps();finalizeMotionCapabilities(doc,c);
    expect(c.chains['Arm L'].mode).toBe('limited');expect(doc.param.find(p=>p.name==='Arm L')!.max).toEqual([.5,.5]);expect(doc.param.some(p=>p.name==='Arm R')).toBe(true);expect(doc.param.filter(p=>['ParamAngleZ','Head Angles'].includes(p.name))).toEqual(before);
  });
  it('freezes pitch in the exported keyforms while retaining yaw and roll',()=>{
    const doc=document(),zero=Array.from({length:4},()=>[0,0]),delta=(x:number,y:number)=>zero.map(()=>[x,y]);
    const p:InpParameter={uuid:2,name:'Head Angles',is_vec2:true,min:[-30,-30],max:[30,30],defaults:[0,0],axis_points:[[0,.5,1],[0,.5,1]],merge_mode:'Passthrough',bindings:[{node:1,param_name:'deform',interpolate_mode:'Linear',isSet:Array.from({length:3},()=>[true,true,true]),values:[-10,0,10].map(x=>[-20,0,20].map(y=>delta(x,y)))}]};
    doc.param=[p,{...structuredClone(p),uuid:3,name:'ParamAngleZ'}];const roll=structuredClone(doc.param[1]);
    const asset=():CombinedAsset=>({puppet:doc,parts:doc.nodes.children!,width:64,height:64,textures:[]});
    const expected=evaluateCombined(asset(),{'Head Angles':[18,0],ParamAngleZ:[10,0]});
    const c=caps();c.headAxes={yaw:capability(),pitch:{...capability(),mode:'fixed'},roll:capability()};finalizeMotionCapabilities(doc,c);
    expect(evaluateCombined(asset(),{'Head Angles':[18,30],ParamAngleZ:[10,0]})).toEqual(expected);
    expect(doc.param.find(p=>p.name==='ParamAngleZ')).toEqual(roll);
  });
  it('rejects moving a leg underneath an unbound coat despite a valid leg mesh',()=>{
    const doc=document();doc.nodes.children![0].name='topwear';
    doc.param=[{uuid:2,name:'Leg L',is_vec2:true,min:[-25,0],max:[25,60],defaults:[0,0],axis_points:[[0,1],[0,1]],merge_mode:'Passthrough',bindings:[]}];
    doc.meta.combined={chains:[{name:'Leg L',chain:{root:{x:32,y:4},joint:{x:32,y:30},tip:{x:32,y:60},rootBlend:15.6,jointBlend:11.7},distalSign:1}]};
    const pixels=new Uint8ClampedArray(64*64*4).fill(255),r=attachmentMotionGate(doc,[Buffer.from(encodePNG(pixels,64,64))],'Leg L');
    expect(r.status).toBe('failed');expect(r.maxUnownedDisplacement).toBeGreaterThan(r.tolerance);
    const zeros=Array.from({length:4},()=>[0,0]);
    doc.param[0].bindings=[{node:1,param_name:'deform',interpolate_mode:'Linear',isSet:[[true,true],[true,true]],values:[[zeros,zeros],[zeros,zeros]]}];
    expect(attachmentMotionGate(doc,[Buffer.from(encodePNG(pixels,64,64))],'Leg L').maxSharedFieldError).toBeGreaterThan(r.tolerance);
    doc.param[0].bindings=[];
    pixels.fill(0);expect(attachmentMotionGate(doc,[Buffer.from(encodePNG(pixels,64,64))],'Leg L').status).toBe('passed');
  });
  it('freezes missing expression channels at neutral opacity instead of showing an open patch',()=>{
    const doc=document();doc.nodes.children![0].name='mouth_open';
    doc.param=[{uuid:2,name:'ParamMouthOpenY',is_vec2:false,min:[0,0],max:[1,0],defaults:[0,0],axis_points:[[0,1],[0]],merge_mode:'Passthrough',bindings:[{node:1,param_name:'opacity',interpolate_mode:'Linear',isSet:[[true],[true]],values:[[0],[1]]}]}];
    const asset=():CombinedAsset=>({puppet:doc,parts:doc.nodes.children!,width:64,height:64,textures:[]});const before=evaluateCombined(asset(),{});
    const c=caps();c.face.mouth.mode='fixed';finalizeMotionCapabilities(doc,c);expect(evaluateCombined(asset(),{})).toEqual(before);expect(doc.param).toHaveLength(0);
  });
});
