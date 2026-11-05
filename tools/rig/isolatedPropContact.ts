/** Evidence for an otherwise unlabelled single-hand prop. This does not infer a
 * grasp from proximity alone: whole-component hand contact is required by the
 * caller; substantial contact with any other body surface rejects the fallback. */
export function isolatedPropContact(prop:Uint8ClampedArray,otherBody:Uint8ClampedArray,maxArea:number){
 let area=0,otherOverlap=0;for(let i=3;i<prop.length;i+=4)if(prop[i]>128){area++;if(otherBody[i]>128)otherOverlap++;}
 const otherOverlapRatio=otherOverlap/Math.max(1,area);return {area,otherOverlap,otherOverlapRatio,maxArea,passed:area>=64&&area<=maxArea&&otherOverlapRatio<=.005};
}
