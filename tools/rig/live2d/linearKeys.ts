/** Remove interior 1D keys only when every affected property is affine there.
 * The tolerance is in source value units (px for deform, unitless for opacity).
 * No nonlinear body grid is approximated and endpoint keys are retained. */
export function affineKeyIndices(keys:number[],series:unknown[][],tolerance=1e-10) {
 const equal=(a:unknown,b:unknown,c:unknown,t:number):boolean=>typeof a==='number'&&typeof b==='number'&&typeof c==='number'?Math.abs(b-(a+(c-a)*t))<=tolerance:Array.isArray(a)&&Array.isArray(b)&&Array.isArray(c)&&a.length===b.length&&a.length===c.length&&a.every((v,i)=>equal(v,b[i],c[i],t));
 const keep=keys.map((_,i)=>i);let i=1;
 while(i<keep.length-1){const a=keep[i-1],b=keep[i],c=keep[i+1],t=(keys[b]-keys[a])/(keys[c]-keys[a]);if(series.every(v=>equal(v[a],v[b],v[c],t)))keep.splice(i,1);else i++;}
 return keep;
}
