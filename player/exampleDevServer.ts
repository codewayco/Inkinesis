import type {Plugin} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readCatalog} from './avatarCatalog';
import {ExampleDownloads} from './exampleDownloads';
import {loadEnvironment} from '../tools/imageToRig/config';

export function exampleDevServer(provided?:ExampleDownloads):Plugin {
    return {name:'example-downloads',apply:'serve',configureServer(server) {
        loadEnvironment();
        const store=provided??new ExampleDownloads(resolve('example-avatars'),readCatalog(JSON.parse(readFileSync('example-avatars/catalog.json','utf8'))),process.env.INKINESIS_AVATAR_RELEASE_URL);
        server.httpServer?.once('close',()=>{void store.close();});
        server.middlewares.use('/api/examples',(req,res)=>{
            const send=(status:number,data:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
            const path=(req.url??'/').split('?')[0];
            void (async()=>{
                if(req.method==='GET'&&(path==='/'||path===''))return send(200,{configured:Boolean(store.base),entries:await Promise.all(store.catalog.entries.map(async e=>({id:e.id,...await store.state(e.id)})))});
                const m=path.match(/^\/([a-z0-9-]+)(\/download)?$/);
                if(!m)return send(404,{error:'Unknown example request'});
                if(req.method==='GET'&&!m[2])return send(200,await store.state(m[1]));
                if(req.method!=='POST'||!m[2])return send(405,{error:'Method not allowed'});
                if(req.headers.origin&&![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))return send(403,{error:'Same-origin requests only'});
                await store.start(m[1]);send(202,await store.state(m[1]));
            })().catch(error=>send(400,{error:String(error.message??error)}));
        });
    }};
}
