import {describe,it,expect} from 'vitest';
import {assessCapabilities,chainJoints,type ChainName} from '../capabilities';
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
