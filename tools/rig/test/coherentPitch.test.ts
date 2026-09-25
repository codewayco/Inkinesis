import {describe,it,expect} from 'vitest';
import {coherentPitch,pitchPoint} from '../coherentPitch';
import type {InpDocument} from '../inp';

const frame={cx:0,cy:0,rx:50,ry:70,pivotY:60};
describe('shared facial pitch',()=>{
    it('preserves neutral and keeps the surface orientation across proportions',()=>{
        for(const scale of [.25,1,4])for(const aspect of [.1,1,20])for(const pitch of [-30,-15,0,15,30]){
            const f=Object.fromEntries(Object.entries(frame).map(([k,v])=>[k,v*scale])) as typeof frame;
            f.rx*=aspect;
            for(let y=-100;y<100;y+=5)for(let x=-80;x<80;x+=5){
                const a=pitchPoint({x:x*scale,y:y*scale},pitch,f),b=pitchPoint({x:x*scale,y:(y+1)*scale},pitch,f);
                expect(b.y).toBeGreaterThan(a.y);expect(a.x).toBe(x*scale);
                if(!pitch)expect(a.y).toBe(y*scale);
            }
        }
    });
    it('leaves neck, yaw-only cells and scalar roll/jaw controls exactly unchanged',()=>{
        const verts=[-50,-70,50,-70,0,60];
        const nodes=['face','neck','mouth_close'].map((name,i)=>({uuid:i+1,name,type:'Part' as const,enabled:true,zsort:i,mesh:{verts:[...verts],uvs:[0,0,1,0,.5,1],indices:[0,1,2],origin:[0,0]}}));
        const puppet:InpDocument={meta:{canvas:{width:200,height:200}},nodes:{uuid:0,name:'root',type:'Node',enabled:true,zsort:0,children:nodes},param:[{uuid:10,name:'Head Angles',is_vec2:true,min:[-45,-30],max:[45,30],defaults:[0,0],axis_points:[[0,.5,1],[0,.5,1]],merge_mode:'Passthrough',bindings:nodes.map(n=>({node:n.uuid,param_name:'deform',interpolate_mode:'Linear',isSet:[[true,true,true],[true,true,true],[true,true,true]],values:[-1,0,1].map(x=>[-1,0,1].map(y=>verts.filter((_,i)=>i%2===0).map(()=>[x,y])))}))}]};
        puppet.param.push({...structuredClone(puppet.param[0]),uuid:11,name:'ParamAngleZ'},{...structuredClone(puppet.param[0]),uuid:12,name:'ParamMouthOpenY'});
        const before=structuredClone(puppet);coherentPitch(puppet,{eyeL:{x:80,y:100},eyeR:{x:120,y:100},chin:{x:100,y:160}});
        expect(puppet.param.slice(1)).toEqual(before.param.slice(1));
        expect(puppet.param[0].bindings[1]).toEqual(before.param[0].bindings[1]);
        for(let i=0;i<3;i++)for(let j=0;j<3;j++)expect(puppet.param[0].bindings[i].values[j][1]).toEqual(before.param[0].bindings[i].values[j][1]);
    });
});
