import {readFileSync,existsSync} from 'node:fs';
import { defineConfig } from 'vite';
import {exampleDevServer} from './player/exampleDevServer';
import {readCatalog} from './player/avatarCatalog';
import { ttsDevServer } from './player/ttsDevServer';
import { combinedDevServer } from './player/combinedDevServer';
import { live2dDevServer } from './player/live2dDevServer';

export default defineConfig({
  root: '.',
  plugins: [exampleDevServer(), ttsDevServer(), combinedDevServer(), live2dDevServer(), {
    name:'example-avatars',apply:'build',generateBundle(){
      const manifest='example-avatars/catalog.json';
      if(!existsSync(manifest))return;
      const entries=readCatalog(JSON.parse(readFileSync(manifest,'utf8'))).entries;
      const files=[manifest,'example-avatars/checksums.json',...entries.map(entry=>entry.preview.slice(1))];
      for(const fileName of new Set(files))this.emitFile({type:'asset',fileName,source:readFileSync(fileName)});
    },
  }],
  server: {
    host: '127.0.0.1', port: 5200, strictPort: true, open: '/',
    watch: { ignored: ['**/outputs/**', '**/example-avatars/**', '**/new-avatars/**'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/example-avatars/.downloads/**'] },
  },
  preview: { host: '127.0.0.1', open: false },
  build: {
    outDir: 'dist/player', emptyOutDir: true, target: 'es2022',
    rollupOptions: { input: 'index.html' },
  },
});
