import {it,expect} from 'vitest';import {armGarmentCoverage} from '../armGarmentCoverage';
for(const scale of [1,2])it(`distinguishes a torso-edge intersection from a sleeve at scale ${scale}`,()=>{
 const w=100*scale,h=200*scale,arm=new Uint8ClampedArray(w*h*4),edge=new Uint8ClampedArray(w*h*4),sleeve=new Uint8ClampedArray(w*h*4);
 for(let y=20*scale;y<120*scale;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4+3;if(x>=35*scale&&x<=55*scale)arm[i]=255;if(x>=50*scale)edge[i]=255;if(x>=30*scale&&x<=70*scale)sleeve[i]=255;}
 const chain={root:{x:50*scale,y:20*scale},joint:{x:50*scale,y:120*scale},tip:{x:50*scale,y:180*scale},rootBlend:60*scale,jointBlend:45*scale},p={x:50*scale,y:70*scale};const e=armGarmentCoverage(edge,arm,w,h,chain,p),s=armGarmentCoverage(sleeve,arm,w,h,chain,p);
 expect(e.pointCovered).toBe(true);expect(e.reliable).toBe(true);expect(e.substantial).toBe(false);expect(s.substantial).toBe(true);
});
it('preserves the conservative point check when the prepared arm is missing',()=>{
 const w=100,h=200,g=new Uint8ClampedArray(w*h*4).fill(255),chain={root:{x:50,y:20},joint:{x:50,y:120},tip:{x:50,y:180},rootBlend:60,jointBlend:45};const r=armGarmentCoverage(g,new Uint8ClampedArray(g.length),w,h,chain,{x:50,y:70});expect(r.reliable).toBe(false);expect(r.substantial).toBe(true);
});
it('does not treat hidden off-axis arm padding alone as a new sleeve witness',()=>{
 const w=100,h=200,arm=new Uint8ClampedArray(w*h*4),garment=new Uint8ClampedArray(w*h*4);
 for(let y=20;y<120;y++)for(let x=20;x<80;x++){const i=(y*w+x)*4+3;if(x>=35&&x<=55)arm[i]=255;if(x<50)garment[i]=255;}
 const chain={root:{x:50,y:20},joint:{x:50,y:120},tip:{x:50,y:180},rootBlend:60,jointBlend:45},r=armGarmentCoverage(garment,arm,w,h,chain,{x:50,y:70});expect(r.fraction).toBeGreaterThan(.5);expect(r.pointCovered).toBe(false);expect(r.substantial).toBe(false);
});
