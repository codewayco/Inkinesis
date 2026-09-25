/** Backend policy is independent of image/rig authoring; explicit CLI H100 stays strict. */
import {loadEnvironment} from './config';
export class RemoteArtifactError extends Error {}
export const uiGpuOptions = () => {
    loadEnvironment();
    const mode=process.env.RIG_GPU_BACKEND || 'local';
    if(!['local','h100-first','h100'].includes(mode))throw new Error('RIG_GPU_BACKEND must be local, h100-first or h100');
    return {remoteQueue:mode==='local'?undefined:(process.env.RIG_H100_QUEUE || '.cache/rig/h100-queue'),allowLocalFallback:mode==='h100-first'};
};
export async function runDecomposition(policy:{remoteQueue?:string;allowLocalFallback?:boolean},work:{remote:()=>Promise<unknown>;local:()=>Promise<unknown>;fallback:(reason:string)=>void}) {
    if(!policy.remoteQueue){await work.local();return 'local' as const;}
    try{await work.remote();return 'h100' as const;}
    catch(error){
        // Identity/integrity failures must remain visible rather than being hidden by a retry.
        if(!policy.allowLocalFallback||error instanceof RemoteArtifactError)throw error;
        work.fallback(error instanceof Error?error.message:String(error));
        await work.local();return 'local' as const;
    }
}
