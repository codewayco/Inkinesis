/** Package only verified export inventory entries, without invoking image models. */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireRun } from '../../imageToRig/lock';
import { exportLive2D } from './export';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Uncompressed ZIP: PNG and MOC files are already compact; no additional dependency. */
export function zipFiles(files: { name: string; bytes: Buffer }[]): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Unsafe archive path');
    const filename = Buffer.from(name);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(33, 12); // January 1, 1980
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function packageExport(folder: string, sourceSha256: string): Buffer {
  const report = JSON.parse(readFileSync(resolve(folder, 'export.json'), 'utf8')) as {sourceSha256: string; runtimeManifest: string; files: Record<string, string>};
  if (report.sourceSha256 !== sourceSha256) throw new Error('Export does not match this rig');
  const files = Object.entries(report.files).map(([name, sha]) => {
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Unsafe export path');
    const bytes = readFileSync(resolve(folder, 'model', name));
    if (hash(bytes) !== sha) throw new Error(`Export checksum mismatch: ${name}`);
    return { name, bytes };
  });
  const manifestName = report.runtimeManifest.replace(/^model\//, '');
  const manifest = JSON.parse(files.find(f => f.name === manifestName)!.bytes.toString());
  const refs = manifest.FileReferences;
  for (const name of [refs.Moc, ...refs.Textures, refs.DisplayInfo].filter(Boolean)) {
    if (!files.some(f => f.name === name)) throw new Error(`Missing runtime dependency: ${name}`);
  }
  files.push({ name: 'README.txt', bytes: Buffer.from(`Extract this ZIP before opening ${manifestName} in Live2D Cubism Viewer.\nKeep the textures folder beside the model files.\nThe CMO3 is a reconstructed editor project. Custom limb parameters require explicit tracking mappings.\nNo animation clips or physics are synthesized.\nSource INP SHA-256: ${sourceSha256}\n`) });
  return zipFiles(files);
}
function buildDownload(source: string, zip: string) {
  const release = acquireRun(zip);
  try {
    const sourceHash = hash(readFileSync(source));
    mkdirSync(dirname(zip), { recursive: true });
    const folder = mkdtempSync(resolve(dirname(zip), 'export-'));
    exportLive2D(source, folder);
    const bytes = packageExport(folder, sourceHash);
    if (hash(readFileSync(source)) !== sourceHash) throw new Error('Source rig changed while preparing download');
    mkdirSync(dirname(zip), { recursive: true });
    writeFileSync(zip + '.tmp', bytes);
    renameSync(zip + '.tmp', zip);
  } finally { release(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, zip] = process.argv.slice(2);
  if (!source || !zip) throw new Error('Expected source INP and output ZIP');
  buildDownload(source, zip);
}
