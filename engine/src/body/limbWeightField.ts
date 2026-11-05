import type {ContinuousLimb,LimbPoint} from './continuousLimb';
export interface LimbWeightField {x:number;y:number;step:number;width:number;height:number;root:number[];distal:number[];pathToJoint:number;pathToTip:number}
const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
/** Intrinsic distance follows the supplied limb alpha. It cannot jump across
 * transparent space from a folded wrist to the adjacent upper arm. */
export function buildLimbWeightField(rgba:Uint8Array|Uint8ClampedArray,width:number,height:number,c:ContinuousLimb,step=2):LimbWeightField {
 let x0=width,y0=height,x1=0,y1=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]>64){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
 if(x0>x1||y0>y1)throw Error('Empty limb support');
 const w=Math.ceil((x1-x0+1)/step)+1,h=Math.ceil((y1-y0+1)/step)+1,n=w*h,solid=new Uint8Array(n);
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){let any=false;for(let dy=0;dy<step&&!any;dy++)for(let dx=0;dx<step;dx++){const x=x0+i*step+dx,y=y0+j*step+dy;if(x<width&&y<height&&rgba[(y*width+x)*4+3]>64){any=true;break;}}solid[j*w+i]=Number(any);}
 const xy=(i:number)=>({x:x0+(i%w)*step,y:y0+Math.floor(i/w)*step});
 const nearest=(p:LimbPoint)=>{let best=-1,d=Infinity;for(let i=0;i<n;i++)if(solid[i]){const q=xy(i),v=(q.x-p.x)**2+(q.y-p.y)**2;if(v<d){best=i;d=v;}}return best;};
 const root=nearest(c.root),joint=nearest(c.joint),tip=nearest(c.tip),distance=new Float64Array(n).fill(Infinity),heap:[number,number][]=[];
 const push=(item:[number,number])=>{let at=heap.length;heap.push(item);while(at){const p=(at-1)>>1;if(heap[p][0]<=item[0])break;heap[at]=heap[p];at=p;}heap[at]=item;};
 const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let at=0;while(at*2+1<heap.length){let k=at*2+1;if(k+1<heap.length&&heap[k+1][0]<heap[k][0])k++;if(heap[k][0]>=last[0])break;heap[at]=heap[k];at=k;}heap[at]=last;}return first;};
 distance[root]=0;push([0,root]);
 while(heap.length){const [d,i]=pop();if(d!==distance[i])continue;const x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  if(!(dx||dy)||x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;const j=i+dx+dy*w;if(!solid[j])continue;
  // No diagonal jump across two empty orthogonal neighbors.
  if(dx&&dy&&!solid[i+dx]&&!solid[i+dy*w])continue;
  const nd=d+step*Math.hypot(dx,dy);if(nd<distance[j]){distance[j]=nd;push([nd,j]);}
 }}
 const upper=distance[joint],end=distance[tip];
 if(!Number.isFinite(upper)||!Number.isFinite(end)||end<=upper+step*2)throw Error(`Limb support does not establish a root-joint-tip path: joint=${upper}, tip=${end}`);
 // Extend nearest reachable material weights into transparent cells solely for
 // boundary mesh vertices; actual visible support supplied the distance field.
 const owner=new Int32Array(n).fill(-1),queue:number[]=[];
 for(let i=0;i<n;i++)if(Number.isFinite(distance[i])){owner[i]=i;queue.push(i);}
 for(let k=0;k<queue.length;k++){const i=queue[k],x=i%w,y=Math.floor(i/w);for(const j of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1])if(j>=0&&owner[j]<0){owner[j]=owner[i];queue.push(j);}}
 const roots=[],distals=[];
 for(let i=0;i<n;i++){const d=distance[owner[i]];roots.push(smooth(0,c.rootBlend,d));distals.push(smooth(upper-c.jointBlend,upper+c.jointBlend,d));}
 return {x:x0,y:y0,step,width:w,height:h,root:roots,distal:distals,pathToJoint:upper,pathToTip:end};
}
export function sampleLimbWeightField(p:LimbPoint,f:LimbWeightField) {
 const x=Math.max(0,Math.min(f.width-1,(p.x-f.x)/f.step)),y=Math.max(0,Math.min(f.height-1,(p.y-f.y)/f.step));
 const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,f.width-1),y1=Math.min(y0+1,f.height-1),a=x-x0,b=y-y0;
 const sample=(v:number[])=>((1-a)*v[y0*f.width+x0]+a*v[y0*f.width+x1])*(1-b)+((1-a)*v[y1*f.width+x0]+a*v[y1*f.width+x1])*b;
 return {root:sample(f.root),distal:sample(f.distal)};
}
