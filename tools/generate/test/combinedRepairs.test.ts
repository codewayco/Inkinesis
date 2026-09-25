import {poseFilename} from '../../verify/measurePuppet';
import {describe,it,expect} from 'vitest';
import {repairFootOwnership} from '../../rig/combinedFootwear';
import {combinedMeshGate} from '../../rig/combinedMeshGate';
import {constrainClosedEyes,restoreMissingEyeDetails} from '../../rig/combinedExpressions';
import {type InpDocument,type InpNode,inpParts} from '../../rig/inp';
import {encodePNG} from '../../shared/encodePNG';
import {decodePNG} from '../png';
const node=(name:string,uuid:number,texture:number):InpNode=>({name,uuid,type:'Part',enabled:true,zsort:uuid,textures:[texture],mesh:{verts:[-32,-32,32,-32,-32,32,32,32],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}});
const doc=(parts:InpNode[]):InpDocument=>({meta:{canvas:{width:64,height:64}},nodes:{name:'root',uuid:0,type:'Node',enabled:true,zsort:0,children:parts},param:[]});
describe('combined local repairs',()=>{
 it('keeps opposite joint extrema in different signed evidence files',()=>{
  expect(poseFilename('check Arm L -30 -60')).not.toBe(poseFilename('check Arm L 30 60'));
  expect(poseFilename('Leg L lattice -12.5 0')).not.toBe(poseFilename('Leg L lattice 12.5 0'));
 });
 it('rejects a joint key that folds a triangle before an INP can be emitted',()=>{
  const p=doc([node('arm-l',1,0)]);const zero=Array.from({length:4},()=>[0,0]);
  p.param=[{uuid:2,name:'Arm L',is_vec2:true,min:[0,0],max:[1,1],defaults:[0,0],axis_points:[[0,1],[0,1]],merge_mode:'Passthrough',bindings:[{node:1,param_name:'deform',interpolate_mode:'Linear',isSet:[[true,true],[true,true]],values:[[zero,zero],[zero,zero]]}]}];
  expect(combinedMeshGate(p).status).toBe('passed');
  p.param[0].bindings[0].values[1][1]=[[0,0],[-128,0],[0,0],[-128,0]];
  expect(()=>combinedMeshGate(p)).toThrow('Body foldover');
 });
 it('rejects an off-feature closed-eye patch when independent eyes are absent',()=>{
  const p=doc([node('face',1,0),node('eye_close-l',2,0),node('eye_close-r',3,0)]);
  for(const part of p.nodes.children!.slice(1))part.mesh!.verts=[-32,-32,-28,-32,-32,-28,-28,-28];
  const image={width:64,height:64,rgba:new Uint8ClampedArray(64*64*4).fill(255)},textures=[Buffer.from(encodePNG(image.rgba,64,64))];
  const result=restoreMissingEyeDetails(p,textures,image,{eyeL:{x:44,y:40},eyeLOuter:{x:54,y:40},eyeR:{x:20,y:40},eyeROuter:{x:10,y:40}});
  expect(result.filter(r=>r.kind.startsWith('Rejected'))).toHaveLength(2);
  expect(decodePNG(textures[p.nodes.children![1].textures![0]]).rgba[3]).toBe(0);
 });

 it('moves a shoe fragment from the wrong source half to its connected shoe',()=>{
  const rgba=[new Uint8ClampedArray(64*64*4),new Uint8ClampedArray(64*64*4)];
  for(let y=40;y<55;y++)for(let x=10;x<56;x++)if(x<22||x>=44){const t=x<48?1:0,i=(y*64+x)*4;rgba[t].set([200,100,60,255],i);}
  const textures=rgba.map(a=>Buffer.from(encodePNG(a,64,64))),p=doc([node('footwear-l',1,0),node('footwear-r',2,1)]);
  const result=repairFootOwnership(p,textures,{ankleL:{x:50,y:42},ankleR:{x:16,y:42}});
  expect(result.status).toBe('reassigned');
  const parts=inpParts(p);const left=decodePNG(textures[parts[0].textures![0]]),right=decodePNG(textures[parts[1].textures![0]]);
  expect(left.rgba[(47*64+45)*4+3]).toBe(255);
  expect(right.rgba[(47*64+45)*4+3]).toBe(0);
  expect(right.rgba[(47*64+15)*4+3]).toBe(255);
 });
 it('constrains only expression alpha and preserves the authored pose geometry',()=>{
  const rgba=new Uint8ClampedArray(64*64*4).fill(255),texture=Buffer.from(encodePNG(rgba,64,64));
  const parts=['l','r'].flatMap((s,i)=>{const close=node(`eye_close-${s}`,i*2+1,0),open=node(`eyewhite-${s}`,i*2+2,0);open.mesh!.verts=[-8,-8,8,-8,-8,8,8,8];return [close,open];});
  const p=doc(parts),textures=[texture],before=JSON.stringify(parts[0].mesh);
  constrainClosedEyes(p,textures);
  const image=decodePNG(textures[parts[0].textures![0]]);
  expect(image.rgba[3]).toBe(0);expect(image.rgba[(32*64+32)*4+3]).toBe(255);
  expect(JSON.stringify(parts[0].mesh)).toBe(before);
 });
});
