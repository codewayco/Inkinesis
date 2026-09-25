/** H100 transport; the caller selects whether a remote failure permits local fallback. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { RemoteArtifactError } from '../imageToRig/decompositionBackend';
import {chunkedDownload} from './chunkedDownload';

export function bridgeStatus(queuePath:string,now=Date.now()) {
    try {
        const queue=resolve(queuePath),ready=JSON.parse(readFileSync(join(queue,'bridge.json'),'utf8')),heartbeat=JSON.parse(readFileSync(join(queue,'heartbeat.json'),'utf8'));
        const age=now/1000-heartbeat.time;
        return ready.status==='ready'&&Number.isFinite(age)&&age>=-5&&age<30 ? {ready:true,reason:'H100 bridge connected'} : {ready:false,reason:'H100 bridge is stopped, busy or its heartbeat expired'};
    } catch {return {ready:false,reason:'H100 bridge is not connected'};}
}


/** Older bridges resolve mkdir paths relative to the kernel working directory. */
export function remoteMkdirPath(remoteFile:string,kernelRoot=process.env.RIG_REMOTE_KERNEL_ROOT):string {
    if(!kernelRoot)return remoteFile;
    if(!kernelRoot.startsWith('/')||kernelRoot.includes('..'))throw new Error('RIG_REMOTE_KERNEL_ROOT must be an absolute kernel working directory');
    const prefix=kernelRoot.replace(/\/$/,'')+'/';
    if(!remoteFile.startsWith(prefix)||remoteFile.includes('..'))throw new Error('Remote job directory must be inside RIG_REMOTE_KERNEL_ROOT');
    return remoteFile.slice(prefix.length);
}

export async function decomposeH100(input: string, output: string, queuePath: string, limits: {pickupMs?:number;executionMs?:number;pollMs?:number} = {}) {
    const queue = resolve(queuePath), bridge=bridgeStatus(queue);
    if (!bridge.ready)throw new Error(bridge.reason);
    mkdirSync(output,{recursive:true});
    const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    const id = 'decompose-' + randomUUID();
    const root=process.env.RIG_REMOTE_ROOT;
    const contentsRoot=process.env.RIG_REMOTE_CONTENTS_ROOT;
    if(!root?.startsWith('/')||!contentsRoot?.startsWith('/')||root.includes('..')||contentsRoot.includes('..'))
        throw new Error('Set absolute RIG_REMOTE_ROOT and RIG_REMOTE_CONTENTS_ROOT paths for your Jupyter server');
    const prefix=contentsRoot.replace(/\/$/,'')+'/';
    if(!root.startsWith(prefix))throw new Error('RIG_REMOTE_ROOT must be inside RIG_REMOTE_CONTENTS_ROOT');
    const relative = `${root.slice(prefix.length)}/jobs/${id}`, remote = `${root}/jobs/${id}`;
    // Late remote downloads never overwrite a local fallback or a previous valid result.
    const attempt=resolve(output,'.h100-attempts',id);mkdirSync(attempt,{recursive:true});
    const spec = { mkdir: [remoteMkdirPath(`${remote}/input.png`)], uploads: [
        { local: resolve(input), remote: `${relative}/input.png` },
        { local: resolve('tools/generate/localSeeThrough.py'), remote: `${relative}/runner.py` },
    ], code: `import subprocess, sys, json, time, hashlib\nfrom pathlib import Path\nimport torch\nassert torch.cuda.is_available()\nassert 'H100' in torch.cuda.get_device_name(), 'An H100 allocation is required for this experiment'\np=Path(${JSON.stringify(remote)})\nstarted=time.monotonic()\nargs=[sys.executable,str(p/'runner.py'),'--source-checkout',${JSON.stringify(root+'/see-through')},'--models',${JSON.stringify(root+'/models')},'--manifest',${JSON.stringify(root+'/tools/generate/models/see-through.json')},'--input',str(p/'input.png'),'--output',str(p),'--device','cuda']\nwith (p/'inference.log').open('w') as f:\n result=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT)\nprint((p/'inference.log').read_text()[-6000:],flush=True)\nif result.returncode: raise RuntimeError('See-through failed; remote inference.log retained at '+str(p))\nrecord={'backend':'jupyterhub-cuda','gpu':torch.cuda.get_device_name(),'torch':torch.__version__,'cuda':torch.version.cuda,'seconds':time.monotonic()-started,'inputSha256':hashlib.sha256((p/'input.png').read_bytes()).hexdigest(),'outputSha256':hashlib.sha256((p/'decomposition.psd').read_bytes()).hexdigest(),'runnerSha256':hashlib.sha256((p/'runner.py').read_bytes()).hexdigest(),'job':${JSON.stringify(id)}}\n(p/'remote-execution.json').write_text(json.dumps(record,indent=2)+'\\n')\nprint(json.dumps(record),flush=True)`,
        downloads: ['decomposition.psd','local-decomposition.json','remote-execution.json','inference.log'].map(name=>({ remote: `${relative}/${name}`, local: resolve(attempt, name) })), timeout: 7200 };
    const request = join(queue, id + '.request.json');
    writeFileSync(request+'.pending', JSON.stringify(spec)); renameSync(request+'.pending', request);
    writeFileSync(join(output,'remote-job.json'), JSON.stringify({id,inputSha256:sha(input),remoteDirectory:remote,queue,attempt},null,2)+'\n');
    const result = join(queue,id+'.result.json'), started = Date.now();
    while (!existsSync(result)) {
        const elapsed=Date.now()-started,claimed=existsSync(join(queue,id+'.running.json'));
        if ((!claimed&&elapsed>(limits.pickupMs??30_000))||elapsed>(limits.executionMs??8*60_000)) {
            writeFileSync(join(queue,id+'.cancelled.json'),JSON.stringify({reason:'Client deadline expired',time:Date.now()}));
            throw new Error(claimed?'H100 response deadline exceeded; any late output remains isolated in the remote attempt directory.':'H100 bridge did not accept the job within the connection deadline.');
        }
        await new Promise(done=>setTimeout(done,limits.pollMs??1000));
    }
    let response = JSON.parse(readFileSync(result,'utf8'));
    // A broken Contents API response does not invalidate completed GPU inference.
    // Retry artifact transfer only; preserve the original failure and never rerun inference.
    for(let retry=1;response.status!=='complete'&&/IncompleteRead|ConnectionResetError|RemoteDisconnected/.test(String(response.error))&&retry<=2;retry++){
        const recoveryId=id+'-download-'+retry,recovery=join(queue,recoveryId+'.request.json');
        const transferOnly={code:'print("Recovering completed H100 artifacts; inference is not rerun", flush=True)',downloads:spec.downloads,timeout:120};
        writeFileSync(recovery+'.pending',JSON.stringify(transferOnly));renameSync(recovery+'.pending',recovery);
        const recoveryResult=join(queue,recoveryId+'.result.json'),recoveryStarted=Date.now();
        while(!existsSync(recoveryResult)&&Date.now()-recoveryStarted<180_000)await new Promise(done=>setTimeout(done,1000));
        if(!existsSync(recoveryResult)){
            writeFileSync(join(queue,recoveryId+'.cancelled.json'),JSON.stringify({reason:'Transfer recovery deadline expired'}));
            break;
        }
        response=JSON.parse(readFileSync(recoveryResult,'utf8'));
        writeFileSync(join(output,'remote-transfer-recovery.json'),JSON.stringify({originalJob:id,recoveryJob:recoveryId,attempt:retry,status:response.status,inferenceRepeated:false},null,2)+'\n');
    }
    if(response.status!=='complete'&&/IncompleteRead|ConnectionResetError|RemoteDisconnected/.test(String(response.error))){
        const recovery=await chunkedDownload(queue,spec.downloads,contentsRoot);
        writeFileSync(join(output,'remote-transfer-recovery.json'),JSON.stringify({originalJob:id,status:'complete',...recovery},null,2)+'\n');
        response={status:'complete'};
    }
    if(response.status!=='complete') throw new Error(`H100 job failed: ${response.error}. See ${request.replace('.json','.log')}`);
    return promoteH100Artifacts(input,output,attempt);
}

export function promoteH100Artifacts(input:string,output:string,attempt:string){
    const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
    const record = JSON.parse(readFileSync(join(attempt,'remote-execution.json'),'utf8'));
    if (record.inputSha256!==sha(input) || record.outputSha256!==sha(join(attempt,'decomposition.psd')) ||
        record.runnerSha256!==sha('tools/generate/localSeeThrough.py') || !record.gpu.includes('H100'))
        throw new RemoteArtifactError('Remote artifact identity or H100 provenance mismatch');
    const local=JSON.parse(readFileSync(join(attempt,'local-decomposition.json'),'utf8'));
    if(local.status!=='complete'||local.inputSha256!==record.inputSha256||local.outputSha256!==record.outputSha256||local.manifestSha256!==sha('tools/generate/models/see-through.json'))throw new RemoteArtifactError('Remote decomposition manifest or completion record mismatch');
    for(const name of ['decomposition.psd','local-decomposition.json','remote-execution.json','inference.log']){
        copyFileSync(join(attempt,name),join(output,name+'.remote-pending'));renameSync(join(output,name+'.remote-pending'),join(output,name));
    }
    return record;
}
