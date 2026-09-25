/** Public catalog metadata; large payloads are distributed as release assets. */
export interface AvatarArtifact { file:string; asset:string; bytes:number; sha256:string }
export interface AvatarEntry { id:string; label:string; base:string; preview:string; files:Record<string,string>; artifacts:AvatarArtifact[] }
export interface AvatarCatalog { release:{baseUrl:string|null}; entries:AvatarEntry[] }
const basename=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s)&&!s.includes('..');
export function validAvatarEntry(e:AvatarEntry):boolean {
    return Boolean(e&&typeof e.id==='string'&&/^[a-z0-9-]+$/.test(e.id)&&typeof e.label==='string'&&
        e.base===`/example-avatars/${e.id}`&&e.preview===`/example-avatars/previews/${e.id}.webp`&&
        e.files?.['Download rig']==='character.inp'&&e.files?.['Live2D package']==='Live2D.zip'&&
        Array.isArray(e.artifacts)&&e.artifacts.length===2&&new Set(e.artifacts.map(a=>a.file)).size===2&&
        e.artifacts.every(a=>['character.inp','Live2D.zip'].includes(a.file)&&basename(a.asset)&&
            Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes<2*1024**3&&/^[a-f0-9]{64}$/.test(a.sha256)));
}
export function readCatalog(value:unknown):AvatarCatalog {
    const c=value as AvatarCatalog;
    if(!c||!Array.isArray(c.entries)||!c.entries.length||!c.entries.every(validAvatarEntry)||
        new Set(c.entries.map(e=>e.id)).size!==c.entries.length||!c.release||
        !(c.release.baseUrl===null||typeof c.release.baseUrl==='string'))throw new Error('Invalid example avatar catalog');
    const assets=c.entries.flatMap(e=>e.artifacts.map(a=>a.asset));
    if(new Set(assets).size!==assets.length)throw new Error('Duplicate release asset names');
    return c;
}
