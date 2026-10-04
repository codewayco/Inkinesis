import {attachmentMotionGate} from '../attachmentMotionGate';
import {describe,it,expect} from 'vitest';
import {layerCapabilities,finalizeMotionCapabilities,heldProp} from '../motionCapabilities';
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
  it('lets a thigh swing under a static skirt but not slide out of a static shorts tube',()=>{
    const W=100,H=200,quad={verts:[-W/2,-H/2,W/2,-H/2,-W/2,H/2,W/2,H/2],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]};
    const image=(inside:(x:number,y:number)=>boolean)=>{const px=new Uint8ClampedArray(W*H*4);for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(inside(x,y))px.set([200,150,120,255],(y*W+x)*4);return Buffer.from(encodePNG(px,W,H));};
    const doc=(garment:(x:number,y:number)=>boolean)=>{
      const d:InpDocument={meta:{canvas:{width:W,height:H},combined:{chains:[{name:'Leg L',parts:['legwear-l'],chain:{root:{x:50,y:40},joint:{x:50,y:120},tip:{x:50,y:190},rootBlend:48,jointBlend:36},distalSign:1}]}},
        nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[{uuid:1,name:'legwear-l',type:'Part',enabled:true,zsort:1,textures:[0],mesh:structuredClone(quad)},{uuid:2,name:'bottomwear',type:'Part',enabled:true,zsort:2,textures:[1],mesh:structuredClone(quad)}]},
        param:[{uuid:3,name:'Leg L',is_vec2:true,min:[-25,0],max:[25,60],defaults:[0,0],axis_points:[[0,1],[0,1]],merge_mode:'Passthrough',bindings:[]}]};
      return {d,textures:[image((x,y)=>x>=40&&x<60&&y>=40&&y<190),image(garment)]};
    };
    const skirt=doc((x,y)=>y>=30&&y<100&&x>=5&&x<95),skirtCheck=attachmentMotionGate(skirt.d,skirt.textures,'Leg L');
    expect(skirtCheck.status).toBe('passed');expect(skirtCheck.maxExposedHiddenLeg).toBeLessThanOrEqual(skirtCheck.exposureAllowance!);
    const tube=doc((x,y)=>y>=30&&y<100&&x>=37&&x<63),tubeCheck=attachmentMotionGate(tube.d,tube.textures,'Leg L');
    expect(tubeCheck.status).toBe('failed');expect(tubeCheck.maxExposedHiddenLeg).toBeGreaterThan(tubeCheck.exposureAllowance!);
  });
  it('lets a long thigh swing out below a skirt that covers both legs, but not out of a tube that leaves the gap open',()=>{
    const W=200,H=300,quad={verts:[-W/2,-H/2,W/2,-H/2,-W/2,H/2,W/2,H/2],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]};
    const image=(inside:(x:number,y:number)=>boolean)=>{const px=new Uint8ClampedArray(W*H*4);for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(inside(x,y))px.set([200,150,120,255],(y*W+x)*4);return Buffer.from(encodePNG(px,W,H));};
    const leg=(x0:number)=>({root:{x:x0,y:60},joint:{x:x0,y:170},tip:{x:x0,y:280},rootBlend:48,jointBlend:36});
    const doc=(garment:(x:number,y:number)=>boolean)=>{
      const d:InpDocument={meta:{canvas:{width:W,height:H},combined:{chains:[{name:'Leg L',parts:['legwear-l'],chain:leg(120),distalSign:1},{name:'Leg R',parts:['legwear-r'],chain:leg(80),distalSign:1}]}},
        nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[{uuid:1,name:'legwear-l',type:'Part',enabled:true,zsort:1,textures:[0],mesh:structuredClone(quad)},{uuid:2,name:'bottomwear',type:'Part',enabled:true,zsort:2,textures:[1],mesh:structuredClone(quad)}]},
        param:[{uuid:3,name:'Leg L',is_vec2:true,min:[-25,0],max:[25,60],defaults:[0,0],axis_points:[[0,1],[0,1]],merge_mode:'Passthrough',bindings:[]}]};
      // The leg layer starts part-way under the garment, well below the hip pivot.
      return {d,textures:[image((x,y)=>x>=108&&x<132&&y>=100&&y<280),image(garment)]};
    };
    const skirt=doc((x,y)=>y>=40&&y<150&&x>=40&&x<160);
    expect(attachmentMotionGate(skirt.d,skirt.textures,'Leg L').status).toBe('passed');
    const tube=doc((x,y)=>y>=40&&y<150&&x>=104&&x<136);
    expect(attachmentMotionGate(tube.d,tube.textures,'Leg L').status).toBe('failed');
  });
  it('freezes missing expression channels at neutral opacity instead of showing an open patch',()=>{
    const doc=document();doc.nodes.children![0].name='mouth_open';
    doc.param=[{uuid:2,name:'ParamMouthOpenY',is_vec2:false,min:[0,0],max:[1,0],defaults:[0,0],axis_points:[[0,1],[0]],merge_mode:'Passthrough',bindings:[{node:1,param_name:'opacity',interpolate_mode:'Linear',isSet:[[true],[true]],values:[[0],[1]]}]}];
    const asset=():CombinedAsset=>({puppet:doc,parts:doc.nodes.children!,width:64,height:64,textures:[]});const before=evaluateCombined(asset(),{});
    const c=caps();c.face.mouth.mode='fixed';finalizeMotionCapabilities(doc,c);expect(evaluateCombined(asset(),{})).toEqual(before);expect(doc.param).toHaveLength(0);
  });
  it('finds a prop held at the fingertips, a thin stick through the fist, and ignores a seat under the hand',()=>{
    const W=200,H=200,img=()=>new Uint8ClampedArray(W*H*4),fill=(a:Uint8ClampedArray,x0:number,y0:number,x1:number,y1:number)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)a[(y*W+x)*4+3]=255;};
    const elbow={x:100,y:20},wrist={x:100,y:60};
    // Arm down to the wrist, a long hand whose fingertips end 45 px below it.
    const arm=img();fill(arm,92,0,108,60);fill(arm,90,60,110,105);
    const fan=img();fill(fan,85,105,140,150);
    expect(heldProp(arm,fan,W,H,elbow,wrist)?.contact).toBeGreaterThan(20);
    // A 3 px stick crossing a fist: little area, but it touches the hand along its length.
    const stick=img();fill(stick,40,80,160,83);
    const fist=img();fill(fist,92,0,108,60);fill(fist,80,60,120,100);
    expect(heldProp(fist,stick,W,H,elbow,wrist)).not.toBeNull();
    // A bench far larger than the hand, touched only along its top edge.
    const bench=img();fill(bench,20,106,200,200);
    expect(heldProp(arm,bench,W,H,elbow,wrist)).toBeNull();
    // The same piece held at its middle is a prop (a cello and its bow).
    const cello=img();fill(cello,20,70,200,200);
    expect(heldProp(arm,cello,W,H,elbow,wrist)).not.toBeNull();
  });
  it('keeps an arm still when its hand holds a static prop',()=>{
    const doc=document(),marks={shoulderL:{x:16,y:5},elbowL:{x:16,y:25},wristL:{x:16,y:50}};
    const full=new Uint8ClampedArray(64*64*4).fill(255);
    const prop=new Uint8ClampedArray(64*64*4);for(let y=44;y<60;y++)for(let x=8;x<24;x++)prop.set([200,100,50,255],(y*64+x)*4);
    doc.nodes.children!.push({uuid:2,name:'objects',type:'Part',enabled:true,zsort:2,textures:[1],mesh:{verts:[-32,-32,32,-32,-32,32,32,32],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}});
    const held=layerCapabilities(doc,[Buffer.from(encodePNG(full,64,64)),Buffer.from(encodePNG(prop,64,64))],marks,caps());
    expect(held.chains['Arm L'].mode).toBe('fixed');expect(held.chains['Arm L'].reasons.at(-1)).toContain('holds a prop');
    const away=new Uint8ClampedArray(64*64*4);for(let y=0;y<8;y++)for(let x=50;x<64;x++)away.set([200,100,50,255],(y*64+x)*4);
    // arm pixels only near the arm: a prop far from the hand does not restrict it
    const arm=new Uint8ClampedArray(64*64*4);for(let y=0;y<64;y++)for(let x=8;x<24;x++)arm.set([255,255,255,255],(y*64+x)*4);
    const free=layerCapabilities(doc,[Buffer.from(encodePNG(arm,64,64)),Buffer.from(encodePNG(away,64,64))],marks,caps());
    expect(free.chains['Arm L'].mode).toBe('articulated');
  });
});
