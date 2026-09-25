/** Hosted drawing stage. Only the supplied description is sent to the provider. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

if (!process.env.OPEN_AI_API_KEY && existsSync('.env')) process.loadEnvFile('.env');
import { imageApiKey } from '../imageToRig/config';
const SIZE = '1024x1536';

function brief(description: string, background: 'white' | 'transparent'): string {
  return [
    'A CHARACTER REFERENCE SHEET drawing for a Japanese animation production:',
    'a single anime character, drawn as anime, not as an illustration of a real',
    'person. Bold clean black line art of even weight; large stylised anime eyes',
    'with a visible coloured iris, a highlight and a dark pupil; hair drawn as',
    'solid shaped clumps with a hard-edged shine, not as strands; flat cel',
    'colour with exactly one hard-edged shadow tone and no gradient; simplified',
    'stylised anatomy. No photographic texture, no realistic skin shading, no',
    'airbrush, no painterly brushwork, no 3D render, no semi-realistic style.',
    '',
    `The character: ${description}.`,
    'Preserve all explicitly requested features, including stature, body proportions,',
    'clothing length, silhouette, facial hair and accessories. These take priority over',
    'the defaults below; never change an explicit design choice to simplify rigging.',
    'For clothing details the user leaves unspecified, use a simple fitted shirt ending',
    'at the waist, separate straight trousers and simple shoes. Keep the limb outlines',
    'clear and the arms and legs separate. Add outerwear only when requested or required',
    'by an explicitly requested outfit or role. Do not infer clothing colour from hair',
    'or beard colour; apply each requested colour only to the named feature.',
    '',
    'Pose and framing, which matter as much as the character: the WHOLE figure',
    'from the top of the head to below the feet, nothing cropped; standing',
    'upright and facing the viewer straight on; both arms hanging down and held',
    'clearly away from the torso so that the gap between each arm and the body',
    'is visible along its whole length; legs slightly apart; both hands open and',
    'not overlapping the clothing.',
    '',
    'Where compatible with the requested design, draw the face in full detail: both eyes',
    'open and clearly visible with their irises, the mouth visible and closed,',
    'the nose visible. Avoid unrequested obstructions across the face. Keep explicitly',
    'requested masks, facial hair and accessories. Both ears need not be visible.',
    '',
    background === 'transparent'
      ? 'The background is fully transparent. Only the character is drawn.'
      : 'The background is a single flat pure white, empty, with no scenery, no'
        + ' shadow on the ground and no border.',
    '',
    `Colours, exactly as stated and not swapped between parts: ${description}.`,
  ].join('\n');
}

async function draw(prompt: string, background: 'white' | 'transparent',
  quality: string, model: string) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json',
      authorization: `Bearer ${imageApiKey()}` },
    body: JSON.stringify({ model, prompt, size: SIZE, quality, n: 1,
      ...(background === 'transparent' ? { background: 'transparent' } : {}) }),
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 400)}`);
  const body = await response.json() as
    { data: { b64_json: string }[]; usage?: Record<string, number> };
  return { png: Buffer.from(body.data[0].b64_json, 'base64'), usage: body.usage };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const at = (flag: string) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
  const description = at('--prompt')?.trim(), output = at('--out');
  if (!description || !output) throw new Error('Supply --prompt and --out for the drawing stage');
  if (!imageApiKey()) throw new Error('Missing OPENAI_API_KEY');
  const background = at('--background') ?? 'white';
  if (background !== 'white' && background !== 'transparent') throw new Error('Use white or transparent background');
  const model = at('--model') || process.env.IMAGE_MODEL;
  if(!model)throw new Error('Set IMAGE_MODEL to an image model available to your account');
  const quality = at('--quality') ?? 'high';
  const prompt = brief(description, background), started = Date.now();
  const { png, usage } = await draw(prompt, background, quality, model);
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  writeFileSync(resolve(dirname(path), 'draw.json'), JSON.stringify({
    generated: true, hosted: true, description, model, background, quality, size: SIZE,
    seconds: (Date.now() - started) / 1000, bytes: png.length, usage, prompt,
    whatLeftThisMachine: 'The supplied character description only.',
  }, null, 2) + '\n');
  console.log('Wrote ' + path);
}
void main();
