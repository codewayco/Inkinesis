/** Motion candidates, not a promise of visual quality. Finalize against prepared layers and meshes. */
import type {Assessment} from './analyze';

export const chainJoints = {
  'Arm L': ['shoulderL','elbowL','wristL'], 'Arm R': ['shoulderR','elbowR','wristR'],
  'Leg L': ['hipL','kneeL','ankleL'], 'Leg R': ['hipR','kneeR','ankleR'],
} as const;
export type ChainName = keyof typeof chainJoints;
export interface RegionEvidence {visible:boolean; separate:boolean; rootOccluded:boolean; reason:string}
export interface MotionCapability {
  mode:'articulated'|'limited'|'fixed'; reasons:string[];
  stage:'source'|'layers'|'geometry';
  checks?:{name:string;status:'passed'|'failed';samples?:number;detail:string}[];
}
export interface MotionCapabilities {
  version:1;
  chains:Record<ChainName,MotionCapability>;
  face:Record<'head'|'blink'|'mouth',MotionCapability>;
  headAxes?:Record<'yaw'|'pitch'|'roll',MotionCapability>;
  reviewRequired:true;
}
export function usablePoint(p:Assessment['points'][string]|undefined, minimum=.5) {
  return Boolean(p && [p.x,p.y,p.confidence].every(Number.isFinite) && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1 && p.confidence>=minimum && p.confidence<=1);
}
export function assessCapabilities(a:Assessment,width:number,height:number) {
  const result=(mode:MotionCapability['mode'],reasons:string[]):MotionCapability=>({mode,reasons,stage:'source'});
  const chains={} as MotionCapabilities['chains'];
  for(const name of Object.keys(chainJoints) as ChainName[]) {
    const ids=chainJoints[name],e=a.regions?.[name],reasons:string[]=[];
    if(e && [e.visible,e.separate,e.rootOccluded].every(v=>typeof v==='boolean') && typeof e.reason==='string') {
      if(!e.visible)reasons.push(e.reason||'This limb is not visible in the drawing.');
      else if(!e.separate)reasons.push(e.reason||'This limb overlaps another body region.');
      else if(e.rootOccluded)reasons.push(e.reason||'Clothing hides the limb attachment; independent movement is unverified.');
    } else {
      if(!a.separateLimbs)reasons.push('Independent separation of this limb has not been established.');
      if(name.startsWith('Leg')&&a.longGarment)reasons.push('Long clothing may hide the leg attachments; their visibility has not been established.');
    }
    const missing=ids.filter(id=>!usablePoint(a.points[id]));
    if(missing.length)reasons.push('The '+missing.map(id=>id.slice(0,-1)).join(' and ')+' position cannot be located reliably in this image.');
    if(!missing.length) {
      const p=ids.map(id=>a.points[id]!);
      if(p.slice(1).some((q,i)=>Math.hypot((q.x-p[i].x)*width,(q.y-p[i].y)*height)<Math.min(width,height)*.025))reasons.push('The estimated joints are too close to define a stable limb.');
      const opposite=a.points[ids[0].slice(0,-1)+(name.endsWith('L')?'R':'L')];
      if(usablePoint(opposite)&&(name.endsWith('L')?p[0].x<=opposite!.x:p[0].x>=opposite!.x))reasons.push('Left/right attachment ownership is ambiguous.');
    }
    const uncertain=ids.some(id=>!usablePoint(a.points[id],.8));
    chains[name]=reasons.length?result('fixed',reasons):result('articulated',uncertain?['Joint positions are estimated from the drawing; anatomical accuracy still needs visual review.']:[]);
  }
  const face={} as MotionCapabilities['face'];
  for(const [feature,ids] of Object.entries({head:['eyeL','eyeR','chin'],blink:['eyeL','eyeR'],mouth:['mouth']})) {
    const missing=ids.filter(id=>!usablePoint(a.points[id]));
    face[feature as keyof typeof face]=result(missing.length?'fixed':'articulated',missing.length?['Visible '+feature+' landmarks are insufficient: '+missing.join(', ')+'.']:[]);
  }
  // Pitch needs the lower face extent. Yaw and roll use the imported bust's
  // independent controls, so a hidden chin must not veto those candidates.
  const headAxes={} as NonNullable<MotionCapabilities['headAxes']>;
  for(const axis of ['yaw','pitch','roll'] as const) {
    const ids=axis==='pitch'?['eyeL','eyeR','chin']:['eyeL','eyeR'];
    const missing=ids.filter(id=>!usablePoint(a.points[id]));
    headAxes[axis]=result(missing.length?'fixed':'articulated',missing.length?[axis+' requires reliable '+missing.join(', ')+' landmarks.']:[]);
  }
  face.head=result(Object.values(headAxes).every(c=>c.mode==='fixed')?'fixed':Object.values(headAxes).some(c=>c.mode==='fixed')?'limited':'articulated',[]);
  const capabilities:MotionCapabilities={version:1,chains,face,headAxes,reviewRequired:true};
  // This bust adapter still requires a usable frontal face. Limb occlusion is not a global refusal.
  const unsupported=!a.singleCharacter||!a.frontFacing;
  const canBuild=!unsupported&&usablePoint({x:0,y:0,confidence:a.confidence})&&['eyeL','eyeR'].every(id=>usablePoint(a.points[id]));
  const reasons=[...a.reasons,...Object.entries(chains).flatMap(([name,c])=>c.reasons.map(r=>name+': '+r)),...Object.entries(face).flatMap(([name,c])=>c.reasons.map(r=>name+': '+r))];
  if(unsupported)reasons.push('A single front-facing character is required by the current face builder.');
  if(!usablePoint({x:0,y:0,confidence:a.confidence}))reasons.push('Overall analysis confidence is unavailable or below 0.5.');
  return {status:unsupported?'unsupported' as const:'needs_review' as const,canBuild,reasons,capabilities};
}
