import {attachmentMotionGate} from './attachmentMotionGate';
import {chainJoints,type ChainName,type MotionCapabilities} from '../imageToRig/capabilities';
import {inpParts,inpTextures,type InpDocument} from './inp';
import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import type {LimbPoint} from '../../engine/src/body/continuousLimb';
import {combinedMeshGate} from './combinedMeshGate';
import {semanticLayer} from './carryPsd2Live';
import {evaluateCombined,type CombinedAsset} from '../../player/src/combinedRuntime';

/**
 * The static prop a hand holds at rest, if any. The hand is the arm's artwork
 * beyond the middle of the forearm (the hand silhouette, however the fingers
 * reach), not a radius around the wrist: a fan held at the fingertips lies
 * farther from the wrist than a fist. Props are judged one connected piece at
 * a time, since one prop layer can hold a bench and a plate. A piece is held
 * when it touches the hand along a stretch at least half a forearm long in
 * pixels (a thin stick crossing a fist qualifies; no area share is needed). A
 * large piece the hand only touches along its top edge is a seat or a table
 * the hand rests on.
 */
export function heldProp(limb:Uint8ClampedArray|Uint8Array,prop:Uint8ClampedArray|Uint8Array,width:number,height:number,elbow:LimbPoint,wrist:LimbPoint) {
  const fx=wrist.x-elbow.x,fy=wrist.y-elbow.y,f2=Math.max(1e-6,fx*fx+fy*fy),forearm=Math.sqrt(f2);
  const hand=new Uint8Array(width*height);let handPixels=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(limb[i*4+3]>128&&((x-elbow.x)*fx+(y-elbow.y)*fy)/f2>=.5){hand[i]=1;handPixels++;}}
  if(!handPixels)return null;
  const labels=new Int32Array(width*height),stack:number[]=[];let count=0;
  const pieces:{area:number;top:number;bottom:number}[]=[];
  for(let start=0;start<width*height;start++){
    if(labels[start]||prop[start*4+3]<=128)continue;
    count++;labels[start]=count;stack.push(start);let area=0,top=height,bottom=0;
    while(stack.length){const i=stack.pop()!,x=i%width,y=(i-x)/width;area++;top=Math.min(top,y);bottom=Math.max(bottom,y);
      for(const j of [x>0?i-1:-1,x<width-1?i+1:-1,y>0?i-width:-1,y<height-1?i+width:-1])if(j>=0&&!labels[j]&&prop[j*4+3]>128){labels[j]=count;stack.push(j);}}
    pieces.push({area,top,bottom});
  }
  const contact=new Map<number,{n:number;y:number}>();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(!hand[y*width+x])continue;const seen=new Set<number>();
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;const l=labels[yy*width+xx];if(l)seen.add(l);}
    for(const l of seen){const c=contact.get(l)??{n:0,y:0};c.n++;c.y+=y;contact.set(l,c);}
  }
  let best:{contact:number;area:number}|null=null;
  for(const [l,c] of contact){
    const piece=pieces[l-1],rows=piece.bottom-piece.top+1;
    if(c.n<Math.max(24,.5*forearm))continue;
    if(piece.area>=5*handPixels&&(c.y/c.n-piece.top)<=.1*rows)continue;
    if(!best||c.n>best.contact)best={contact:c.n,area:piece.area};
  }
  return best;
}
export const faceLayers=/^(front hair|back hair|side hair|hair|headwear|eyewear|earwear(?:-[lr])?|face|neck|nose|ears?(?:-[lr])?|eyebrow-[lr]|irides-[lr]|eyewhite-[lr]|eyelash-[lr]|eye_close-[lr]|mouth(?:_open|_close)?|lip_upper|lip_lower|tooth-[tb]|tongue)$/;
export function layerCapabilities(puppet:InpDocument,textures:Buffer[],marks:Record<string,LimbPoint>,source:MotionCapabilities) {
  const caps=structuredClone(source),nodes=inpParts(puppet),decoded=inpTextures(textures);
  const {width,height}=puppet.meta.canvas as {width:number;height:number};
  for(const name of Object.keys(chainJoints) as ChainName[]) {
    const c=caps.chains[name];if(c.mode==='fixed')continue;
    const side=name.at(-1)!.toLowerCase(),arm=name.startsWith('Arm');
    const names=arm?[`arm-${side}`,`hand-${side}`,`handwear-${side}`]:[`legwear-${side}`,`footwear-${side}`];
    const owned=nodes.filter(n=>names.includes(n.name));
    const missing=chainJoints[name].filter(id=>!marks[id]);
    if(missing.length||!owned.some(n=>arm?/^(arm|handwear)-/.test(n.name):n.name.startsWith('legwear-'))) {
      c.mode='fixed';c.stage='layers';c.reasons.push('See-through did not provide independently usable limb layers and joint locations.');continue;
    }
    if(!arm&&nodes.some(n=>n.name==='bottomwear')&&!['hipL','hipR','kneeL','kneeR'].every(id=>marks[id])) {
      c.mode='fixed';c.stage='layers';c.reasons.push('The lower garment cannot be assigned safely to this leg without the opposite attachment landmarks.');continue;
    }
    const coverage=[...owned,...nodes.filter(n=>n.name===(arm?'topwear':'bottomwear'))];
    const rgba=renderTextured(coverage.map(n=>({xy:new Float64Array(n.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[n.textures![0]],sampling:'bilinear'} as TexturedMesh)),width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
    const points=chainJoints[name].map(id=>marks[id]),radius=Math.max(3,Math.hypot(points[2].x-points[1].x,points[2].y-points[1].y)*.15);
    // The root may be behind a sleeve. Require independent artwork at the bend,
    // tip and throughout the distal segment; never infer a moving limb from its name alone.
    const probes=Array.from({length:5},(_,i)=>({x:points[1].x+(points[2].x-points[1].x)*i/4,y:points[1].y+(points[2].y-points[1].y)*i/4}));
    const supported=probes.every(p=>{
      for(let y=Math.max(0,Math.floor(p.y-radius));y<Math.min(height,p.y+radius);y++)for(let x=Math.max(0,Math.floor(p.x-radius));x<Math.min(width,p.x+radius);x++)if(rgba[(y*width+x)*4+3]>32)return true;
      return false;
    });
    c.stage='layers';
    if(!supported){c.mode='fixed';c.reasons.push('The separated artwork does not cover the expected limb continuously; movement is disabled to avoid detached parts.');continue;}
    // A hand holding a prop the rig cannot carry would leave it floating: a
    // static prop that touches the hand at rest keeps the arm still.
    if(arm){
      const props=nodes.filter(n=>/^(objects|prop)$/.test(semanticLayer(n.name))&&n.mesh?.indices.length);
      if(props.length){
        const render=(parts:typeof nodes)=>renderTextured(parts.map(n=>({xy:new Float64Array(n.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[n.textures![0]],sampling:'bilinear'} as TexturedMesh)),width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
        const held=heldProp(render(owned),render(props),width,height,points[1],points[2]);
        if(held){c.mode='fixed';c.reasons.push(`The hand holds a prop that does not follow it (${held.contact} hand pixels against a static prop of ${held.area} pixels); the arm stays in its drawn pose so the prop is not left floating.`);}
      }
    }
  }
  const has=(name:string)=>nodes.some(n=>n.name===name&&n.mesh?.indices.length);
  if(!['eyewhite-l','eyewhite-r','eye_close-l','eye_close-r'].every(has)) {
    caps.face.blink.mode='fixed';caps.face.blink.reasons.push('See-through or expression preparation did not produce independent open and closed eye layers.');
  }
  if(!has('mouth_open')||!has('mouth_close')) {
    caps.face.mouth.mode='fixed';caps.face.mouth.reasons.push('No independently prepared speaking mouth is available; the drawn mouth is retained.');
  }
  caps.face.blink.stage=caps.face.mouth.stage='layers';
  return caps;
}

/** Removing a channel freezes it at its imported neutral state, not at an arbitrary key. */
export function finalizeMotionCapabilities(puppet:InpDocument,caps:MotionCapabilities,textures?:Buffer[],_marks?:Record<string,LimbPoint>) {
  for(const name of Object.keys(chainJoints) as ChainName[]) {
    const c=caps.chains[name],parameter=puppet.param.find(p=>p.name===name);
    if(!parameter){c.mode='fixed';continue;}
    if(textures && puppet.meta.combined) {
      const check=attachmentMotionGate(puppet,textures,name);(c.checks??=[]).push(check);
      if(check.status==='failed'){c.mode='fixed';c.stage='geometry';c.reasons.push(check.detail);puppet.param=puppet.param.filter(p=>p!==parameter);continue;}
    }
    try {const g=combinedMeshGate({...puppet,param:[parameter]});c.stage='geometry';(c.checks??=[]).push({name:'mesh foldover sweep',status:'passed',samples:g.coupledKeyAndHalfGridSamples,detail:'Authored poses and intermediate poses passed triangle orientation checks.'});}
    catch(error) {
      // Try one bounded subrange using the actual existing evaluator. Resample all
      // skin AND clothing bindings together; never change a neighboring chain.
      const original=structuredClone(parameter),nodes=inpParts(puppet),{width,height}=puppet.meta.canvas as {width:number;height:number};
      const asset:CombinedAsset={puppet:{...puppet,param:[original]},parts:nodes,width,height,textures:[]};
      parameter.min=original.min.map((v,i)=>original.defaults[i]+(v-original.defaults[i])*.5);
      parameter.max=original.max.map((v,i)=>original.defaults[i]+(v-original.defaults[i])*.5);
      const frames=parameter.axis_points[0].map(x=>parameter.axis_points[1].map(y=>new Map(evaluateCombined(asset,{[name]:[parameter.min[0]+x*(parameter.max[0]-parameter.min[0]),parameter.min[1]+y*(parameter.max[1]-parameter.min[1])]}).map(p=>[p.uuid,p]))));
      for(const b of parameter.bindings) {
        const n=nodes.find(n=>n.uuid===b.node)!;
        b.values=frames.map(col=>col.map(frame=>b.param_name==='opacity'?frame.get(b.node)!.opacity:n.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>[frame.get(b.node)!.xy[i*2]-n.mesh!.verts[i*2],frame.get(b.node)!.xy[i*2+1]-n.mesh!.verts[i*2+1]])));
      }
      try {
        const g=combinedMeshGate({...puppet,param:[parameter]});c.mode='limited';c.stage='geometry';(c.checks??=[]).push({name:'mesh foldover sweep',status:'passed',samples:g.coupledKeyAndHalfGridSamples,detail:'Reduced range passed triangle orientation checks.'});
        c.reasons.push('The full movement range failed its mesh test. A reduced range passed; extreme poses are unavailable.');
        c.reasons.push('Full-range failure: '+(error instanceof Error?error.message:String(error)));
        continue;
      } catch { /* Hold the chain still if even the reduced range is unsafe. */ }
      c.mode='fixed';c.stage='geometry';c.reasons.push('The movement test produced a mesh foldover. This limb is held in its neutral pose.');
      c.reasons.push(error instanceof Error?error.message:String(error));
      puppet.param=puppet.param.filter(p=>p!==parameter);
    }
  }
  if(caps.headAxes) {
    const nodes=inpParts(puppet),{width,height}=puppet.meta.canvas as {width:number;height:number};
    for(const [axis,c] of Object.entries(caps.headAxes)) {
      const p=puppet.param.find(p=>p.name===(axis==='roll'?'ParamAngleZ':'Head Angles'));
      if(c.mode==='fixed')continue;
      if(!p?.bindings.length){c.mode='fixed';c.reasons.push('No independent control was produced for this head axis.');continue;}
      const index=axis==='pitch'?1:0;
      // Check each head axis at the other axis's neutral value, without changing
      // the authored deformation. A chin veto affects pitch alone.
      const asset:CombinedAsset={puppet:{...puppet,param:[p]},parts:nodes,width,height,textures:[]};
      const frames=p.axis_points[index].map(t=>{const v=[...p.defaults];v[index]=p.min[index]+t*(p.max[index]-p.min[index]);return evaluateCombined(asset,{[p.name]:v});});
      const valid=frames.every(f=>f.every(n=>n.xy.every(Number.isFinite)&&Number.isFinite(n.opacity)));
      (c.checks??=[]).push({name:'axis control evaluation',status:valid?'passed':'failed',samples:frames.length,detail:'Independent authored axis evaluated for finite coordinates; visual neck/face quality still requires review.'});
      c.stage='geometry';if(!valid){c.mode='fixed';c.reasons.push('This head axis produced invalid coordinates.');}
    }
    const p=puppet.param.find(p=>p.name==='Head Angles');
    if(p && ['yaw','pitch'].some(axis=>caps.headAxes![axis as 'yaw'|'pitch'].mode==='fixed')) {
      const original=structuredClone(p),asset:CombinedAsset={puppet:{...puppet,param:[original]},parts:nodes,width,height,textures:[]};
      const frames=p.axis_points[0].map(x=>p.axis_points[1].map(y=>{const v=[p.min[0]+x*(p.max[0]-p.min[0]),p.min[1]+y*(p.max[1]-p.min[1])];if(caps.headAxes!.yaw.mode==='fixed')v[0]=p.defaults[0];if(caps.headAxes!.pitch.mode==='fixed')v[1]=p.defaults[1];return new Map(evaluateCombined(asset,{[p.name]:v}).map(n=>[n.uuid,n]));}));
      for(const b of p.bindings){const n=nodes.find(n=>n.uuid===b.node)!;b.values=frames.map(col=>col.map(f=>b.param_name==='opacity'?f.get(b.node)!.opacity:n.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>[f.get(b.node)!.xy[i*2]-n.mesh!.verts[i*2],f.get(b.node)!.xy[i*2+1]-n.mesh!.verts[i*2+1]])));}
    }
    caps.face.head.mode=Object.values(caps.headAxes).every(c=>c.mode==='fixed')?'fixed':Object.values(caps.headAxes).some(c=>c.mode==='fixed')?'limited':'articulated';
  }
  for(const [feature,names] of Object.entries({head:['Head Angles','ParamAngleZ'],blink:['ParamEyeLOpen','ParamEyeROpen'],mouth:['ParamMouthOpenY']})) {
    const c=caps.face[feature as keyof typeof caps.face];
    if(feature==='head'&&caps.headAxes){c.stage='geometry';continue;}
    if(c.mode!=='fixed'&&!names.every(name=>puppet.param.some(p=>p.name===name&&p.bindings.length))) {
      c.mode='fixed';c.reasons.push('The prepared rig has no complete independent control for this feature.');
    }
    if(c.mode!=='fixed')(c.checks??=[]).push({name:'prepared expression controls',status:'passed',detail:'Required expression layers and independent controls are present; expression appearance still needs visual review.'});
  }
  const removed=puppet.param.filter(p=>(caps.face.head.mode==='fixed'&&/^(Head Angles|ParamAngleZ)$/.test(p.name))||(caps.headAxes?.roll.mode==='fixed'&&p.name==='ParamAngleZ')||(caps.face.mouth.mode==='fixed'&&/^ParamMouth/.test(p.name))||(caps.face.blink.mode==='fixed'&&/^ParamEye[LR]Open$/.test(p.name)));
  if(removed.length) {
    const nodes=inpParts(puppet),{width,height}=puppet.meta.canvas as {width:number;height:number};
    const neutral=evaluateCombined({puppet:{...puppet,param:removed},parts:nodes,width,height,textures:[]} as CombinedAsset,{});
    puppet.param=puppet.param.filter(p=>!removed.includes(p));
    for(const n of nodes) {
      const frozen=neutral.find(p=>p.uuid===n.uuid)!;
      n.mesh!.verts=frozen.xy;
      if(!removed.some(p=>p.bindings.some(b=>b.node===n.uuid&&b.param_name==='opacity')))continue;
      // Runtime opacity tracks override node opacity. Fold the frozen factor into
      // the first remaining opacity owner, if any, instead of revealing a closed patch.
      const owner=puppet.param.flatMap(p=>p.bindings).find(b=>b.node===n.uuid&&b.param_name==='opacity');
      if(owner)owner.values=(owner.values as number[][]).map(col=>col.map(v=>v*frozen.opacity));
      else n.opacity=frozen.opacity;
    }
  }
  puppet.meta.motionCapabilities=caps;
}
