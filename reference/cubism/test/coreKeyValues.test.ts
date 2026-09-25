import { expect, it } from 'vitest';
import { coreKeyValues } from '../coreKeyValues';
import type { InpParameter } from '../../../tools/rig/inp';

it('uses physical parameter units and leaves source values untouched', () => {
    const p = { name:'mouth', is_vec2:false, min:[0,0], max:[1,1], defaults:[0,0], axis_points:[[0,.875,1],[0]] } as InpParameter;
    const values = { mouth:[.8756560781,0] };
    expect(coreKeyValues([p],values).mouth[0]).toBe(.875);
    expect(values.mouth[0]).toBe(.8756560781);
    expect(coreKeyValues([p],{mouth:[.877,0]}).mouth[0]).toBe(.877);
    expect(coreKeyValues([{...p,min:[-30,0],max:[30,1]}],{mouth:[22.5005,0]}).mouth[0]).toBe(22.5);
});
