import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceQuality} from '../source';
import {judge} from '../vision';
import {editCandidate} from '../edit';
import type {Assessment,Issue} from '../schema';
vi.mock('../vision',()=>({POLICY:'test-policy',sha:(s:string|Buffer)=>createHash('sha256').update(s).digest('hex'),judge:vi.fn()}));
vi.mock('../edit',()=>({editCandidate:vi.fn(async (_input,out,_region,_instruction,kind,ledger)=>{const id=ledger.reserve(kind);writeFileSync(out,'candidate'+id);ledger.finish(id,'complete');return {png:Buffer.from('candidate'),changedPixels:1,allowedPixels:1,outsideScopeChanged:0};})}));
const dirs:string[]=[];
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});vi.mocked(judge).mockReset();vi.mocked(editCandidate).mockClear();});
function setup(){const d=mkdtempSync(join(tmpdir(),'source-quality-'));dirs.push(d);const input=join(d,'input.png');writeFileSync(input,'original');return {input,home:join(d,'quality')};}
const issue:Issue={code:'merged_limbs',stage:'source',severity:'blocking',evidence:'Hand touches hip',region:[.2,.3,.4,.5],part:'hand',certainty:'clear',repair:'source_edit',instruction:'Separate hand and hip'};
const a=(issues:Issue[],preservedIdentity:Assessment['preservedIdentity']='yes'):Assessment=>({issues,preservedIdentity,summary:'test'});
it('observe mode never spends an image edit or stops an existing input',async()=>{
 const {input,home}=setup();vi.mocked(judge).mockResolvedValue(a([issue]));
 const r=await sourceQuality(input,home,'observe','same identity',true);
 expect(editCandidate).not.toHaveBeenCalled();expect(r.selected).toBe(input);expect(r.stopBeforeRig).toBe(false);expect(readFileSync(input,'utf8')).toBe('original');
});
it('uploaded inputs cannot be automatically edited even in repair mode',async()=>{
 const {input,home}=setup();vi.mocked(judge).mockResolvedValue(a([issue]));
 const r=await sourceQuality(input,home,'repair','uploaded',false);
 expect(editCandidate).not.toHaveBeenCalled();expect(r.stopBeforeRig).toBe(true);expect(r.selected).toBe(input);
});
it('stops on identity regression, retains original, and cache resume never retries',async()=>{
 const {input,home}=setup();vi.mocked(judge).mockResolvedValueOnce(a([issue])).mockResolvedValueOnce(a([],'no'));
 const r=await sourceQuality(input,home,'repair','same identity',true);
 expect(editCandidate).toHaveBeenCalledTimes(1);expect(r.selected).toBe(input);expect(r.attempts[0].acceptance.eligibleForReview).toBe(false);
 await sourceQuality(input,home,'repair','same identity',true);expect(editCandidate).toHaveBeenCalledTimes(1);
});
it('caps source edits at two even when each improves a different blocking issue',async()=>{
 const {input,home}=setup();const other={...issue,part:'other hand'},third={...issue,part:'foot'};
 vi.mocked(judge).mockResolvedValueOnce(a([issue,other,third])).mockResolvedValueOnce(a([other,third])).mockResolvedValueOnce(a([third]));
 const r=await sourceQuality(input,home,'repair','same identity',true);
 expect(editCandidate).toHaveBeenCalledTimes(2);expect(r.attempts).toHaveLength(2);expect(r.stopBeforeRig).toBe(true);expect(r.humanApproved).toBe(false);expect(readFileSync(input,'utf8')).toBe('original');
});
it('a passed original bypasses edits and proceeds unmodified',async()=>{
 const {input,home}=setup();vi.mocked(judge).mockResolvedValue(a([]));const r=await sourceQuality(input,home,'repair','same identity',true);
 expect(r.selected).toBe(input);expect(r.status).toBe('pass_checks');expect(editCandidate).not.toHaveBeenCalled();
});
it('uncertain blocking suggestions do not become automatic refusal',async()=>{
 const {input,home}=setup();vi.mocked(judge).mockResolvedValue(a([{...issue,certainty:'uncertain'}]));const r=await sourceQuality(input,home,'repair','same identity',true);
 expect(r.stopBeforeRig).toBe(false);expect(r.status).toBe('needs_review');expect(editCandidate).not.toHaveBeenCalled();
});
