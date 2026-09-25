/** On-demand, local-only second output format for the combined player. */
import type { Plugin } from 'vite';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { generatedRigs, UI_RIG_URL } from './generatedRigStore';
import { activeRun } from '../tools/imageToRig/lock';

export function live2dSource(url: unknown): string {
  if (typeof url === 'string' && url.startsWith(UI_RIG_URL+'/')) return generatedRigs.source(url);
  if(typeof url!=='string'||!/^\/example-avatars\/[a-z0-9-]+\/character\.inp$/.test(url))throw new Error('Select a saved or generated combined rig');
  const path=resolve('.'+url);
  if(realpathSync(path)!==path)throw new Error('Symlink sources are not supported');
  return path;
}
export function live2dDevServer(): Plugin {
  return { name: 'live2d-downloads', apply: 'serve', configureServer(server) {
    const destinations = new Map<string,string>();
    const jobs = new Map<string, { status: 'running' | 'failed'; error?: string }>();
    let running = false;
    const zipPath = (id: string) => join(destinations.get(id) ?? generatedRigs.exportRoot(),id,'Live2D.zip');
    server.middlewares.use('/api/live2d', (req, res) => {
      const send = (code: number, value: unknown) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      const path = (req.url ?? '/').split('?')[0];
      const match = path.match(/^\/([a-f0-9]{64})(\/download)?$/);
      if (req.method === 'GET' && match) {
        const [, id, download] = match;
        if (existsSync(zipPath(id))) {
          if (!download) return send(200, { status: 'ready', url: `/api/live2d/${id}/download` });
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', 'attachment; filename="Live2D.zip"');
          const stream = createReadStream(zipPath(id));
          stream.on('error', () => res.destroy()); stream.pipe(res); return;
        }
        return jobs.has(id) ? send(200, jobs.get(id)) : send(404, { error: 'Export interrupted or unavailable. Select Live2D again to retry.' });
      }
      if (req.method !== 'POST' || path !== '/') return send(405, { error: 'Method not allowed' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return send(403, { error: 'Same-origin requests only' });
      let body = '', rejected = false;
      req.on('data', chunk => {
        if (rejected) return;
        body += String(chunk);
        if (body.length > 4096) { rejected = true; send(413, { error: 'Request too large' }); }
      });
      req.on('end', () => {
        if (rejected) return;
        let source: string;
        try { source = live2dSource(JSON.parse(body).source); }
        catch { return send(400, { error: 'Select a saved or generated combined rig' }); }
        const hash = createHash('sha256').update(readFileSync(source));
        // Isolate identical rigs in different trials so each Save includes its own exports.
        const runId=source.match(/\/([a-f0-9-]{36})\/character\.inp$/)?.[1];
        if(runId)hash.update(runId);
        for (const file of ['export.ts', 'CombinedExport.kt', 'export.gradle', 'download.ts']) hash.update(readFileSync(resolve('tools/rig/live2d', file)));
        const id = hash.digest('hex');
        const isGenerated=source.includes('/image-to-rig/') || String(JSON.parse(body).source).startsWith(UI_RIG_URL+'/');
        destinations.set(id,isGenerated?join(dirname(source),'live2d-downloads'):generatedRigs.exportRoot());
        if (existsSync(zipPath(id)) || jobs.get(id)?.status === 'running') return send(200, { id });
        if (running || activeRun()) return send(409, { error: 'Another rig operation is running. Retry when it finishes.' });
        let release:()=>void;
        try { release=generatedRigs.hold(dirname(source)); } catch(error) {return send(409,{error:String(error)});}
        mkdirSync(dirname(zipPath(id)), { recursive: true });
        running = true; jobs.set(id, { status: 'running' });
        const child = spawn(process.execPath, ['--import', 'tsx', 'tools/rig/live2d/download.ts', source, zipPath(id)], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] });
        let error = '';
        child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-16000); });
        child.on('error', e => { error += e.message; });
        child.on('close', code => {
          running = false; release();
          if (code !== 0 || !existsSync(zipPath(id))) {
            writeFileSync(join(dirname(zipPath(id)), 'error.log'), error);
            jobs.set(id, { status: 'failed', error: `Live2D export failed. Your Inochi rig is still available. Export diagnostics are retained with the preview files.` });
          } else jobs.delete(id);
        });
        send(202, { id });
      });
    });
  } };
}
