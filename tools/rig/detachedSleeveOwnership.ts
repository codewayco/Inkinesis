/** A disconnected garment island may duplicate sleeve artwork in an arm layer.
 * Require near-complete alpha overlap and agreement of most opaque colors;
 * proximity alone would incorrectly attach a skirt behind a resting hand. */
export function detachedSleeveOwnership(garment:Uint8ClampedArray,arms:{name:string;rgba:Uint8ClampedArray}[],width:number,height:number) {
 const labels=new Int32Array(width*height),queue=new Int32Array(width*height),owners=new Int16Array(width*height),components=[];let label=0;
 for(let start=0;start<labels.length;start++){
  if(labels[start]||garment[start*4+3]===0)continue;label++;let end=1;queue[0]=start;labels[start]=label;
  for(let at=0;at<end;at++){const p=queue[at],x=p%width;for(const q of [x?p-1:-1,x+1<width?p+1:-1,p-width,p+width])if(q>=0&&q<labels.length&&!labels[q]&&garment[q*4+3]>0){labels[q]=label;queue[end++]=q;}}
  if(end<64)continue;
  const matches=arms.map((arm,index)=>{let opaque=0,overlap=0,similar=0;for(let j=0;j<end;j++){const i=queue[j]*4;if(garment[i+3]<=128)continue;opaque++;if(arm.rgba[i+3]>128){overlap++;const d=(Math.abs(garment[i]-arm.rgba[i])+Math.abs(garment[i+1]-arm.rgba[i+1])+Math.abs(garment[i+2]-arm.rgba[i+2]))/3;if(d<20)similar++;}}return {name:arm.name,index,opaque,overlap:overlap/Math.max(1,opaque),similar:similar/Math.max(1,opaque)};}).filter(m=>m.opaque>=64&&m.overlap>=.9&&m.similar>=.65);
  if(matches.length!==1)continue;const m=matches[0];for(let j=0;j<end;j++)owners[queue[j]]=m.index+1;components.push({component:label,pixels:end,owner:m.name,alphaOverlap:m.overlap,colorAgreement:m.similar});
 }
 return {owners,components};
}
