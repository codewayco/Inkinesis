/** Recover upper-arm artwork duplicated in the torso garment layer when the
 * skeletal outward-width heuristic finds no sleeve. Prepared layer alpha and
 * RGB or saturated hue agreement are evidence of ownership; a nearby bone alone is not. */
import type {ContinuousLimb} from '../../engine/src/body/continuousLimb';
export function sleeveMaterialMatch(a:ArrayLike<number>,b:ArrayLike<number>,i:number) {
 const rgb=(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;
 if(rgb<20)return true;
 const hsv=(c:ArrayLike<number>)=>{const r=c[i]/255,g=c[i+1]/255,b=c[i+2]/255,hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo;
 let h=d===0?0:hi===r?60*((g-b)/d%6):hi===g?60*((b-r)/d+2):60*((r-g)/d+4);if(h<0)h+=360;return {h,s:hi?d/hi:0,v:hi};};
 const x=hsv(a),y=hsv(b),dh=Math.abs(x.h-y.h);
 return x.s>=.25&&y.s>=.25&&x.v>40/255&&y.v>40/255&&Math.min(dh,360-dh)<=10;
}
export function sourceSleeveMaterialAgreement(garment:Uint8ClampedArray,arms:{name:string;rgba:Uint8ClampedArray;chain:ContinuousLimb;eligible:boolean}[],width:number,height:number){
 const owners=new Int16Array(width*height),claims=new Uint8Array(width*height),components=[];
 for(const [index,arm] of arms.entries()){
  if(!arm.eligible)continue;
  const {root,joint}=arm.chain,dx=joint.x-root.x,dy=joint.y-root.y,upper=Math.hypot(dx,dy),seen=new Uint8Array(width*height),queue=new Int32Array(width*height);
  const along=(i:number)=>((i%width-root.x)*dx+(Math.floor(i/width)-root.y)*dy)/upper;
  const supported=(i:number)=>garment[i*4+3]>128&&arm.rgba[i*4+3]>128&&along(i)>0&&along(i)<upper*1.05;
  for(let start=0;start<seen.length;start++){
   if(seen[start]||!supported(start))continue;seen[start]=1;let end=1;queue[0]=start;
   for(let at=0;at<end;at++){const p=queue[at],x=p%width;for(const q of [x?p-1:-1,x+1<width?p+1:-1,p-width,p+width])if(q>=0&&q<seen.length&&!seen[q]&&supported(q)){seen[q]=1;queue[end++]=q;}}
   if(end<64)continue;let similar=0,lo=Infinity,hi=-Infinity;
   for(let j=0;j<end;j++){const p=queue[j],i=p*4,t=along(p);lo=Math.min(lo,t);hi=Math.max(hi,t);if(sleeveMaterialMatch(garment,arm.rgba,i))similar++;}
   const accepted=similar/end>=.65&&hi-lo>=upper*.2;
   components.push({owner:arm.name,area:end,materialAgreement:similar/end,upperSpan:(hi-lo)/upper,accepted});
   if(accepted)for(let j=0;j<end;j++){const p=queue[j];claims[p]++;owners[p]=index+1;}
  }
 }
 for(let i=0;i<owners.length;i++)if(claims[i]!==1)owners[i]=0;
 return {owners,components};
}
