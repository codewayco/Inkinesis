import type {ContinuousLimb,LimbPoint} from './continuousLimb';
/** Refine angle intervals using the chord error bound r(1-cos(delta/2)).
 * Each axis receives half of the requested positional-error budget. Existing
 * keys and zero are retained; the budget cap is reported, never hidden. */
export function sampleLimbAxes(chain:ContinuousLimb,points:LimbPoint[],xs:number[],ys:number[],tolerancePixels:number,maxKeysPerAxis=65,preserveSymmetry=false) {
  if(!(tolerancePixels>0)||maxKeysPerAxis<3)throw new Error('Invalid limb sampling budget');
  const upper=Math.hypot(chain.joint.x-chain.root.x,chain.joint.y-chain.root.y);
  const distalRadius=Math.max(1,...points.map(p=>Math.hypot(p.x-chain.joint.x,p.y-chain.joint.y)));
  const rootRadius=upper+distalRadius;
  const refine=(keys:number[],radius:number)=>{
    const limit=2*Math.acos(Math.max(-1,1-tolerancePixels/(2*radius)))*180/Math.PI;
    let out:number[]=[];
    for(let i=0;i<keys.length-1;i++){
      const a=keys[i],b=keys[i+1],n=Math.max(1,Math.ceil((b-a)/limit));
      for(let j=0;j<n;j++)out.push(a+(b-a)*j/n);
    }
    out.push(keys.at(-1)!);
    if(out.length>maxKeysPerAxis){
      // Keep the original grid and spend the remaining slots on its widest
      // gaps. This bound exposes the achieved accuracy under an export budget.
      out=[...keys];
      const symmetric=preserveSymmetry&&keys.every(v=>keys.some(w=>Math.abs(v+w)<1e-9));
      while(out.length<maxKeysPerAxis){
        const gaps=out.slice(1).map((b,i)=>({a:out[i],b,width:b-out[i]})).sort((a,b)=>b.width-a.width||(preserveSymmetry?Math.abs((a.a+a.b)/2)-Math.abs((b.a+b.b)/2):0));
        let added=false;
        for(const gap of gaps){
          const mid=(gap.a+gap.b)/2;
          const candidates=symmetric?[mid,-mid]:[mid];
          const fresh=candidates.filter((v,i)=>candidates.findIndex(w=>Math.abs(w-v)<1e-9)===i&&!out.some(w=>Math.abs(w-v)<1e-9));
          if(!fresh.length||out.length+fresh.length>maxKeysPerAxis)continue;
          out.push(...fresh);out.sort((a,b)=>a-b);added=true;break;
        }
        if(!added)break;
      }
    }
    const gap=Math.max(...out.slice(1).map((v,i)=>v-out[i]));
    return {keys:out,bound:radius*(1-Math.cos(gap*Math.PI/360))};
  };
  const x=refine(xs,rootRadius),y=refine(ys,distalRadius);
  return {xs:x.keys,ys:y.keys,requestedTolerancePixels:tolerancePixels,chordBoundPixels:x.bound+y.bound,budgetLimited:x.bound+y.bound>tolerancePixels+1e-9};
}
