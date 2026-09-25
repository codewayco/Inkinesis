import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editExpressions } from '../editExpressions';
import { encodePNG } from '../../shared/encodePNG';

const directories:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();directories.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}));});
function fixture(kinds=['eyes','mouth']) {
    const root=mkdtempSync(join(tmpdir(),'rig-expression-test-'));directories.push(root);
    const image=encodePNG(new Uint8ClampedArray(16).fill(255),2,2);
    writeFileSync(join(root,'edit-source.png'),image);
    for(const kind of kinds)writeFileSync(join(root,`edit-mask-${kind}.png`),image);
    writeFileSync(join(root,'edit-plan.json'),JSON.stringify({expressionKinds:kinds}));
    vi.stubEnv('OPEN_AI_API_KEY','test-key');return {root,image};
}
describe('direct expression API adapter',()=>{
    it('sends only the planned masked edits, then reuses verified bytes',async()=>{
        const {root,image}=fixture();
        const fetch=vi.fn(async(_url:unknown,options:RequestInit)=>{
            const form=options.body as FormData;
            expect(form.get('image')).toBeInstanceOf(Blob);expect(form.get('mask')).toBeInstanceOf(Blob);
            return new Response(JSON.stringify({data:[{b64_json:Buffer.from(image).toString('base64')}]}),{status:200});
        });vi.stubGlobal('fetch',fetch);
        await editExpressions(root);await editExpressions(root);
        expect(fetch).toHaveBeenCalledTimes(2);
        writeFileSync(join(root,'expression_mouth.png'),'corrupted');
        await expect(editExpressions(root)).rejects.toThrow('Expression cache differs');
        expect(fetch).toHaveBeenCalledTimes(2);
    });
    it('keeps eye edits when speaking-mouth generation fails in partial mode',async()=>{
        const {root,image}=fixture();writeFileSync(join(root,'edit-plan.json'),JSON.stringify({expressionKinds:['eyes','mouth'],allowPartial:true}));
        vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:[{b64_json:Buffer.from(image).toString('base64')}]}),{status:200})).mockResolvedValueOnce(new Response('unavailable',{status:503})));
        await editExpressions(root);expect(readFileSync(join(root,'expression_eyes.png'))).toEqual(Buffer.from(image));
        expect(JSON.parse(readFileSync(join(root,'expression_mouth.failure.json'),'utf8')).status).toBe('unavailable');
    });
    it('does not request eyes when decomposition has no independent eye layers',async()=>{
        const {root,image}=fixture(['mouth']);const fetch=vi.fn(async()=>new Response(JSON.stringify({data:[{b64_json:Buffer.from(image).toString('base64')}]})));
        vi.stubGlobal('fetch',fetch);await editExpressions(root);expect(fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(readFileSync(join(root,'expression_mouth.json'),'utf8')).inputSha256).toHaveLength(64);
    });
    it('reports a provider rejection without leaking its response body or credentials',async()=>{
        const {root}=fixture();vi.stubGlobal('fetch',vi.fn(async()=>new Response('sensitive provider text',{status:401})));
        await expect(editExpressions(root)).rejects.toThrow('image service answered 401');
    });
});
