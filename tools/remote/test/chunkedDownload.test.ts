import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {assembleDownload} from '../chunkedDownload';
const roots:string[]=[];
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function fixture(){const root=mkdtempSync(join(tmpdir(),'rig-parts-'));roots.push(root);writeFileSync(join(root,'0-0.bin'),'abc');writeFileSync(join(root,'0-1.bin'),'def');return {root,file:{remote:'user/test.psd',size:6,sha256:sha('abcdef'),parts:[{name:'0-0.bin',sha256:sha('abc')},{name:'0-1.bin',sha256:sha('def')}]}};}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
describe('resumable artifact assembly',()=>{
 it('reconstructs exact bytes from ordered verified parts',()=>{const {root,file}=fixture();expect(assembleDownload(file,root).toString()).toBe('abcdef');});
 it('rejects corrupt or reordered parts and incorrect total lengths',()=>{const {root,file}=fixture();writeFileSync(join(root,'0-0.bin'),'xxx');expect(()=>assembleDownload(file,root)).toThrow('part hash');writeFileSync(join(root,'0-0.bin'),'abc');expect(()=>assembleDownload({...file,parts:[...file.parts].reverse()},root)).toThrow('artifact hash');expect(()=>assembleDownload({...file,size:7},root)).toThrow('length');});
 it('rejects manifest path traversal',()=>{const {root,file}=fixture();expect(()=>assembleDownload({...file,parts:[{name:'../elsewhere',sha256:sha('')} ]},root)).toThrow('part name');});
});
