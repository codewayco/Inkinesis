import {it,expect} from 'vitest';
import {rigFixture} from '../../test/rigFixture';
import {prepareLive2D} from '../live2d/export';
import {readCombined,evaluateCombined} from '../../../player/src/combinedRuntime';
const weights=(keys:number[],v:number)=>{if(v<=keys[0])return [[0,1]];if(v>=keys.at(-1)!)return [[keys.length-1,1]];let i=0;while(keys[i+1]<=v)i++;const t=(v-keys[i])/(keys[i+1]-keys[i]);return [[i,1-t],[i+1,t]];};
it('retains nonseparable irregular bilinear fields in regular grids with unchanged controls',()=>{
 const a=readCombined(rigFixture());for(const p of a.puppet.param)p.bindings=p.bindings.filter(b=>b.param_name==='deform');
 const p=a.puppet.param.find(p=>p.name==='Arm L')!;p.axis_points=[[0,.21,.5,.78,1],[0,.31,.5,.83,1]];
 for(const b of p.bindings){b.isSet=p.axis_points[0].map(()=>p.axis_points[1].map(()=>true));b.values=p.axis_points[0].map(t=>p.axis_points[1].map(u=>{const x=-30+60*t,y=-30+60*u;return Array.from({length:4},(_,k)=>[x*.2+y*.1+x*y*(k+1)*.002+x*x*y*.0001,y*.3+x*x*.003-y*x*x*(k+1)*.00003]);}));}
 const before=JSON.stringify(a.puppet),normal=prepareLive2D(a,'Legacy',{additiveMorphs:true,channelMorphs:true}),m=prepareLive2D(a,'Regular',{additiveMorphs:true,channelMorphs:true});
 expect(m.parameters.map(({kind:_kind,...p})=>p)).toEqual(normal.parameters.map(({kind:_kind,...p})=>p));expect(m.links).toEqual(normal.links);expect(JSON.stringify(a.puppet)).toBe(before);
 const samples=[...Array.from({length:40},(_,i)=>[-30+60*((i*29%43)/42),-30+60*((i*13%47)/46)]),...p.axis_points[0].flatMap(x=>p.axis_points[1].flatMap(y=>[-.00099,.00099].map(e=>[-30+60*x+e,-30+60*y-e])))];
 for(const [x,y] of samples){const source={'Arm L':[x,y],'Head Angles':[x*.13,y*.27],ParamAngleZ:[x*.31,0]},expected=evaluateCombined(a,source),values=Object.fromEntries(m.parameters.map(p=>[p.id,(source as Record<string,number[]>)[p.source]?.[p.axis]??p.default]));
 for(const d of m.drawables){const actual=d.positions.map((n,k)=>n-(k%2?a.height:a.width)/2);for(const c of d.cells){const w=d.axes.reduce((s,ax,k)=>s*(weights(ax.keys,values[ax.id]).find(([i])=>i===c.coordinate[k])?.[1]??0),1);c.delta.forEach((v,k)=>actual[k]+=w*v);}
 for(const bs of d.morphs)for(const [j,w] of weights(bs.keys,values[bs.id]))if(j!==bs.neutral)bs.forms[j].forEach((v,k)=>actual[k]+=w*v);
 const e=expected.find(p=>p.uuid===d.uuid)!;actual.forEach((v,k)=>expect(v).toBeCloseTo(e.xy[k],5));}
 }
});
it('keeps unsupported vector opacity and nonzero-neutral fields in their original grids',()=>{
 const a=readCombined(rigFixture()),p=a.puppet.param.find(p=>p.name==='Arm L')!;p.bindings.push({node:1,param_name:'opacity',interpolate_mode:'Linear',isSet:[[true,true,true],[true,true,true],[true,true,true]],values:[[0,.2,.3],[.4,.5,.6],[.7,.8,1]]});
 const head=a.puppet.param.find(p=>p.name==='Head Angles')!;(head.bindings[0].values[1][1] as number[][])[0][0]=1;
 const m=prepareLive2D(a,'Fallback');for(const id of ['ParamShoulderL','ParamElbowL','ParamAngleX','ParamAngleY'])expect(m.parameters.find(p=>p.id===id)!.kind).toBe('normal');
});
