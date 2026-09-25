import {describe,it,expect} from 'vitest';
import {mergeGarmentComponents} from '../mergeGarmentComponents';
import type {PoseDump} from '../carryPsd2Live';
const panel=(layer:string,x:number):PoseDump['drawables'][number]=>({id:layer,layer,textureFile:'atlas.png',opacity:1,drawOrder:3,rest:[x,0,x+2,0,x,3],uvs:[0,0,1,0,0,1],indices:[0,1,2]});
describe('disconnected garment panels',()=>{
 it('joins mesh inventories without inventing triangles across the opening',()=>{
  const a=panel('topwear#6:l',0),b=panel('topwear#6:r',20),face=panel('face',0);
  const result=mergeGarmentComponents([a,b,face]);
  expect(result).toHaveLength(2);expect(result[0].layer).toBe('topwear');
  expect(result[0].rest).toEqual([...a.rest!,...b.rest!]);
  expect(result[0].indices).toEqual([0,1,2,3,4,5]);expect(result[1]).toBe(face);
  expect(a.layer).toBe('topwear#6:l');
 });
 it('does not alter ordinary whole layers or face splits',()=>{
  const parts=[panel('topwear',0),panel('face#1:l',0),panel('face#1:r',20)];
  expect(mergeGarmentComponents(parts)).toEqual(parts);
 });
 it('refuses components that do not share texture and opacity',()=>{
  const a=panel('topwear#6:l',0),b={...panel('topwear#6:r',20),textureFile:'other.png'};
  expect(()=>mergeGarmentComponents([a,b])).toThrow('Cannot safely merge');
 });
});
