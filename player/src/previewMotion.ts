import type { InpParameter } from '../../tools/rig/inp';
import type { MotionCapabilities, ChainName } from '../../tools/imageToRig/capabilities';

/** A moderate joint demonstration, not a walking or ground-contact simulation. */
export function motionDemoValues(parameters: Pick<InpParameter,'name'|'min'|'max'|'defaults'>[], caps:MotionCapabilities|undefined, seconds:number):Record<string,number[]> {
    const result:Record<string,number[]> = {};
    const phase = seconds * Math.PI / 2;
    for (const p of parameters) {
        if (/^(Arm|Leg) [LR]$/.test(p.name)) {
            if (caps?.chains[p.name as ChainName]?.mode === 'fixed') continue;
            const arm = p.name.startsWith('Arm'), left = p.name.endsWith('L');
            const wave = Math.sin(phase + (left ? 0 : Math.PI));
            const bend = .5 - .5 * Math.cos(phase + (left ? 0 : Math.PI));
            // Use mirrored elbow directions and positive knee flexion, bounded
            // by both the rig's actual range and moderate demonstration angles.
            const direction = arm && !left ? -1 : 1;
            // Counter-rotate the hip during knee flexion so the demo does not
            // repeatedly sweep both feet across the body center.
            const flexion = direction * (arm ? 36 : 28) * bend;
            const target = [arm ? wave*12 : wave*5-flexion*.45, flexion];
            result[p.name] = p.defaults.map((rest,i) => {
                if (i > 1) return rest;
                const room = target[i] < 0 ? rest-p.min[i] : p.max[i]-rest;
                const amount = Math.sign(target[i]) * Math.min(Math.abs(target[i]), room*.65);
                return Math.max(p.min[i],Math.min(p.max[i],rest+amount));
            });
        } else if (['ParamGarmentSway','ParamBodySway','ParamBreath'].includes(p.name)) {
            const wave = p.name==='ParamBreath' ? (1-Math.cos(phase))*.5 : Math.sin(phase);
            const rest=p.defaults[0],room=wave<0?rest-p.min[0]:p.max[0]-rest;
            result[p.name]=[Math.max(p.min[0],Math.min(p.max[0],rest+wave*room*.3))];
        }
    }
    return result;
}

/** One blink: 100 ms close, 40 ms closed, 200 ms reopen. */
export function blinkOpenness(elapsedMs:number):number {
    if (elapsedMs<0 || elapsedMs>=340) return 1;
    if (elapsedMs<100) return 1-elapsedMs/100;
    if (elapsedMs<140) return 0;
    return (elapsedMs-140)/200;
}
