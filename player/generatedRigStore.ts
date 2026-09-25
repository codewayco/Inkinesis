/** UI runs are disposable until explicitly saved; CLI output paths are unchanged. */
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {cp, lstat, readdir, rename, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';

import {outputRoot} from '../tools/imageToRig/config';

export const UI_RIG_URL = '/api/rig/files';
const validId = (id: string) => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);
export class GeneratedRigStore {
  private temporary?: string;
  private entries = new Map<string, {dir:string;saved:boolean;busy:boolean}>();
  constructor(private savedRoot = resolve(outputRoot())) {}
  private tempRoot() { return this.temporary ??= realpathSync(mkdtempSync(join(tmpdir(), 'inkinesis-preview-'))); }
  create(id:string) {
    if (!validId(id) || this.entries.has(id)) throw new Error('Invalid or duplicate generation');
    const dir=join(this.tempRoot(),id);mkdirSync(dir);
    this.entries.set(id,{dir,saved:false,busy:false});return dir;
  }
  get(id:string) {
    if(!this.entries.has(id)&&validId(id)&&existsSync(join(this.savedRoot,id,'report.json')))
      this.entries.set(id,{dir:resolve(this.savedRoot,id),saved:true,busy:false});
    return this.entries.get(id);
  }
  list() { return [...this.entries].map(([id,e])=>({id,saved:e.saved})); }
  base(id:string) { return `${UI_RIG_URL}/${id}`; }
  file(id:string,name:string) {
    const entry=this.get(id);if(!entry)throw new Error('Temporary generation unavailable; the server may have restarted.');
    const root=realpathSync(entry.dir),path=resolve(root,name),rel=relative(root,path);
    if(!rel || rel==='..' || rel.startsWith('..'+sep) || isAbsolute(rel))throw new Error('Invalid file');
    if(realpathSync(path)!==path)throw new Error('Symlink files are not supported');
    return path;
  }
  source(url:string) {
    const match=url.match(/^\/api\/rig\/files\/([a-f0-9-]{36})\/character\.inp$/);
    if(!match)throw new Error('Invalid temporary rig');
    return this.file(match[1],'character.inp');
  }
  hold(dir:string) {
    const e=[...this.entries.values()].find(e=>e.dir===dir);
    if(e?.busy)throw new Error('Saving or exporting this avatar is already in progress.');
    if(e)e.busy=true;
    return ()=>{if(e)e.busy=false;};
  }
  exportRoot() { return join(this.tempRoot(),'exports'); }
  async save(id:string) {
    const e=this.entries.get(id);if(!e)throw new Error('Temporary generation unavailable.');
    if(e.busy)throw new Error('Wait for this avatar’s current save or export to finish.');
    if(e.saved)return e.dir;
    const report=JSON.parse(readFileSync(join(e.dir,'report.json'),'utf8'));
    if(report.status==='running')throw new Error('Wait for generation to finish before saving.');
    if(!existsSync(join(e.dir,'input.png')))throw new Error('There is no generated image to save.');
    e.busy=true;
    const dest=join(this.savedRoot,id),stage=join(this.savedRoot,`.saving-${id}`);
    try {
      if(existsSync(dest))throw new Error('Destination already exists; it has not been overwritten.');
      // Refuse links rather than copying unrelated files through an artifact directory.
      const check=async(path:string):Promise<void>=>{
        const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Cannot save a linked artifact.');
        if(info.isDirectory())for(const name of await readdir(path))await check(join(path,name));
      };
      await check(e.dir);mkdirSync(dirname(dest),{recursive:true});
      await cp(e.dir,stage,{recursive:true,errorOnExist:true,force:false});
      await rename(stage,dest);
      // Keep temporary URLs valid, but subsequent exports now live beside the saved rig.
      e.dir=dest;e.saved=true;return dest;
    } catch(error) {await rm(stage,{recursive:true,force:true});throw error;}
    finally {e.busy=false;}
  }
  dispose() { if(this.temporary)rmSync(this.temporary,{recursive:true,force:true});this.entries.clear(); }
}
export const generatedRigs = new GeneratedRigStore();
// Ordinary server shutdown removes preview files. Abrupt crashes may leave OS temp files.
process.once('exit',()=>generatedRigs.dispose());
