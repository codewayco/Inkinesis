import {it,expect} from 'vitest';import {sharedPropGroup} from '../sharedPropGroup';
it('carries a singly held accessory alongside a prop shared by both hands',()=>{
 expect(sharedPropGroup([{area:4000},{area:16}],[[{component:1}],[{component:1},{component:2}]])).toEqual({supported:true,shared:[1],unsupported:[]});
});
it('keeps an unheld significant component gated even if another component is shared',()=>{
 expect(sharedPropGroup([{area:4000},{area:16}],[[{component:1}],[{component:1}]])).toEqual({supported:false,shared:[1],unsupported:[2]});
});
it('does not infer a two-hand constraint from two unrelated held objects',()=>{
 expect(sharedPropGroup([{area:4000},{area:4000}],[[{component:1}],[{component:2}]]).supported).toBe(false);
});
it('does not expand the inherited eight-pixel ignored-fragment bound',()=>{
 const contacts=[[{component:1}],[{component:1}]];
 expect(sharedPropGroup([{area:4000},{area:8}],contacts).supported).toBe(true);
 expect(sharedPropGroup([{area:4000},{area:9}],contacts).supported).toBe(false);
});
