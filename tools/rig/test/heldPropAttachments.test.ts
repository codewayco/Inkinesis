import {it,expect} from 'vitest';
import {poseHeldProp} from '../heldPropAttachments';
import {poseContinuousLimb,type ContinuousLimb} from '../../../engine/src/body/continuousLimb';
const chain:ContinuousLimb={root:{x:0,y:0},joint:{x:0,y:100},tip:{x:0,y:200},rootBlend:60,jointBlend:45,blendMode:'angle'};
it('keeps the prop wrist contact on the posed wrist and preserves prop distances',()=>{
 const a={x:15,y:220},b={x:80,y:245};
 for(const x of [-30,-11,0,14,30])for(const y of [-60,-23,0,33,60]){
  expect(poseHeldProp(chain.tip,chain,x,y)).toEqual(poseContinuousLimb(chain.tip,chain,x,y));
  const u=poseHeldProp(a,chain,x,y),v=poseHeldProp(b,chain,x,y);
  expect(Math.hypot(u.x-v.x,u.y-v.y)).toBeCloseTo(Math.hypot(a.x-b.x,a.y-b.y),9);
 }
 expect(poseHeldProp(a,chain,0,0)).toEqual(a);
});
