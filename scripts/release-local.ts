// Publica o pacote de atualização nativa (ghcr.io/jhonata-php/habblaud:dist-cloud-vX.Y.Z) buildado AQUI, sem Docker nem
// GitHub Actions: faz o mesmo que o estágio dist-pkg do Dockerfile.cloud (dist + package.json + deps.hash + scripts +
// .claude-plugin + mod numa camada) e envia como artefato OCI pela API do GHCR. É o que o botão "Atualizar" baixa.
//   npm run release:local -- 0.3.127            -> builda e envia (gh com o escopo write:packages)
//   npm run release:local -- 0.3.127 --dry-run  -> builda e monta o pacote, sem enviar
// Rode numa cópia limpa do commit da tag (git worktree add ../x cloud-vX.Y.Z), com as dependências instaladas
// (npm ci --include=dev). A imagem completa do Velix (:cloud-vX.Y.Z) ainda precisa de Docker/Actions.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const IMAGE = 'jhonata-php/habblaud';
const sha = (b: Buffer | string): string => `sha256:${createHash('sha256').update(b).digest('hex')}`;

const version = process.argv[2]?.replace(/^cloud-v/, '');
const dryRun = process.argv.includes('--dry-run');
if (!version || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version)) throw new Error('uso: npm run release:local -- X.Y.Z [--dry-run]');

execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const work = mkdtempSync(join(tmpdir(), 'devland-pkg-'));
try {
  const pkg = join(work, 'pkg');
  // A atualização nativa só aceita o pacote se o deps.hash for o da imagem em uso (sha256 do package-lock). Bump só de
  // devDependencies muda o lock sem mudar o que roda: --deps-from cloud-vX.Y.Z usa o hash do lock dessa tag (confira antes
  // que os pacotes de produção do lock são os mesmos).
  const from = process.argv.find((a, i) => process.argv[i - 1] === '--deps-from');
  const lock = from ? execFileSync('git', ['show', `${from}:package-lock.json`], { maxBuffer: 1 << 26 }) : readFileSync('package-lock.json');
  writeFileSync(join(work, 'deps.hash'), `${sha(lock).slice(7)}\n`);
  execFileSync('mkdir', [pkg]);
  for (const f of ['dist', 'package.json', 'scripts', '.claude-plugin', 'mod']) cpSync(f, join(pkg, f), { recursive: true });
  cpSync(join(work, 'deps.hash'), join(pkg, 'deps.hash'));
  const tar = execFileSync('tar', ['-C', pkg, '--owner=0', '--group=0', '-cf', '-', '.'], { maxBuffer: 1 << 30 });
  const layer = gzipSync(tar);
  console.log(`pacote ${version}: ${(layer.length / 1048576).toFixed(1)} MB, ${sha(layer)}`);
  if (dryRun) process.exit(0);

  const ghToken = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  const user = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim();
  const tokRes = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${IMAGE}:push,pull`, { headers: { Authorization: `Basic ${Buffer.from(`${user}:${ghToken}`).toString('base64')}` } });
  if (!tokRes.ok) throw new Error(`GHCR recusou o login (${tokRes.status}): falta o escopo write:packages? rode: gh auth refresh -s write:packages`);
  const auth = { Authorization: `Bearer ${((await tokRes.json()) as { token: string }).token}` };

  const push = async (body: Buffer): Promise<{ digest: string; size: number }> => {
    const digest = sha(body);
    const start = await fetch(`https://ghcr.io/v2/${IMAGE}/blobs/uploads/`, { method: 'POST', headers: auth });
    const loc = start.headers.get('location');
    if (!start.ok || !loc) throw new Error(`GHCR não abriu o envio (${start.status})`);
    const url = new URL(loc, 'https://ghcr.io');
    url.searchParams.set('digest', digest);
    const put = await fetch(url, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body });
    if (!put.ok) throw new Error(`GHCR recusou o envio (${put.status}): ${(await put.text()).slice(0, 200)}`);
    return { digest, size: body.length };
  };
  const config = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux', rootfs: { type: 'layers', diff_ids: [sha(tar)] } }));
  const [cfg, lay] = [await push(config), await push(layer)];
  const manifest = JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', ...cfg },
    layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', ...lay }],
  });
  // dist- primeiro e cloud-v por último: o "Verificar agora" só enxerga cloud-v*, e aí o pacote já existe (como no workflow).
  // shortcut: cloud-v aponta para o pacote, não para uma imagem executável; quem roda a imagem por essa tag (Velix) precisa do workflow.
  for (const tag of [`dist-cloud-v${version}`, `cloud-v${version}`]) {
    const res = await fetch(`https://ghcr.io/v2/${IMAGE}/manifests/${tag}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/vnd.oci.image.manifest.v1+json' }, body: manifest });
    if (!res.ok) throw new Error(`GHCR recusou o manifesto (${res.status}): ${(await res.text()).slice(0, 200)}`);
    console.log(`publicado: ghcr.io/${IMAGE}:${tag}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
