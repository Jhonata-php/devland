// Troca de conta no meio da conversa: o Claude Code guarda o histórico em <conta>/projects/<pasta>/<sessão>.jsonl, e o
// `--resume` só enxerga o da própria conta. Copia o histórico para a conta nova (mesma pasta de projeto, mesma sessão).
import { chownSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Copia a sessão de uma conta para a outra. Devolve false se a conta de origem não tem o histórico. */
export function copyTranscript(fromDir: string, toDir: string, sessionId: string): boolean {
  const file = `${sessionId}.jsonl`;
  let project: string | undefined;
  try {
    project = readdirSync(join(fromDir, 'projects')).find((p) => existsSync(join(fromDir, 'projects', p, file)));
  } catch {
    return false;
  }
  if (!project) return false;
  const dest = join(toDir, 'projects', project);
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(fromDir, 'projects', project, file), join(dest, file));
  try {
    // Servidor como root, agentes como outro usuário (Cloud): o histórico copiado precisa ser do dono da conta.
    const { uid, gid } = statSync(toDir);
    for (const p of [join(toDir, 'projects'), dest, join(dest, file)]) chownSync(p, uid, gid);
  } catch {
    // sem permissão para trocar o dono (já roda como o próprio usuário)
  }
  return true;
}
