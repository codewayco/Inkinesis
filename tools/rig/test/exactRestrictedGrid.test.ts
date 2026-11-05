import {it,expect} from 'vitest';
import {rigFixture} from '../../test/rigFixture';
import {readCombined,evaluateCombined} from '../../../player/src/combinedRuntime';
import {clipParameterGrid} from '../parameterGridClip';
import {rememberRestrictedSource,restrictedSource} from '../exactRestrictedGrid';
it('preserves the full authored piecewise bilinear motion at unchanged restricted ranges, including internal source knots',()=>{
 const a=readCombined(rigFixture()),p=a.puppet.param.find(p=>p.name==='Arm L')!;a.puppet.param=[p];p.axis_points=[[0,.21,.5,.78,1],[0,.31,.5,.83,1]];
 for(const b of p.bindings){b.isSet=p.axis_points[0].map(()=>p.axis_points[1].map(()=>true));b.values=p.axis_points[0].map(t=>p.axis_points[1].map(u=>Array.from({length:4},(_,k)=>[(t-.5)*Math.abs(u-.5)*(k+1)*3,(u-.5)*(t-.5)**2*2])));}
 const before=JSON.stringify(p),min=[-11,-17],max=[19,21],q=clipParameterGrid(p,min,max),next={...a,puppet:{...a.puppet,param:[q]}};
 expect(q.min).toEqual(min);expect(q.max).toEqual(max);expect(q.defaults).toEqual(p.defaults);
 for(let i=0;i<137;i++){
  const value=[min[0]+(max[0]-min[0])*(i*31%137)/136,min[1]+(max[1]-min[1])*(i*61%137)/136],x=evaluateCombined(a,{'Arm L':value}),y=evaluateCombined(next,{'Arm L':value});
  x.forEach((p,j)=>p.xy.forEach((v,k)=>expect(y[j].xy[k]).toBeCloseTo(v,10)));
 }expect(JSON.stringify(p)).toBe(before);
});
it('does not replace fields modified or cloned by a later optimizer',()=>{
 const a=readCombined(rigFixture()),p=a.puppet.param.find(p=>p.name==='Arm L')!,q=clipParameterGrid(p,[-11,-17],[19,21]);rememberRestrictedSource(q,p);
 expect(restrictedSource(q)).toEqual(p);expect(restrictedSource(structuredClone(q))).toBeUndefined();(q.bindings[0].values[0][0] as number[][])[0][0]+=.1;expect(restrictedSource(q)).toBeUndefined();
});
