import {describe,it,expect} from 'vitest';import {continuousLimbWeights,poseContinuousLimb,type ContinuousLimb} from '../src/body/continuousLimb';
describe('bisector field for a folded knee',()=>{
 const c:ContinuousLimb={root:{x:0,y:0},joint:{x:70,y:100},tip:{x:30,y:40},rootBlend:70,jointBlend:45,weightMode:'bisector',blendMode:'angle'};
 it('pins the hip and gives the ankle the full composed rigid motion',()=>{expect(continuousLimbWeights(c.root,c)).toEqual({root:0,distal:0});expect(continuousLimbWeights(c.tip,c)).toEqual({root:1,distal:1});expect(poseContinuousLimb(c.root,c,5,16)).toEqual(c.root);const a=poseContinuousLimb(c.tip,c,0,16);expect(Math.hypot(a.x-c.joint.x,a.y-c.joint.y)).toBeCloseTo(Math.hypot(c.tip.x-c.joint.x,c.tip.y-c.joint.y),10);});
 it('keeps the blend continuous around the hinge',()=>{const a=poseContinuousLimb({x:70-1e-7,y:100},c,5,16),b=poseContinuousLimb({x:70+1e-7,y:100},c,5,16);expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(1e-5);});
});
