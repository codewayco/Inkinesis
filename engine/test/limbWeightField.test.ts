import {it,expect} from 'vitest';
import {buildLimbWeightField,sampleLimbWeightField} from '../src/body/limbWeightField';
import {poseContinuousLimb,type ContinuousLimb} from '../src/body/continuousLimb';
it('follows a folded alpha path instead of jumping the transparent gap',()=>{
 const W=100,H=110,rgba=new Uint8Array(W*H*4);
 for(let y=10;y<95;y++)for(let x=10;x<55;x++)if(x<25||x>=40||y>=75)rgba[(y*W+x)*4+3]=255;
 const c:ContinuousLimb={root:{x:17,y:15},joint:{x:32,y:85},tip:{x:47,y:15},rootBlend:25,jointBlend:15,blendMode:'angle'};
 c.weightField=buildLimbWeightField(rgba,W,H,c,1);
 expect(c.weightField.pathToTip).toBeGreaterThan(140);
 expect(sampleLimbWeightField(c.root,c.weightField).root).toBeCloseTo(0,8);
 expect(sampleLimbWeightField(c.tip,c.weightField).distal).toBe(1);
 expect(sampleLimbWeightField({x:18,y:35},c.weightField).distal).toBe(0);
 const moved=poseContinuousLimb(c.tip,c,0,30);expect(Math.hypot(moved.x-c.tip.x,moved.y-c.tip.y)).toBeGreaterThan(30);
});
it('rejects disconnected or empty support rather than inventing a connection',()=>{
 const rgba=new Uint8Array(20*20*4),c:ContinuousLimb={root:{x:1,y:1},joint:{x:5,y:5},tip:{x:10,y:10},rootBlend:2,jointBlend:2};
 expect(()=>buildLimbWeightField(rgba,20,20,c)).toThrow('Empty');
 rgba[(1*20+1)*4+3]=255;rgba[(10*20+10)*4+3]=255;
 expect(()=>buildLimbWeightField(rgba,20,20,c,1)).toThrow('path');
});
