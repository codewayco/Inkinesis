import {describe,it,expect} from 'vitest';
import {anchorLongHair,headProbeValues,quadraticGridBounds} from '../garmentHair';
import {evaluateCombined,type CombinedAsset} from '../../../player/src/combinedRuntime';
import type {InpDocument,InpNode} from '../inp';

describe('continuous head-cell determinant bounds',()=>{
    it('detects an interior dip even when all corners and the midpoint are positive',()=>{
        const f=(x:number)=>(x-.25)**2-.01;
        expect([f(0),f(.5),f(1)].every(x=>x>0)).toBe(true);
        expect(quadraticGridBounds([f(0),f(.5),f(1)],[3]).min).toBeLessThan(0);
    });
    it('bounds a coupled polynomial across multiple nonuniform cells and a constant dimension',()=>{
        const x=[0,.1,.2,.6,1],y=[0,.5,1],f=(x:number,y:number)=>1+x*x-2*x*y+.7*y*y;
        const bound=quadraticGridBounds(x.flatMap(x=>y.map(y=>f(x,y))),[5,1,3]);
        for(let i=0;i<=100;i++)for(let j=0;j<=100;j++){expect(f(i/100,j/100)).toBeGreaterThanOrEqual(bound.min-1e-12);expect(f(i/100,j/100)).toBeLessThanOrEqual(bound.max+1e-12);}
    });
});

function fixture(scale:number,length:number,mirror:number):InpDocument {
    const height=600*scale,verts:number[]=[],uvs:number[]=[],indices:number[]=[];
    for(let y=0;y<=12;y++)for(let x=0;x<=4;x++){verts.push((70+x*15)*scale*mirror,(40+y*length/12)*scale-height/2);uvs.push(x/4,y/12);}
    for(let y=0;y<12;y++)for(let x=0;x<4;x++){const a=y*5+x;indices.push(a,a+1,a+5,a+1,a+6,a+5);}
    const hair:InpNode={uuid:1,name:'back hair#21:l',type:'Part',enabled:true,zsort:1,mesh:{verts,uvs,indices,origin:[0,0]}};
    const face:InpNode={uuid:2,name:'face',type:'Part',enabled:true,zsort:2,mesh:{verts:[70*scale,40*scale-height/2,130*scale,40*scale-height/2,100*scale,140*scale-height/2],uvs:[0,0,1,0,.5,1],indices:[0,1,2],origin:[0,0]}};
    const values=[-30,0,30].map(angle=>[verts.reduce<number[][]>((a,_,i)=>{if(i%2)return a;const x=verts[i]-100*scale*mirror,y=verts[i+1]-(140*scale-height/2),r=angle*Math.PI/180;a.push([x*Math.cos(r)-y*Math.sin(r)-x,x*Math.sin(r)+y*Math.cos(r)-y]);return a;},[])]);
    return {meta:{canvas:{width:height,height}},nodes:{uuid:0,name:'root',type:'Node',enabled:true,zsort:0,children:[hair,face]},param:[{uuid:3,name:'ParamAngleZ',is_vec2:false,min:[-30,0],max:[30,0],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0,.5,1],[0]],bindings:[{node:1,param_name:'deform',values,isSet:[[true],[true],[true]],interpolate_mode:'Linear'}]}]};
}
describe('input-derived hair attachment',()=>{
    it('preserves distinct native face and neck bindings when attaching long hair',()=>{
        const puppet=fixture(1,320,1);
        const face=puppet.nodes.children![1];
        const neck={...structuredClone(face),uuid:4,name:'neck'};
        puppet.nodes.children!.push(neck);
        const p=puppet.param[0];
        for(const node of [face,neck])p.bindings.push({node:node.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:[[true],[true],[true]],values:[-1,0,1].map(k=>[Array.from({length:3},()=>[k*node.uuid,k*2])])});
        const before=structuredClone(p.bindings.filter(b=>b.node!==1));
        anchorLongHair(puppet,140,600);
        expect(p.bindings.filter(b=>b.node!==1)).toEqual(before);
    });
    it('leaves short hair and its authored motion untouched',()=>{
        const puppet=fixture(1,80,1),before=structuredClone(puppet);
        expect(anchorLongHair(puppet,140,600)).toEqual([]);expect(puppet).toEqual(before);
    });
    it('refuses an unsafe source field when no attachment candidate can preserve its roots',()=>{
        const puppet=fixture(1,320,1),binding=puppet.param[0].bindings[0];
        // Collapse every root horizontally at a head extreme; tip weighting cannot repair it.
        (binding.values as number[][][][])[0][0].forEach((xy,i)=>{xy[0]=-puppet.nodes.children![0].mesh!.verts[i*2];});
        expect(()=>anchorLongHair(puppet,140,600)).toThrow('No certified head/hair field');
    });
    for(const scale of [.5,1,2])for(const length of [180,320,480])for(const mirror of [-1,1])it(`keeps moving roots and valid cells: scale ${scale}, extent ${length}, mirror ${mirror}`,()=>{
        const puppet=fixture(scale,length,mirror),before=structuredClone(puppet),report=anchorLongHair(puppet,140*scale,600*scale);
        expect(report).toHaveLength(1);expect(report[0].geometry.certifiedMinAreaRatio).toBeGreaterThanOrEqual(.2);
        expect(report[0].geometry.certifiedMaxAreaRatio).toBeLessThanOrEqual(4);
        const asset=(p:InpDocument):CombinedAsset=>({puppet:p,width:600*scale,height:600*scale,parts:p.nodes.children!,textures:[]});
        for(const pose of headProbeValues(puppet)){
            const old=evaluateCombined(asset(before),pose)[0],now=evaluateCombined(asset(puppet),pose)[0];
            for(let i=0;i<old.xy.length;i+=2)if(before.nodes.children![0].mesh!.verts[i+1]+300*scale<=140*scale){expect(now.xy[i]).toBeCloseTo(old.xy[i],8);expect(now.xy[i+1]).toBeCloseTo(old.xy[i+1],8);}
        }
        expect(puppet.param[0].bindings[0].values[1]).toEqual(before.param[0].bindings[0].values[1]);
    });
});
