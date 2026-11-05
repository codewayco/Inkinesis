import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import {sourceGripProbes,sourceGripSlip} from './sourceGripConstraint';
import {inpParts,inpTextures,type InpDocument} from './inp';
import {poseContinuousLimb,continuousLimbWeights,type ContinuousLimb} from '../../engine/src/body/continuousLimb';
import {drawsNoTexture,combinedMeshGate} from './combinedMeshGate';
import {attachmentMotionGate} from './attachmentMotionGate';
import {evaluateCombined} from '../../player/src/combinedRuntime';
import {poseHeldProp} from './heldPropAttachments';
/** Source-only shoulder transition search. Existing ranges and wrist influence are
 * held fixed. Source area, axis and peak deformation must all improve or tie;
 * every accepted candidate also passes original ownership and full mesh gates. */
export function optimizeRootRadial(puppet:InpDocument,textures:Buffer[],options:{armMatteCoverage?:boolean}={}) {
 const {width,height}=puppet.meta.canvas as {width:number;height:number},nodes=inpParts(puppet),decoded=inpTextures(textures),report=[];
 const garments=nodes.filter(n=>/^(topwear|bottomwear)(?:__|$)/.test(n.name));
 const garmentAlpha=renderTextured(garments.map(n=>({xy:new Float64Array(n.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[n.textures![0]],sampling:'bilinear'} as TexturedMesh)),width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
 const combined=puppet.meta.combined as {chains:{name:string;chain:ContinuousLimb;sampling?:unknown}[]};
 for(const record of combined.chains){
  const p=puppet.param.find(p=>p.name===record.name),chain=record.chain;
  if(!p||!/^Arm /.test(p.name)||chain.blendMode!=='angle'||chain.weightField||chain.rootMode==='rigid'||chain.attachmentPins)continue;
  const side=p.name.at(-1)!.toLowerCase(),parts=nodes.filter(n=>new RegExp(`^(arm|hand|handwear)-${side}(?:#|__|$)`).test(n.name));
  const meshes=parts.map(n=>{const m=n.mesh!,texture=decoded[n.textures![0]],points=m.verts.filter((_,i)=>i%2===0).map((_,i)=>({x:m.verts[2*i]+width/2,y:m.verts[2*i+1]+height/2})),tri=[];
   for(let i=0;i<m.indices.length;i+=3){const [a,c,d]=m.indices.slice(i,i+3),A=[points[c].x-points[a].x,points[d].x-points[a].x,points[c].y-points[a].y,points[d].y-points[a].y],det=A[0]*A[3]-A[1]*A[2];
    if(Math.abs(det)<=.1||drawsNoTexture(m.uvs,a,c,d))continue;
    // Uniform interior quadrature over the source texture, independent of any
    // evaluation mask/probe. Transparent padding must not dominate the objective.
    let coverage=0,count=0;
    for(let u=0;u<6;u++)for(let v=0;v<6-u;v++){
     const b=(u+1/3)/6,cw=(v+1/3)/6,aw=1-b-cw;
     const tx=Math.max(0,Math.min(texture.width-1,Math.round((aw*m.uvs[2*a]+b*m.uvs[2*c]+cw*m.uvs[2*d])*(texture.width-1))));
     const ty=Math.max(0,Math.min(texture.height-1,Math.round((aw*m.uvs[2*a+1]+b*m.uvs[2*c+1]+cw*m.uvs[2*d+1])*(texture.height-1))));
     coverage+=texture.rgba[4*(ty*texture.width+tx)+3]/255;count++;
    }
    coverage/=count;if(coverage<1e-6)continue;tri.push({ids:[a,c,d],inv:[A[3]/det,-A[1]/det,-A[2]/det,A[0]/det],det,weight:Math.abs(det)*coverage});
   }return {node:n,points,tri};
  });
  if(!meshes.some(m=>m.tri.length)){report.push({name:record.name,selected:null,reason:'No alpha-supported source triangles'});continue;}
  const upper=Math.hypot(chain.joint.x-chain.root.x,chain.joint.y-chain.root.y),originalWeights=continuousLimbWeights(chain.tip,chain);
  // Restore the accepted root field on the actual opaque garment/torso cut.
  // Include every vertex of triangles touching the cut so baked interpolation
  // agrees there, not only the analytic source-pixel field.
  const boundaryPoints:{x:number;y:number}[]=[];
  for(const fragment of nodes.filter(n=>n.name.endsWith('__'+record.name.replace(' ','_')))){
   const torso=nodes.find(n=>n.name===fragment.name.split('__')[0]+'__torso');if(!torso)continue;
   const a=decoded[fragment.textures![0]],z=decoded[torso.textures![0]];
   if(a.width!==width||a.height!==height||z.width!==width||z.height!==height)throw Error('Boundary restoration requires canvas-space garment textures');
   const cut:{x:number;y:number}[]=[];
   for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;if(a.rgba[4*i+3]<128)continue;
    if([i,i-1,i+1,i-width,i+width].some(j=>z.rgba[4*j+3]>=128))cut.push({x,y});
   }
   const m=fragment.mesh!,points=m.verts.filter((_,i)=>i%2===0).map((_,i)=>({x:m.verts[2*i]+width/2,y:m.verts[2*i+1]+height/2}));
   const near=points.map(q=>cut.some(c=>Math.hypot(q.x-c.x,q.y-c.y)<=16));
   const indices=new Set<number>();for(let i=0;i<m.indices.length;i+=3){const ids=m.indices.slice(i,i+3);if(ids.some(j=>near[j]))ids.forEach(j=>indices.add(j));}
   for(const i of indices)boundaryPoints.push(points[i]);
  }
  // Preserve all currently authored garment vertices, and limb triangles that
  // contain opaque source garment/skin contact. This keeps pre-existing material
  // correspondence unchanged while allowing exposed shoulder material to improve.
  const bindings=new Set(p.bindings.map(b=>b.node));
  for(const n of garments.filter(n=>bindings.has(n.uuid))){const m=n.mesh!;for(let i=0;i<m.verts.length;i+=2)boundaryPoints.push({x:m.verts[i]+width/2,y:m.verts[i+1]+height/2});}
  for(const m of meshes){const texture=decoded[m.node.textures![0]],uv=m.node.mesh!.uvs;
   for(const tr of m.tri){const pts=tr.ids.map(i=>m.points[i]),[a,c,d]=pts,ux=c.x-a.x,uy=c.y-a.y,vx=d.x-a.x,vy=d.y-a.y,det=ux*vy-uy*vx;
    let touch=false;
    for(let y=Math.max(0,Math.floor(Math.min(...pts.map(q=>q.y))));y<=Math.min(height-1,Math.ceil(Math.max(...pts.map(q=>q.y))))&&!touch;y++)for(let x=Math.max(0,Math.floor(Math.min(...pts.map(q=>q.x))));x<=Math.min(width-1,Math.ceil(Math.max(...pts.map(q=>q.x))));x++){
     if(garmentAlpha[4*(y*width+x)+3]<64)continue;
     const zx=x-a.x,zy=y-a.y,wb=(zx*vy-zy*vx)/det,wc=(ux*zy-uy*zx)/det,wa=1-wb-wc;if(Math.min(wa,wb,wc)<-1e-8)continue;
     const [i,j,k]=tr.ids,u=wa*uv[2*i]+wb*uv[2*j]+wc*uv[2*k],v=wa*uv[2*i+1]+wb*uv[2*j+1]+wc*uv[2*k+1];
     const tx=Math.max(0,Math.min(texture.width-1,Math.round(u*(texture.width-1)))),ty=Math.max(0,Math.min(texture.height-1,Math.round(v*(texture.height-1))));
     if(texture.rgba[4*(ty*texture.width+tx)+3]>=64){touch=true;break;}
    }
    if(touch)boundaryPoints.push(...pts);
   }
  }
  const unique=new Map<string,{x:number;y:number}>();
  for(const q of boundaryPoints)if(Math.hypot(q.x-chain.root.x,q.y-chain.root.y)<upper+Math.max(12,.3*upper)||continuousLimbWeights(q,chain).root<.999999)unique.set(q.x+','+q.y,q);
  boundaryPoints.splice(0,boundaryPoints.length,...unique.values());
  const rootBoundary=boundaryPoints.length?{points:boundaryPoints,fixedRadius:2,blendRadius:Math.max(12,.3*upper)}:undefined;

  const evaluate=(c:ContinuousLimb)=>{
   const w=continuousLimbWeights(c.tip,c);if(Math.abs(w.root-originalWeights.root)+Math.abs(w.distal-originalWeights.distal)>1e-8)return null;
   let area=0,axis=0,total=0,flips=0,peak=1;
   for(const t of [0,.25,.5,.75,1])for(const u of [0,.25,.5,.75,1]){
    const x=p.min[0]+t*(p.max[0]-p.min[0]),y=p.min[1]+u*(p.max[1]-p.min[1]);
    for(const m of meshes){const q=m.points.map(v=>poseContinuousLimb(v,c,x,y));
     for(const tr of m.tri){const [a,d,e]=tr.ids.map(i=>q[i]),B=[d.x-a.x,e.x-a.x,d.y-a.y,e.y-a.y],I=tr.inv,F=[B[0]*I[0]+B[1]*I[2],B[0]*I[1]+B[1]*I[3],B[2]*I[0]+B[3]*I[2],B[2]*I[1]+B[3]*I[3]],det=F[0]*F[3]-F[1]*F[2],sum=F.reduce((s,x)=>s+x*x,0),disc=Math.sqrt(Math.max(0,sum*sum-4*det*det)),smax=Math.sqrt(Math.max(0,(sum+disc)/2)),smin=Math.abs(det)/Math.max(smax,1e-12),stretch=Math.max(smax,1/Math.max(smin,1e-12));
      area+=tr.weight*Math.abs(Math.log(Math.max(Math.abs(det),1e-12)));axis+=tr.weight*Math.log(Math.max(1,stretch));total+=tr.weight;flips+=det<=0?1:0;peak=Math.max(peak,stretch);
     }
    }
   }return {area:area/total,axis:axis/total,flips,peak};
  };
  const probes=meshes.flatMap(m=>m.tri.map(tr=>{
   const point={x:tr.ids.reduce((s,i)=>s+m.points[i].x,0)/3,y:tr.ids.reduce((s,i)=>s+m.points[i].y,0)/3};
   return {node:m.node.uuid,ids:tr.ids,point,distance:Math.hypot(point.x-chain.tip.x,point.y-chain.tip.y)};
  })).filter(q=>q.distance<upper*.2).sort((a,b)=>a.distance-b.distance).slice(0,8);
  const baseline=evaluate(chain)!,candidates=[];
  for(const r of [.1,.2,.35,.5,.7,1]){
   const candidate:ContinuousLimb={...chain,rootMode:'radial',radialRadius:upper*r,rootBoundary};
   const preservesWrist=probes.every(probe=>{const m=meshes.find(m=>m.node.uuid===probe.node)!;return probe.ids.every(i=>{const before=continuousLimbWeights(m.points[i],chain),after=continuousLimbWeights(m.points[i],candidate);return Math.abs(before.root-after.root)+Math.abs(before.distal-after.distal)<1e-10;});});
   const metrics=preservesWrist?evaluate(candidate):null;if(metrics)candidates.push({rootFraction:r,jointFraction:chain.jointBlend/upper,...metrics});
  }
  const viable=candidates.filter(c=>c.flips===0&&c.area<baseline.area*.98&&c.axis<=baseline.axis&&c.peak<=baseline.peak).sort((a,c)=>a.area-c.area);

  const contact=sourceGripProbes(puppet,textures,record.name,chain);
  const assessBaked=(doc:InpDocument)=>{
   let area=0,axis=0,total=0,tipError=0,tipPeak=0,tipCount=0,contactSum=0,contactCount=0,contactMax=0;const poseAxes:number[]=[];
   for(const t of [0,.137,.317,.5,.683,.863,1])for(const u of [0,.137,.317,.5,.683,.863,1]){
    const x=p.min[0]+t*(p.max[0]-p.min[0]),y=p.min[1]+u*(p.max[1]-p.min[1]);
    const frames=new Map(evaluateCombined({puppet:doc,parts:nodes,width,height,textures:[]},{[p.name]:[x,y]}).map(n=>[n.uuid,n.xy]));
    const grip=sourceGripSlip(contact.probes,frames);contactSum+=grip.sum;contactCount+=grip.count;contactMax=Math.max(contactMax,grip.max);
    let localAxis=0,localWeight=0;
    for(const m of meshes){const q=frames.get(m.node.uuid)!;
     for(const tr of m.tri){const [a,d,e]=tr.ids,B=[q[2*d]-q[2*a],q[2*e]-q[2*a],q[2*d+1]-q[2*a+1],q[2*e+1]-q[2*a+1]],I=tr.inv;
      const F=[B[0]*I[0]+B[1]*I[2],B[0]*I[1]+B[1]*I[3],B[2]*I[0]+B[3]*I[2],B[2]*I[1]+B[3]*I[3]],det=F[0]*F[3]-F[1]*F[2],sum=F.reduce((s,x)=>s+x*x,0),disc=Math.sqrt(Math.max(0,sum*sum-4*det*det)),smax=Math.sqrt(Math.max(0,(sum+disc)/2)),smin=Math.abs(det)/Math.max(smax,1e-12),stretch=Math.max(1,smax,1/Math.max(smin,1e-12));
      area+=tr.weight*Math.abs(Math.log(Math.max(Math.abs(det),1e-12)));axis+=tr.weight*Math.log(stretch);total+=tr.weight;localAxis+=tr.weight*Math.log(stretch);localWeight+=tr.weight;
     }
    }
    poseAxes.push(localAxis/Math.max(localWeight,1e-12));
    for(const probe of probes){const xy=frames.get(probe.node)!,actual={x:probe.ids.reduce((s,i)=>s+xy[2*i],0)/3+width/2,y:probe.ids.reduce((s,i)=>s+xy[2*i+1],0)/3+height/2},expected=poseHeldProp(probe.point,chain,x,y),error=Math.hypot(actual.x-expected.x,actual.y-expected.y);tipError+=error;tipPeak=Math.max(tipPeak,error);tipCount++;}
   }
   return {area:area/total,axis:axis/total,tipError:tipError/Math.max(1,tipCount),tipPeak,tipCount,poseAxes,contactMean:contactSum/Math.max(1,contactCount),contactMax};
  };
  const bakedBaseline=assessBaked({...puppet,param:[p]});
  const attempts=[];let selected:unknown=null;
  for(const proposal of viable){
   const nextChain:ContinuousLimb={...chain,rootMode:'radial',radialRadius:upper*proposal.rootFraction,rootBoundary,jointBlend:upper*proposal.jointFraction},parameter=structuredClone(p);
   for(const bind of parameter.bindings){
    if(bind.param_name!=='deform')throw Error('Shoulder optimization requires deformation bindings');
    const node=nodes.find(n=>n.uuid===bind.node)!;
    const priorValues=bind.values as number[][][][];
    bind.values=parameter.axis_points[0].map((t,ti)=>parameter.axis_points[1].map((u,ui)=>{
     const x=parameter.min[0]+t*(parameter.max[0]-parameter.min[0]),y=parameter.min[1]+u*(parameter.max[1]-parameter.min[1]);
     return node.mesh!.verts.filter((_,i)=>i%2===0).map((_,i)=>{const q={x:node.mesh!.verts[2*i]+width/2,y:node.mesh!.verts[2*i+1]+height/2},posed=/^(objects|prop)(?:#|__|$)/.test(node.name)?poseHeldProp(q,nextChain,x,y):poseContinuousLimb(q,nextChain,x,y);const priorPosed=/^(objects|prop)(?:#|__|$)/.test(node.name)?poseHeldProp(q,chain,x,y):poseContinuousLimb(q,chain,x,y);return [priorValues[ti][ui][i][0]+posed.x-priorPosed.x,priorValues[ti][ui][i][1]+posed.y-priorPosed.y];});
    }));
   }
   const trial:InpDocument={...puppet,param:[parameter],meta:{...puppet.meta,combined:{...combined,chains:combined.chains.map(r=>r===record?{...r,chain:nextChain}:r)}}};
   const baked=assessBaked(trial);
   if((contact.hasCarrier&&(!contact.probes.length||baked.contactMean>bakedBaseline.contactMean+.001||baked.contactMax>bakedBaseline.contactMax+.001))||!probes.length||baked.area>=bakedBaseline.area*.98||baked.poseAxes.some((v,i)=>v>bakedBaseline.poseAxes[i]+1e-7)||baked.tipError>bakedBaseline.tipError+.001||baked.tipPeak>bakedBaseline.tipPeak+.001){
    attempts.push({proposal,accepted:false,reason:'Baked visible-surface or source wrist-material constraint failed',baked});continue;
   }
   const attachment=attachmentMotionGate(trial,textures,p.name as 'Arm L'|'Arm R',{armMatteCoverage:options.armMatteCoverage});
   if(attachment.status!=='passed'){attempts.push({proposal,accepted:false,reason:'Existing garment attachment gate failed',attachment});continue;}
   try {const mesh=combinedMeshGate(trial);puppet.param[puppet.param.indexOf(p)]=parameter;record.chain=nextChain;record.sampling={status:'Dense grid reused after source shoulder choice; unchanged range and full key/half-grid validation',prior:record.sampling};selected=proposal;attempts.push({proposal,accepted:true,mesh,attachment,baked});break;}
   catch(e){attempts.push({proposal,accepted:false,reason:String(e)});}
  }
  report.push({name:record.name,sourceBoundary:{points:boundaryPoints.length},sourceGrip:{hasCarrier:contact.hasCarrier,probes:contact.probes.length},candidateCount:candidates.length,viableCount:viable.length,original:{rootFraction:chain.rootBlend/upper,jointFraction:chain.jointBlend/upper,...baseline},selected,attempts,bakedBaseline,sourceWristProbes:probes.length,scope:'Radial shoulder transition candidate;25 analytical and 49 baked retained authoring-range samples;analytical wrist weights exact,alpha-weighted source area/axis and peak constrained; baked axis non-worse at every source pose and 8 nearest source wrist triangle centroids stay within 0.001px of prior mean/max rigid-hand error. Existing ranges,ownership and full key/half-grid gates unchanged. Full visual/export checks still required.'});
 }
 return report;
}
