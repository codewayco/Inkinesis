import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function loadEnvironment() { if (existsSync('.env')) process.loadEnvFile('.env'); }
export function imageApiKey() { return process.env.OPENAI_API_KEY || process.env.OPEN_AI_API_KEY || process.env.LLM_API_KEY; }
export function outputRoot() { loadEnvironment(); return process.env.RIG_OUTPUT_DIR || 'outputs'; }
export function rigConfig() {
    loadEnvironment();
    const e = process.env;
    return {
        python: e.RIG_DIRECT_PYTHON || '.venv/bin/python',
        localPython: e.RIG_LOCAL_PYTHON || '.venv-gen/bin/python',
        engine: e.RIG_DIRECT_ENGINE || '.cache/rig/psd2live',
        java: e.RIG_JAVA_HOME || e.JAVA_HOME || (process.platform==='darwin' ? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home' : '/usr/lib/jvm/java-21-openjdk-amd64'),
        seeThrough: e.RIG_DIRECT_SEE_THROUGH || '.cache/rig/see-through',
        models: e.RIG_DIRECT_MODELS || '.cache/rig/models',
        manifest: 'tools/generate/models/see-through.json',
        device: e.RIG_DEVICE || (process.platform==='darwin'?'mps':'cuda'),
        verifier: e.RIG_VERIFIER || 'tools/verify/inochi-puppet/inochi-puppet-check',
    };
}
export function preflight(options: {local?:boolean} = {}) {
    const config = rigConfig(), local=options.local!==false;
    const remoteOnly = new Set(['localPython','seeThrough','models']);
    const missing = Object.entries(config)
        .filter(([k,v]) => k!=='device' && (local||!remoteOnly.has(k)) && !existsSync(v))
        .map(([k,v])=>`${k}: ${v}`);
    if(local&&!['cuda','mps'].includes(config.device))missing.push('RIG_DEVICE must be cuda or mps; CPU inference is not supported');
    if(local&&existsSync(config.manifest)) {
        const weights=JSON.parse(readFileSync(config.manifest,'utf8')) as {model:string;path:string;size:number}[];
        for(const weight of weights){
            const file=join(config.models,weight.model,weight.path);
            if(!existsSync(file)||statSync(file).size!==weight.size)missing.push(`Incomplete model file: ${file}`);
        }
    }
    if(!process.env.ANTHROPIC_API_KEY)missing.push('ANTHROPIC_API_KEY');
    if(!imageApiKey())missing.push('OPENAI_API_KEY (drawing and expression generation)');
    if(!process.env.IMAGE_MODEL)missing.push('IMAGE_MODEL (an image generation/editing model available to your account)');
    if(!process.env.RIG_ANALYSIS_MODEL)missing.push('RIG_ANALYSIS_MODEL (an Anthropic vision model available to your account)');
    return {available:!missing.length,missing,config};
}
