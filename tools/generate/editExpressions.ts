import {imageApiKey} from '../imageToRig/config';
/** Two masked edits, requested directly from the image API. No external helpers. */
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function editExpressions(directory: string, notify: (message: string) => void = () => {}) {
    const root = resolve(directory);
    const model = process.env.IMAGE_MODEL ?? '';
    const key = imageApiKey();
    if (!key) throw new Error('Missing image API key');
    const input = readFileSync(resolve(root, 'edit-source.png'));
    const digest = createHash('sha256').update(input).digest('hex');
    const plan = JSON.parse(readFileSync(resolve(root, 'edit-plan.json'), 'utf8')) as { expressionKinds: string[]; allowPartial?:boolean };
    if (!Array.isArray(plan.expressionKinds) || plan.expressionKinds.some(k=>!['eyes','mouth'].includes(k))) throw new Error('Invalid expression plan');
    for (const kind of plan.expressionKinds) {
      try {
        const prompt = `Edit only the transparent masked region of this character reference. Keep the exact character identity, drawing style, head position, scale, skin color, hair and all unmasked artwork unchanged. ${kind === 'eyes' ? 'Close both eyes naturally, with clean closed eyelid lines. Preserve the eyebrows and mouth.' : 'Open the mouth in a natural speaking expression. Include a dark mouth cavity, a modest upper tooth band and tongue if visible. Preserve the eyes and eyebrows.'} Do not add accessories, facial hair or text. Return the same framing.`;
        const signature = createHash('sha256').update(digest + model + prompt).update(readFileSync(resolve(root, `edit-mask-${kind}.png`))).digest('hex');
        const recordPath = resolve(root, `expression_${kind}.json`), output = resolve(root, `expression_${kind}.png`);
        if (existsSync(output) && existsSync(recordPath)) {
            const old = JSON.parse(readFileSync(recordPath, 'utf8'));
            if (old.signature === signature && old.sha256 === createHash('sha256').update(readFileSync(output)).digest('hex')) {
                notify(`Reusing verified ${kind} expression`);
                continue;
            }
            throw new Error('Expression cache differs; use a new output directory');
        }
        const form = new FormData();
        form.set('model', model); form.set('prompt', prompt); form.set('size', '1024x1024');
        form.set('image', new Blob([input], { type: 'image/png' }), 'reference.png');
        form.set('mask', new Blob([readFileSync(resolve(root, `edit-mask-${kind}.png`))], { type: 'image/png' }), 'mask.png');
        const start = Date.now();
        notify(`Generating ${kind} expression`);
        const response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(240_000) });
        if (!response.ok) throw new Error(`Expression ${kind}: image service answered ${response.status}`);
        const body = await response.json() as { data?: { b64_json?: string }[] };
        if (!body.data?.[0]?.b64_json) throw new Error('Image API returned no pixels');
        const bytes = Buffer.from(body.data[0].b64_json, 'base64');
        writeFileSync(output, bytes);
        writeFileSync(recordPath, JSON.stringify({ signature, model, prompt, inputSha256: digest, sha256: createHash('sha256').update(bytes).digest('hex'), seconds: (Date.now()-start)/1000 }, null, 2)+'\n');
        rmSync(resolve(root,`expression_${kind}.failure.json`),{force:true});
        notify(`Saved ${kind} expression`);
      } catch(error) {
        if(!plan.allowPartial || (error instanceof Error&&error.message.startsWith('Expression cache differs')))throw error;
        writeFileSync(resolve(root,`expression_${kind}.failure.json`),JSON.stringify({kind,status:'unavailable',reason:error instanceof Error?error.message:String(error)}));
        notify(`Expression ${kind} unavailable; retain source appearance.`);
      }
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (existsSync('.env')) process.loadEnvFile('.env');
    if (!process.argv[2]) throw new Error('Supply the edit-plan directory');
    await editExpressions(process.argv[2], console.log);
}
