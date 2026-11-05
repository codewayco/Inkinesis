import {describe,it,expect} from 'vitest';
import {continuousLimbWeights,poseContinuousLimb,type ContinuousLimb} from '../src/body/continuousLimb';
const chain:ContinuousLimb={root:{x:0,y:0},joint:{x:0,y:100},tip:{x:0,y:200},rootBlend:60,jointBlend:20,blendMode:'angle'};
describe('optional linear hinge profile',()=>{
 it('uses a linear interior ramp with the same zero/full support as smoothstep',()=>{const c={...chain,hingeProfile:'linear' as const};expect(continuousLimbWeights({x:0,y:90},c).distal).toBe(.25);expect(continuousLimbWeights({x:0,y:110},c).distal).toBe(.75);for(const y of [0,60,80,120,200])expect(continuousLimbWeights({x:0,y},c)).toEqual(continuousLimbWeights({x:0,y},chain));});
 it('keeps full distal FK and neutral geometry independent of ramp choice',()=>{for(const profile of ['linear','smoothstep'] as const){const c={...chain,hingeProfile:profile};expect(poseContinuousLimb({x:0,y:200},c,0,90).x).toBeCloseTo(-100);expect(poseContinuousLimb({x:3,y:97},c,0,0)).toEqual({x:3,y:97});}});
});
