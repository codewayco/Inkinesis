/** Cutout ownership for visible sleeves and separated trouser legs. Garment
 * fragments share the skin's complete limb field, rather than stretching torso
 * pixels between unrelated limb transforms. No names or coordinates of presets. */
import {inpParts,inpTextures,type InpDocument,type InpNode,type InpParameter} from './inp';
import {poseContinuousLimb,type ContinuousLimb,type LimbPoint} from '../../engine/src/body/continuousLimb';
import {renderTextured,type TexturedMesh} from '../../engine/src/render/textured';
import {encodePNG} from '../shared/encodePNG';
/** A sparse canvas grid keeps disjoint alpha islands from sharing triangles. */
export function canvasMesh(rgba:Uint8ClampedArray,width:number,height:number) {
    const step=Math.max(6,Math.round(Math.max(width,height)/128));
    const verts:number[]=[],uvs:number[]=[],indices:number[]=[],ids=new Map<string,number>();
    const vertex=(x:number,y:number)=>{const key=x+'/'+y;if(ids.has(key))return ids.get(key)!;const id=verts.length/2;ids.set(key,id);verts.push(x-width/2,y-height/2);uvs.push(x/width,y/height);return id;};
    for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){
        const x1=Math.min(width,x+step),y1=Math.min(height,y+step);let visible=false;
        for(let py=Math.max(0,y-1);py<Math.min(height,y1+1)&&!visible;py++)for(let px=Math.max(0,x-1);px<Math.min(width,x1+1);px++)if(rgba[(py*width+px)*4+3]){visible=true;break;}
        if(visible){const a=vertex(x,y),b=vertex(x1,y),c=vertex(x,y1),d=vertex(x1,y1);indices.push(a,b,c,b,d,c);}
    }
    return {verts,uvs,indices,origin:[0,0]};
}
/** `nearestBone` is an ablation baseline: every garment pixel joins the nearest of the torso spine and the two arm chains. Production uses `anatomical`. */
export interface ClothingAttachmentOptions { assignment?:'anatomical'|'nearestBone' }
function segmentDistance(p:LimbPoint,a:LimbPoint,b:LimbPoint) {
    const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy,t=len2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2)):0;
    return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);
}
/**
 * Share of a leg's field that a leg-garment pixel takes. The seat is the
 * garment above the fork (the crotch apex), where the garment parts into two
 * tubes. The two legs blend across the centre line: the blend half width is at
 * least `halfWidth`, the largest relative displacement of the two legs at the
 * apex, and widens upward at 45 degrees, so the fabric over the fly and seat
 * stretches instead of splitting down the centre seam and no triangle folds.
 * Below the apex each tube fades from the blend to its own leg within
 * `halfWidth` rows, so the tubes part below the crotch as legs do and the seat
 * and tubes meet with equal weights. Character left is image right.
 */
export interface LegBlend {apex:LimbPoint; halfWidth:number}
export function legWeight(p:LimbPoint,blend:LegBlend,side:'L'|'R',tube?:'L'|'R') {
    const {apex,halfWidth}=blend;
    let wL=Math.max(0,Math.min(1,.5+(p.x-apex.x)/(2*Math.max(halfWidth,apex.y-p.y))));
    if(tube&&p.y>apex.y){const t=Math.min(1,(p.y-apex.y)/halfWidth),fade=t*t*(3-2*t);wL=wL*(1-fade)+(tube==='L'?1:0)*fade;}
    return side==='L'?wL:1-wL;
}
export interface LegFork {apex:LimbPoint; separated:true}
/**
 * The row where a garment parts into two leg tubes: scanning down from the
 * hips, the first row whose pixels on both thigh axes are garment while the
 * point between them is not. Rows, not a few fixed samples, so short shorts
 * that end just below the crotch are found as well as trousers.
 */
export function legFork(alpha:(p:LimbPoint)=>number,marks:Record<string,LimbPoint>):LegFork|null {
    const axis=(side:string,y:number)=>{const h=marks['hip'+side],k=marks['knee'+side],t=(y-h.y)/Math.max(1e-6,k.y-h.y);return {x:h.x+(k.x-h.x)*t,y};};
    const start=Math.ceil(Math.min(marks.hipL.y,marks.hipR.y)),end=Math.floor(Math.max(marks.kneeL.y,marks.kneeR.y));
    for(let y=start;y<=end;y++){
        const l=axis('L',y),r=axis('R',y),mid={x:(l.x+r.x)/2,y};
        if(!(alpha(l)>.5&&alpha(r)>.5&&alpha(mid)<.2))continue;
        // Apex: the centre of the open run between the tubes on this row.
        let a=mid.x,b=mid.x;
        while(a>Math.min(l.x,r.x)&&alpha({x:a-1,y})<.5)a--;
        while(b<Math.max(l.x,r.x)&&alpha({x:b+1,y})<.5)b++;
        return {apex:{x:(a+b)/2,y},separated:true};
    }
    return null;
}
/**
 * Whether the garment below the fork wraps each leg like a trouser or shorts
 * tube: on the rows just below the fork, the garment run on each thigh axis
 * covers the leg layer there and is at most 1.8 times as wide. Coat panels,
 * tails or aprons beside the legs fail this.
 */
export function fittedTubes(alpha:(p:LimbPoint)=>number,legs:Uint8ClampedArray,width:number,height:number,marks:Record<string,LimbPoint>,fork:LegFork) {
    const thigh=(Math.hypot(marks.kneeL.x-marks.hipL.x,marks.kneeL.y-marks.hipL.y)+Math.hypot(marks.kneeR.x-marks.hipR.x,marks.kneeR.y-marks.hipR.y))/2;
    const leg=(x:number,y:number)=>x>=0&&y>=0&&x<width&&y<height&&legs[(y*width+x)*4+3]>128;
    let rows=0,fitted=0;
    for(let y=Math.round(fork.apex.y)+2;y<=fork.apex.y+.3*thigh&&y<height;y+=2)for(const side of ['L','R']){
        const h=marks['hip'+side],k=marks['knee'+side],x=Math.round(h.x+(k.x-h.x)*(y-h.y)/Math.max(1e-6,k.y-h.y));
        if(!leg(x,y))continue;
        let l0=x,l1=x;while(leg(l0-1,y))l0--;while(leg(l1+1,y))l1++;
        if(alpha({x,y})<=.5){rows++;continue;}
        let g0=x,g1=x;while(g0>0&&alpha({x:g0-1,y})>.5)g0--;while(g1<width-1&&alpha({x:g1+1,y})>.5)g1++;
        const overlap=Math.max(0,Math.min(g1,l1)-Math.max(g0,l0)+1);
        rows++;if(overlap>=.8*(l1-l0+1)&&g1-g0+1<=1.8*(l1-l0+1)+4)fitted++;
    }
    return rows>=6&&fitted>=.7*rows;
}
export function clothingAttachments(puppet:InpDocument,textures:Buffer[],marks:Record<string,LimbPoint>,options:ClothingAttachmentOptions={}) {
    const assignment=options.assignment??'anatomical';
    const {width,height}=puppet.meta.canvas as {width:number;height:number};
    const nodes=inpParts(puppet),decoded=inpTextures(textures),report=[];
    const combined=puppet.meta.combined as {chains?:{name:string;chain:ContinuousLimb;distalSign:number}[]}|undefined;
    let nextId=Math.max(...nodes.map(n=>n.uuid))+1;
    const render=(parts:InpNode[])=>renderTextured(parts.map(n=>({xy:new Float64Array(n.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(n.mesh!.uvs),indices:new Uint32Array(n.mesh!.indices),depth:new Float64Array(n.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[n.textures![0]],sampling:'bilinear'} as TexturedMesh)),width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
    const legMarks=['hipL','hipR','kneeL','kneeR'].every(id=>marks[id]);
    for(const node of nodes.filter(n=>n.name==='topwear'||n.name==='bottomwear')){
        const top=node.name==='topwear';
        const armOwners=top?puppet.param.filter(p=>p.name.startsWith('Arm ')):[];
        const legOwners=legMarks?puppet.param.filter(p=>p.name.startsWith('Leg ')):[];
        if(!armOwners.length&&!legOwners.length)continue;
        const rgba=render([node]);
        const alpha=(p:LimbPoint)=>rgba[(Math.max(0,Math.min(height-1,Math.round(p.y)))*width+Math.max(0,Math.min(width-1,Math.round(p.x))))*4+3]/255;
        // Leg tubes: below the fork each tube follows its leg; the seat above it blends both legs (legWeight).
        let fork=legOwners.length?legFork(alpha,marks):null;
        // A torso garment carries leg tubes only when they wrap the legs like
        // shorts or overalls; coat panels or tails beside the legs stay with the torso.
        if(fork&&top&&!fittedTubes(alpha,render(nodes.filter(n=>/^legwear-[lr]$/.test(n.name))),width,height,marks,fork))fork=null;
        if(!top&&!fork){report.push({layer:node.name,status:'retained',reason:'No alpha-supported trouser/short-leg separation; skirt retained.'});continue;}
        if(!armOwners.length&&!fork){report.push({layer:node.name,status:'retained',reason:'No supported sleeve pixels'});continue;}
        if(puppet.param.some(p=>p.bindings.some(b=>b.node===node.uuid)))throw new Error('Clothing attachment expects an unbound source garment');
        const chains=armOwners.map(param=>{const side=param.name.at(-1)!,record=combined?.chains?.find(c=>c.name===param.name);if(!record)throw new Error('Missing limb chain');const {root,joint,tip}=record.chain,upper=Math.hypot(joint.x-root.x,joint.y-root.y),lower=Math.hypot(tip.x-joint.x,tip.y-joint.y);let cuff=0;
            {let seen=false;for(let d=0;d<=upper+lower;d+=2){const a=d<upper?root:joint,b=d<upper?joint:tip,t=d<upper?d/upper:(d-upper)/lower,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};if(alpha(p)>.5){seen=true;cuff=d;}else if(seen)break;}}
            // Require garment support outside the skeletal centerline. A narrow garment
            // strap intersecting an uncertain shoulder estimate is not a sleeve.
            let outerWidth=0;
            if(cuff>0){const t=cuff*.55/upper,center={x:root.x+(joint.x-root.x)*t,y:root.y+(joint.y-root.y)*t};
                for(let d=0;d<upper*.4;d+=Math.max(1,upper*.005)){const p={x:center.x+(joint.y-root.y)/upper*d*(side==='L'?1:-1),y:center.y-(joint.x-root.x)/upper*d*(side==='L'?1:-1)};if(alpha(p)<.5)break;outerWidth=d;}
            }
            return {param,side,record,upper,cuff,outerWidth};});
        const legs=fork?legOwners.map(param=>{const record=combined?.chains?.find(c=>c.name===param.name);if(!record)throw new Error('Missing limb chain');return {param,side:param.name.at(-1)! as 'L'|'R',record};}):[];
        // Labels: 0 torso, 1..arms sleeves, then one tube per moving leg, then the seat.
        const tubeLabel=(side:string)=>{const j=legs.findIndex(l=>l.side===side);return j<0?0:chains.length+1+j;},seatLabel=chains.length+legs.length+1;
        let blend:LegBlend|undefined;
        if(fork){
            // Half width: the largest relative displacement of the two legs at the apex (each leg's largest, summed),
            // so that no seat triangle folds even when both legs swing toward each other.
            const largest=legs.map(l=>Math.max(...[l.param.min[0],l.param.max[0]].flatMap(x=>[l.param.min[1],l.param.max[1]].map(y=>{const q=poseContinuousLimb(fork.apex,l.record.chain,x,y*l.record.distalSign);return Math.hypot(q.x-fork.apex.x,q.y-fork.apex.y);}))));
            blend={apex:fork.apex,halfWidth:Math.max(2,largest.reduce((a,b)=>a+b,0))};
        }
        const fixedSide=fork&&legs.length<2?(legs.some(l=>l.side==='L')?'R':'L'):undefined;
        const apex=fork?.apex,hipTop=fork?Math.min(marks.hipL.y,marks.hipR.y):0;
        const axisMid=(y:number)=>{const at=(s:string)=>{const h=marks['hip'+s],k=marks['knee'+s];return h.x+(k.x-h.x)*(y-h.y)/Math.max(1e-6,k.y-h.y);};return (at('L')+at('R'))/2;};
        const labels=new Uint8Array(width*height),counts=new Array(seatLabel+1).fill(0);
        for(let i=0;i<labels.length;i++){if(!rgba[i*4+3])continue;const p={x:i%width,y:Math.floor(i/width)};
            let label=0;
            if(chains.length){
                if(assignment==='nearestBone'){
                    const spineTop={x:(marks.shoulderL.x+marks.shoulderR.x)/2,y:(marks.shoulderL.y+marks.shoulderR.y)/2},spineBottom={x:(marks.hipL.x+marks.hipR.x)/2,y:(marks.hipL.y+marks.hipR.y)/2};
                    let best=segmentDistance(p,spineTop,spineBottom);
                    for(const [j,c] of chains.entries()){const {root,joint,tip}=c.record.chain,d=Math.min(segmentDistance(p,root,joint),segmentDistance(p,joint,tip));if(d<best){best=d;label=j+1;}}
                }
                else for(const [j,c] of chains.entries()){
                    const {root,joint}=c.record.chain,dx=joint.x-root.x,dy=joint.y-root.y;
                    const along=((p.x-root.x)*dx+(p.y-root.y)*dy)/c.upper;
                    const outward=((p.x-root.x)*dy-(p.y-root.y)*dx)/c.upper*(c.side==='L'?1:-1);
                    if(c.cuff>c.upper*.12&&c.outerWidth>c.upper*.1&&along>0&&along<c.cuff+c.upper*.08&&outward>-c.outerWidth*.75){label=j+1;break;}
                }
            }
            if(!label&&apex&&(!top||p.y>=hipTop)){
                // Character left is image right.
                if(p.y>=apex.y)label=tubeLabel(p.x>=apex.x+axisMid(p.y)-axisMid(apex.y)?'L':'R');
                else label=legs.length?seatLabel:0;
            }
            labels[i]=label;counts[label]++;
        }
        if(counts.slice(1).reduce((a,b)=>a+b,0)<32){report.push({layer:node.name,status:'retained',reason:fork?'No supported sleeve or leg pixels':'No supported sleeve pixels'});continue;}
        const fragments=[];const blended:Record<string,'L'|'R'|'seat'>={};
        const bind=(fragment:InpNode,param:InpParameter,record:{chain:ContinuousLimb;distalSign:number},weight:(p:LimbPoint)=>number)=>{
            const xs=param.axis_points[0].map(t=>param.min[0]+t*(param.max[0]-param.min[0])),ys=param.axis_points[1].map(t=>param.min[1]+t*(param.max[1]-param.min[1]));
            param.bindings.push({node:fragment.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:xs.map(()=>ys.map(()=>true)),values:xs.map(x=>ys.map(y=>{const delta:number[][]=[];for(let i=0;i<fragment.mesh!.verts.length;i+=2){const p={x:fragment.mesh!.verts[i]+width/2,y:fragment.mesh!.verts[i+1]+height/2},q=poseContinuousLimb(p,record.chain,x,y*record.distalSign),w=weight(p);delta.push([(q.x-p.x)*w,(q.y-p.y)*w]);}return delta;}))});
        };
        if(blend){
            // The seat and upper tubes share both leg fields. Their underlying
            // leg surfaces must share those weights too: independent motion
            // otherwise slides a trouser edge off its leg and exposes the
            // decomposition's hidden lining as a lens between the thighs.
            // Below the blend this is exactly the original single-leg field.
            for(const under of nodes.filter(n=>/^(legwear|footwear)-[lr]$/.test(n.name))){
                const side=under.name.endsWith('-l')?'L':'R';
                const owner=legs.find(l=>l.side===side);
                if(!owner||!owner.param.bindings.some(b=>b.node===under.uuid&&b.param_name==='deform'))continue;
                for(const l of legs){
                    l.param.bindings=l.param.bindings.filter(b=>b.node!==under.uuid||b.param_name!=='deform');
                    bind(under,l.param,l.record,p=>legWeight(p,blend!,l.side,side));
                }
            }
        }
        for(let label=0;label<=seatLabel;label++){
            if(counts[label]===0)continue;
            const pixels=new Uint8ClampedArray(rgba.length);
            for(let i=0;i<labels.length;i++)if(rgba[i*4+3]){
                const x=i%width,y=Math.floor(i/width);
                // One-pixel overlap at internal cuts preserves opaque seam coverage.
                const neighbors=[i,x>0?i-1:i,x+1<width?i+1:i,y>0?i-width:i,y+1<height?i+width:i];
                if(neighbors.some(j=>rgba[j*4+3]>0&&labels[j]===label))pixels.set(rgba.subarray(i*4,i*4+4),i*4);
            }
            const suffix=!label?'torso':label<=chains.length?chains[label-1].param.name.replace(' ','_'):label===seatLabel?'seat':legs[label-chains.length-1].param.name.replace(' ','_');
            const fragment:InpNode={...node,uuid:nextId++,name:node.name+'__'+suffix,mesh:canvasMesh(pixels,width,height),textures:[textures.length]};
            textures.push(Buffer.from(encodePNG(pixels,width,height)));puppet.nodes.children!.push(fragment);fragments.push(fragment.name);
            // The torso holds the tube of a leg that does not move: the moving leg's blend still reaches it at the apex.
            const tube=label===seatLabel?undefined:label>chains.length?legs[label-chains.length-1].side:!label&&fixedSide?fixedSide:null;
            if(blend&&tube!==null){for(const l of legs)bind(fragment,l.param,l.record,p=>legWeight(p,blend,l.side,tube));blended[fragment.name]=tube??'seat';continue;}
            if(!label)continue;
            const {param,record}=chains[label-1];bind(fragment,param,record,()=>1);
        }
        puppet.nodes.children=puppet.nodes.children!.filter(n=>n.uuid!==node.uuid);
        report.push({layer:node.name,status:'partitioned',fragments,pixelOwnership:counts,cuffs:chains.map(c=>({side:c.side,distance:c.cuff,outerWidth:c.outerWidth})),...(blend?{legBlend:{...blend,fragments:blended}}:{}),
            method:assignment==='nearestBone'?'Ablation baseline: nearest-bone pixel assignment among torso spine and arm chains; garment and skin share identical continuous limb fields.':'Alpha-supported anatomical cutouts; garment and skin share identical continuous limb fields. Leg tubes part below the fork; the seat above it blends both leg fields. One-pixel internal cut overlap; no generated hidden artwork.'});
    }
    puppet.meta.clothingAttachments=report;return {parts:report};
}
