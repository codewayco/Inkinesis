import {describe,it,expect} from 'vitest';
import {assessCapabilities,chainJoints,usablePoint,designNotes,SHOULDER_ESTIMATE_REASON,HIP_ESTIMATE_REASON,type ChainName,type MotionCapabilities} from '../capabilities';
import type {Assessment} from '../analyze';
function source():Assessment {
  return {singleCharacter:true,frontFacing:true,longGarment:false,separateLimbs:true,facialHair:false,confidence:.9,reasons:[],
    points:Object.fromEntries([...Object.values(chainJoints).flat().map((id,i)=>[id,{x:id.endsWith('L')?.7:.3,y:.25+(i%3)*.15,confidence:.95}]),...['eyeL','eyeR','mouth','chin'].map(id=>[id,{x:.5,y:.15,confidence:.9}])]),
    regions:Object.fromEntries(Object.keys(chainJoints).map(name=>[name,{visible:true,separate:true,rootOccluded:false,reason:''}]))};
}
describe('regional capability decisions',()=>{
  it('keeps both arms when a coat hides the hips without rewriting the design',()=>{
    const a=source();a.longGarment=true;
    for(const side of ['L','R']){a.points['hip'+side]=null;a.regions![`Leg ${side}` as ChainName]!.rootOccluded=true;a.regions![`Leg ${side}` as ChainName]!.reason='The coat covers the hips.';}
    const before=structuredClone(a),r=assessCapabilities(a,1024,1536);
    expect(r.canBuild).toBe(true);expect(r.capabilities.chains['Arm L'].mode).toBe('articulated');expect(r.capabilities.chains['Arm R'].mode).toBe('articulated');
    expect(r.capabilities.chains['Leg L']).toMatchObject({mode:'fixed',reasons:expect.arrayContaining(['The coat covers the hips.'])});expect(a).toEqual(before);
  });
  it('retains uncertain but usable chains for layer checks and isolates one missing arm',()=>{
    const a=source();a.points.elbowL!.confidence=.6;a.points.wristR=null;
    const r=assessCapabilities(a,1024,1536);expect(r.canBuild).toBe(true);
    expect(r.capabilities.chains['Arm L'].mode).toBe('articulated');expect(r.capabilities.chains['Arm R'].mode).toBe('fixed');expect(r.capabilities.chains['Leg L'].mode).toBe('articulated');
  });
  it('separates mouth uncertainty from head and blink, without rejecting a beard',()=>{
    const a=source();a.facialHair=true;expect(assessCapabilities(a,1024,1536).capabilities.face.mouth.mode).toBe('articulated');
    a.points.mouth=null;const r=assessCapabilities(a,1024,1536);expect(r.canBuild).toBe(true);expect(r.capabilities.face.mouth.mode).toBe('fixed');expect(r.capabilities.face.head.mode).toBe('articulated');
  });
  it.each(['singleCharacter','frontFacing'] as const)('still refuses unsupported global condition %s',key=>{const a=source();a[key]=false;expect(assessCapabilities(a,1024,1536).canBuild).toBe(false);});
  it('does not invent a usable head or trust invalid confidence',()=>{const a=source();a.points.chin=null;expect(assessCapabilities(a,1024,1536).canBuild).toBe(true);expect(assessCapabilities(a,1024,1536).capabilities.headAxes?.pitch.mode).toBe('fixed');expect(assessCapabilities(a,1024,1536).capabilities.headAxes?.roll.mode).toBe('articulated');expect(assessCapabilities(a,1024,1536).capabilities.headAxes?.yaw.mode).toBe('articulated');a.points.eyeL=null;expect(assessCapabilities(a,1024,1536).canBuild).toBe(false);a.confidence=NaN;expect(assessCapabilities(a,1024,1536).canBuild).toBe(false);});
});

describe('verified landmarks',()=>{
  it('accepts a low-confidence point only when the decomposition verified it, without raising its confidence',()=>{
    expect(usablePoint({x:.5,y:.5,confidence:.4})).toBe(false);
    expect(usablePoint({x:.5,y:.5,confidence:.4,verified:true})).toBe(true);
    expect(usablePoint({x:.5,y:.5,confidence:.2,verified:true})).toBe(false);
    expect(usablePoint({x:.5,y:.5,confidence:.4,verified:true},.8)).toBe(false);
    const a=source();a.points.elbowL={...a.points.elbowL!,confidence:.4};
    expect(assessCapabilities(a,1000,1000).capabilities.chains['Arm L'].mode).toBe('fixed');
    a.points.elbowL={...a.points.elbowL!,verified:true};
    expect(assessCapabilities(a,1000,1000).capabilities.chains['Arm L'].mode).toBe('articulated');
  });
});

describe('estimated arm roots',()=>{
  const occluded=()=>{const a=source();for(const name of Object.keys(chainJoints) as ChainName[]){a.regions![name]!.rootOccluded=true;a.regions![name]!.reason='A loose garment hides the '+(name.startsWith('Arm')?'shoulder':'hip')+'.';}return a;};
  it('keeps an occluded arm fixed unless the landmark check estimated its shoulder',()=>{
    const a=occluded();
    expect(assessCapabilities(a,1000,1000).capabilities.chains['Arm L'].mode).toBe('fixed');
    a.rootEstimates={'Arm L':{status:'declined',reason:'The forearm is not separated from the body by a background gap'}};
    expect(assessCapabilities(a,1000,1000).capabilities.chains['Arm L'].mode).toBe('fixed');
    a.rootEstimates={'Arm L':{status:'estimated',reason:SHOULDER_ESTIMATE_REASON}};
    const c=assessCapabilities(a,1000,1000).capabilities.chains;
    expect(c['Arm L']).toMatchObject({mode:'limited',reasons:['A loose garment hides the shoulder.',SHOULDER_ESTIMATE_REASON+'; the arm moves in a reduced range.']});
    expect(c['Arm R'].mode).toBe('fixed');
  });
  it('keeps every other gate of an estimated arm',()=>{
    const a=occluded();
    a.rootEstimates={'Arm L':{status:'estimated',reason:SHOULDER_ESTIMATE_REASON},'Arm R':{status:'estimated',reason:SHOULDER_ESTIMATE_REASON}};
    a.regions!['Arm R']!.separate=false;a.points.wristL=null;
    const c=assessCapabilities(a,1000,1000).capabilities.chains;
    expect(c['Arm L'].mode).toBe('fixed');expect(c['Arm R'].mode).toBe('fixed');
  });
});

describe('estimated hips under a hem',()=>{
  const occluded=()=>{const a=source();for(const side of ['L','R']){const r=a.regions![`Leg ${side}` as ChainName]!;r.rootOccluded=true;r.reason='The skirt hides the hip.';}return a;};
  it('keeps an occluded leg fixed unless the landmark check estimated its hip',()=>{
    const a=occluded();
    expect(assessCapabilities(a,1000,1000).capabilities.chains['Leg L'].mode).toBe('fixed');
    a.rootEstimates={'Leg L':{status:'declined',reason:'Too little of the thigh is visible below the hem'}};
    expect(assessCapabilities(a,1000,1000).capabilities.chains['Leg L'].mode).toBe('fixed');
  });
  it('moves an estimated leg in the full range, leaving the static hem to the rig sweep',()=>{
    const a=occluded();
    a.rootEstimates={'Leg L':{status:'estimated',reason:HIP_ESTIMATE_REASON}};
    const c=assessCapabilities(a,1000,1000).capabilities.chains;
    expect(c['Leg L']).toMatchObject({mode:'articulated',reasons:['The skirt hides the hip.',HIP_ESTIMATE_REASON+'; the static hem is tested on the rig.']});
    expect(c['Leg R'].mode).toBe('fixed');
  });
  it('keeps every other leg gate: an estimate never frees an unseparated leg or one without a knee',()=>{
    const a=occluded();
    a.rootEstimates={'Leg L':{status:'estimated',reason:HIP_ESTIMATE_REASON},'Leg R':{status:'estimated',reason:HIP_ESTIMATE_REASON}};
    a.regions!['Leg R']!.separate=false;a.points.kneeL=null;
    const c=assessCapabilities(a,1000,1000).capabilities.chains;
    expect(c['Leg L'].mode).toBe('fixed');expect(c['Leg R'].mode).toBe('fixed');
  });
  it('an arm estimate never frees a leg, and a leg estimate never frees an arm',()=>{
    const a=source();for(const name of Object.keys(chainJoints) as ChainName[])a.regions![name]!.rootOccluded=true;
    a.rootEstimates={'Arm L':{status:'estimated',reason:SHOULDER_ESTIMATE_REASON}};
    expect(assessCapabilities(a,1000,1000).capabilities.chains['Leg L'].mode).toBe('fixed');
    a.rootEstimates={'Leg L':{status:'estimated',reason:HIP_ESTIMATE_REASON}};
    expect(assessCapabilities(a,1000,1000).capabilities.chains['Arm L'].mode).toBe('fixed');
  });
});

describe('design notes for the user',()=>{
  it('names every held or reduced control with its reason, then the failed source-check items',()=>{
    const ok={mode:'articulated' as const,reasons:[],stage:'geometry' as const};
    const caps:MotionCapabilities={version:1,reviewRequired:true,face:{head:ok,blink:ok,mouth:ok},
      chains:{'Arm L':ok,'Arm R':{mode:'limited',reasons:['Shoulder estimated.'],stage:'geometry'},
        'Leg L':{mode:'fixed',reasons:['A long gown hides the hip.'],stage:'source'},'Leg R':{mode:'fixed',reasons:['A long gown hides the hip.'],stage:'source'}},
      sourceCheck:[{item:'P2',name:'left arm clear of the torso',status:'fail',value:.2,detail:''},{item:'C2',name:'figure margin',status:'fail',value:0,detail:''}]};
    expect(designNotes(caps)).toEqual([
      'Right arm moves in a reduced range: Shoulder estimated.',
      'Left leg stays in its drawn pose: A long gown hides the hip.',
      'Right leg stays in its drawn pose: A long gown hides the hip.',
      'The left arm touches the torso in the drawing, so it may stay still.',
      'The figure touches the image edge; parts at the edge may be cut off.']);
    expect(designNotes({...caps,chains:{'Arm L':ok,'Arm R':ok,'Leg L':ok,'Leg R':ok},sourceCheck:[]})).toEqual([]);
  });
});
