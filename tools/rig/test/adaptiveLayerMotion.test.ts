import {describe,it,expect} from 'vitest';
import {boundsProposalUsable,containsExistingLimbDomains,normalizeLimbLayerNames} from '../adaptiveLayerMotion';
import {inferLegPointsFromLayers} from '../layerBoundsLegs';
import {writeInp,type InpDocument} from '../inp';
import type {PoseDump} from '../carryPsd2Live';
const rig=(lo:number[],hi:number[],name='Leg L')=>writeInp({meta:{},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0},param:[{uuid:1,name,is_vec2:true,min:lo,max:hi,defaults:[0,0],axis_points:[[0,1],[0,1]],merge_mode:'Passthrough',bindings:[]}]} as InpDocument,[]);
describe('source-supported leg proposals',()=>{
 it('retains observed landmarks, even when bounds suggest different points',()=>{
  const known={hipL:{x:68,y:45},kneeL:{x:71,y:65}};
  const r=inferLegPointsFromLayers([{name:'bottomwear',x:30,y:35,width:40,height:20},{name:'legwear-l',x:60,y:50,width:15,height:40}],{width:100,height:100},known);
  expect(r.points.hipL).toEqual(known.hipL);expect(r.points.kneeL).toEqual(known.kneeL);expect(r.points.ankleL).toEqual({x:67.5,y:90});expect(r.points.kneeR).toBeUndefined();
 });
 it('rejects reversed inferred hip labels but does not override observed anatomy',()=>{
  const hips={hipL:{x:30,y:40},hipR:{x:70,y:40}};
  expect(boundsProposalUsable({},hips)).toBe(false);expect(boundsProposalUsable(hips,hips)).toBe(true);
 });
 it('requires containment of both existing control bounds, not just equal width',()=>{
  const baseline=rig([-25,0],[25,120]);
  expect(containsExistingLimbDomains(rig([-20,-10],[30,110]),baseline)).toBe(false);
  expect(containsExistingLimbDomains(rig([-30,-5],[30,125]),baseline)).toBe(true);
  expect(containsExistingLimbDomains(rig([-30,-5],[30,125],'Leg R'),baseline)).toBe(false);
 });
 it('renames native anonymous limbs without changing geometry or source data',()=>{
  const dump={coordinateSystem:'canvas-y-down',drawables:[{layer:'legwear#1',rest:[70,50,80,90]}]} as PoseDump;
  const r=normalizeLimbLayerNames(dump,{ankleL:{x:75,y:90},ankleR:{x:25,y:90}});
  expect(r.dump.drawables[0].layer).toBe('legwear-l');expect(r.dump.drawables[0].rest).toEqual(dump.drawables[0].rest);expect(dump.drawables[0].layer).toBe('legwear#1');
  dump.drawables.push({...dump.drawables[0],layer:'legwear-l'});
  expect(()=>normalizeLimbLayerNames(dump,{ankleL:{x:75,y:90},ankleR:{x:25,y:90}})).toThrow('Ambiguous');
 });
});
