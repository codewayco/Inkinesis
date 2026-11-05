import {expect,it} from 'vitest';
import {poseContinuousLimb,type ContinuousLimb} from '../src/body/continuousLimb';
const c:ContinuousLimb={root:{x:0,y:0},joint:{x:0,y:100},tip:{x:0,y:200},rootBlend:50,jointBlend:20,blendMode:'angle',rootMode:'radial'};
it('radial shoulder-only map preserves local area through the transition',()=>{
 for(const angle of [-30,30])for(const p of [{x:5,y:8},{x:-15,y:12},{x:25,y:30}]){
  const h=1e-3,dx1=poseContinuousLimb({x:p.x+h,y:p.y},c,angle,0),dx0=poseContinuousLimb({x:p.x-h,y:p.y},c,angle,0),dy1=poseContinuousLimb({x:p.x,y:p.y+h},c,angle,0),dy0=poseContinuousLimb({x:p.x,y:p.y-h},c,angle,0);
  const det=((dx1.x-dx0.x)*(dy1.y-dy0.y)-(dy1.x-dy0.x)*(dx1.y-dx0.y))/(4*h*h);expect(det).toBeCloseTo(1,6);
 }
});
it('keeps the shoulder pivot fixed and the distant wrist fully articulated',()=>{
 expect(poseContinuousLimb(c.root,c,30,0)).toEqual(c.root);
 expect(poseContinuousLimb(c.tip,c,30,45)).toEqual(poseContinuousLimb(c.tip,{...c,rootMode:'rigid'},30,45));
});
it('retains the complete prior articulated map on a protected garment boundary',()=>{
 const prior={...c,rootMode:undefined,weightMode:'bisector' as const};
 const q={x:18,y:25};const next={...prior,rootMode:'radial' as const,radialRadius:10,rootBoundary:{points:[q],fixedRadius:4,blendRadius:30}};
 for(const p of [q,{x:20,y:26}])for(const root of [-30,0,30])for(const elbow of [-60,0,60])expect(poseContinuousLimb(p,next,root,elbow)).toEqual(poseContinuousLimb(p,prior,root,elbow));
});
it('keeps the radial shoulder radius independent of the preserved prior field',()=>{
 const prior={...c,rootMode:undefined};const next={...prior,rootMode:'radial' as const,radialRadius:10,rootBoundary:{points:[{x:0,y:0}],fixedRadius:2,blendRadius:10}};
 expect(poseContinuousLimb({x:0,y:25},next,30,0)).toEqual(poseContinuousLimb({x:0,y:25},{...prior,rootMode:'rigid'},30,0));
 expect(poseContinuousLimb(c.tip,next,30,45)).toEqual(poseContinuousLimb(c.tip,prior,30,45));
});
