/** Conservative kinematic check: artwork covering a moving bone must share its
 * deformation. This does not establish anatomical correctness or hidden artwork. */
import {inpParts,inpTextures,type InpDocument} from './inp';
import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import {poseContinuousLimb,type ContinuousLimb,type LimbPoint} from '../../engine/src/body/continuousLimb';
import {evaluateCombined,type CombinedAsset} from '../../player/src/combinedRuntime';
import type {ChainName} from '../imageToRig/capabilities';
export function attachmentMotionGate(puppet:InpDocument,textures:Buffer[],name:ChainName) {
  const {width,height}=puppet.meta.canvas as {width:number;height:number},nodes=inpParts(puppet);
  const record=(puppet.meta.combined as {chains:{name:string;chain:ContinuousLimb;distalSign:number}[]}).chains.find(c=>c.name===name)!;
  const param=puppet.param.find(p=>p.name===name)!;
  const decoded=inpTextures(textures),garments=nodes.filter(n=>/^(topwear|bottomwear)(?:__|$)/.test(n.name));
  const upper=Math.hypot(record.chain.joint.x-record.chain.root.x,record.chain.joint.y-record.chain.root.y);
  const probes: LimbPoint[]=Array.from({length:5},(_,i)=>{const t=.4+i*.15;return {x:record.chain.root.x+(record.chain.joint.x-record.chain.root.x)*t,y:record.chain.root.y+(record.chain.joint.y-record.chain.root.y)*t};});
  const owners=garments.map(n=>{
    const rgba=renderTextured([{xy:new Float64Array(n.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[n.textures![0]],sampling:'bilinear'} as TexturedMesh],width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
    const covered=probes.filter(p=>{const x=Math.round(p.x),y=Math.round(p.y);return x>=0&&y>=0&&x<width&&y<height&&rgba[(y*width+x)*4+3]>128;});
    return {n,covered,bound:param.bindings.some(b=>b.node===n.uuid&&b.param_name==='deform')};
  });
  const values=[...new Set([param.min[0],(param.min[0]+param.defaults[0])/2,param.defaults[0],(param.max[0]+param.defaults[0])/2,param.max[0]])];
  const bends=[...new Set([param.min[1],param.defaults[1],param.max[1]])];
  let samples=0,maxUnownedDisplacement=0,maxSharedFieldError=0;
  const asset:CombinedAsset={puppet:{...puppet,param:[param]},parts:nodes,width,height,textures:[]};
  for(const x of values)for(const y of bends) {
    samples++;
    const posed=new Map(evaluateCombined(asset,{[name]:[x,y]}).map(p=>[p.uuid,p]));
    for(const {n,covered,bound} of owners) {
      if(!bound) {
        // Two interior samples distinguish a substantial occluder
        // from a trim edge or the normal root overlap at a shoulder/hip.
        if(covered.length>=2)for(const p of covered){const q=poseContinuousLimb(p,record.chain,x,y*record.distalSign);maxUnownedDisplacement=Math.max(maxUnownedDisplacement,Math.hypot(q.x-p.x,q.y-p.y));}
      } else {
        const xy=posed.get(n.uuid)!.xy,v=n.mesh!.verts;
        for(let i=0;i<v.length;i+=2){const p={x:v[i]+width/2,y:v[i+1]+height/2},q=poseContinuousLimb(p,record.chain,x,y*record.distalSign);maxSharedFieldError=Math.max(maxSharedFieldError,Math.hypot(xy[i]+width/2-q.x,xy[i+1]+height/2-q.y));}
      }
    }
  }
  // Express tolerances relative to the chain, independent of character or resolution.
  const tolerance=Math.max(2,upper*.025);
  const passed=maxUnownedDisplacement<=tolerance&&maxSharedFieldError<=tolerance;
  const region=name.startsWith('Leg')?'thigh':'upper arm';
  return {name:'garment attachment sweep',status:passed?'passed' as const:'failed' as const,samples,maxUnownedDisplacement,maxSharedFieldError,tolerance,detail:passed?'Sampled clothing bindings follow the limb field; no substantial static garment overlap was detected.':maxUnownedDisplacement>tolerance?`Clothing overlaps the ${region} but does not follow its movement. This limb stays in its drawn pose.`:'The clothing and limb move out of alignment in the sampled poses. This limb stays in its drawn pose.'};
}
