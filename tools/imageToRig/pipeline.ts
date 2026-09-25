/** One isolated input-to-delivery run. Existing experiments are never overwritten. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight, outputRoot, imageApiKey } from './config';
import { acquireRun } from './lock';
import { readCombined } from '../../player/src/combinedRuntime';
import { analyze } from './analyze';
import { analyzeGarment, assessGarment, type GarmentAssessment } from './garmentAnalysis';
import { decomposeH100 } from '../remote/decompose';
import { runDecomposition, uiGpuOptions } from './decompositionBackend';
import {sourceQuality} from '../quality/source';
import {preparedQuality} from '../quality/prepared';
import {motionQuality} from '../quality/motion';
import {assessCapabilities,type MotionCapabilities} from './capabilities';
export interface RunReport {
    motionCapabilities?: MotionCapabilities;
    qualityMode?: 'off' | 'observe' | 'repair';
    originalInputSha256?: string;
    decomposition?: {requested:'h100-first'|'h100'|'local';used?:'h100'|'local';fallbackReason?:string;cached?:boolean};
    preparation?: 'independent';
    rigMode?: 'visible-limbs' | 'garment-v1';
    id: string;
    status: 'running' | 'success' | 'needs_review' | 'unsupported' | 'failed';
    stage: string;
    detail?: string;
    started: string;
    finished?: string;
    reasons: string[];
    stages: {
        name: string;
        status: string;
        seconds: number;
    }[];
    files: Record<string, string>;
    inputSha256?: string;
}
export const RUN_ROOT = outputRoot();
export async function runPipeline(options: {
    image?: string;
    prompt?: string;
    out?: string;
    resume?: boolean;
    live2d?: boolean;
    experimentalGarments?: boolean;
    remoteQueue?: string;
    allowLocalFallback?: boolean;
    quality?: 'off' | 'observe' | 'repair';
}, notify?: (r: RunReport) => void) {
    const id = randomUUID(), home = resolve(options.out ?? join(RUN_ROOT, id));
    if (!options.resume && existsSync(join(home, 'report.json')))
        throw new Error('Output already contains a run; choose a new directory.');
    if (!options.resume && existsSync(home) && readdirSync(home).some(name => name !== 'upload')) throw new Error('Output directory is not empty; choose a new directory or resume an existing run.');
    mkdirSync(home, { recursive: true });
    const previous = options.resume && existsSync(join(home, 'report.json')) ? JSON.parse(readFileSync(join(home, 'report.json'), 'utf8')) as RunReport : undefined;
    const preparation = 'independent';
    const rigMode = options.experimentalGarments ? 'garment-v1' : 'visible-limbs';
    const qualityMode=options.quality??'off';
    if(!['off','observe','repair'].includes(qualityMode))throw new Error('Invalid quality mode');
    if(previous&&(previous.qualityMode??'off')!==qualityMode)throw new Error('Cannot change quality mode on resume');
    if (previous && (previous.rigMode ?? 'visible-limbs') !== rigMode) throw new Error('Cannot change rig mode on resume.');
    if (options.experimentalGarments && (!options.remoteQueue || options.allowLocalFallback)) throw new Error('Garment experiments require --h100-queue; no local fallback.');
    if (previous)
        copyFileSync(join(home, 'report.json'), join(home, `report-attempt-${Date.now()}.json`));
    const report: RunReport = { id, preparation, rigMode, qualityMode, status: 'running', stage: 'preflight', started: new Date().toISOString(), reasons: [], stages: previous?.stages ?? [], files: {}, decomposition:{requested:options.remoteQueue?(options.allowLocalFallback?'h100-first':'h100'):'local'} };
    const save = () => { writeFileSync(join(home, 'report.pending.json'), JSON.stringify(report, null, 2) + '\n'); renameSync(join(home, 'report.pending.json'), join(home, 'report.json')); notify?.(structuredClone(report)); };
    const c = preflight({local:!options.remoteQueue || options.allowLocalFallback});
    const env = { ...process.env };
    const release = acquireRun(home);
    // Existing prompt drawer writes relative records; isolate its working directory.
    const command = (name: string, bin: string, args: string[], cwd = process.cwd(), extraEnv: Record<string, string> = {}) => new Promise<void>((done, fail) => {
        report.stage = name;
        save();
        const start = Date.now();
        const child = spawn(bin, args, { cwd, env: { ...env, ...extraEnv } });
        let output = '', lastFlush = 0;
        const logPath = join(home, name + '.log');
        const previousLog = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
        const flushLog = () => {
            let safe = output;
            for (const [k, v] of Object.entries(env))
                if (/KEY|TOKEN|SECRET/.test(k) && v) safe = safe.split(v).join('[redacted]');
            // Retain a suffix while the process is live so a credential split across
            // stdout chunks cannot leak before its remainder arrives.
            const longestSecret = Math.max(1, ...Object.entries(env).filter(([k,v]) => /KEY|TOKEN|SECRET/.test(k) && v).map(([,v]) => v!.length));
            writeFileSync(logPath, previousLog + safe.slice(0, Math.max(0, safe.length - longestSecret)));
        };
        const collect = (v: Buffer) => { output += String(v); if (Date.now() - lastFlush > 1000) { flushLog(); lastFlush = Date.now(); } };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.on('error', fail);
        child.on('close', code => {
            for (const [k, v] of Object.entries(env))
                if (/KEY|TOKEN|SECRET/.test(k) && v) output = output.split(v).join('[redacted]');
            writeFileSync(logPath, previousLog + output);
            report.stages.push({ name, status: code === 0 ? 'complete' : 'failed', seconds: (Date.now() - start) / 1000 });
            save();
            if (code === 0)
                done();
            else {
                report.files.failureLog = name + '.log';
                fail(new Error(`${name} failed (exit ${code}); see ${name}.log`));
            }
        });
    });
    const node = (name: string, script: string, args: string[], cwd?: string) => command(name, process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve(script), ...args], cwd);
    try {
        save();
        if (!c.available)
            throw new Error('Missing requirements: ' + c.missing.join('; '));
        if (Boolean(options.image) === Boolean(options.prompt))
            throw new Error('Supply exactly one image or prompt.');
        const cfg = c.config, assets = join(home, 'assets'), rig = join(home, 'rig');
        let source = join(home, 'input.png');
        mkdirSync(assets, { recursive: true });
        if (options.resume && options.prompt && readFileSync(join(home, 'prompt.txt'), 'utf8').trim() !== options.prompt.trim())
            throw new Error('Resume prompt differs from the original run.');
        if (options.prompt && !(options.resume && existsSync(source))) {
            if (!imageApiKey())
                throw new Error('Set OPENAI_API_KEY for prompt drawing.');
            writeFileSync(join(home, 'prompt.txt'), options.prompt + '\n');
            await node('draw', 'tools/generate/baseOpenAI.ts', ['--prompt', options.prompt, '--out', source], home);
        }
        else if (options.image) {
            await command('normalize', cfg.python, ['-c', 'from PIL import Image,ImageOps; import sys; im=ImageOps.exif_transpose(Image.open(sys.argv[1])); im.thumbnail((1536,1536)); im.convert("RGBA").save(sys.argv[2])', resolve(options.image!), join(home, 'normalized.png')]);
            const normalized = readFileSync(join(home, 'normalized.png'));
            if (previous?.inputSha256 && createHash('sha256').update(normalized).digest('hex') !== (previous.originalInputSha256??previous.inputSha256))
                throw new Error('Resume image differs from the original run.');
            writeFileSync(source, normalized);
        }
        report.inputSha256 = createHash('sha256').update(readFileSync(source)).digest('hex');
        report.files.input = 'input.png';
        report.originalInputSha256=report.inputSha256;
        if(qualityMode!=='off'){
            report.stage='source-quality';save();const started=Date.now();
            try{
                const q=await sourceQuality(source,join(home,'quality/source'),qualityMode,options.prompt??'Preserve the uploaded character; report unsupported capabilities without changing its design.',Boolean(options.prompt));
                report.files.sourceQuality='quality/source/result.json';
                if(q.stopBeforeRig){report.status='needs_review';report.reasons=['A clear blocking source finding remains; automatic repair stopped or was not permitted. Original image retained; see source quality report.'];return report;}
                source=q.selected;report.inputSha256=q.selectedSha256;
                report.files.input=source.slice(home.length+1);
                report.stages.push({name:'source-quality',status:'complete',seconds:(Date.now()-started)/1000});
            }catch(error){
                report.stages.push({name:'source-quality',status:'failed',seconds:(Date.now()-started)/1000});
                if(qualityMode==='repair')throw error;
                writeFileSync(join(home,'quality-error.json'),JSON.stringify({stage:'source',message:error instanceof Error?error.message:'Error',mode:'observe',blockedProduction:false}));report.files.qualityError='quality-error.json';
            }
        }
        report.stage = 'support-and-landmarks';
        save();
        const t = Date.now();
        const analysisPath = join(home, 'analysis.json');
        let analysis: Omit<Awaited<ReturnType<typeof analyze>>,'capabilities'> & {capabilities?:MotionCapabilities|ReturnType<typeof assessGarment>['capabilities']};
        if (options.resume && existsSync(analysisPath)) {
            analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));
            if (analysis.source.digest !== 'sha256:' + report.inputSha256)
                throw new Error('Cached analysis belongs to another image.');
            Object.assign(analysis, options.experimentalGarments ? assessGarment(analysis.assessment as GarmentAssessment) : assessCapabilities(analysis.assessment, analysis.source.width, analysis.source.height));
            analysis.points = Object.fromEntries(Object.entries(analysis.assessment.points).filter(([, p]) => p && p.confidence >= (options.experimentalGarments ? .8 : .5) && p.confidence <= 1 && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1).map(([k, p]) => [k, { x: p!.x * analysis.source.width, y: p!.y * analysis.source.height }]));
            writeFileSync(analysisPath, JSON.stringify(analysis, null, 2) + '\n');
        }
        else
            analysis = options.experimentalGarments ? await analyzeGarment(source, analysisPath) : await analyze(source, analysisPath);
        report.stages.push({ name: report.stage, status: 'complete', seconds: (Date.now() - t) / 1000 });
        report.files.analysis = 'analysis.json';
        if(!options.experimentalGarments)report.motionCapabilities=analysis.capabilities as MotionCapabilities;
        if (!analysis.canBuild) {
            report.status = analysis.status === 'unsupported' ? 'unsupported' : 'needs_review';
            report.reasons = analysis.reasons;
            return report;
        }
        await command('neutralize', cfg.python, ['tools/generate/prepareCharacter.py', 'neutralize', '--image', source, '--out', assets]);
        // Decomposition must use the exact neutralized image that the expression stages use.
        const decompositionRecord = join(assets, 'local-decomposition.json');
        const cachedDecomposition = options.resume && existsSync(decompositionRecord) && existsSync(join(assets, 'decomposition.psd')) ? JSON.parse(readFileSync(decompositionRecord, 'utf8')) : null;
        const remoteRecord = join(assets, 'remote-execution.json');
        const remoteCache = existsSync(remoteRecord) ? JSON.parse(readFileSync(remoteRecord, 'utf8')) : null;
        const remoteMatches = !options.remoteQueue || (remoteCache?.gpu?.includes('H100') && remoteCache.inputSha256 === cachedDecomposition?.inputSha256 && remoteCache.outputSha256 === cachedDecomposition?.outputSha256 && remoteCache.runnerSha256 === createHash('sha256').update(readFileSync('tools/generate/localSeeThrough.py')).digest('hex'));
        const decompositionMatches = (remoteMatches || (options.allowLocalFallback && cachedDecomposition?.device === cfg.device)) && cachedDecomposition?.status === 'complete' && cachedDecomposition.manifestSha256 === createHash('sha256').update(readFileSync(cfg.manifest)).digest('hex') && cachedDecomposition.inputSha256 === createHash('sha256').update(readFileSync(join(assets, 'input.png'))).digest('hex') && cachedDecomposition.outputSha256 === createHash('sha256').update(readFileSync(join(assets, 'decomposition.psd'))).digest('hex');
        if (!decompositionMatches) {
            report.decomposition!.used=await runDecomposition(options,{
                remote:async()=>{
                    report.stage='see-through-h100';report.decomposition!.used='h100';save();const started=Date.now();
                    try { await decomposeH100(join(assets,'input.png'),assets,options.remoteQueue!);
                        report.stages.push({name:'see-through-h100',status:'complete',seconds:(Date.now()-started)/1000});
                    } catch(error){report.stages.push({name:'see-through-h100',status:'failed',seconds:(Date.now()-started)/1000});throw error;}
                    finally{save();}
                },
                fallback:reason=>{report.decomposition!.used='local';report.decomposition!.fallbackReason=reason;report.stage='see-through-fallback';save();},
                local:async()=>{
                    report.decomposition!.used='local';
                    if(existsSync(remoteRecord))renameSync(remoteRecord,join(assets,`remote-execution-before-local-${Date.now()}.json`));
                    await command('see-through',cfg.localPython,['tools/generate/localSeeThrough.py','--source-checkout',cfg.seeThrough,'--models',cfg.models,'--manifest',cfg.manifest,'--input',join(assets,'input.png'),'--output',assets,'--device',cfg.device]);
                }
            });save();
        } else {
            report.decomposition!.used=remoteMatches&&remoteCache?'h100':'local';report.decomposition!.cached=true;save();
        }
        const common = ['--image', source, '--psd', join(assets, 'decomposition.psd'), '--out', assets];
        await command('expression-regions', cfg.python, ['tools/generate/prepareCharacter.py', 'plan', ...common, '--analysis', analysisPath]);
        await node('expression-edits', 'tools/generate/editExpressions.ts', [assets]);
        await command('prepare-layers', cfg.python, ['tools/generate/prepareCharacter.py', 'prepare', ...common, '--analysis', analysisPath, ...(options.experimentalGarments ? ['--garment-mode'] : [])]);
        report.files.preparedLayers = 'assets/character.psd';
        report.files.preparationReport = 'assets/preparation.json';
        if(qualityMode!=='off'){
            report.stage='layer-quality';save();const started=Date.now();
            try{
                await preparedQuality(source,join(assets,'character.psd'),join(home,'quality/layers'));
                report.files.layerQuality='quality/layers/assessment.json';
                report.stages.push({name:'layer-quality',status:'complete',seconds:(Date.now()-started)/1000});
            }catch(error){
                writeFileSync(join(home,'layer-quality-error.json'),JSON.stringify({message:error instanceof Error?error.message:'Error',blockedProduction:false}));report.files.layerQualityError='layer-quality-error.json';
                report.stages.push({name:'layer-quality',status:'failed',seconds:(Date.now()-started)/1000});
            }
            // Layer repairs remain isolated explicit candidates until calibrated and reviewed.
        }
        await command('source-bust', cfg.python, ['tools/rig/psd2live/prepareDirect.py', '--engine', cfg.engine, '--java-home', cfg.java, '--psd', join(assets, 'character.psd'), '--output', rig]);
        const config = { compactFace: true, headAttachmentSafety: true, sourcePoses: join(rig, 'model/poses.json'), landmarks: join(home, 'analysis.json'), reference: source, out: home, visibleSeparateLimbs: analysis.assessment.separateLimbs, longGarment: analysis.assessment.longGarment, ...(!options.experimentalGarments?{capabilities:analysis.capabilities}:{}) };
        writeFileSync(join(home, 'combined-config.json'), JSON.stringify(config, null, 2) + '\n');
        await node('combined-rig', options.experimentalGarments ? 'tools/rig/buildGarment.ts' : 'tools/rig/buildCombined.ts', [join(home, 'combined-config.json')]);
        // Keep build provenance precise without changing the builder's contract.
        const build = JSON.parse(readFileSync(join(home, 'build.json'), 'utf8'));
        if(build.motionCapabilities)report.motionCapabilities=build.motionCapabilities;
        build.landmarkMode = 'Automatic model inference with confidence, bounds and support gates; see analysis.json';
        writeFileSync(join(home, 'build.json'), JSON.stringify(build, null, 2) + '\n');
        const samples = [{ label: 'rest', values: {} }, ...Array.from({ length: 12 }, (_, i) => { const t = i / 12 * Math.PI * 2; return { label: `demo_${String(i).padStart(2, '0')}`, values: { 'Head Angles': [15 * Math.sin(t), 10 * Math.cos(t)], 'ParamAngleZ': [8 * Math.sin(t)], 'ParamMouthOpenY': [(1 + Math.sin(t)) / 2], 'ParamGarmentSway':[Math.sin(t)], 'ParamBodySway':[Math.sin(t)*.5], 'ParamBreath':[(1+Math.cos(t))/2], 'Arm L': [18 * Math.sin(t), 25 * (1 + Math.sin(t))], 'Arm R': [-18 * Math.sin(t), 25 * (1 - Math.sin(t))], 'Leg L': [12 * Math.sin(t), 12 * (1 + Math.sin(t))], 'Leg R': [-12 * Math.sin(t), 12 * (1 - Math.sin(t))] } }; })];
        if (options.experimentalGarments) for (const value of [-1,-.5,0,.5,1]) samples.push({label:`cloth_${value}`,values:{ParamGarmentSway:[value],ParamBodySway:[value],ParamBreath:[Math.abs(value)]} as typeof samples[number]['values']});
        if (options.experimentalGarments) for (const side of [-1,1]) samples.push({label:`head_combined_${side}`,values:{'Head Angles':[45*side,-30*side],ParamAngleZ:[30*side]} as typeof samples[number]['values']});
        const availableControls = new Set(readCombined(readFileSync(join(home, 'character.inp'))).puppet.param.map(p => p.name));
        for (const sample of samples)
            sample.values = Object.fromEntries(Object.entries(sample.values).filter(([name]) => availableControls.has(name)).map(([name, value]) => [name, [value![0], value![1] ?? 0]]));
        writeFileSync(join(home, 'samples.json'), JSON.stringify(samples));
        await command('native-validation', cfg.verifier, ['--pose', join(home, 'poses.json'), join(home, 'character.inp'), join(home, 'samples.json')]);
        await node('geometry-audit', 'tools/imageToRig/validate.ts', [join(home, 'character.inp'), join(home, 'poses.json'), join(home, 'validation.json')]);
        await node('render-evidence', 'tools/verify/measurePuppet.ts', [join(home, 'character.inp'), join(home, 'poses.json'), source, join(home, 'frames')]);
        await command('demo', cfg.python, ['-c', 'from PIL import Image; from pathlib import Path; import sys; p=Path(sys.argv[1]); fs=[Image.open(f).convert("RGBA") for f in sorted((p/"frames").glob("demo_*.png"))]; fs[0].save(p/"demo.gif",save_all=True,append_images=fs[1:],duration=100,loop=0,disposal=2)', home]);
        copyFileSync(join(assets, 'decomposition.psd'), join(home, 'layers.psd'));
        report.files = { ...report.files, rig: 'character.inp', layers: 'layers.psd', build: 'build.json', poses: 'poses.json', measurement: 'frames/measurement.json', validation: 'validation.json', demo: 'demo.gif' };
        // Structural validation is not visual acceptance. Always preserve review status.
        report.status = 'needs_review';
        report.reasons = [...analysis.assessment.reasons, ...Object.entries({...report.motionCapabilities?.chains,...report.motionCapabilities?.face,...report.motionCapabilities?.headAxes}).flatMap(([name,c])=>c.reasons.map(r=>`${name}: ${r}`)), 'Rig exported and native geometry evaluated. Visual review is required for anatomy, identity, expression quality and extreme poses.'];
        if(qualityMode!=='off'){
            report.stage='motion-quality';save();const started=Date.now();
            try{
                await motionQuality(source,join(home,'character.inp'),join(home,'quality/motion'),cfg.verifier);
                report.files.motionQuality='quality/motion/assessment.json';
                report.stages.push({name:'motion-quality',status:'complete',seconds:(Date.now()-started)/1000});
            }catch(error){
                writeFileSync(join(home,'motion-quality-error.json'),JSON.stringify({message:error instanceof Error?error.message:'Error',blockedProduction:false}));
                report.files.motionQualityError='motion-quality-error.json';
                report.stages.push({name:'motion-quality',status:'failed',seconds:(Date.now()-started)/1000});
            }
        }
        if (options.live2d) {
            // A secondary export must never invalidate or overwrite the delivered INP.
            const folder = 'live2d-' + id;
            report.status = 'running';
            try {
                await command('live2d-export', process.execPath, ['--import', 'tsx', 'tools/rig/live2d/export.ts', join(home, 'character.inp'), join(home, folder), 'Character']);
                report.files.live2d = folder + '/model/Character.model3.json';
                report.files.live2dProject = folder + '/model/Character.cmo3';
                report.files.live2dReport = folder + '/export.json';
                report.reasons.push('Optional Live2D package exported. Its Cubism Core/Viewer check and visual review remain separate from INP validation.');
            } catch (error) {
                report.reasons.push('Optional Live2D export failed; the validated INP remains available. ' + (error instanceof Error ? error.message : String(error)));
            } finally {
                report.status = 'needs_review';
            }
        }
    }
    catch (error) {
        report.status = 'failed';
        report.reasons = [error instanceof Error ? error.message : String(error)];
    }
    finally {
        report.finished = new Date().toISOString();
        writeFileSync(join(home, 'REPORT.md'), `# Image-to-rig result\n\nStatus: **${report.status}**\n\n${report.reasons.join('\n\n')}\n\n${report.motionCapabilities ? '## Regional motion\n\n'+(report.files.rig?'Prepared rig; visual review required.':'Source candidates only; no rig produced.')+'\n\n| Region | Movement | Evidence stage | Reason |\n| --- | --- | --- | --- |\n'+Object.entries({...(report.motionCapabilities.headAxes?{blink:report.motionCapabilities.face.blink,mouth:report.motionCapabilities.face.mouth}:report.motionCapabilities.face),...report.motionCapabilities.headAxes,...report.motionCapabilities.chains}).map(([name,c])=>'| '+[name,c.mode,c.stage,[...c.reasons,...(c.checks??[]).map(check=>check.name+': '+check.status+(check.samples?' ('+check.samples+' poses)':'')+'. '+check.detail)].join(' ')||'No restriction found in these checks.'].map(v=>v.replaceAll('|','/').replaceAll('\n',' ')).join(' | ')+' |').join('\n')+'\n\n':''}See-through backend: **${report.decomposition?.used ?? 'not run'}** (requested: ${report.decomposition?.requested}).${report.decomposition?.fallbackReason ? '\n\nLocal fallback: ' + report.decomposition.fallbackReason : ''}\n\n${Object.entries(report.files).map(([k, v]) => `- [${k}](${v})`).join('\n')}\n\nModel analysis is fallible. Structural checks do not certify visual quality.\n\nComponents: See-through semantic decomposition, repository-owned expression and layer preparation with a direct psd2live adapter, and this repository's continuous limb rig. No Cubism Core or physics is included.\n`);
        save();
        release();
    }
    return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2), get = (flag: string) => args[args.indexOf(flag) + 1];
    if (args.includes('--check')) {
        const policy=uiGpuOptions();
        const p = preflight({local:!policy.remoteQueue||policy.allowLocalFallback});
        console.log(JSON.stringify({ available: p.available, missing: p.missing }, null, 2));
        process.exitCode = p.available ? 0 : 1;
    }
    else if (args.includes('--help') || !args.length)
        console.log('Usage: npm run image-to-rig -- --image input.png [--out directory] [--live2d] [--h100-queue path] [--experimental-garments] [--quality off|observe|repair]\n       npm run inkinesis -- --prompt "character description" [--out directory]\n       npm run image-to-rig -- --check');
    else {
        const result = await runPipeline({ image: args.includes('--image') ? get('--image') : undefined, prompt: args.includes('--prompt') ? get('--prompt') : undefined, out: args.includes('--out') ? get('--out') : undefined, resume: args.includes('--resume'), live2d: args.includes('--live2d'), experimentalGarments: args.includes('--experimental-garments'), remoteQueue: args.includes('--h100-queue') ? get('--h100-queue') : undefined, quality:args.includes('--quality')?get('--quality') as 'off'|'observe'|'repair':undefined }, r => console.log(`${r.status}: ${r.stage}`));
        process.exitCode = result.status === 'failed' ? 1 : result.status === 'unsupported' ? 2 : 0;
    }
}
