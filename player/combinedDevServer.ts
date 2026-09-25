/** Development-only asynchronous jobs for the new version. */
import type { Plugin } from 'vite';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { runPipeline, RUN_ROOT, type RunReport } from '../tools/imageToRig/pipeline';
import { preflight } from '../tools/imageToRig/config';
import { uiGpuOptions } from '../tools/imageToRig/decompositionBackend';
import { bridgeStatus } from '../tools/remote/decompose';
import { generatedRigs, UI_RIG_URL, type GeneratedRigStore } from './generatedRigStore';
import { activeRun } from '../tools/imageToRig/lock';
export function combinedDevServer(store: GeneratedRigStore = generatedRigs): Plugin {
    return { name: 'combined-rig-jobs', apply: 'serve', configureServer(server) {
            let running: string | null = null;
            const jobs = new Map<string, RunReport>();
            server.middlewares.use('/api/rig', (req, res) => {
                const send = (status: number, value: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
                const path = (req.url ?? '/').split('?')[0];
                const asset = path.match(/^\/files\/([a-f0-9-]{36})\/(.+)$/);
                if (req.method === 'GET' && asset) {
                    try {
                        const file = store.file(asset[1],decodeURIComponent(asset[2]));
                        if(!statSync(file).isFile())return send(404,{error:'Unknown file'});
                        const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.json':'application/json','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.zip':'application/zip'};
                        res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');
                        res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
                        const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return;
                    } catch {return send(404,{error:'Preview file unavailable'});}
                }
                const saveMatch=path.match(/^\/([a-f0-9-]{36})\/save$/);
                if(req.method==='POST' && saveMatch){
                    if(req.headers.origin && ![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))return send(403,{error:'Same-origin requests only'});
                    if(running===saveMatch[1])return send(409,{error:'Wait for generation to finish before saving.'});
                    void store.save(saveMatch[1]).then(folder=>send(200,{saved:true,folder,base:store.base(saveMatch[1])})).catch(error=>send(409,{error:String(error.message??error)}));return;
                }
                if (req.method === 'GET') {
                    if(path==='/session')return send(200,{entries:store.list()});
                    if (path === '/' || path === '') {
                        const policy=uiGpuOptions();
                        const p = preflight({local:!policy.remoteQueue||policy.allowLocalFallback});
                        return send(200, { available: p.available, missing: p.missing, running, decomposition: {policy:process.env.RIG_GPU_BACKEND||'local',...(uiGpuOptions().remoteQueue?bridgeStatus(uiGpuOptions().remoteQueue!):{ready:false,reason:'Local GPU selected'})} });
                    }
                    if (path === '/last') {
                        const root = resolve(RUN_ROOT);
                        const last = existsSync(root) ? readdirSync(root).filter(id => /^[a-zA-Z0-9-]+$/.test(id) && existsSync(join(root, id, 'report.json')) && existsSync(join(root, id, 'character.inp')) && Boolean(JSON.parse(readFileSync(join(root, id, 'report.json'), 'utf8')).files?.rig)).sort((a, b) => statSync(join(root, b, 'report.json')).mtimeMs - statSync(join(root, a, 'report.json')).mtimeMs)[0] : undefined;
                        return last ? send(200, { base: store.base(last), report: JSON.parse(readFileSync(join(root, last, 'report.json'), 'utf8')) }) : send(404, { error: 'No generated combined rig yet.' });
                    }
                    const id = path.slice(1);
                    if (!/^[a-f0-9-]{36}$/.test(id))
                        return send(404, { error: 'Unknown job' });
                    const entry=store.get(id);
                    const file = entry ? join(entry.dir,'report.json') : resolve(RUN_ROOT, id, 'report.json');
                    const report = (jobs.has(id) ? structuredClone(jobs.get(id)!) : undefined) ?? (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as RunReport : null);
                    if (report?.status === 'running' && report.stage === 'see-through') {
                        const assets = entry ? join(entry.dir,'assets') : resolve(RUN_ROOT, id, 'assets');
                        const progressPath = join(assets, 'local-decomposition.json');
                        try {
                            const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
                            report.detail = progress.status === 'depth-inference' ? 'Estimating layer depth' : progress.status === 'psd-export' ? 'Writing character layers' : existsSync(join(assets, 'local-work/input/src_head.png')) ? 'Separating face layers' : 'Separating body layers';
                        } catch { /* The stage has not written its progress record yet. */ }
                    }
                    if (report?.status === 'running' && !jobs.has(id) && !activeRun()) { report.status = 'failed'; report.reasons = ['Generation was interrupted. Resume this output directory with the CLI.']; }
                    return report ? send(200, { base: store.base(id), saved:entry?.saved??true, report }) : send(404, { error: 'Unknown job' });
                }
                if (req.method !== 'POST' || path !== '/')
                    return send(405, { error: 'Method not allowed' });
                // Reject cross-origin browser writes; generation has real compute/API costs.
                if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`)
                    return send(403, { error: 'Same-origin requests only' });
                if (running || activeRun())
                    return send(409, { error: 'A combined generation is already running.', id: running });
                const policy=uiGpuOptions();
                        const p = preflight({local:!policy.remoteQueue||policy.allowLocalFallback});
                if (!p.available)
                    return send(503, { error: 'Generation requirements are missing.', missing: p.missing });
                const type = (req.headers['content-type'] ?? '').split(';')[0];
                if (!['application/json', 'image/png', 'image/jpeg', 'image/webp'].includes(type))
                    return send(415, { error: 'Upload PNG, JPEG or WebP, or send a JSON prompt.' });
                const id = randomUUID();
                running = id;
                let size = 0, aborted = false;
                const chunks: Buffer[] = [];
                req.on('aborted', () => { aborted = true; if (running === id)
                    running = null; });
                req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 20 * 1024 * 1024) {
                    if (!aborted)
                        send(413, { error: 'Image exceeds 20 MB' });
                    aborted = true;
                    if (running === id) running = null;
                }
                else if (!aborted)
                    chunks.push(chunk); });
                req.on('end', () => {
                    if (aborted)
                        return;
                    const bytes = Buffer.concat(chunks);
                    let prompt: string | undefined;
                    if (type === 'application/json') {
                        try {
                            const body = JSON.parse(bytes.toString());
                            if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 6000)
                                throw new Error();
                            prompt = body.prompt.trim();
                        }
                        catch {
                            running = null;
                            return send(400, { error: 'Expected a nonempty prompt (up to 6000 characters).' });
                        }
                    }
                    const out = store.create(id);
                    const input = join(out, 'upload');
                    if (!prompt)
                        writeFileSync(input, bytes);
                    send(202, { id, base: `${UI_RIG_URL}/${id}`, saved:false });
                    void runPipeline({ prompt, image: prompt ? undefined : input, out, ...uiGpuOptions() }, r => jobs.set(id, r)).catch(error => { jobs.set(id, { id, status: 'failed', stage: 'startup', started: new Date().toISOString(), reasons: [String(error)], stages: [], files: {} }); }).finally(() => { if (running === id)
                        running = null; });
                });
            });
        } };
}
