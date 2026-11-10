// Habblaud Cloud: ninguém roda `npm run usage:install` dentro do container, então o servidor mesmo põe o tap de uso
// (scripts/statusline-tap.mjs) no statusLine de cada conta do Claude Code do usuário dos agentes: ao subir e quando uma
// conta nova é conectada. É o que alimenta os cartões de uso (5 h e semana). Mesma regra do instalador: o statusline que
// já existia continua rodando (o tap só espia e repassa), com backup do settings.json antes de mexer.
import { chownSync } from 'node:fs';
import { join } from 'node:path';
import { planInstall, readSettings, writeSettings } from '../../scripts/statusline-install';
import { agentRunAs } from '../spawn/runas';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';

/** Instala o tap em cada pasta de conta. Devolve quantas settings.json mudaram. Nunca lança: falha vira aviso no log. */
export function ensureUsageTap(dirs: readonly string[], tapPath: string, nodeCmd = 'node'): number {
  const who = agentRunAs();
  let changed = 0;
  for (const dir of dirs) {
    const file = join(dir, 'settings.json');
    try {
      const read = readSettings(file);
      if ('error' in read) {
        log.warnOnce(`usage-tap:${file}`, tr('Uso de {0}: settings.json não foi alterado ({1}).', [dir, read.error]));
        continue;
      }
      const plan = planInstall(read.settings, nodeCmd, tapPath);
      if (plan.action !== 'install') continue;
      writeSettings(file, plan.settings, read.raw, new Date());
      // O servidor roda como root no Cloud; o claude (usuário dos agentes) precisa continuar dono do arquivo.
      if (who) chownSync(file, who.uid, who.gid);
      changed++;
    } catch (err) {
      log.warnOnce(`usage-tap:${file}`, tr('Uso de {0}: não deu para instalar o tap ({1}).', [dir, errMsg(err)]));
    }
  }
  return changed;
}
