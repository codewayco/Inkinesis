import {it,expect} from 'vitest';
import {qualityPoses} from '../motion';
it('samples both signs, intermediate angles, coupled extremes and expressions without narrowing roll',()=>{
 const {head,body}=qualityPoses();expect(head).toHaveLength(28);expect(body).toHaveLength(8);
 expect(new Set([...head,...body].map(p=>p.label)).size).toBe(36);
 for(const v of [-30,-15,15,30])expect(head.some(p=>p.values.ParamAngleZ?.[0]===v)).toBe(true);
 expect(head.filter(p=>p.label.startsWith('Y'))).toHaveLength(8);
 expect(head.some(p=>p.values.ParamMouthOpenY?.[0]===1)).toBe(true);
 expect(head.some(p=>p.values.ParamEyeLOpen?.[0]===0)).toBe(true);
});
