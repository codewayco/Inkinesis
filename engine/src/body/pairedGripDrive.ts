import {solveGripWrist} from './pairedGrip';
import type {ContinuousLimb,LimbPoint} from './continuousLimb';
const rotate=(p:LimbPoint,c:LimbPoint,deg:number):LimbPoint=>{const t=deg*Math.PI/180,x=p.x-c.x,y=p.y-c.y;return {x:c.x+x*Math.cos(t)-y*Math.sin(t),y:c.y+x*Math.sin(t)+y*Math.cos(t)};};
const bounded=(a:ReturnType<typeof solveGripWrist>)=>a.ok&&Math.abs(a.proximal)<=30+1e-8&&Math.abs(a.distal)<=60+1e-8;
/** Authoring-time single-hand driver with a passive linked hand. The target
 * comes from the original two-link FK command. A rigid inter-grip vector may
 * rotate, never stretch, and both IK solutions stay on their source branch.
 * This does not provide two independent arms. The passive joint-excursion
 * objective is refined continuously within a sampled angular bracket;
 * source-grid continuity, mesh/garment and baked contact checks remain required. */
export function solveGripDrive(chains:[ContinuousLimb,ContinuousLimb],driver:0|1,root:number,bend:number){
 if(!Number.isFinite(root)||!Number.isFinite(bend)||Math.abs(root)>30+1e-8||Math.abs(bend)>60+1e-8)return {ok:false as const,reason:'Driver command outside finite source range'};
 const own=chains[driver],other=chains[1-driver],target=rotate(rotate(own.tip,own.joint,bend),own.root,root),ownSolve=solveGripWrist(own,target);
 if(!bounded(ownSolve))return {ok:false as const,reason:'Driver target unreachable on source branch or exceeds angle bounds'};
 const at=(theta:number)=>{const delta=rotate(other.tip,own.tip,theta),otherTarget={x:target.x+delta.x-own.tip.x,y:target.y+delta.y-own.tip.y},otherSolve=solveGripWrist(other,otherTarget);return {theta,otherTarget,otherSolve};};
 // Minimize passive joint excursion, with a small object rotation penalty.
 // Minimizing rotation alone tends to land exactly on a passive elbow limit,
 // leaving no deformation margin for the existing lift. All quantities use
 // source angular ranges.
 const cost=(s:ReturnType<typeof at>)=>s.otherSolve.ok&&bounded(s.otherSolve)?(s.otherSolve.proximal/30)**2+(s.otherSolve.distal/60)**2+.1*(s.theta/60)**2:Infinity;
 let chosen=at(0),best=cost(chosen);
 for(let theta=-60;theta<=60;theta+=.5){const q=at(theta),c=cost(q);if(c<best){chosen=q;best=c;}}
 if(!Number.isFinite(best))return {ok:false as const,reason:'No bounded rigid linked-hand pose within 60 deg object rotation'};
 let lo=Math.max(-60,chosen.theta-.5),hi=Math.min(60,chosen.theta+.5);
 // Local continuous refinement around the best feasible angular sample.
 for(let k=0;k<28;k++){const a=lo+(hi-lo)/3,c=hi-(hi-lo)/3,ca=cost(at(a)),cc=cost(at(c));if(ca<=cc)hi=c;else lo=a;}
 const refined=at((lo+hi)/2);if(cost(refined)<best){chosen=refined;best=cost(refined);}
 const zero=at(0);if(cost(zero)<=best+1e-12)chosen=zero;
 const arms=driver===0?[ownSolve,chosen.otherSolve]:[chosen.otherSolve,ownSolve],targets=driver===0?[target,chosen.otherTarget]:[chosen.otherTarget,target];
 return {ok:true as const,driver,theta:chosen.theta,target,targets,arms};
}
export function poseGripObject(p:LimbPoint,driverTip:LimbPoint,target:LimbPoint,theta:number):LimbPoint{
 const q=rotate(p,driverTip,theta);return {x:target.x+q.x-driverTip.x,y:target.y+q.y-driverTip.y};
}

import {poseGripFrame} from './pairedGrip';
/** The shared hand-frame field anchors both lift and driver to the shoulder. */
export function poseGripDriveFrame(p:LimbPoint,chain:ContinuousLimb,proximal:number,distal:number,theta:number):LimbPoint{
 return poseGripFrame(p,chain,proximal,distal,theta,-.25);
}
