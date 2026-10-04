/** Conservative kinematic check: artwork covering a moving bone must share its
 * deformation. This does not establish anatomical correctness or hidden artwork.
 *
 * A static garment over an arm fails when it covers the upper arm. A static
 * garment over a thigh (a skirt, tunic or apron hem, open below) is judged by
 * what it hides instead: the leg artwork under it at rest must stay under it,
 * or on the leg's own visible artwork, in every sampled pose, up to the
 * tolerance across the hidden leg's width. A shorts tube the thigh slides out
 * of fails; a skirt the thigh swings under passes. Without leg artwork to test, the covering rule applies. */
import {inpParts,inpTextures,type InpDocument} from './inp';
import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import {poseContinuousLimb,type ContinuousLimb,type LimbPoint} from '../../engine/src/body/continuousLimb';
import {evaluateCombined,type CombinedAsset} from '../../player/src/combinedRuntime';
import type {ChainName} from '../imageToRig/capabilities';
import {legWeight,type LegBlend} from './clothingAttachments';
export function attachmentMotionGate(puppet:InpDocument,textures:Buffer[],name:ChainName) {
  const {width,height}=puppet.meta.canvas as {width:number;height:number},nodes=inpParts(puppet);
  const record=(puppet.meta.combined as {chains:{name:string;chain:ContinuousLimb;distalSign:number;parts?:string[]}[]}).chains.find(c=>c.name===name)!;
  const param=puppet.param.find(p=>p.name===name)!;
  const decoded=inpTextures(textures),garments=nodes.filter(n=>/^(topwear|bottomwear)(?:__|$)/.test(n.name));
  const upper=Math.hypot(record.chain.joint.x-record.chain.root.x,record.chain.joint.y-record.chain.root.y);
  const probes: LimbPoint[]=Array.from({length:5},(_,i)=>{const t=.4+i*.15;return {x:record.chain.root.x+(record.chain.joint.x-record.chain.root.x)*t,y:record.chain.root.y+(record.chain.joint.y-record.chain.root.y)*t};});
  const render=(parts:typeof nodes)=>renderTextured(parts.map(n=>({xy:new Float64Array(n.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[n.textures![0]],sampling:'bilinear'} as TexturedMesh)),width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
  const owners=garments.map(n=>{
    const rgba=render([n]);
    const covered=probes.filter(p=>{const x=Math.round(p.x),y=Math.round(p.y);return x>=0&&y>=0&&x<width&&y<height&&rgba[(y*width+x)*4+3]>128;});
    return {n,rgba,covered,bound:param.bindings.some(b=>b.node===n.uuid&&b.param_name==='deform')};
  });
  // Leg artwork hidden under each static garment at rest (legs only), sampled every other pixel.
  const legParts=name.startsWith('Leg')?nodes.filter(n=>record.parts?.includes(n.name)&&n.mesh?.indices.length):[];
  const legAlpha=legParts.length?render(legParts):undefined;
  const hidden=new Map<number,{points:LimbPoint[];width:number}>(),skirts=new Set<number>();
  if(legAlpha)for(const {n,rgba,covered,bound} of owners){
    if(bound||covered.length<2)continue;
    const points:LimbPoint[]=[];const rows=new Set<number>();
    for(let y=0;y<height;y+=2)for(let x=0;x<width;x+=2){const i=(y*width+x)*4+3;if(legAlpha[i]>128&&rgba[i]>128){points.push({x,y});rows.add(y);}}
    // A garment that also covers the gap between the two legs at its hem is a skirt:
    // the thigh swings out below its hem onto its own drawn artwork, not out of a tube.
    // Only a garment that leaves that gap open (a shorts tube) is tested for exposure.
    const other=(puppet.meta.combined as {chains:{name:string;chain:ContinuousLimb}[]}).chains.find(c=>c.name===(name.endsWith('L')?'Leg R':'Leg L'));
    if(points.length&&other){
      // The whole garment counts, not one fragment of it: a skirt split into per-leg
      // fragments still covers the gap between the legs as one piece.
      const family=owners.filter(o=>o.n.name.split('__')[0]===n.name.split('__')[0]);
      // Tested at the median row of the hidden thigh: a skirt covers the gap between the
      // legs there, while below a shorts crotch that gap is open.
      const ys=points.map(p=>p.y).sort((a,b)=>a-b),row=Math.round(ys[Math.floor(ys.length/2)]),mid=Math.round((record.chain.root.x+other.chain.root.x)/2);
      if(mid>=0&&mid<width&&row>=0&&row<height&&family.some(o=>o.rgba[(row*width+mid)*4+3]>128)){skirts.add(n.uuid);continue;}
    }
    // Mean hidden width across the leg: hidden area over the rows it spans.
    if(points.length)hidden.set(n.uuid,{points,width:points.length*2/Math.max(1,rows.size)});
  }
  let maxExposed=0,exposureAllowance=Infinity;
  // Leg-garment fragments follow each leg by their blend weight (clothingAttachments.legWeight).
  const blends=new Map(((puppet.meta.clothingAttachments??[]) as {legBlend?:LegBlend&{fragments:Record<string,'L'|'R'|'seat'>}}[]).flatMap(r=>r.legBlend?Object.entries(r.legBlend.fragments).map(([f,tube])=>[f,{blend:r.legBlend!,tube:tube==='seat'?undefined:tube}] as const):[]));
  const side=name.at(-1) as 'L'|'R';
  const values=[...new Set([param.min[0],(param.min[0]+param.defaults[0])/2,param.defaults[0],(param.max[0]+param.defaults[0])/2,param.max[0]])];
  const bends=[...new Set([param.min[1],param.defaults[1],param.max[1]])];
  let samples=0,maxUnownedDisplacement=0,maxSharedFieldError=0;
  // Express tolerances relative to the chain, independent of character or resolution.
  const tolerance=Math.max(2,upper*.025);
  const asset:CombinedAsset={puppet:{...puppet,param:[param]},parts:nodes,width,height,textures:[]};
  for(const x of values)for(const y of bends) {
    samples++;
    const posed=new Map(evaluateCombined(asset,{[name]:[x,y]}).map(p=>[p.uuid,p]));
    for(const {n,rgba,covered,bound} of owners) {
      if(skirts.has(n.uuid))continue;
      if(!bound) {
        // Two interior samples distinguish a substantial occluder
        // from a trim edge or the normal root overlap at a shoulder/hip.
        const under=hidden.get(n.uuid);
        if(under){
          // Hidden leg pixels that the pose carries out from under the static garment to where
          // no leg was drawn at rest (each sample stands for 2 x 2 pixels). A thigh dipping
          // below a skirt hem onto its own visible artwork is not exposed; one sliding out
          // beside a shorts tube onto the background is.
          let exposed=0;
          for(const p of under.points){const q=poseContinuousLimb(p,record.chain,x,y*record.distalSign),qx=Math.round(q.x),qy=Math.round(q.y);if(qx<0||qy<0||qx>=width||qy>=height||(rgba[(qy*width+qx)*4+3]<=128&&legAlpha![(qy*width+qx)*4+3]<=128))exposed+=4;}
          maxExposed=Math.max(maxExposed,exposed);exposureAllowance=Math.min(exposureAllowance,tolerance*under.width);
        } else if(covered.length>=2)for(const p of covered){const q=poseContinuousLimb(p,record.chain,x,y*record.distalSign);maxUnownedDisplacement=Math.max(maxUnownedDisplacement,Math.hypot(q.x-p.x,q.y-p.y));}
      } else {
        const xy=posed.get(n.uuid)!.xy,v=n.mesh!.verts;
        const blend=name.startsWith('Leg')?blends.get(n.name):undefined;
        for(let i=0;i<v.length;i+=2){const p={x:v[i]+width/2,y:v[i+1]+height/2},q=poseContinuousLimb(p,record.chain,x,y*record.distalSign),w=blend?legWeight(p,blend.blend,side,blend.tube):1;maxSharedFieldError=Math.max(maxSharedFieldError,Math.hypot(xy[i]+width/2-(p.x+(q.x-p.x)*w),xy[i+1]+height/2-(p.y+(q.y-p.y)*w)));}
      }
    }
  }
  const passed=maxUnownedDisplacement<=tolerance&&maxSharedFieldError<=tolerance&&maxExposed<=exposureAllowance;
  const region=name.startsWith('Leg')?'thigh':'upper arm';
  return {name:'garment attachment sweep',status:passed?'passed' as const:'failed' as const,samples,maxUnownedDisplacement,maxSharedFieldError,tolerance,
    ...(hidden.size?{maxExposedHiddenLeg:maxExposed,exposureAllowance}:{}),
    ...(skirts.size?{skirtLike:skirts.size}:{}),
    detail:passed?(hidden.size?'Sampled clothing bindings follow the limb field; the leg hidden under the static hem stays under it in the sampled poses.':'Sampled clothing bindings follow the limb field; no substantial static garment overlap was detected.')
      :maxUnownedDisplacement>tolerance?`Clothing overlaps the ${region} but does not follow its movement. This limb stays in its drawn pose.`
      :maxExposed>exposureAllowance?`The leg hidden under a static garment would slide out from under it (${Math.round(maxExposed)} px against ${Math.round(exposureAllowance)}). This limb stays in its drawn pose.`
      :'The clothing and limb move out of alignment in the sampled poses. This limb stays in its drawn pose.'};
}
