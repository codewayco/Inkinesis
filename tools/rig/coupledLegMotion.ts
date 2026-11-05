/** Additional sampled simultaneous-leg check. Only newly enabled controls may shrink. */
import {readCombined,evaluateCombined} from '../../player/src/combinedRuntime';
import {writeInp,combinedChains} from './inp';
import type {ChainName,MotionCapabilities} from '../imageToRig/capabilities';
import {combinedMeshGate,drawsNoTexture} from './combinedMeshGate';
import {clipParameterGrid} from './parameterGridClip';
import {attachmentMotionGate} from './attachmentMotionGate';
export function guardCoupledLegMotion(candidate:Buffer,reference:Buffer) {
 const bytes=candidate,a=readCombined(candidate),original=readCombined(reference);
const legNames=['Leg L','Leg R'],parts=a.parts;const area=(v:number[],t:number[])=>(v[t[1]*2]-v[t[0]*2])*(v[t[2]*2+1]-v[t[0]*2+1])-(v[t[1]*2+1]-v[t[0]*2+1])*(v[t[2]*2]-v[t[0]*2]);
const neutral=evaluateCombined(a,{});const triangles=parts.flatMap((p,i)=>{if(!/^(arm|handwear|legwear|footwear|topwear|bottomwear)/.test(p.name))return[];const m=p.mesh!,out:{i:number;t:number[];rest:number}[]=[];for(let k=0;k<m.indices.length;k+=3){const t=m.indices.slice(k,k+3),rest=area(m.verts,t);if(Math.abs(rest)>.1&&!drawsNoTexture(m.uvs,...t as [number,number,number]))out.push({i,t,rest});}return out;});
function sweep(){
 const fields=legNames.map(name=>{const p=a.puppet.param.find(p=>p.name===name);if(!p)return [parts.map(n=>n.mesh!.verts.map(()=>0))];const sub={...a,puppet:{...a.puppet,param:[p]}};const base=evaluateCombined(sub,{});return [0,.25,.5,.75,1].flatMap(x=>[0,.25,.5,.75,1].map(y=>evaluateCombined(sub,{[name]:[p.min[0]+x*(p.max[0]-p.min[0]),p.min[1]+y*(p.max[1]-p.min[1])]}).map((n,i)=>n.xy.map((v,k)=>v-base[i].xy[k]))));});let failed=0,checks=0,first:{leftGrid:number;rightGrid:number;part:string;triangle:number[]}|null=null;
 for(let l=0;l<fields[0].length;l++)for(let rr=0;rr<fields[1].length;rr++){const xy=neutral.map((p,i)=>p.xy.map((v,k)=>v+fields[0][l][i][k]+fields[1][rr][i][k]));let bad=false;for(const q of triangles){if(!neutral[q.i].enabled||neutral[q.i].opacity<=0)continue;checks++;const v=area(xy[q.i],q.t);if(!Number.isFinite(v)||v*q.rest<=0){bad=true;first??={leftGrid:l,rightGrid:rr,part:parts[q.i].name,triangle:q.t};}}if(bad)failed++;}
 return {status:failed?'failed':'passed',failedStates:failed,states:fields[0].length*fields[1].length,triangleChecks:checks,first};
}
const before=sweep(),eligible=a.puppet.param.filter(p=>legNames.includes(p.name)&&!original.puppet.param.some(q=>q.name===p.name)).map(p=>structuredClone(p));let after=before,scale=1;const trials:Record<string,unknown>[]=[];let fallback=false;
function at(s:number){for(const p of eligible){const q=clipParameterGrid(p,p.min.map((v,i)=>p.defaults[i]+(v-p.defaults[i])*s),p.max.map((v,i)=>p.defaults[i]+(v-p.defaults[i])*s));Object.assign(a.puppet.param.find(q=>q.name===p.name)!,q);}const check=sweep();trials.push({scale:s,...check});return check;}
if(before.failedStates){let good=0,bad=1;for(const s of[.5,.25,.125,.0625]){const c=at(s);if(c.status==='passed'){good=s;after=c;break;}bad=s;}if(good){for(let i=0;i<5;i++){const s=(good+bad)/2,c=at(s);if(c.status==='passed'){good=s;after=c;}else bad=s;}scale=good;after=at(good);}else fallback=true;}
let resultBytes:Buffer;const attachment:ReturnType<typeof attachmentMotionGate>[]=[];if(fallback){resultBytes=reference;}else{
 if(scale<1){for(const p of eligible){const q=a.puppet.param.find(t=>t.name===p.name)!;const caps=(a.puppet.meta.motionCapabilities as MotionCapabilities).chains[p.name as ChainName];caps.mode='limited';caps.reasons.push(`Simultaneous-leg gate retained ${(scale*100).toFixed(3)}% of this newly enabled control span; pre-existing controls unchanged.`);const ch=combinedChains(a.puppet).find(c=>c.name===p.name)!;ch.range=[q.min,q.max];attachment.push(attachmentMotionGate(a.puppet,a.textures.map(t=>Buffer.from(t)),p.name as ChainName,{armMatteCoverage:true}));}if(attachment.some(c=>c.status!=='passed')){fallback=true;after={status:'passed',failedStates:0,states:1,triangleChecks:0,first:null};}}
 const gate=combinedMeshGate(a.puppet);if(gate.status!=='passed')fallback=true;resultBytes=fallback?reference:scale===1?bytes:writeInp(a.puppet,a.textures.map(t=>Buffer.from(t)));
}
const unchanged=original.puppet.param.filter(p=>legNames.includes(p.name)).every(p=>{const q=a.puppet.param.find(q=>q.name===p.name);const beforeP=readCombined(bytes).puppet.param.find(q=>q.name===p.name);return JSON.stringify(q)===JSON.stringify(beforeP)});
if(!unchanged)throw Error('Existing moving leg parameter changed by coupled guard');return {file:resultBytes,report:{before,after,scale,rejectedToOriginal:fallback,eligibleNewLegs:eligible.map(p=>p.name),preExistingLegParametersUnchanged:unchanged,trials,attachment,changed:!resultBytes.equals(bytes),scope:'Finite sampled simultaneous-leg sweep; exact subdomain clipping, no claim of continuous safety.'}};
}
