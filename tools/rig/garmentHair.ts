/** Geometry-selected attachment fields for long hair; no character-specific names or coordinates. */
import { inpParts, type InpDocument, type InpNode } from './inp';
import { semanticLayer } from './carryPsd2Live';
import { evaluateCombined, type CombinedAsset } from '../../player/src/combinedRuntime';

const controls=new Set(['ParamAngleZ','Head Angles']);
const smooth=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const area=(xy:number[],a:number,b:number,c:number)=>(xy[b*2]-xy[a*2])*(xy[c*2+1]-xy[a*2+1])-(xy[b*2+1]-xy[a*2+1])*(xy[c*2]-xy[a*2]);
function axisSamples(axis:number[],min:number,max:number){return [...new Set([...axis,...axis.slice(1).map((v,i)=>(v+axis[i])/2)])].sort((a,b)=>a-b).map(v=>min+(max-min)*v);}
/** Include every authored cell corner and midpoint, also across simultaneous head controls. */
export function headProbeValues(puppet:InpDocument) {
    let values:Record<string,number[]>[]=[{}];
    for(const p of puppet.param.filter(p=>controls.has(p.name))){
        const xs=axisSamples(p.axis_points[0],p.min[0],p.max[0]),ys=p.is_vec2?axisSamples(p.axis_points[1],p.min[1],p.max[1]):[0];
        values=values.flatMap(v=>xs.flatMap(x=>ys.map(y=>({...v,[p.name]:[x,y]}))));
    }
    return values;
}
/** Tensor quadratic Bernstein bounds. A determinant of bilinear XY + linear roll
 * vertex tracks is at most quadratic in each coordinate inside an authored cell. */
export function quadraticGridBounds(values:number[],shape:number[]) {
    const strides=shape.map((_,i)=>shape.slice(i+1).reduce((a,b)=>a*b,1));
    let starts:number[][]=[[]];
    for(const n of shape)starts=starts.flatMap(s=>Array.from({length:n===1?1:(n-1)/2},(_,i)=>[...s,2*i]));
    let min=Infinity,max=-Infinity;
    for(const start of starts){
        let coords:number[][]=[[]];
        for(const n of shape)coords=coords.flatMap(c=>Array.from({length:n===1?1:3},(_,i)=>[...c,i]));
        const localShape=shape.map(n=>n===1?1:3),localStrides=localShape.map((_,i)=>localShape.slice(i+1).reduce<number>((a,b)=>a*b,1));
        const coefficients=coords.map(c=>values[c.reduce((sum,v,i)=>sum+(v+start[i])*strides[i],0)]);
        for(let axis=0;axis<shape.length;axis++)if(shape[axis]>1)for(let i=0;i<coords.length;i++)if(coords[i][axis]===1){
            const step=localStrides[axis];coefficients[i]=2*coefficients[i]-.5*(coefficients[i-step]+coefficients[i+step]);
        }
        for(const c of coefficients){min=Math.min(min,c);max=Math.max(max,c);}
    }
    return {min,max};
}
function audit(part:InpNode,offsets:number[][],weights:number[],height:number,shape:number[]) {
    let minAreaRatio=Infinity,maxAreaRatio=0,triangleChecks=0;
    const ratios:number[][]=[];
    for(const delta of offsets){
        const xy=part.mesh!.verts.map((v,i)=>v+delta[i]*weights[i>>1]);
        const mesh=part.mesh!;
        for(let i=0;i<mesh.indices.length;i+=3){
            const [a,b,c]=mesh.indices.slice(i,i+3),rest=area(mesh.verts,a,b,c);
            if(Math.abs(rest)<height*height*1e-7)continue;
            const ratio=area(xy,a,b,c)/rest;
            if(!Number.isFinite(ratio))throw new Error('Non-finite hair geometry');
            minAreaRatio=Math.min(minAreaRatio,ratio);maxAreaRatio=Math.max(maxAreaRatio,ratio);triangleChecks++;
            (ratios[i/3]??=[]).push(ratio);
        }
    }
    let certifiedMinAreaRatio=-Infinity,certifiedMaxAreaRatio=Infinity;
    if(minAreaRatio>=.25&&maxAreaRatio<=4){
        certifiedMinAreaRatio=Infinity;certifiedMaxAreaRatio=0;
        for(const row of ratios)if(row){const bound=quadraticGridBounds(row,shape);certifiedMinAreaRatio=Math.min(certifiedMinAreaRatio,bound.min);certifiedMaxAreaRatio=Math.max(certifiedMaxAreaRatio,bound.max);}
    }
    return {minAreaRatio,maxAreaRatio,triangleChecks,certifiedMinAreaRatio,certifiedMaxAreaRatio};
}
export function anchorLongHair(puppet:InpDocument,chinY:number,height:number) {
    const result=[];
    const face=inpParts(puppet).find(p=>semanticLayer(p.name)==='face');
    if(!face)throw new Error('Hair attachment needs a face mesh');
    const headHeight=chinY-Math.min(...face.mesh!.verts.filter((_,i)=>i%2).map(y=>y+height/2));
    if(!(headHeight>0))throw new Error('Invalid face/chin attachment evidence');
    const probes=headProbeValues(puppet);
    const shape=puppet.param.filter(p=>controls.has(p.name)).flatMap(p=>[p.axis_points[0].length*2-1,...(p.is_vec2?[p.axis_points[1].length*2-1]:[1])]);
    for(const part of inpParts(puppet).filter(p=>/^(front hair|back hair|side hair|hair)$/.test(semanticLayer(p.name)))) {
        const ys=part.mesh!.verts.filter((_,i)=>i%2).map(y=>y+height/2),bottom=Math.max(...ys);
        if(bottom<chinY+headHeight*.5)continue;
        const parameters=puppet.param.filter(p=>controls.has(p.name)).map(p=>({...p,bindings:p.bindings.filter(b=>b.node===part.uuid)}));
        const asset:CombinedAsset={width:height,height,textures:[],parts:[part],puppet:{...puppet,param:parameters}};
        const offsets=probes.map(v=>evaluateCombined(asset,v)[0].xy.map((n,i)=>n-part.mesh!.verts[i]));
        let chosen: {weights:number[];end:number;geometry:ReturnType<typeof audit>}|undefined;
        // Choose the shortest attachment band that passes the same geometry constraints
        // on every input. Longer bands trade tip anchoring for lower mesh compression.
        let attempts=0;
        for(let step=0;step<=24;step++){
            const end=chinY+(bottom-chinY)*(.4+step*.05);
            const weights=ys.map(y=>1-smooth((y-chinY)/(end-chinY))),geometry=audit(part,offsets,weights,height,shape);attempts++;
            if(geometry.certifiedMinAreaRatio>=.2&&geometry.certifiedMaxAreaRatio<=4){chosen={weights,end,geometry};break;}
        }
        if(!chosen){
            const weights=ys.map(()=>1),geometry=audit(part,offsets,weights,height,shape);
            if(geometry.certifiedMinAreaRatio<.2||geometry.certifiedMaxAreaRatio>4)throw new Error('No certified head/hair field for '+part.name+'; needs reviewed mesh or narrower head controls');
            chosen={weights,end:Infinity,geometry};
        }
        for(const parameter of parameters)for(const b of parameter.bindings)if(b.param_name==='deform')
            b.values=(b.values as number[][][][]).map(column=>column.map(offsets=>offsets.map((xy,i)=>xy.map(v=>v*chosen!.weights[i]))));
        result.push({layer:part.name,fullHeadMotionAboveY:chinY,stationaryBelowY:Number.isFinite(chosen.end)?chosen.end:null,tipHeadMotionWeight:chosen.weights[ys.indexOf(bottom)],attempts,poses:probes.length,geometry:chosen.geometry,
            policy:'Shortest geometry-safe smooth attachment band derived from face/chin and hair extent. Native motion retained at roots. Native fallback if no attached field passes.',
            certificate:'Tensor quadratic Bernstein bounds on triangle signed-area ratios throughout every continuous head-control cell; ignores rest triangles below height^2 * 1e-7.',
            limitation:'Orientation/area bounds do not certify collision avoidance, perceptual quality or correctness of hidden artwork. No hair physics.'});
    }
    return result;
}
