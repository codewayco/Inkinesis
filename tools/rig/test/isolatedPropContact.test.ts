import {describe,it,expect} from 'vitest';import {isolatedPropContact} from '../isolatedPropContact';
describe('isolated prop fallback evidence',()=>{
 const prop=new Uint8ClampedArray(400*4);for(let i=0;i<100;i++)prop[i*4+3]=255;
 it('allows an isolated prop within the scale bound',()=>{expect(isolatedPropContact(prop,new Uint8ClampedArray(prop.length),150).passed).toBe(true);});
 it('rejects substantial contact with a second body surface or an oversized support',()=>{const other=new Uint8ClampedArray(prop.length);for(let i=0;i<15;i++)other[i*4+3]=255;expect(isolatedPropContact(prop,other,150).passed).toBe(false);expect(isolatedPropContact(prop,new Uint8ClampedArray(prop.length),50).passed).toBe(false);});
});
