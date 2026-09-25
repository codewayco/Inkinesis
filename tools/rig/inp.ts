/** Small checked reader/writer for the PNG-only INP subset this exporter owns. */
import { decodePNG } from '../generate/png';
export interface InpBinding {
  node: number; param_name: string; values: unknown[][]; isSet: boolean[][]; interpolate_mode: string;
}
export interface InpParameter {
  uuid: number; name: string; min: number[]; max: number[]; defaults: number[];
  is_vec2: boolean; axis_points: number[][]; merge_mode: string; bindings: InpBinding[];
}
export interface InpNode {
  uuid: number; name: string; type: string; enabled: boolean; zsort: number;
  children?: InpNode[]; opacity?: number; textures?: number[]; mask_threshold?: number;
  masks?: { source: number; mode: string }[];
  mesh?: { verts: number[]; uvs: number[]; indices: number[]; origin: number[] };
}
export interface InpDocument {
  meta: Record<string, unknown>; nodes: InpNode; param: InpParameter[];
}
export function readInp(bytes: Buffer) {
  let at = 0;
  const take = (n: number) => {
    if (n < 0 || at + n > bytes.length) throw new Error('Truncated INP');
    const b = bytes.subarray(at, at + n); at += n; return b;
  };
  const word = () => take(4).readUInt32BE();
  if (take(8).toString() !== 'TRNSRTS\0') throw new Error('Not an INP');
  const puppet = JSON.parse(take(word()).toString()) as InpDocument;
  if (take(8).toString() !== 'TEX_SECT') throw new Error('No INP texture section');
  const count = word(), textures: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const size = word();
    if (take(1)[0] !== 0) throw new Error('Only PNG INP textures supported');
    textures.push(take(size));
  }
  if (at !== bytes.length) throw new Error('Unrecognized trailing INP data');
  return { puppet, textures };
}
export function writeInp(puppet: InpDocument, textures: Buffer[]) {
  const word = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const json = Buffer.from(JSON.stringify(puppet));
  return Buffer.concat([Buffer.from('TRNSRTS\0'), word(json.length), json,
    Buffer.from('TEX_SECT'), word(textures.length),
    ...textures.flatMap(b => [word(b.length), Buffer.from([0]), b])]);
}
export function inpParts(puppet: InpDocument) {
  const parts: InpNode[] = [];
  const walk = (n: InpNode) => { if (n.type === 'Part') parts.push(n); n.children?.forEach(walk); };
  walk(puppet.nodes);
  return parts;
}
export const inpTextures = (textures: Buffer[]) => textures.map(b => decodePNG(new Uint8Array(b)));
