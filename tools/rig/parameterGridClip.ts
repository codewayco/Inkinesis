import type {InpParameter} from './inp';

/** Clip a linear authored grid without changing its physical interpolation.
 * Keep every interior source key, both new boundaries, and the neutral key.
 * Skin, clothing and carried objects are resampled together. */
export function clipParameterGrid(source:InpParameter,min:number[],max:number[]):InpParameter {
 if(!source.is_vec2||source.bindings.some(b=>b.interpolate_mode!=='Linear'))throw Error('Rectangular range requires a linear vector grid');
 const physical=source.axis_points.map((keys,i)=>keys.map(t=>source.min[i]+t*(source.max[i]-source.min[i])));
 for(let i=0;i<2;i++)if(!Number.isFinite(min[i])||!Number.isFinite(max[i])||min[i]>=max[i]||min[i]<source.min[i]-1e-9||max[i]>source.max[i]+1e-9||source.defaults[i]<min[i]||source.defaults[i]>max[i])throw Error('Invalid source subrange');
 const keys=physical.map((axis,i)=>[...new Set([min[i],...axis.filter(v=>v>min[i]+1e-10&&v<max[i]-1e-10),source.defaults[i],max[i]])].sort((a,b)=>a-b));
 const interval=(axis:number[],v:number)=>{let i=0;while(i<axis.length-2&&axis[i+1]<=v)i++;return {i,t:Math.max(0,Math.min(1,(v-axis[i])/(axis[i+1]-axis[i])))};};
 const p=structuredClone(source);p.min=min.slice();p.max=max.slice();p.axis_points=keys.map((axis,i)=>axis.map(v=>(v-min[i])/(max[i]-min[i])));
 for(let k=0;k<p.bindings.length;k++){
  const src=source.bindings[k],bind=p.bindings[k];bind.isSet=keys[0].map(()=>keys[1].map(()=>true));
  bind.values=keys[0].map(x=>keys[1].map(y=>{
   const a=interval(physical[0],x),b=interval(physical[1],y),weights=[(1-a.t)*(1-b.t),a.t*(1-b.t),(1-a.t)*b.t,a.t*b.t],values=[src.values[a.i][b.i],src.values[a.i+1][b.i],src.values[a.i][b.i+1],src.values[a.i+1][b.i+1]];
   if(src.param_name==='opacity')return values.reduce<number>((s,v,i)=>s+Number(v)*weights[i],0);
   if(src.param_name!=='deform')throw Error('Unsupported rectangular-range binding');
   return (values[0] as number[][]).map((v,j)=>v.map((_,c)=>values.reduce<number>((s,q,i)=>s+(q as number[][])[j][c]*weights[i],0)));
  }));
 }
 return p;
}

