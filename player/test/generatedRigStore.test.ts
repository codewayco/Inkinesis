import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,realpathSync,existsSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GeneratedRigStore} from '../generatedRigStore';
const id='00000000-0000-4000-8000-000000000001';
const fixtures:{root:string;store:GeneratedRigStore}[]=[];
function fixture(status='needs_review'){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'save-avatar-test-'))),saved=join(root,'saved'),store=new GeneratedRigStore(saved),dir=store.create(id);
 fixtures.push({root,store});
 for(const [name,data] of Object.entries({'report.json':JSON.stringify({status,files:{input:'input.png',rig:'character.inp'}}),'input.png':'image','prompt.txt':'prompt','character.inp':'rig','layers.psd':'layers'}))writeFileSync(join(dir,name),data);
 mkdirSync(join(dir,'live2d-downloads','hash','model'),{recursive:true});
 writeFileSync(join(dir,'live2d-downloads','hash','Live2D.zip'),'zip');writeFileSync(join(dir,'live2d-downloads','hash','model','Character.moc3'),'moc');
 return {store,dir,saved};
}
afterEach(()=>{for(const f of fixtures.splice(0)){f.store.dispose();rmSync(f.root,{recursive:true,force:true});}});
describe('explicit avatar persistence',()=>{
 it('keeps preview outside saved storage and copies the complete tree only on Save',async()=>{
  const {store,dir,saved}=fixture();expect(existsSync(saved)).toBe(false);
  expect(store.source(store.base(id)+'/character.inp')).toBe(join(dir,'character.inp'));
  const dest=await store.save(id);expect(dest).toBe(join(saved,id));
  for(const file of ['prompt.txt','input.png','character.inp','layers.psd','report.json','live2d-downloads/hash/Live2D.zip','live2d-downloads/hash/model/Character.moc3'])expect(readFileSync(join(dest,file))).toEqual(readFileSync(join(dir,file)));
  expect(await store.save(id)).toBe(dest);expect(store.source(store.base(id)+'/character.inp')).toBe(join(dest,'character.inp'));
  store.dispose();expect(existsSync(dir)).toBe(false);expect(existsSync(join(dest,'character.inp'))).toBe(true);
 });
 it('refuses incomplete runs and concurrent export/save without creating a destination',async()=>{
  const {store,dir,saved}=fixture('running');await expect(store.save(id)).rejects.toThrow('generation');expect(existsSync(saved)).toBe(false);
  writeFileSync(join(dir,'report.json'),JSON.stringify({status:'needs_review'}));
  const release=store.hold(dir);await expect(store.save(id)).rejects.toThrow('export');release();
  const saving=store.save(id);expect(()=>store.hold(dir)).toThrow('progress');await saving;
 });
 it('refuses path traversal, symlink artifacts and overwrite',async()=>{
  const {store,dir,saved}=fixture();expect(()=>store.file(id,'../outside')).toThrow('Invalid file');
  symlinkSync(join(dir,'input.png'),join(dir,'linked.png'));expect(()=>store.file(id,'linked.png')).toThrow('Symlink');
  await expect(store.save(id)).rejects.toThrow('linked');expect(existsSync(join(saved,id))).toBe(false);
  rmSync(join(dir,'linked.png'));mkdirSync(join(saved,id),{recursive:true});writeFileSync(join(saved,id,'keep'),'existing');
  await expect(store.save(id)).rejects.toThrow('exists');expect(readFileSync(join(saved,id,'keep'),'utf8')).toBe('existing');
 });
 it('allows saving a failed trial with a source image and clears unsaved previews on disposal',async()=>{
  const {store,dir,saved}=fixture('unsupported');rmSync(join(dir,'character.inp'));await store.save(id);expect(existsSync(join(saved,id,'input.png'))).toBe(true);
  const other='00000000-0000-4000-8000-000000000002',preview=store.create(other);store.dispose();expect(existsSync(preview)).toBe(false);expect(existsSync(join(saved,other))).toBe(false);
 });
});
