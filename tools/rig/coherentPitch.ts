/** A shared, bounded facial-surface pitch field. Neck and scalar expression tracks stay native. */
import {inpParts,type InpDocument} from './inp';
import {semanticLayer} from './carryPsd2Live';

type Point={x:number;y:number};
export interface PitchFrame {cx:number;cy:number;rx:number;ry:number;pivotY:number}
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
/** Orthographic projection of a shallow smooth surface; not recovered 3D anatomy. */
export function pitchPoint(p:Point,degrees:number,f:PitchFrame):Point {
    if(degrees===0)return {...p};
    const theta=clamp(degrees,-30,30)*.45*Math.PI/180;
    const x=clamp((p.x-f.cx)/f.rx,-1,1),y=clamp((p.y-f.cy)/f.ry,-1,1);
    // Bound the vertical depth gradient even for unusually wide, short faces.
    const depth=Math.min(f.rx*.64,f.ry*1.2)*(.4+.6*Math.cos(x*Math.PI/2))*(.75+.25*Math.cos(y*Math.PI/2));
    return {x:p.x,y:p.y-Math.sin(theta)*depth+(Math.cos(theta)-1)*(p.y-f.pivotY)};
}
export function coherentPitch(puppet:InpDocument,marks:Record<string,Point>) {
    const head=puppet.param.find(p=>p.name==='Head Angles');
    const face=inpParts(puppet).find(p=>semanticLayer(p.name)==='face');
    if(!head||!face?.mesh)return {status:'skipped',reason:'No coupled head surface'};
    const canvas=puppet.meta.canvas as {width:number;height:number};
    const ys=head.axis_points[1].map(y=>head.min[1]+y*(head.max[1]-head.min[1]));
    const neutral=ys.findIndex(y=>Math.abs(y)<1e-8);
    if(neutral<0)throw new Error('Shared pitch needs an authored neutral row');
    const xs=face.mesh.verts.filter((_,i)=>i%2===0),fy=face.mesh.verts.filter((_,i)=>i%2);
    const eyeY=marks.eyeL&&marks.eyeR?(marks.eyeL.y+marks.eyeR.y)/2-canvas.height/2:Math.min(...fy)+(Math.max(...fy)-Math.min(...fy))*.45;
    const chin=marks.chin?marks.chin.y-canvas.height/2:Math.max(...fy);
    const frame:PitchFrame={cx:(Math.min(...xs)+Math.max(...xs))/2,cy:eyeY,rx:(Math.max(...xs)-Math.min(...xs))/2,ry:Math.max(chin-eyeY,eyeY-Math.min(...fy)),pivotY:chin};
    if(!(frame.rx>1&&frame.ry>1))throw new Error('Invalid facial surface dimensions');
    // All skull-attached artwork shares the field; neck and clothing never do.
    const selected=new Set(inpParts(puppet).filter(p=>/^(front hair|back hair|side hair|hair|headwear|face|nose|ears?(?:-[lr])?|earwear(?:-[lr])?|eyewear|eyebrow-[lr]|irides-[lr]|eyewhite-[lr]|eyelash-[lr]|eye_close-[lr]|mouth(?:_open|_close)?|lip_upper|lip_lower|tooth-[tb]|tongue)$/.test(semanticLayer(p.name))).map(p=>p.uuid));
    const parts=new Map(inpParts(puppet).map(p=>[p.uuid,p]));let vertices=0,maxCorrection=0;
    for(const binding of head.bindings){
        if(binding.param_name!=='deform'||!selected.has(binding.node))continue;
        const part=parts.get(binding.node)!,rest=part.mesh!.verts,values=binding.values as number[][][][];
        const attachment=(puppet.meta.headAttachments as {layer:string;fullHeadMotionAboveY:number;stationaryBelowY:number|null}[]|undefined)?.find(a=>a.layer===part.name);
        for(const column of values){
            const yaw=column[neutral];
            // Composite mouth geometry collapses near the closed endpoint. A
            // shared patch translation commutes with that aperture deformation;
            // per-vertex surface curvature would shear its nearly flat mesh.
            const mouth=/^(mouth(?:_open|_close)?|lip_upper|lip_lower|tooth-[tb]|tongue)$/.test(semanticLayer(part.name));
            const center=mouth?{x:yaw.reduce((s,v,i)=>s+rest[i*2]+v[0],0)/yaw.length,y:yaw.reduce((s,v,i)=>s+rest[i*2+1]+v[1],0)/yaw.length}:undefined;
            for(let j=0;j<ys.length;j++){
                if(j===neutral)continue;
                const priorCenter=mouth?{x:column[j].reduce((s,v,i)=>s+rest[i*2]+v[0],0)/yaw.length,y:column[j].reduce((s,v,i)=>s+rest[i*2+1]+v[1],0)/yaw.length}:undefined;
                column[j]=yaw.map((offset,i)=>{
                    const p=center??{x:rest[i*2]+offset[0],y:rest[i*2+1]+offset[1]},q=pitchPoint(p,ys[j],frame);
                    const t=attachment?.stationaryBelowY?clamp((rest[i*2+1]+canvas.height/2-attachment.fullHeadMotionAboveY)/(attachment.stationaryBelowY-attachment.fullHeadMotionAboveY),0,1):0;
                    const weight=1-t*t*(3-2*t);
                    const delta=priorCenter?[column[j][i][0]+q.x-priorCenter.x,column[j][i][1]+q.y-priorCenter.y]
                        :[offset[0]+(q.x-p.x)*weight,offset[1]+(q.y-p.y)*weight];
                    maxCorrection=Math.max(maxCorrection,Math.hypot(delta[0]-column[j][i][0],delta[1]-column[j][i][1]));vertices++;
                    return delta;
                });
            }
        }
    }
    return {status:'applied',version:1,frame,vertices,maxCorrection,
        method:'Shared shallow facial-surface pitch composed on each native yaw key. No independent feature pitch offsets.',
        preserved:'Neutral and yaw-only head rows, neck, long-hair attachment weights, roll, mouth and eye scalar tracks.',
        limitation:'A conservative 2D projection prior, not inferred 3D or newly drawn chin/nostril surfaces.'};
}
