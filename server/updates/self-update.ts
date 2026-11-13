// DevLand Cloud: atualização nativa, sem Velix. Baixa o pacote de código da versão nova (ghcr.io/<imagem>:dist-cloud-v<versão>,
// publicado pelo workflow, imagem pública: sem token), confere o conteúdo (sha256 da camada e deps.hash igual ao da imagem em
// uso) e guarda em <dados>/app/<versão>. O entrypoint do container (scripts/cloud-entrypoint.sh) passa a rodar esse código
// no próximo início, com volta automática à imagem se ele não ficar de pé; o servidor só precisa reiniciar.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { errMsg } from '../log';
import { tr } from '../../shared/i18n';

const TIMEOUT_MS = 60_000;
const MAX_LAYER_BYTES = 150 * 1024 * 1024;
const KEEP_VERSIONS = 2;
const ACCEPT = 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json';

export type StageResult = { ok: true; version: string } | { ok: false; error: string; needsImage?: true };

export interface StageOptions {
  /** "dono/nome" da imagem no ghcr.io. */
  image: string;
  /** Versão sem prefixo (ex.: "0.3.16"). */
  version: string;
  dataDir: string;
  /** deps.hash da imagem em uso (o pacote novo precisa ter o mesmo). */
  depsHashFile: string;
  fetchFn?: typeof fetch;
  /** Extrai um .tar.gz em uma pasta (padrão: o `tar` do sistema). */
  extract?: (file: string, dest: string) => Promise<void>;
}

function tarExtract(file: string, dest: string): Promise<void> {
  return new Promise((ok, fail) => {
    execFile('tar', ['-xzf', file, '-C', dest, '--no-same-owner'], { timeout: TIMEOUT_MS }, (err) => (err ? fail(err) : ok()));
  });
}

async function json(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(tr('o GitHub respondeu {0} ({1})', [res.status, what]));
  return (await res.json()) as Record<string, unknown>;
}

/** Baixa e prepara a versão em <dados>/app/<versão>. Não reinicia nada. */
export async function stageVersion(o: StageOptions): Promise<StageResult> {
  const fetchFn = o.fetchFn ?? fetch;
  const extract = o.extract ?? tarExtract;
  if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(o.version)) return { ok: false, error: tr('versão inválida') };
  const root = join(o.dataDir, 'app');
  const staging = join(root, `.staging-${o.version}`);
  const blobFile = join(root, `.blob-${o.version}.tgz`);
  try {
    mkdirSync(root, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    const tag = `dist-cloud-v${o.version}`;
    const tok = await json(await fetchFn(`https://ghcr.io/token?service=ghcr.io&scope=repository:${o.image}:pull`, { signal: AbortSignal.timeout(TIMEOUT_MS) }), 'token');
    const auth = { Authorization: `Bearer ${String(tok.token)}` };
    const get = (path: string) => fetchFn(`https://ghcr.io/v2/${o.image}/${path}`, { headers: { ...auth, Accept: ACCEPT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    let manifest = await json(await get(`manifests/${tag}`), 'manifesto');
    if (Array.isArray(manifest.manifests)) {
      const first = (manifest.manifests as { digest?: string }[])[0]?.digest;
      if (!first) throw new Error(tr('o pacote da versão {0} está vazio', [o.version]));
      manifest = await json(await get(`manifests/${first}`), 'manifesto');
    }
    const layers = (manifest.layers ?? []) as { digest?: string; size?: number }[];
    if (!layers.length || layers.length > 4) throw new Error(tr('o pacote da versão {0} não tem o formato esperado', [o.version]));
    for (const layer of layers) {
      if (!layer.digest || !/^sha256:[0-9a-f]{64}$/.test(layer.digest) || (layer.size ?? 0) > MAX_LAYER_BYTES) throw new Error(tr('camada inválida no pacote'));
      const res = await get(`blobs/${layer.digest}`);
      if (!res.ok) throw new Error(tr('o GitHub respondeu {0} ({1})', [res.status, 'camada']));
      const buf = Buffer.from(await res.arrayBuffer());
      if (`sha256:${createHash('sha256').update(buf).digest('hex')}` !== layer.digest) throw new Error(tr('o pacote baixado não confere com o esperado'));
      writeFileSync(blobFile, buf);
      await extract(blobFile, staging);
    }
    if (!existsSync(join(staging, 'dist', 'server', 'index.js'))) throw new Error(tr('o pacote não traz o servidor'));
    const want = readFileSync(o.depsHashFile, 'utf8').trim();
    const got = existsSync(join(staging, 'deps.hash')) ? readFileSync(join(staging, 'deps.hash'), 'utf8').trim() : '';
    if (!want || want !== got) {
      rmSync(staging, { recursive: true, force: true });
      return { ok: false, needsImage: true, error: tr('esta versão muda as dependências: precisa de uma imagem nova (reimplante no Velix)') };
    }
    const dest = join(root, o.version);
    rmSync(dest, { recursive: true, force: true });
    renameSync(staging, dest);
    rmSync(join(root, `bad-${o.version}`), { force: true });
    writeFileSync(join(root, 'current.tmp'), `${o.version}\n`);
    renameSync(join(root, 'current.tmp'), join(root, 'current'));
    prune(root, o.version);
    return { ok: true, version: o.version };
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, error: errMsg(err) };
  } finally {
    rmSync(blobFile, { force: true });
  }
}

/** Mantém só a versão atual e a anterior. */
function prune(root: string, current: string): void {
  try {
    const dirs = readdirSync(root).filter((n) => /^\d+\.\d+\.\d+$/.test(n) && n !== current);
    dirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const d of dirs.slice(0, Math.max(0, dirs.length - (KEEP_VERSIONS - 1)))) rmSync(join(root, d), { recursive: true, force: true });
  } catch {
    // limpeza é só higiene
  }
}
