import {describe,it,expect} from 'vitest';
import {combinedMeshGate,drawsNoTexture} from '../combinedMeshGate';
import type {InpDocument,InpNode} from '../inp';

function puppet(uvs:number[]):InpDocument {
  // One triangle that flips orientation at the second key.
  const part:InpNode={uuid:1,name:'arm-l',type:'Part',enabled:true,zsort:1,mesh:{verts:[0,0,10,0,0,10],uvs,indices:[0,1,2],origin:[0,0]}};
  const values=[[[[0,0],[0,0],[0,0]],[[0,0],[0,0],[0,-20]]]];
  return {meta:{},nodes:{uuid:0,name:'root',type:'Node',enabled:true,zsort:0,children:[part]},param:[{uuid:2,name:'Arm L',is_vec2:true,min:[0,0],max:[1,1],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0],[0,1]],bindings:[{node:1,param_name:'deform',values,isSet:[[true,true]],interpolate_mode:'Linear'}]}]};
}
describe('mesh foldover gate',()=>{
  it('rejects a fold of a textured triangle',()=>{
    expect(()=>combinedMeshGate(puppet([0,0,1,0,0,1]))).toThrow('Body foldover');
  });
  it('ignores a sliver whose texture coordinates are collinear: it draws nothing',()=>{
    expect(drawsNoTexture([0,0,.5,.5,1,1],0,1,2)).toBe(true);expect(drawsNoTexture([0,0,1,0,0,1],0,1,2)).toBe(false);
    expect(combinedMeshGate(puppet([0,0,.5,.5,1,1])).status).toBe('passed');
  });
});
