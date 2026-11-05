import {it,expect} from 'vitest';
import {bakePairedGripLift} from '../pairedGripLift';
import type {InpDocument,InpParameter} from '../inp';
it('retains face controls but freezes an incomplete two-hand group instead of releasing one hand',()=>{
 const arm={name:'Arm L'} as InpParameter,face={name:'ParamEyeLOpen'} as InpParameter;
 const doc={param:[arm,face],meta:{combined:{chains:[]}}} as unknown as InpDocument;
 const result=bakePairedGripLift(doc,[],[]);
 expect(result.status).toBe('rejected');expect(doc.param).toEqual([face]);
});
