/** Pixel-scope guards for explicit isolated repair candidates. */
import {decodePNG} from '../generate/png';
import {encodePNG} from '../shared/encodePNG';
export type Region=[number,number,number,number];
export function scopedEdit(original:Buffer,edited:Buffer,region:Region){
 const a=decodePNG(original),b=decodePNG(edited);if(a.width!==b.width||a.height!==b.height)throw Error('Edit changed image dimensions');
 const [x0,y0,x1,y1]=region;if(!region.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||x0>=x1||y0>=y1)throw Error('Invalid scope');
 const out=new Uint8ClampedArray(a.rgba);let changed=0,allowed=0;
 for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)if(x/a.width>=x0&&(x+1)/a.width<=x1&&y/a.height>=y0&&(y+1)/a.height<=y1){
  allowed++;const at=(y*a.width+x)*4;if([0,1,2,3].some(k=>a.rgba[at+k]!==b.rgba[at+k]))changed++;
  out.set(b.rgba.subarray(at,at+4),at);
 }
 return {png:encodePNG(out,a.width,a.height),changedPixels:changed,allowedPixels:allowed,outsideScopeChanged:0};
}
export function editMask(image:Buffer,region:Region){const im=decodePNG(image),v=new Uint8ClampedArray(im.rgba.length);for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){const inside=x/im.width>=region[0]&&(x+1)/im.width<=region[2]&&y/im.height>=region[1]&&(y+1)/im.height<=region[3];v[(y*im.width+x)*4+3]=inside?0:255;}return encodePNG(v,im.width,im.height);}
