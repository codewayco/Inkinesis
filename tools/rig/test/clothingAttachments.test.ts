import {describe,it,expect} from 'vitest';
import {clothingAttachments} from '../clothingAttachments';
import {encodePNG} from '../../shared/encodePNG';
import {inpParts,type InpDocument} from '../inp';
import {poseContinuousLimb} from '../../../engine/src/body/continuousLimb';
function fixture(scale:number,separated:boolean){
 const w=200*scale,h=300*scale,pixels=new Uint8ClampedArray(w*h*4);
 for(let y=100*scale;y<260*scale;y++)for(let x=55*scale;x<145*scale;x++)if(!separated||y<135*scale||x<90*scale||x>110*scale){const i=(y*w+x)*4;pixels.set([90,130,180,255],i);}
 const point=(x:number,y:number)=>({x:x*scale,y:y*scale});
 const marks:Record<string,{x:number;y:number}>={hipL:point(128,110),hipR:point(72,110),kneeL:point(132,200),kneeR:point(68,200),ankleL:point(137,285),ankleR:point(63,285)};
 const chains=(['L','R'] as const).map(side=>({name:'Leg '+side,distalSign:side==='L'?1:-1,chain:{root:marks['hip'+side],joint:marks['knee'+side],tip:marks['ankle'+side],rootBlend:54*scale,jointBlend:40*scale}}));
 const puppet:InpDocument={meta:{canvas:{width:w,height:h},combined:{chains}},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[{uuid:1,name:'bottomwear',type:'Part',enabled:true,zsort:1,textures:[0],mesh:{verts:[-w/2,-h/2,w/2,-h/2,-w/2,h/2,w/2,h/2],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}}]},param:chains.map((c,i)=>({uuid:i+10,name:c.name,is_vec2:true,min:[-25,0],max:[25,60],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0,.5,1],[0,.5,1]],bindings:[]}))};
 return {puppet,textures:[Buffer.from(encodePNG(pixels,w,h))],marks,chains,w,h};
}
describe('alpha-supported garment ownership',()=>{
 it('does not pretend that a skirt is two visible trouser legs',()=>{
  const f=fixture(1,false),before=structuredClone(f.puppet.nodes);const report=clothingAttachments(f.puppet,f.textures,f.marks);
  expect(report.parts[0].status).toBe('retained');expect(f.puppet.nodes).toEqual(before);expect(f.puppet.param.every(p=>p.bindings.length===0)).toBe(true);
 });
 it('can attach one leg while retaining the other clothing pixels at rest',()=>{
  const f=fixture(1,true);f.puppet.param=f.puppet.param.filter(p=>p.name==='Leg L');
  const report=clothingAttachments(f.puppet,f.textures,f.marks);expect(report.parts[0].status).toBe('partitioned');
  expect(f.puppet.param).toHaveLength(1);expect(f.puppet.param[0].bindings.length).toBeGreaterThan(0);
  expect(inpParts(f.puppet).some(n=>n.name==='bottomwear__torso')).toBe(true);
  expect(inpParts(f.puppet).some(n=>n.name==='bottomwear__Leg_R')).toBe(false);
 });
 for(const scale of [.5,1,2])it(`attaches separated trousers to the exact skin field at scale ${scale}`,()=>{
  const f=fixture(scale,true),report=clothingAttachments(f.puppet,f.textures,f.marks);expect(report.parts[0].status).toBe('partitioned');
  for(const [k,param] of f.puppet.param.entries()){
   const binding=param.bindings[0],part=inpParts(f.puppet).find(p=>p.uuid===binding.node)!;expect(part.name).toContain(param.name.replace(' ','_'));
   for(let i=0;i<part.mesh!.verts.length;i+=2){const p={x:part.mesh!.verts[i]+f.w/2,y:part.mesh!.verts[i+1]+f.h/2},q=poseContinuousLimb(p,f.chains[k].chain,25,60*f.chains[k].distalSign);expect((binding.values[2][2] as number[][])[i/2]).toEqual([q.x-p.x,q.y-p.y]);expect((binding.values[1][0] as number[][])[i/2]).toEqual([0,0]);}
  }
 });
});
