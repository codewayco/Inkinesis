import type {ContinuousLimb,LimbPoint} from '../../engine/src/body/continuousLimb';
/** Does a garment cover most of the prepared arm cross-section at a bone probe?
 * A line passing through a torso edge alone is insufficient sleeve evidence.
 * This corroborates the original centerline witness; hidden shoulder-cap alpha
 * alone cannot introduce a new occlusion claim away from that witness.
 * Missing/very narrow arm evidence falls back to the original point test. */
export function armGarmentCoverage(garment:Uint8ClampedArray,arm:Uint8ClampedArray,width:number,height:number,chain:ContinuousLimb,p:LimbPoint){
 const dx=chain.joint.x-chain.root.x,dy=chain.joint.y-chain.root.y,upper=Math.hypot(dx,dy),nx=dy/upper,ny=-dx/upper;let support=0,covered=0;const pixels=new Set<number>();
 for(let d=-Math.floor(upper*.4);d<=upper*.4;d++){const x=Math.round(p.x+nx*d),y=Math.round(p.y+ny*d);if(x>=0&&y>=0&&x<width&&y<height)pixels.add(y*width+x);}
 for(const i of pixels)if(arm[i*4+3]>128){support++;if(garment[i*4+3]>128)covered++;}
 const x=Math.round(p.x),y=Math.round(p.y),pointCovered=x>=0&&y>=0&&x<width&&y<height&&garment[(y*width+x)*4+3]>128;
 const reliable=support>=Math.max(4,upper*.02),fraction=covered/Math.max(1,support);return {support,covered,fraction,reliable,pointCovered,substantial:pointCovered&&(!reliable||fraction>=.5)};
}
