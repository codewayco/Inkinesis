import {afterEach, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const roots:string[]=[];
afterEach(()=>{roots.forEach(root=>rmSync(root,{recursive:true,force:true}));roots.length=0;});
function fixture() {
    const root=mkdtempSync(join(tmpdir(),'avatar-release-test-'));roots.push(root);
    const id='01-fixture',folder=join(root,'example-avatars',id),out=join(root,'.cache/avatar-release');
    mkdirSync(folder,{recursive:true});mkdirSync(out,{recursive:true});writeFileSync(join(out,'removed-avatar.inp'),'old release');
    const artifacts=['character.inp','Live2D.zip'].map((file,i)=>{
        const bytes=Buffer.from('fixture '+file);writeFileSync(join(folder,file),bytes);
        return {file,asset:i?'01-fixture-live2d.zip':'01-fixture.inp',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    });
    writeFileSync(join(root,'example-avatars/catalog.json'),JSON.stringify({release:{baseUrl:null},entries:[{id,label:'Fixture',base:'/example-avatars/'+id,preview:'/example-avatars/previews/'+id+'.webp',files:{'Download rig':'character.inp','Live2D package':'Live2D.zip'},artifacts}]}));
    return {root,out,folder,run:()=>execFileSync(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('tools/distribution/prepareAvatarRelease.ts')],{cwd:root,stdio:'pipe'})};
}
it('replaces stale attachments with exactly the current verified catalog',()=>{
    const f=fixture();f.run();
    expect(readdirSync(f.out).sort()).toEqual(['01-fixture-live2d.zip','01-fixture.inp','SHA256SUMS']);
    expect(readFileSync(join(f.out,'01-fixture.inp'))).toEqual(readFileSync(join(f.folder,'character.inp')));
    expect(readFileSync(join(f.out,'SHA256SUMS'),'utf8').trim().split('\n')).toHaveLength(2);
});
it('preserves the previous prepared release if a new artifact fails integrity',()=>{
    const f=fixture();writeFileSync(join(f.folder,'Live2D.zip'),'corrupt');
    expect(f.run).toThrow();
    expect(readdirSync(f.out)).toEqual(['removed-avatar.inp']);
    expect(readdirSync(join(f.root,'.cache'))).toEqual(['avatar-release']);
});
