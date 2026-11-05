import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {writeJson} from '../live2d/writeJson';

it('streams multi-chunk bridge data with the exact JSON bytes and digest',()=>{
 const home=mkdtempSync(join(tmpdir(),'inkinesis-json-')),file=join(home,'bridge.json');
 try {
  for(const value of [
   {name:'İ😀\\"\n',unset:undefined,nested:[null,true,false,NaN,Infinity,-0,undefined,undefined,{x:'abc'}]},
   Array.from({length:17003},(_,i)=>i%3?i*.000001:{coordinate:[i,0],delta:[-i,i],opacity:1}),
   {a:Array.from({length:100003},(_,i)=>Math.sin(i)),editor:undefined},
  ]) {
   const result=writeJson(file,value),expected=JSON.stringify(value);
   expect(readFileSync(file,'utf8')).toBe(expected);
   expect(result).toEqual({sha256:createHash('sha256').update(expected).digest('hex'),bytes:Buffer.byteLength(expected)});
  }
  const circular:Record<string,unknown>={};circular.child=circular;
  expect(()=>writeJson(file,circular)).toThrow('Circular JSON');
 }finally{rmSync(home,{recursive:true,force:true});}
});
