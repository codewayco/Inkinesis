/** Serialize GPU/Gradle authoring across CLI invocations and dev-server reloads. */
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve('.cache/rig/locks');
const path = resolve(root, '.active.json');
export function activeRun(): {
    pid: number;
    out: string;
} | null {
    if (!existsSync(path))
        return null;
    try {
        const data = JSON.parse(readFileSync(path, 'utf8')) as {
            pid: number;
            out: string;
        };
        process.kill(data.pid, 0);
        return data;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM')
            return { pid: 0, out: 'Another process' };
        return null;
    }
}
export function acquireRun(out: string) {
    mkdirSync(root, { recursive: true });
    const claim = () => { const fd = openSync(path, 'wx'); writeFileSync(fd, JSON.stringify({ pid: process.pid, out })); closeSync(fd); };
    try {
        claim();
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
            throw error;
        if (activeRun())
            throw new Error('Another image-to-rig run is active. Wait for it to finish.');
        // A dead process left this file behind. The exclusive create arbitrates the retry.
        unlinkSync(path);
        claim();
    }
    return () => { if (activeRun()?.pid === process.pid)
        unlinkSync(path); };
}
