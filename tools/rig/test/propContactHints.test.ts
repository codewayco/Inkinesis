import {it,expect} from 'vitest';import {propContactHints} from '../propContactHints';
it('distinguishes a resting hand from a grasp without changing the supplied assessment',()=>{
 const a={regions:{'Arm L':{reason:'Sleeved arm; hand overlaps thigh only at wrist'},'Arm R':{reason:'Raised arm; hand holding plate fully visible'}},reasons:['Left hand resting on thigh']};
 const h=propContactHints(a);expect(h['Arm L'].mode).toBe('resting');expect(h['Arm R'].mode).toBe('held');expect(a.regions['Arm L'].reason).toContain('overlaps thigh');
 expect(propContactHints({regions:{'Arm L':{reason:'Arm extends away from torso'}}})['Arm L'].mode).toBe('unknown');
 expect(propContactHints({regions:{'Arm L':{reason:'Hand is not holding anything'}}})['Arm L'].mode).toBe('unknown');
});

it('recognizes a named forearm grasp without treating an unmentioned grasp as known',()=>{
 const h=propContactHints({reasons:['Character-right forearm overlaps the torso while gripping microphone']});
 expect(h['Arm R'].mode).toBe('held');expect(h['Arm L'].mode).toBe('unknown');
});
