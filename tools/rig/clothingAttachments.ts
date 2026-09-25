/** Cutout ownership for visible sleeves and separated trouser legs. Garment
 * fragments share the skin's complete limb field, rather than stretching torso
 * pixels between unrelated limb transforms. No names or coordinates of presets. */
import {inpParts,inpTextures,type InpDocument,type InpNode} from './inp';
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
export function clothingAttachments(puppet:InpDocument,textures:Buffer[],marks:Record<string,LimbPoint>,options:ClothingAttachmentOptions={}) {
    const assignment=options.assignment??'anatomical';
    const {width,height}=puppet.meta.canvas as {width:number;height:number};
    const nodes=inpParts(puppet),decoded=inpTextures(textures),report=[];
    const combined=puppet.meta.combined as {chains?:{name:string;chain:ContinuousLimb;distalSign:number}[]}|undefined;
    let nextId=Math.max(...nodes.map(n=>n.uuid))+1;
    for(const node of nodes.filter(n=>n.name==='topwear'||n.name==='bottomwear')){
        const kind=node.name==='topwear'?'Arm':'Leg',owners=puppet.param.filter(p=>p.name.startsWith(kind+' '));
        if(!owners.length||(kind==='Leg'&&!['hipL','hipR','kneeL','kneeR'].every(id=>marks[id])))continue;
        const rgba=renderTextured([{xy:new Float64Array(node.mesh!.verts.map((v,i)=>v+(i%2?height:width)/2)),uv:new Float64Array(node.mesh!.uvs),indices:new Uint32Array(node.mesh!.indices),depth:new Float64Array(node.mesh!.verts.length/2),depthOffset:0,opacity:1,texture:decoded[node.textures![0]],sampling:'bilinear'} as TexturedMesh],width,height,[0,0,0,0],{selfOverlap:'count'}).rgba;
        const alpha=(p:LimbPoint)=>rgba[(Math.max(0,Math.min(height-1,Math.round(p.y)))*width+Math.max(0,Math.min(width-1,Math.round(p.x))))*4+3]/255;
        if(kind==='Leg'){
            let separated=false;
            for(const t of [.45,.6,.75,.9,1.05]){const point=(s:string)=>({x:marks['hip'+s].x*(1-t)+marks['knee'+s].x*t,y:marks['hip'+s].y*(1-t)+marks['knee'+s].y*t});const l=point('L'),r=point('R');if(alpha(l)>.5&&alpha(r)>.5&&alpha({x:(l.x+r.x)/2,y:(l.y+r.y)/2})<.2)separated=true;}
            if(!separated){report.push({layer:node.name,status:'retained',reason:'No alpha-supported trouser/short-leg separation; skirt retained.'});continue;}
        }
        if(puppet.param.some(p=>p.bindings.some(b=>b.node===node.uuid)))throw new Error('Clothing attachment expects an unbound source garment');
        const chains=owners.map(param=>{const side=param.name.at(-1)!,record=combined?.chains?.find(c=>c.name===param.name);if(!record)throw new Error('Missing limb chain');const {root,joint,tip}=record.chain,upper=Math.hypot(joint.x-root.x,joint.y-root.y),lower=Math.hypot(tip.x-joint.x,tip.y-joint.y);let cuff=0;
            if(kind==='Arm'){let seen=false;for(let d=0;d<=upper+lower;d+=2){const a=d<upper?root:joint,b=d<upper?joint:tip,t=d<upper?d/upper:(d-upper)/lower,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};if(alpha(p)>.5){seen=true;cuff=d;}else if(seen)break;}}
            // Require garment support outside the skeletal centerline. A narrow garment
            // strap intersecting an uncertain shoulder estimate is not a sleeve.
            let outerWidth=0;
            if(kind==='Arm'&&cuff>0){const t=cuff*.55/upper,center={x:root.x+(joint.x-root.x)*t,y:root.y+(joint.y-root.y)*t};
                for(let d=0;d<upper*.4;d+=Math.max(1,upper*.005)){const p={x:center.x+(joint.y-root.y)/upper*d*(side==='L'?1:-1),y:center.y-(joint.x-root.x)/upper*d*(side==='L'?1:-1)};if(alpha(p)<.5)break;outerWidth=d;}
            }
            return {param,side,record,upper,cuff,outerWidth};});
        const labels=new Uint8Array(width*height),counts=[0,0,0];
        for(let i=0;i<labels.length;i++){if(!rgba[i*4+3])continue;const p={x:i%width,y:Math.floor(i/width)};
            let label=0;
            if(kind==='Leg'){const center=(marks.hipL.x+marks.hipR.x)/2;label=p.x>=center?chains.findIndex(c=>c.side==='L')+1:chains.findIndex(c=>c.side==='R')+1;}
            else if(assignment==='nearestBone'){
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
            labels[i]=label;counts[label]++;
        }
        if(counts[1]+counts[2]<32){report.push({layer:node.name,status:'retained',reason:'No supported sleeve pixels'});continue;}
        const fragments=[];
        for(let label=0;label<=chains.length;label++){
            if(counts[label]===0)continue;
            const pixels=new Uint8ClampedArray(rgba.length);
            for(let i=0;i<labels.length;i++)if(rgba[i*4+3]){
                const x=i%width,y=Math.floor(i/width);
                // One-pixel overlap at internal cuts preserves opaque seam coverage.
                const neighbors=[i,x>0?i-1:i,x+1<width?i+1:i,y>0?i-width:i,y+1<height?i+width:i];
                if(neighbors.some(j=>rgba[j*4+3]>0&&labels[j]===label))pixels.set(rgba.subarray(i*4,i*4+4),i*4);
            }
            const fragment:InpNode={...node,uuid:nextId++,name:node.name+(label?'__'+chains[label-1].param.name.replace(' ','_'):'__torso'),mesh:canvasMesh(pixels,width,height),textures:[textures.length]};
            textures.push(Buffer.from(encodePNG(pixels,width,height)));puppet.nodes.children!.push(fragment);fragments.push(fragment.name);
            if(!label)continue;
            const {param,record}=chains[label-1],xs=param.axis_points[0].map(t=>param.min[0]+t*(param.max[0]-param.min[0])),ys=param.axis_points[1].map(t=>param.min[1]+t*(param.max[1]-param.min[1]));
            param.bindings.push({node:fragment.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:xs.map(()=>ys.map(()=>true)),values:xs.map(x=>ys.map(y=>{const delta:number[][]=[];for(let i=0;i<fragment.mesh!.verts.length;i+=2){const p={x:fragment.mesh!.verts[i]+width/2,y:fragment.mesh!.verts[i+1]+height/2},q=poseContinuousLimb(p,record.chain,x,y*record.distalSign);delta.push([q.x-p.x,q.y-p.y]);}return delta;}))});
        }
        puppet.nodes.children=puppet.nodes.children!.filter(n=>n.uuid!==node.uuid);
        report.push({layer:node.name,status:'partitioned',fragments,pixelOwnership:counts,cuffs:chains.map(c=>({side:c.side,distance:c.cuff,outerWidth:c.outerWidth})),method:assignment==='nearestBone'?'Ablation baseline: nearest-bone pixel assignment among torso spine and arm chains; garment and skin share identical continuous limb fields.':'Alpha-supported anatomical cutouts; garment and skin share identical continuous limb fields. One-pixel internal cut overlap; no generated hidden artwork.'});
    }
    puppet.meta.clothingAttachments=report;return {parts:report};
}
