// Transcript de uma sessão que não está onde a conta dela diz (Cloud): o serviço de segundo plano do Claude Code
// (`claude --bg`) é um só e grava na pasta da conta com que foi iniciado, então uma sessão da Conta B pode estar em
// .claude/projects em vez de .claude-2/projects. Procura o mesmo arquivo (<sessão>.jsonl) nas pastas das outras contas,
// primeiro na mesma pasta de projeto e depois em todas; guarda o achado para não varrer de novo.
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const found = new Map<string, string>();

export function locateTranscript(path: string | undefined, claudeDirs: readonly string[], exists: (p: string) => boolean = existsSync): string | undefined {
  if (!path || exists(path)) return path;
  const hit = found.get(path);
  if (hit && exists(hit)) return hit;
  const file = basename(path);
  if (!/^[\w-]+\.jsonl$/.test(file)) return path;
  const project = basename(dirname(path));
  for (const dir of claudeDirs) {
    const same = join(dir, 'projects', project, file);
    if (exists(same)) return remember(path, same);
  }
  for (const dir of claudeDirs) {
    let projects: string[] = [];
    try {
      projects = readdirSync(join(dir, 'projects'));
    } catch {
      continue;
    }
    for (const p of projects) {
      const candidate = join(dir, 'projects', p, file);
      if (exists(candidate)) return remember(path, candidate);
    }
  }
  return path;
}

function remember(path: string, real: string): string {
  if (found.size > 500) found.clear();
  found.set(path, real);
  return real;
}
