import {it,expect} from 'vitest';
import {optimizeLimbWidths} from '../optimizeLimbWidths';
import {encodePNG} from '../../shared/encodePNG';
import {poseContinuousLimb} from '../../../engine/src/body/continuousLimb';
import {combinedMeshGate} from '../combinedMeshGate';
import {evaluateCombined} from '../../../player/src/combinedRuntime';
import type {InpDocument,InpNode} from '../inp';
function fixture(occluded=false,alpha=255){
 const width=200,height=240,chain={root:{x:100,y:30},joint:{x:100,y:110},tip:{x:130,y:210},rootBlend:48,jointBlend:36,blendMode:'angle' as const};
 const verts:number[]=[],uvs:number[]=[],indices:number[]=[];
 for(let row=0;row<=19;row++)for(let col=0;col<2;col++){verts.push(100+(col-.5)*(10+60*Math.exp(-(((row-8)/3)**2)))+Math.max(0,row*10-80)*.3-width/2,30+row*10-height/2);uvs.push(col,row/19);}
 for(let row=0;row<19;row++){const a=row*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
 const arm:InpNode={uuid:1,name:'arm-r',type:'Part',enabled:true,zsort:1,textures:[0],mesh:{verts,uvs,indices,origin:[0,0]}};
 const face:InpNode={uuid:3,name:'face',type:'Part',enabled:true,zsort:3,textures:[0],mesh:{verts:[-20,-115,20,-115,0,-95],uvs:[0,0,1,0,.5,1],indices:[0,1,2],origin:[0,0]}};
 const children=[arm,face];
 if(occluded)children.push({uuid:2,name:'topwear',type:'Part',enabled:true,zsort:2,textures:[0],mesh:{verts:[-100,-120,100,-120,-100,120,100,120],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}});
 const grid=Array.from({length:13},(_,i)=>i/12);
 const doc:InpDocument={meta:{canvas:{width,height},combined:{chains:[{name:'Arm R',chain}]}},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children},param:[{uuid:10,name:'Arm R',is_vec2:true,min:[-20,-40],max:[20,40],defaults:[0,0],merge_mode:'Passthrough',axis_points:[grid,grid],bindings:[{node:1,param_name:'deform',interpolate_mode:'Linear',isSet:grid.map(()=>grid.map(()=>true)),values:grid.map(t=>grid.map(u=>verts.filter((_,i)=>i%2===0).map((_,i)=>{const p={x:verts[2*i]+width/2,y:verts[2*i+1]+height/2},q=poseContinuousLimb(p,chain,-20+40*t,-40+80*u);return [q.x-p.x,q.y-p.y];})))}]}]};
 const rgba=new Uint8ClampedArray(8*8*4).fill(255);for(let i=3;i<rgba.length;i+=4)rgba[i]=alpha;
 return {doc,textures:[Buffer.from(encodePNG(rgba,8,8))],asset:(puppet:InpDocument)=>({puppet,parts:children,width,height,textures:[]})};
}
it('improves a visible source strip without changing ranges, wrist material, face, or topology',()=>{
 const {doc,textures,asset}=fixture(),before=structuredClone(doc),result=optimizeLimbWidths(doc,textures);
 expect(result[0].selected).not.toBeNull();expect(doc.nodes).toEqual(before.nodes);
 expect(doc.param[0].min).toEqual(before.param[0].min);expect(doc.param[0].max).toEqual(before.param[0].max);
 expect(combinedMeshGate(doc).status).toBe('passed');
 for(const x of [-17.29,3.17,19.38])for(const y of [-37.8,11.7,38.3]){
  const old=evaluateCombined(asset(before),{'Arm R':[x,y]}),next=evaluateCombined(asset(doc),{'Arm R':[x,y]});
  expect(next[1]).toEqual(old[1]);
  // Last two rows are distal hand material, held rigid under either field.
  for(let i=72;i<80;i++)expect(next[0].xy[i]).toBeCloseTo(old[0].xy[i],8);
 }
});
it('keeps an unchanged document when the original garment attachment veto rejects every proposal',()=>{
 const {doc,textures}=fixture(true),before=JSON.stringify(doc),result=optimizeLimbWidths(doc,textures);
 expect(result[0].selected).toBeNull();expect(JSON.stringify(doc)).toBe(before);
 expect(result[0].attempts?.some(a=>'reason' in a&&a.reason==='Existing garment attachment gate failed')).toBe(true);
});
it('does not optimize or emit nonfinite diagnostics for fully transparent artwork',()=>{
 const {doc,textures}=fixture(false,0),before=JSON.stringify(doc),result=optimizeLimbWidths(doc,textures);
 expect(JSON.stringify(doc)).toBe(before);expect(result[0].selected).toBeNull();
 expect(result[0]).toHaveProperty('reason','No alpha-supported source triangles');
});
