import {describe,it,expect} from 'vitest';
import {analysisImage,analysisSize,analysisPrompt,parseAssessment,normalizePixelPoints,requestAssessment,acceptedPoints,adoptLandmarkCheck,ANALYSIS_MAX_EDGE,ANALYSIS_MAX_PIXELS,type AnalysisRequest,type Assessment} from '../analyze';
import {chainJoints} from '../capabilities';
import {encodePNG} from '../../shared/encodePNG';
import {decodePNG} from '../../generate/png';

const answer=(points:Record<string,unknown>)=>JSON.stringify({frontFacing:true,singleCharacter:true,longGarment:false,separateLimbs:true,facialHair:false,confidence:.8,reasons:['clear'],points,
  regions:Object.fromEntries(Object.keys(chainJoints).map(n=>[n,{visible:true,separate:true,rootOccluded:false,reason:'clear'}]))});
const image={data:Buffer.from([]),width:800,height:1200};

describe('support analysis contract',()=>{
  it('shows the model an image no server will resize and states its pixel frame',()=>{
    const s=analysisSize(1024,1536);
    expect(s.width*s.height).toBeLessThanOrEqual(ANALYSIS_MAX_PIXELS);expect(Math.max(s.width,s.height)).toBeLessThanOrEqual(ANALYSIS_MAX_EDGE);
    expect(s.height/s.width).toBeCloseTo(1.5,2);
    expect(analysisSize(600,800)).toEqual({width:600,height:800});
    const prompt=analysisPrompt(s.width,s.height);
    expect(prompt).toContain(`exactly ${s.width} pixels wide and ${s.height} pixels tall`);expect(prompt).toContain('never divide y by the width');
  });
  it('converts pixel answers per axis and drops points outside the image',()=>{
    const p=normalizePixelPoints({eyeL:{x:400,y:300,confidence:.9},wristL:{x:900,y:100,confidence:.9},kneeL:null,ankleL:{x:'a',y:1,confidence:1}},800,1200);
    expect(p.eyeL).toEqual({x:.5,y:.25,confidence:.9});expect(p.wristL).toBeNull();expect(p.kneeL).toBeNull();expect(p.ankleL).toBeNull();
    expect(acceptedPoints({eyeL:{x:.5,y:.25,confidence:.9},eyeR:{x:.4,y:.25,confidence:.45}},1024,1536)).toEqual({eyeL:{x:512,y:384}});
  });
  it('tolerates code fences and text around the JSON, and rejects malformed answers',()=>{
    expect(parseAssessment('Here:\n```json\n'+answer({})+'\n```').frontFacing).toBe(true);
    expect(()=>parseAssessment('{"reasons":[]}')).toThrow('Malformed');expect(()=>parseAssessment('no json')).toThrow();
  });
  it('retries a truncated or unparsable answer and asks for shorter reasons',async()=>{
    const prompts:string[]=[];
    const replies=[{text:answer({}).slice(0,50),stopReason:'max_tokens'},{text:'{"frontFacing": tru',stopReason:'end_turn'},{text:answer({eyeL:{x:400,y:600,confidence:.9}}),stopReason:'end_turn'}];
    const request:AnalysisRequest=async prompt=>{prompts.push(prompt);return replies.shift()!;};
    const result=await requestAssessment(request,image);
    expect(result.attempts).toBe(3);expect(result.failures).toHaveLength(2);expect(result.failures[0]).toContain('truncated');
    expect(prompts[1]).toContain('under 12 words');expect(result.assessment.points.eyeL).toEqual({x:.5,y:.5,confidence:.9});
    expect(result.assessment.pixelPoints?.eyeL).toEqual({x:400,y:600,confidence:.9});
  });
  it('fails with every reason after the last attempt',async()=>{
    const request:AnalysisRequest=async()=>({text:'{',stopReason:'max_tokens'});
    await expect(requestAssessment(request,image,2)).rejects.toThrow(/2 attempts: truncated.*truncated/);
  });
  it('adopts verified landmarks, keeps the model answer and recomputes capabilities with the same gates',()=>{
    const points:Assessment['points']=Object.fromEntries([...Object.values(chainJoints).flat().map((id,i)=>[id,{x:id.endsWith('L')?.7:.3,y:.25+(i%3)*.15,confidence:.9}]),...['eyeL','eyeR','mouth','chin'].map(id=>[id,{x:.5,y:.15,confidence:.9}])]);
    const assessment:Assessment={...JSON.parse(answer(points)),points};
    const analysis={assessment,source:{width:1024,height:1536},capabilities:{}};
    const checked={...points,elbowL:null};
    const adopted=adoptLandmarkCheck(analysis,{schema:1,points:checked,records:[{point:'elbowL',status:'rejected',reason:'off the arm'}],changed:1});
    expect(adopted.assessment.modelPoints).toEqual(points);expect(adopted.assessment.points.elbowL).toBeNull();
    expect(adopted.capabilities.chains['Arm L'].mode).toBe('fixed');expect(adopted.capabilities.chains['Arm R'].mode).toBe('articulated');
    expect(adopted.points.elbowL).toBeUndefined();expect(adopted.landmarkCheck.changed).toBe(1);
    // Adopting again keeps the original model answer.
    expect(adoptLandmarkCheck(adopted,{schema:1,points:checked,records:[],changed:0}).assessment.modelPoints).toEqual(points);
  });
  it('adopts an estimated occluded shoulder as a reduced-range arm, and a later check without it fixes the arm again',()=>{
    const points:Assessment['points']=Object.fromEntries([...Object.values(chainJoints).flat().map((id,i)=>[id,{x:id.endsWith('L')?.7:.3,y:.25+(i%3)*.15,confidence:.9}]),...['eyeL','eyeR','mouth','chin'].map(id=>[id,{x:.5,y:.15,confidence:.9}])]);
    const assessment:Assessment={...JSON.parse(answer(points)),points,regions:{'Arm R':{visible:true,separate:true,rootOccluded:true,reason:'Loose hoodie shoulder hides the joint.'}}};
    const analysis={assessment,source:{width:1024,height:1536},capabilities:{}};
    const adopted=adoptLandmarkCheck(analysis,{schema:1,points,records:[{point:'shoulderR',status:'estimated',reason:'Shoulder estimated from the separated arm silhouette'}],changed:1,
      rootEstimates:{'Arm R':{status:'estimated',reason:'Shoulder estimated from the separated arm silhouette'}}});
    expect(adopted.capabilities.chains['Arm R'].mode).toBe('limited');expect(adopted.landmarkCheck.rootEstimates['Arm R']?.status).toBe('estimated');
    expect(adoptLandmarkCheck(adopted,{schema:1,points,records:[],changed:0}).capabilities.chains['Arm R'].mode).toBe('fixed');
  });
});

describe('transparent drawings',()=>{
  it('are shown to the model on white, never with the colour hidden under transparent pixels',()=>{
    const rgba=new Uint8ClampedArray(4*4*4);
    rgba.set([0,0,0,0],0);rgba.set([200,40,40,255],4);rgba.set([0,0,255,128],8);
    const shown=decodePNG(new Uint8Array(analysisImage(Buffer.from(encodePNG(rgba,4,4))).data));
    expect([...shown.rgba.slice(0,4)]).toEqual([255,255,255,255]);
    expect([...shown.rgba.slice(4,8)]).toEqual([200,40,40,255]);
    expect([...shown.rgba.slice(8,12)]).toEqual([127,127,255,255]);
  });
});
