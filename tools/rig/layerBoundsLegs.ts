/** Layer-bound leg skeleton heuristic, expressed in Inkinesis landmark
 * coordinates. No Stretchy Studio imports or runtime dependencies. Geometric candidates are not
 * anatomical ground truth; Inkinesis ownership and runtime gates still decide
 * which channels can be exported. Bounds heuristic adapted from Stretchy Studio
 * armatureOrganizer.js, commit 24a83a27ba43e43e9d2e3de5e33994594e6199c2.
 * Copyright (c) 2026 Nguyen Phan; MIT notice: docs/third-party/stretchy-motion-MIT.txt.
 */
import type {LimbPoint} from '../../engine/src/body/continuousLimb';
export interface LayerFootprint {name:string;x?:number;y?:number;width:number;height:number}
export interface RigCanvas {width:number;height:number}
export function inferLegPointsFromLayers(layers:LayerFootprint[],canvas:RigCanvas,known:Record<string,LimbPoint>={}) {
 const bounds=new Map<string,{left:number;top:number;width:number;height:number;cx:number;cy:number}>();
 for(const layer of layers){const name=layer.name.trim().toLowerCase().replaceAll('_','-');if(bounds.has(name)||layer.width<=0||layer.height<=0)continue;const left=layer.x??0,top=layer.y??0;bounds.set(name,{left,top,width:layer.width,height:layer.height,cx:left+layer.width/2,cy:top+layer.height/2});}
 const torso=bounds.get('topwear'),lower=bounds.get('bottomwear'),face=bounds.get('face')??bounds.get('front hair')??bounds.get('headwear');
 const waist=torso?{x:torso.cx,y:torso.top+.85*torso.height}:face?{x:face.cx,y:face.top+face.height}:undefined;
 const result:Record<string,LimbPoint>={},provenance:Record<string,string>={};
 for(const side of['L','R']){
  const anatomicalSign=side==='L'?1:-1;
  // Keep the original heuristic's two fallback conventions; source landmarks
  // override either estimate below.
  const hip=lower?{x:lower.cx+anatomicalSign*.2*lower.width,y:lower.top+.15*lower.height}:waist?{x:waist.x-anatomicalSign*.1*canvas.width,y:waist.y+.08*canvas.height}:{x:canvas.width*(.5+anatomicalSign*.1),y:canvas.height*.58};
  result['hip'+side]=hip;provenance['hip'+side]=lower?'lower-garment bounds':waist?'torso-derived pelvis':'canvas fallback';
  const leg=bounds.get('legwear-'+side.toLowerCase())??bounds.get('legwear'),shoe=bounds.get('footwear-'+side.toLowerCase())??bounds.get('footwear');
  if(leg){const ankle=shoe?{x:shoe.cx,y:shoe.cy}:{x:leg.cx,y:leg.top+leg.height};result['ankle'+side]=ankle;result['knee'+side]={x:(hip.x+ankle.x)/2,y:(hip.y+ankle.y)/2};provenance['ankle'+side]=shoe?'footwear bounds':'leg layer end';provenance['knee'+side]='midpoint of inferred hip and ankle';}
 }
 for(const key of Object.keys(result))if(known[key]){result[key]={...known[key]};provenance[key]='existing source landmark';}
 return {points:result,provenance};
}
