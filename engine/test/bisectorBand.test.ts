import {it,expect} from 'vitest';
import {continuousLimbWeights,poseContinuousLimb,type ContinuousLimb} from '../src/body/continuousLimb';
const chain:ContinuousLimb={root:{x:0,y:0},joint:{x:0,y:100},tip:{x:80,y:100},rootBlend:60,jointBlend:45,blendMode:'angle',weightMode:'bisector'};
it('preserves legacy weights exactly when the optional cap is omitted',()=>{
 for(let x=-50;x<=110;x+=10)for(let y=0;y<=160;y+=10){const p={x,y};expect(poseContinuousLimb(p,chain,21.3,-37.2)).toEqual(poseContinuousLimb(p,{...chain,bisectorBandFraction:.45},21.3,-37.2));}
});
it('can spread the hinge transition while keeping a supported wrist fully articulated',()=>{
 const wide={...chain,bisectorBandFraction:1.3},p={x:-30,y:90};
 expect(continuousLimbWeights(p,chain).distal).toBe(0);
 expect(continuousLimbWeights(p,wide).distal).toBeGreaterThan(0);
 expect(continuousLimbWeights(chain.tip,wide)).toEqual({root:1,distal:1});
 expect(poseContinuousLimb(p,wide,0,0)).toEqual(p);
 const wrist=poseContinuousLimb(chain.tip,wide,0,90);expect(wrist.x).toBeCloseTo(0,9);expect(wrist.y).toBeCloseTo(180,9);
});
it('keeps value and first derivative continuous at both widened band boundaries',()=>{
 const wide={...chain,bisectorBandFraction:1.3},q=(s:number)=>poseContinuousLimb({x:s/Math.SQRT2,y:100+s/Math.SQRT2},wide,0,40),h=1e-4;
 for(const s of [-45,45]){const a=q(s-h),m=q(s),c=q(s+h);expect(Math.hypot(c.x-a.x,c.y-a.y)).toBeLessThan(.001);expect(Math.hypot((c.x-m.x)/h-(m.x-a.x)/h,(c.y-m.y)/h-(m.y-a.y)/h)).toBeLessThan(.0001);}
});
it.each([0,-1,NaN,Infinity])('rejects invalid explicit band fraction %s',(fraction)=>{
 expect(()=>continuousLimbWeights(chain.tip,{...chain,bisectorBandFraction:fraction})).toThrow('Positive finite');
});
