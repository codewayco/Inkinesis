import type {InpParameter} from './inp';
/** Export-budget compression of a dense, already gated limb grid. Greedy removal
 * minimizes source-key reconstruction error over all owned vertices and the
 * other complete axis. Endpoints and neutral retained.
 * Original dense grid is kept as reference for every removal (no error reset). */
export function fitLegGridBudget(p:InpParameter,cap=17){
 const original=structuredClone(p),retained=p.axis_points.map(a=>a.map((_,i)=>i)),axes=p.axis_points;
 const axisError=(dim:number,list:number[])=>{
  let max=0;const other=1-dim;
  for(let i=0;i<axes[dim].length;i++){
   if(list.includes(i))continue;let j=1;while(j<list.length-1&&axes[dim][list[j]]<axes[dim][i])j++;
   const l=list[j-1],r=list[j],t=(axes[dim][i]-axes[dim][l])/(axes[dim][r]-axes[dim][l]);
   for(const b of original.bindings){if(b.param_name!=='deform')throw Error('Only deformation grids supported');for(let k=0;k<axes[other].length;k++){
    const at=(idx:number)=>b.values[dim===0?idx:k][dim===0?k:idx] as number[][];const a=at(l),c=at(r),ref=at(i);
    for(let v=0;v<ref.length;v++)for(let xy=0;xy<2;xy++)max=Math.max(max,Math.abs(ref[v][xy]-(a[v][xy]*(1-t)+c[v][xy]*t)));
   }}
  }return max;
 };
 const errors=[];
 for(const dim of [0,1]){
  const zero=(0-p.min[dim])/(p.max[dim]-p.min[dim]);
  while(retained[dim].length>cap){
   let chosen:number[]|undefined,best=Infinity;
   for(const i of retained[dim].slice(1,-1)){
    if(Math.abs(axes[dim][i]-zero)<1e-9)continue;
    const list=retained[dim].filter(v=>v!==i),error=axisError(dim,list);
    if(error<best){best=error;chosen=list;}
   }
   if(!chosen)throw Error('Cannot fit key budget while preserving endpoints/neutral');retained[dim]=chosen;
  }errors.push(axisError(dim,retained[dim]));
 }
 p.axis_points=retained.map((indices,d)=>indices.map(i=>original.axis_points[d][i]));
 p.bindings.forEach((b,j)=>{b.values=retained[0].map(x=>retained[1].map(y=>original.bindings[j].values[x][y]));b.isSet=retained[0].map(x=>retained[1].map(y=>original.bindings[j].isSet[x][y]));});
 return {oldKeys:axes.map(a=>a.length),newKeys:p.axis_points.map(a=>a.length),retained,axisSourceMaxCoordinateErrorPx:errors,sourceGridReconstructionBoundPx:errors[0]+errors[1],scope:'Bound against bilinear dense source grid, not error against ideal articulation; controls/ranges and all non-leg parameters unchanged.'};
}
