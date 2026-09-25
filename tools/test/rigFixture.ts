/** Authored synthetic test geometry, not generated character artwork. No model APIs. */
import { writeInp, type InpDocument } from '../rig/inp';
import { encodePNG } from '../shared/encodePNG';
export function rigFixture() {
    const names=['Head Angles','Arm L','Arm R','Leg L','Leg R','ParamAngleZ','ParamEyeLOpen','ParamEyeROpen','ParamMouthOpenY','ParamBrowL','ParamBrowR','ParamEyeBallX','ParamEyeBallY','ParamBreath'];
    const puppet:InpDocument={meta:{combined:true,canvas:{width:128,height:128}},nodes:{uuid:0,name:'root',type:'Node',enabled:true,zsort:0,children:[{
        uuid:1,name:'fixture',type:'Part',enabled:true,zsort:0,opacity:1,textures:[0],
        mesh:{verts:[-32,-48,32,-48,32,48,-32,48],uvs:[0,0,1,0,1,1,0,1],indices:[0,1,2,0,2,3],origin:[0,0]},
    }]},param:names.map((name,i)=>{
        const vector=i<5,ys=vector?[0,.5,1]:[0];
        return {uuid:10+i,name,is_vec2:vector,min:[-30,-30],max:[30,30],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0,.5,1],ys],bindings: [0,1,5].includes(i)?[{
            node:1,param_name:'deform',interpolate_mode:'Linear',isSet:[0,.5,1].map(()=>ys.map(()=>true)),
            values:[0,.5,1].map(x=>ys.map(y=>Array.from({length:4},()=>[(x-.5)*4,vector?(y-.5)*2:0]))),
        }]:[6,7].includes(i)?[{node:1,param_name:'opacity',interpolate_mode:'Linear',isSet:[[true],[true],[true]],values:[[.2],[.6],[1]]}]:[]};
    })};
    const pixels=new Uint8ClampedArray(16*16*4);
    for(let i=0;i<pixels.length;i+=4)pixels.set([50+(i/4)%16*10,130,210,255],i);
    return writeInp(puppet,[encodePNG(pixels,16,16)]);
}
