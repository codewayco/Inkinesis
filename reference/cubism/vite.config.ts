import { defineConfig } from 'vite';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(fileURLToPath(import.meta.url));
const repo = resolve(appRoot, '../..');
const sdk = resolve(repo, 'assets/thirdparty/cubism_sdk/CubismSdkForWeb-5-r.5');
const modelRoot = process.env.CUBISM_REFERENCE_MODEL
  ? resolve(process.env.CUBISM_REFERENCE_MODEL)
  : resolve(repo, 'outputs/live2d/model');
const mime: Record<string, string> = {
  '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
};

export default defineConfig({
  root: appRoot,
  resolve: { alias: { '@cubism': resolve(sdk, 'Framework/src') } },
  server: { host: '127.0.0.1', port: Number(process.env.CUBISM_REFERENCE_PORT ?? 5190), strictPort: true, fs: { allow: [appRoot, sdk] } },
  plugins: [{
    name: 'reference-inputs',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/sdk-core.js' && !url.pathname.startsWith('/sdk-shaders/') && url.pathname !== '/model-manifest' &&
            !url.pathname.startsWith('/reference-model/')) return next();
        try {
          let data: Buffer;
          let extension = '.json';
          if (url.pathname === '/model-manifest') {
            const files = (await readdir(modelRoot)).filter(p => p.endsWith('.model3.json'));
            if (files.length !== 1) throw new Error('Expected exactly one runtime model export');
            data = Buffer.from(JSON.stringify({ url: `/reference-model/${encodeURIComponent(files[0])}` }));
          } else if (url.pathname.startsWith('/sdk-shaders/')) {
            const name = url.pathname.slice('/sdk-shaders/'.length);
            if (!/^[a-z]+\.(vert|frag)$/.test(name)) throw new Error('Invalid shader path');
            data = await readFile(resolve(sdk, 'Framework/Shaders/WebGL', name));
            extension = '.txt';
          } else if (url.pathname === '/sdk-core.js') {
            data = await readFile(resolve(sdk, 'Core/live2dcubismcore.min.js'));
            extension = '.js';
          } else {
            const root = await realpath(modelRoot);
            const path = await realpath(resolve(root, decodeURIComponent(url.pathname.slice('/reference-model/'.length))));
            if (!path.startsWith(root + sep)) throw new Error('Invalid reference asset path');
            data = await readFile(path);
            extension = extname(path);
          }
          res.setHeader('Content-Type', mime[extension] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.end(data);
        } catch {
          res.statusCode = 404;
          res.end('Reference input unavailable');
        }
      });
    },
  }],
});
