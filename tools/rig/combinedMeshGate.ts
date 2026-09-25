import {inpParts,type InpDocument} from './inp';
/** Reject foldovers at authored coupled keys and half-grid samples before export. */
export function combinedMeshGate(puppet:InpDocument) {
  const parts=new Map(inpParts(puppet).map(p=>[p.uuid,p]));let samples=0,triangles=0;
  for(const p of puppet.param.filter(p=>/^(Arm|Leg) [LR]$/.test(p.name))) {
    const nx=p.axis_points[0].length,ny=p.axis_points[1].length;
    for(let x=0;x<=nx-1;x+=.5)for(let y=0;y<=ny-1;y+=.5){
      samples++;
      const x0=Math.floor(x),x1=Math.ceil(x),y0=Math.floor(y),y1=Math.ceil(y),fx=x-x0,fy=y-y0;
      for(const b of p.bindings.filter(b=>b.param_name==='deform')){
        const mesh=parts.get(b.node)!.mesh!,v=mesh.verts,posed:number[]=[];
        const offset=(ix:number,iy:number,k:number,c:number)=>(b.values[ix][iy] as number[][])[k][c];
        for(let k=0;k<v.length;k++){
          const vertex=Math.floor(k/2),component=k%2;
          const d0=offset(x0,y0,vertex,component)*(1-fx)+offset(x1,y0,vertex,component)*fx;
          const d1=offset(x0,y1,vertex,component)*(1-fx)+offset(x1,y1,vertex,component)*fx;
          posed.push(v[k]+d0*(1-fy)+d1*fy);
        }
        const area=(xy:number[],a:number,b:number,c:number)=>(xy[b*2]-xy[a*2])*(xy[c*2+1]-xy[a*2+1])-(xy[b*2+1]-xy[a*2+1])*(xy[c*2]-xy[a*2]);
        for(let i=0;i<mesh.indices.length;i+=3){
          const [a,c,d]=mesh.indices.slice(i,i+3),rest=area(v,a,c,d);if(Math.abs(rest)<=.1)continue;
          triangles++;const moved=area(posed,a,c,d);
          if(!Number.isFinite(moved)||moved*rest<=0)throw new Error(`Body foldover: ${p.name}, ${parts.get(b.node)!.name}, grid ${x}/${y}, rest triangle ${[a,c,d].map(i=>v.slice(i*2,i*2+2)).join(';')}`);
        }
      }
    }
  }
  return {status:'passed',coupledKeyAndHalfGridSamples:samples,triangleChecks:triangles,scope:'Every body key and half-grid interpolation; excludes near-degenerate rest triangles <=0.1 doubled px area; not continuous proof or visual acceptance'};
}
