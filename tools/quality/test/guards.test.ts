import {describe,it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger} from '../ledger';
import {parseAssessment,compareAssessments,type Assessment,type Issue} from '../schema';
import {scopedEdit,replaceLayerPixels} from '../pixels';
import {encodePNG} from '../../shared/encodePNG';
import {decodePNG} from '../../generate/png';
import {readInp,writeInp,inpParts,type InpDocument} from '../../rig/inp';
const dirs:string[]=[];
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const temp=()=>{const d=mkdtempSync(join(tmpdir(),'quality-test-'));dirs.push(d);return join(d,'journal.json');};
const target:Issue={code:'expression_patch',stage:'layers',severity:'major',evidence:'A visible patch',region:[.2,.2,.8,.8],part:'face',certainty:'clear',repair:'layer_edit',instruction:'Match original skin shading'};
const assessment=(issues:Issue[],preservedIdentity:Assessment['preservedIdentity']='yes'):Assessment=>({issues,preservedIdentity,summary:'Test evidence'});
describe('bounded quality decisions',()=>{
 it('never treats a layer failure as permission to redraw a character',()=>{
  expect(()=>parseAssessment(assessment([{...target,repair:'source_edit'}]))).toThrow(/source redraw/);
  expect(()=>parseAssessment(assessment([{...target,stage:'source'}]))).toThrow(/scope/);
  expect(()=>parseAssessment(assessment([{...target,region:[0,0,2,1]}]))).toThrow(/region/);
 });
 it('requires improvement, identity, and no new or worsened defects',()=>{
  const before=assessment([target]);
  expect(compareAssessments(before,assessment([]),target).eligibleForReview).toBe(true);
  for(const after of [before,assessment([],'uncertain'),assessment([],'no'),assessment([{...target,severity:'blocking'}]),assessment([{...target,code:'seam_exposure'}]),assessment([{...target,severity:'minor',certainty:'uncertain'}])])expect(compareAssessments(before,after,target).eligibleForReview).toBe(false);
 });
 it('resuming does not reset failed, reserved or cross-part repair attempts',()=>{
  const file=temp(),first=new Ledger(file,'same');
  const a=first.reserve('layers');first.finish(a,'failed');first.reserve('layers');first.close();
  const resumed=new Ledger(file,'same');
  expect(()=>resumed.reserve('layers')).toThrow(/budget/);
  expect(resumed.reserve('source')).toBe(2);resumed.close();
  expect(()=>new Ledger(file,'other')).toThrow(/different evidence/);
 });
 it('prevents competing workers and expired jobs from spending again',()=>{
  const file=temp(),one=new Ledger(file,'same');expect(()=>new Ledger(file,'same')).toThrow();
  one.reserve('analysis');one.close();const state=JSON.parse(readFileSync(file,'utf8'));state.started='2000-01-01T00:00:00Z';writeFileSync(file,JSON.stringify(state));
  const expired=new Ledger(file,'same');expect(()=>expired.reserve('source')).toThrow(/deadline/);expired.close();
 });
});
function solid(r:number,g:number,b:number){const bytes=new Uint8ClampedArray(4*4*4);for(let i=0;i<bytes.length;i+=4)bytes.set([r,g,b,255],i);return encodePNG(bytes,4,4);}
describe('repair isolation',()=>{
 it('restores every unrequested pixel even when a model repaints the entire canvas',()=>{
  const result=scopedEdit(solid(255,0,0),solid(0,0,255),[.25,.25,.75,.75]);const image=decodePNG(result.png);
  expect(result.changedPixels).toBe(4);
  for(let y=0;y<4;y++)for(let x=0;x<4;x++)expect(Array.from(image.rgba.slice((y*4+x)*4,(y*4+x+1)*4))).toEqual(x>=1&&x<=2&&y>=1&&y<=2?[0,0,255,255]:[255,0,0,255]);
  expect(()=>scopedEdit(solid(0,0,0),solid(0,0,0),[0,0,NaN,1])).toThrow();
 });
 it('isolates repaired texture from another part sharing its atlas and preserves all motion bindings',()=>{
  const mesh={verts:[-2,-2,2,-2,2,2,-2,2],uvs:[0,0,1,0,1,1,0,1],indices:[0,1,2,0,2,3],origin:[0,0]};
  const puppet:InpDocument={meta:{canvas:{width:4,height:4}},nodes:{uuid:0,name:'root',type:'Node',enabled:true,zsort:0,children:['face','neck'].map((name,i)=>({uuid:i+1,name,type:'Part',enabled:true,zsort:i,textures:[0],mesh:structuredClone(mesh)}))},param:[{uuid:5,name:'Head Roll',min:[-30],max:[30],defaults:[0],is_vec2:false,axis_points:[[0,.5,1]],merge_mode:'Passthrough',bindings:[{node:1,param_name:'deform',values:[[[1,2]],[[0,0]],[[3,4]]],isSet:[[true],[true],[true]],interpolate_mode:'Linear'}]}]};
  const original=solid(255,0,0),scoped=scopedEdit(original,solid(0,0,255),[.25,.25,.75,.75]);
  const input=writeInp(puppet,[original]),result=readInp(replaceLayerPixels(input,'face',original,scoped.png).file);
  expect(result.puppet.param).toEqual(puppet.param);expect(result.textures[0]).toEqual(original);
  expect(inpParts(result.puppet)[1]).toEqual(inpParts(puppet)[1]);expect(inpParts(result.puppet)[0].mesh).toEqual(mesh);
  expect(inpParts(result.puppet)[0].textures).toEqual([1]);expect(decodePNG(result.textures[1]).rgba).toEqual(decodePNG(scoped.png).rgba);
  expect(()=>replaceLayerPixels(input,'face',original,original)).toThrow(/did not affect/);
 });
});
