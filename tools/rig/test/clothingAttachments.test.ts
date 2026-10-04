import {describe,it,expect} from 'vitest';
import {clothingAttachments,legWeight,legFork,type LegBlend} from '../clothingAttachments';
import {attachmentMotionGate} from '../attachmentMotionGate';
import {combinedMeshGate} from '../combinedMeshGate';
import {evaluateCombined} from '../../../player/src/combinedRuntime';
import {encodePNG} from '../../shared/encodePNG';
import {inpParts,type InpDocument} from '../inp';
import {poseContinuousLimb} from '../../../engine/src/body/continuousLimb';
function fixture(scale:number,separated:boolean,bottom=260){
 const w=200*scale,h=300*scale,pixels=new Uint8ClampedArray(w*h*4);
 for(let y=100*scale;y<bottom*scale;y++)for(let x=55*scale;x<145*scale;x++)if(!separated||y<135*scale||x<90*scale||x>110*scale){const i=(y*w+x)*4;pixels.set([90,130,180,255],i);}
 const point=(x:number,y:number)=>({x:x*scale,y:y*scale});
 const marks:Record<string,{x:number;y:number}>={hipL:point(128,110),hipR:point(72,110),kneeL:point(132,200),kneeR:point(68,200),ankleL:point(137,285),ankleR:point(63,285)};
 const chains=(['L','R'] as const).map(side=>({name:'Leg '+side,distalSign:side==='L'?1:-1,chain:{root:marks['hip'+side],joint:marks['knee'+side],tip:marks['ankle'+side],rootBlend:54*scale,jointBlend:40*scale}}));
 const puppet:InpDocument={meta:{canvas:{width:w,height:h},combined:{chains}},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[{uuid:1,name:'bottomwear',type:'Part',enabled:true,zsort:1,textures:[0],mesh:{verts:[-w/2,-h/2,w/2,-h/2,-w/2,h/2,w/2,h/2],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}}]},param:chains.map((c,i)=>({uuid:i+10,name:c.name,is_vec2:true,min:[-25,0],max:[25,60],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0,.5,1],[0,.5,1]],bindings:[]}))};
 return {puppet,textures:[Buffer.from(encodePNG(pixels,w,h))],marks,chains,w,h};
}
describe('alpha-supported garment ownership',()=>{
 it('keeps the underlying leg and its trouser tube on the same field through the crotch blend',()=>{
  const f=fixture(1,true);
  const leg={...structuredClone(f.puppet.nodes.children![0]),uuid:2,name:'legwear-l',zsort:0};
  leg.mesh!.verts=[15,-15,30,-15,15,5,30,5];
  f.puppet.nodes.children!.push(leg);
  f.puppet.param[0].bindings.push({node:2,param_name:'deform',interpolate_mode:'Linear',isSet:[[true,true,true],[true,true,true],[true,true,true]],values:[-25,0,25].map(x=>[0,30,60].map(y=>{
   const v=leg.mesh!.verts;return Array.from({length:v.length/2},(_,i)=>{const p={x:v[i*2]+f.w/2,y:v[i*2+1]+f.h/2},q=poseContinuousLimb(p,f.chains[0].chain,x,y);return [q.x-p.x,q.y-p.y];});
  }))});
  const report=clothingAttachments(f.puppet,f.textures,f.marks);
  const blend=(report.parts[0] as {legBlend:LegBlend}).legBlend;
  for(const [j,param] of f.puppet.param.entries()){
   const b=param.bindings.find(b=>b.node===2&&b.param_name==='deform');expect(b).toBeDefined();
   for(let i=0;i<leg.mesh!.verts.length;i+=2){
    const p={x:leg.mesh!.verts[i]+f.w/2,y:leg.mesh!.verts[i+1]+f.h/2},q=poseContinuousLimb(p,f.chains[j].chain,25,60*f.chains[j].distalSign),w=legWeight(p,blend,param.name.at(-1) as 'L'|'R','L');
    expect((b!.values[2][2] as number[][])[i/2]).toEqual([(q.x-p.x)*w,(q.y-p.y)*w]);
   }
  }
 });
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
  const blend=(report.parts[0] as {legBlend:LegBlend&{fragments:Record<string,'L'|'R'|'seat'>}}).legBlend;
  expect(Math.abs(blend.apex.y-135*scale)).toBeLessThanOrEqual(1);
  for(const [k,param] of f.puppet.param.entries()){
   const side=param.name.at(-1) as 'L'|'R';
   for(const binding of param.bindings){
    const part=inpParts(f.puppet).find(p=>p.uuid===binding.node)!,fragment=blend.fragments[part.name];expect(fragment).toBeDefined();
    let below=0;
    for(let i=0;i<part.mesh!.verts.length;i+=2){
     const p={x:part.mesh!.verts[i]+f.w/2,y:part.mesh!.verts[i+1]+f.h/2},q=poseContinuousLimb(p,f.chains[k].chain,25,60*f.chains[k].distalSign),w=legWeight(p,blend,side,fragment==='seat'?undefined:fragment);
     expect((binding.values[2][2] as number[][])[i/2]).toEqual([(q.x-p.x)*w,(q.y-p.y)*w]);expect((binding.values[1][0] as number[][])[i/2]).toEqual([0,0]);
     // Below the apex blend each tube follows its own leg exactly.
     if(fragment===side&&p.y>=blend.apex.y+blend.halfWidth){expect(w).toBeCloseTo(1,12);below++;}
    }
    if(fragment===side)expect(below).toBeGreaterThan(0);
   }
  }
 });
 it('finds the fork of short shorts that end just below the crotch',()=>{
  // The hem lies above every former sample (45%..105% of the thigh).
  const f=fixture(1,true,150),report=clothingAttachments(f.puppet,f.textures,f.marks);
  expect(report.parts[0].status).toBe('partitioned');
  const alpha=(p:{x:number;y:number})=>p.y>=100&&p.y<150&&p.x>=55&&p.x<145&&(p.y<135||p.x<90||p.x>110)?1:0;
  expect(legFork(alpha,f.marks)?.apex).toEqual({x:100,y:135});
 });
 it('keeps the fly closed: the seat stretches between the legs instead of splitting at the centre seam',()=>{
  const f=fixture(1,true);
  // The production key grid (9 x 7), so that interpolated poses stay within the sweep tolerance.
  for(const p of f.puppet.param)p.axis_points=[Array.from({length:9},(_,i)=>i/8),Array.from({length:7},(_,i)=>i/6)];
  const report=clothingAttachments(f.puppet,f.textures,f.marks);
  const blend=(report.parts[0] as {legBlend:LegBlend}).legBlend;
  // Weights of the two legs sum to one and change by at most 1/(2*halfWidth) per pixel.
  for(let y=100;y<200;y+=3)for(let x=56;x<144;x+=1){
   const p={x,y},tube=x>=100?'L' as const:'R' as const;
   expect(legWeight(p,blend,'L',tube)+legWeight(p,blend,'R',tube)).toBeCloseTo(1,12);
   if(y<=blend.apex.y)expect(Math.abs(legWeight({x:x+1,y},blend,'L')-legWeight(p,blend,'L'))).toBeLessThanOrEqual(1/(2*blend.halfWidth)+1e-9);
   // The seat and the tubes meet with equal weights at the fork row: no seam opens there.
   if(Math.abs(y-blend.apex.y)<3)expect(legWeight({x,y:blend.apex.y+1e-6},blend,'L',tube)).toBeCloseTo(legWeight({x,y:blend.apex.y},blend,'L'),4);
  }
  // Swinging one leg out at full range folds no seat or tube triangle, and the sweep accepts the blend.
  expect(()=>combinedMeshGate(f.puppet)).not.toThrow();
  for(const name of ['Leg L','Leg R'] as const)expect(attachmentMotionGate(f.puppet,f.textures,name).status).toBe('passed');
  const parts=inpParts(f.puppet),asset={puppet:f.puppet,parts,width:f.w,height:f.h,textures:[]};
  // Both legs at once, swinging toward and away from each other: no seat or tube triangle folds.
  const area=(v:number[],a:number,b:number,c:number)=>(v[2*b]-v[2*a])*(v[2*c+1]-v[2*a+1])-(v[2*b+1]-v[2*a+1])*(v[2*c]-v[2*a]);
  for(const [l,r] of [[-25,25],[25,-25],[25,25],[-25,-25]])for(const bend of [0,60]){
   const posed=new Map(evaluateCombined(asset,{'Leg L':[l,bend],'Leg R':[r,bend]}).map(n=>[n.uuid,n]));
   for(const n of parts.filter(n=>n.name.startsWith('bottomwear__')))for(let i=0;i<n.mesh!.indices.length;i+=3){const [a,b,c]=n.mesh!.indices.slice(i,i+3),rest=area(n.mesh!.verts,a,b,c);if(Math.abs(rest)>.1)expect(area(posed.get(n.uuid)!.xy,a,b,c)*rest).toBeGreaterThan(0);}
  }
  const seat=parts.find(n=>n.name==='bottomwear__seat')!,posed=evaluateCombined(asset,{'Leg L':[25,0]}).find(n=>n.uuid===seat.uuid)!;
  // The centre of the waistband moves with half of the leg, never with all or none of it.
  const k=seat.mesh!.verts.findIndex((v,j)=>j%2===0&&Math.abs(v+f.w/2-100)<6&&Math.abs(seat.mesh!.verts[j+1]+f.h/2-130)<6);
  expect(k).toBeGreaterThanOrEqual(0);
  const p={x:seat.mesh!.verts[k]+f.w/2,y:seat.mesh!.verts[k+1]+f.h/2},q=poseContinuousLimb(p,f.chains[0].chain,25,0);
  const moved=Math.hypot(posed.xy[k]-seat.mesh!.verts[k],posed.xy[k+1]-seat.mesh!.verts[k+1]),full=Math.hypot(q.x-p.x,q.y-p.y);
  expect(full).toBeGreaterThan(1);expect(moved/full).toBeGreaterThan(.25);expect(moved/full).toBeLessThan(.75);
 });
 it('handles a torso garment for arms when no hip is located',()=>{
  const f=fixture(1,true);f.puppet.nodes.children![0].name='topwear';
  const arm={root:{x:60,y:100},joint:{x:40,y:160},tip:{x:30,y:220},rootBlend:40,jointBlend:30};
  f.puppet.meta.combined={chains:[{name:'Arm R',distalSign:1,chain:arm}]};
  f.puppet.param=[{uuid:10,name:'Arm R',is_vec2:true,min:[-30,-60],max:[30,60],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0,.5,1],[0,.5,1]],bindings:[]}];
  const marks={shoulderR:arm.root,elbowR:arm.joint,wristR:arm.tip};
  expect(()=>clothingAttachments(f.puppet,f.textures,marks)).not.toThrow();
 });
 it('fails the sweep when a seat binding is replaced by a full single-leg copy',()=>{
  const f=fixture(1,true);clothingAttachments(f.puppet,f.textures,f.marks);
  const seat=inpParts(f.puppet).find(n=>n.name==='bottomwear__seat')!,leg=f.puppet.param.find(p=>p.name==='Leg L')!;
  const b=leg.bindings.find(b=>b.node===seat.uuid)!;
  b.values=b.values.map((col,x)=>col.map((_,y)=>{const v=seat.mesh!.verts,d:number[][]=[];for(let i=0;i<v.length;i+=2){const p={x:v[i]+f.w/2,y:v[i+1]+f.h/2},q=poseContinuousLimb(p,f.chains[0].chain,[-25,0,25][x],[0,30,60][y]);d.push([q.x-p.x,q.y-p.y]);}return d;}));
  expect(attachmentMotionGate(f.puppet,f.textures,'Leg L').status).toBe('failed');
 });
});
