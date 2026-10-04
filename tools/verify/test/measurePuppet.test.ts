import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {darkEdgeFringe,measurePuppet,sourceFigure} from '../measurePuppet';
import {writeInp,type InpDocument} from '../../rig/inp';
import {encodePNG} from '../../shared/encodePNG';

/** A dark square on a transparent canvas, optionally with a white ring along its edge. */
function square(ring:boolean) {
  const w=40,h=40,rgba=new Uint8ClampedArray(w*h*4);
  for(let y=8;y<32;y++)for(let x=8;x<32;x++){
    const i=(y*w+x)*4,outer=x===8||y===8||x===31||y===31;
    const v=ring&&outer?250:60;rgba[i]=rgba[i+1]=rgba[i+2]=v;rgba[i+3]=255;
  }
  return {rgba,w,h};
}

describe('render evidence',()=>{
  it('counts a light backdrop ring on a dark background and not a clean edge',()=>{
    const clean=square(false),fringe=square(true);
    expect(darkEdgeFringe(clean.rgba,clean.w,clean.h).fringePixels).toBe(0);
    // The white ring pixels next to the dark artwork count.
    expect(darkEdgeFringe(fringe.rgba,fringe.w,fringe.h).fringePixels).toBeGreaterThan(80);
  });
  it('removes frames of an earlier render that this render does not write',()=>{
    const home=mkdtempSync(join(tmpdir(),'measure-')),frames=join(home,'frames');
    const {rgba,w,h}=square(false);
    const doc:InpDocument={meta:{canvas:{width:w,height:h}},nodes:{name:'root',uuid:0,type:'Node',enabled:true,zsort:0,children:[
      {name:'topwear',uuid:1,type:'Part',enabled:true,zsort:1,textures:[0],mesh:{verts:[-20,-20,20,-20,-20,20,20,20],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}}]},param:[]};
    writeFileSync(join(home,'c.inp'),writeInp(doc,[Buffer.from(encodePNG(rgba,w,h))]));
    const xy=[-20,-20,20,-20,-20,20,20,20];
    writeFileSync(join(home,'poses.json'),JSON.stringify({frames:[{label:'rest',parameter:'',value:0,parts:[{uuid:1,name:'topwear',xy}]}]}));
    writeFileSync(join(home,'source.png'),Buffer.from(encodePNG(rgba,w,h)));
    measurePuppet(join(home,'c.inp'),join(home,'poses.json'),join(home,'source.png'),frames);
    writeFileSync(join(frames,'Arm_R_max.png'),'stale');
    const report=measurePuppet(join(home,'c.inp'),join(home,'poses.json'),join(home,'source.png'),frames);
    expect(existsSync(join(frames,'Arm_R_max.png'))).toBe(false);
    expect(readdirSync(frames).sort()).toEqual(['measurement.json','rest.png']);
    expect(report.rest.darkEdgeFringe.fringePixels).toBe(0);
  });
});

describe('source figure',()=>{
  it('keeps white artwork of a transparent drawing, and drops near-white backdrop of an opaque one',()=>{
    const transparent=new Uint8ClampedArray([255,255,255,255, 0,0,0,0]);
    expect(sourceFigure(transparent)(250,250,250,255)).toBe(true);
    expect(sourceFigure(transparent)(0,0,0,0)).toBe(false);
    const opaque=new Uint8ClampedArray([255,255,255,255, 30,30,30,255]);
    expect(sourceFigure(opaque)(250,250,250,255)).toBe(false);
    expect(sourceFigure(opaque)(30,30,30,255)).toBe(true);
  });
});
