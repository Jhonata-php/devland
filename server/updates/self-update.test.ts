import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageVersion } from './self-update';

/** Um .tar.gz de verdade, como o pacote dist-pkg (dist/server/index.js, deps.hash...). */
function makePackage(depsHash: string): { buf: Buffer; digest: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pkg-'));
  mkdirSync(join(dir, 'src', 'dist', 'server'), { recursive: true });
  writeFileSync(join(dir, 'src', 'dist', 'server', 'index.js'), 'console.log("novo")');
  writeFileSync(join(dir, 'src', 'deps.hash'), `${depsHash}\n`);
  execFileSync('tar', ['-czf', join(dir, 'pkg.tgz'), '-C', join(dir, 'src'), '.']);
  const buf = readFileSync(join(dir, 'pkg.tgz'));
  return { buf, digest: `sha256:${createHash('sha256').update(buf).digest('hex')}` };
}

const registry = (pkg: { buf: Buffer; digest: string }, tamper = false) =>
  (async (url: string) => {
    if (url.startsWith('https://ghcr.io/token')) return new Response(JSON.stringify({ token: 't' }));
    if (url.includes('/manifests/')) return new Response(JSON.stringify({ layers: [{ digest: pkg.digest, size: pkg.buf.length }] }));
    return new Response(new Uint8Array(tamper ? Buffer.from('outra coisa') : pkg.buf));
  }) as unknown as typeof fetch;

function setup(hash: string) {
  const dataDir = mkdtempSync(join(tmpdir(), 'data-'));
  const depsHashFile = join(dataDir, 'image-deps.hash');
  writeFileSync(depsHashFile, `${hash}\n`);
  return { dataDir, depsHashFile };
}

describe('Cloud: atualização nativa (stageVersion)', () => {
  it('baixa, confere e deixa a versão pronta em /data/app, apontando o current', async () => {
    const pkg = makePackage('abc123');
    const { dataDir, depsHashFile } = setup('abc123');
    const r = await stageVersion({ image: 'jhonata-php/habblaud', version: '0.3.16', dataDir, depsHashFile, fetchFn: registry(pkg) });
    expect(r).toEqual({ ok: true, version: '0.3.16' });
    expect(existsSync(join(dataDir, 'app', '0.3.16', 'dist', 'server', 'index.js'))).toBe(true);
    expect(readFileSync(join(dataDir, 'app', 'current'), 'utf8').trim()).toBe('0.3.16');
  });

  it('recusa pacote que não confere com o sha256 do manifesto', async () => {
    const pkg = makePackage('abc123');
    const { dataDir, depsHashFile } = setup('abc123');
    const r = await stageVersion({ image: 'jhonata-php/habblaud', version: '0.3.16', dataDir, depsHashFile, fetchFn: registry(pkg, true) });
    expect(r.ok).toBe(false);
    expect(existsSync(join(dataDir, 'app', 'current'))).toBe(false);
  });

  it('dependências diferentes: não instala e pede imagem nova', async () => {
    const pkg = makePackage('outro-hash');
    const { dataDir, depsHashFile } = setup('abc123');
    const r = await stageVersion({ image: 'jhonata-php/habblaud', version: '0.3.16', dataDir, depsHashFile, fetchFn: registry(pkg) });
    expect(r).toMatchObject({ ok: false, needsImage: true });
    expect(existsSync(join(dataDir, 'app', 'current'))).toBe(false);
  });

  it('recusa versão com formato estranho (nada de caminho)', async () => {
    const { dataDir, depsHashFile } = setup('x');
    expect((await stageVersion({ image: 'a/b', version: '../etc', dataDir, depsHashFile })).ok).toBe(false);
  });
});
