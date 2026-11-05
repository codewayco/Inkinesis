import {it,expect} from 'vitest';
import {adaptiveArmWeights} from '../adaptiveArmWeights';
import {poseContinuousLimb} from '../../../engine/src/body/continuousLimb';
import {encodePNG} from '../../shared/encodePNG';
import type {InpDocument} from '../inp';
import type {MotionCapabilities} from '../../imageToRig/capabilities';
it.each([false,true])('retains the garment veto and does not mutate the rig with expanded hinge search=%s',(adaptiveHingeWidth)=>{
 const chain={root:{x:50,y:30},joint:{x:50,y:150},tip:{x:120,y:100},rootBlend:72,jointBlend:54,blendMode:'angle' as const},verts=[-55,-120,-45,-120,-55,0,-45,0,15,-50,25,-50],w=200,h=300;
 const arm={uuid:1,name:'arm-r',type:'Part',enabled:true,zsort:1,textures:[0],mesh:{verts,uvs:[0,0,1,0,0,.5,1,.5,0,1,1,1],indices:[0,1,2,1,3,2,2,3,4,3,5,4],origin:[0,0]}};
 const top={...arm,uuid:2,name:'topwear',mesh:{verts:[-100,-150,100,-150,-100,150,100,150],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}};
 const puppet:InpDocument={meta:{canvas:{width:w,height:h},combined:{chains:[{name:'Arm R',chain,range:[[-30,-60],[30,60]]}]}},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[arm,top]},param:[{uuid:10,name:'Arm R',is_vec2:true,min:[-30,-60],max:[30,60],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0,.5,1],[0,.5,1]],bindings:[{node:1,param_name:'deform',interpolate_mode:'Linear',isSet:[[true,true,true],[true,true,true],[true,true,true]],values:[-30,0,30].map(x=>[-60,0,60].map(y=>verts.filter((_,i)=>i%2===0).map((_,i)=>{const p={x:verts[2*i]+w/2,y:verts[2*i+1]+h/2},q=poseContinuousLimb(p,chain,x,y);return [q.x-p.x,q.y-p.y];})))}]}]};
 const active=()=>({mode:'articulated' as const,reasons:[],stage:'source' as const}),fixed=()=>({mode:'fixed' as const,reasons:[],stage:'source' as const});
 const caps:MotionCapabilities={version:1,chains:{'Arm L':active(),'Arm R':active(),'Leg L':active(),'Leg R':active()},face:{head:fixed(),blink:fixed(),mouth:fixed()},reviewRequired:true};
 const pixels=new Uint8ClampedArray(w*h*4).fill(255),before=JSON.stringify(puppet),beforeCaps=JSON.stringify(caps);
 const r=adaptiveArmWeights(puppet,[Buffer.from(encodePNG(pixels,w,h))],caps,{adaptiveHingeWidth});
 if(adaptiveHingeWidth){expect(r[0].alternatives).toHaveLength(6);expect(r[0].alternatives?.every(a=>a.range===null)).toBe(true);}
 expect(r).toHaveLength(1);expect(r[0].selected).toBe('unchanged');expect(r[0].axis.range).toBeNull();expect(r[0].bisector.range).toBeNull();expect(JSON.stringify(puppet)).toBe(before);expect(JSON.stringify(caps)).toBe(beforeCaps);
});

it('passes distinct hinge bands through to the actual geometry trial',()=>{
 const chain={root:{x:50,y:30},joint:{x:50,y:150},tip:{x:120,y:100},rootBlend:72,jointBlend:54,blendMode:'angle' as const},w=200,h=300,verts=[-55,-120,-45,-120,-55,0,-45,0,15,-50,25,-50];
 const arm={uuid:1,name:'arm-r',type:'Part',enabled:true,zsort:1,textures:[0],mesh:{verts,uvs:[0,0,1,0,0,.5,1,.5,0,1,1,1],indices:[0,1,2,1,3,2,2,3,4,3,5,4],origin:[0,0]}};
 const puppet:InpDocument={meta:{canvas:{width:w,height:h},combined:{chains:[{name:'Arm R',chain,range:[[-30,-60],[30,60]]}]}},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[arm]},param:[{uuid:10,name:'Arm R',is_vec2:true,min:[-30,-60],max:[30,60],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0,.5,1],[0,.5,1]],bindings:[{node:1,param_name:'deform',interpolate_mode:'Linear',isSet:[[true,true,true],[true,true,true],[true,true,true]],values:[-30,0,30].map(x=>[-60,0,60].map(y=>verts.filter((_,i)=>i%2===0).map((_,i)=>{const p={x:verts[2*i]+w/2,y:verts[2*i+1]+h/2},q=poseContinuousLimb(p,chain,x,y);return [q.x-p.x,q.y-p.y];})))}]}]};
 const active=()=>({mode:'articulated' as const,reasons:[],stage:'source' as const}),fixed=()=>({mode:'fixed' as const,reasons:[],stage:'source' as const});
 const caps:MotionCapabilities={version:1,chains:{'Arm L':active(),'Arm R':active(),'Leg L':active(),'Leg R':active()},face:{head:fixed(),blink:fixed(),mouth:fixed()},reviewRequired:true};
 const r=adaptiveArmWeights(puppet,[Buffer.from(encodePNG(new Uint8ClampedArray(w*h*4).fill(255),w,h))],caps,{adaptiveHingeWidth:true});
 const tried=r[0].alternatives!;expect(tried.every(t=>Number.isFinite(t.area))).toBe(true);
 expect(new Set(tried.map(t=>JSON.stringify([t.area,t.range]))).size).toBeGreaterThan(1);
});
