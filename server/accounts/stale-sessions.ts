// Registros de sessão velhos (<conta>/sessions/<pid>.json) depois de o container reiniciar: os PIDs recomeçam baixos e
// os arquivos da rodada anterior passam a apontar para processos NOVOS (o mesmo número), então o escritório achava que as
// sessões velhas continuavam abertas e mostrava o mesmo agente 2, 3 vezes. No Cloud, cada subida do servidor é um
// container novo (o entrypoint faz exec do Node): tudo que foi gravado antes de o servidor subir é de processo morto.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Apaga os registros gravados antes de `bootMs`; devolve quantos saíram. */
export function clearStaleSessions(dirs: readonly string[], bootMs: number): number {
  let n = 0;
  for (const dir of dirs) {
    const sessions = join(dir, 'sessions');
    let files: string[] = [];
    try {
      files = readdirSync(sessions).filter((f) => /^\d+\.json$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      const p = join(sessions, f);
      try {
        if (statSync(p).mtimeMs < bootMs) {
          rmSync(p, { force: true });
          n++;
        }
      } catch {
        // sumiu no meio
      }
    }
  }
  return n;
}
