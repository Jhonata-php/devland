// Habblaud Cloud: ninguém roda `npm run mod:install` dentro do container, então o servidor instala sozinho, em cada conta
// do Claude Code, os plugins que ligam o escritório à sessão: habblaud-mensagens (digitar na sessão pelo escritório) e
// habblaud-permissoes (responder pedidos de permissão). O marketplace é a própria pasta do Habblaud na imagem
// (.claude-plugin/marketplace.json + mod/), pelo CLI do Claude Code com o CLAUDE_CONFIG_DIR da conta, como o mod:install.
// O mod de uso (habblaud) também entra: o captador de statusline (usage-tap.ts) continua como reforço. Sessões que já estavam abertas
// só carregam os plugins ao reiniciar; as novas já vêm com eles.
import { execFile } from 'node:child_process';
import { agentRunAs, runAsOptions } from '../spawn/runas';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';

const MARKETPLACE = 'habblaud';
// habblaud (o mod de uso): grava o uso a cada turno de qualquer sessão, inclusive a de segundo plano.
const PLUGINS = ['habblaud', 'habblaud-mensagens', 'habblaud-permissoes'];
const TIMEOUT_MS = 120_000;

function run(bin: string, args: string[], dir: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((done) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, encoding: 'utf8', ...runAsOptions({ ...process.env, CLAUDE_CONFIG_DIR: dir }, agentRunAs()) }, (err, stdout, stderr) =>
      done({ ok: !err, out: `${stdout ?? ''}${stderr ?? ''}`.trim() }),
    );
  });
}

/** Instala (ou confirma) o marketplace e os plugins em cada pasta de conta, uma de cada vez e em segundo plano. */
export async function ensureHabblaudPlugins(dirs: readonly string[], claudeBin: string, root: string): Promise<void> {
  for (const dir of dirs) {
    try {
      // "já existe" também sai com erro: o que importa é o plugin ficar instalado.
      await run(claudeBin, ['plugin', 'marketplace', 'add', root], dir);
      const failed: string[] = [];
      for (const p of PLUGINS) {
        const r = await run(claudeBin, ['plugin', 'install', `${p}@${MARKETPLACE}`], dir);
        if (!r.ok && !/already|já/i.test(r.out)) failed.push(`${p}: ${r.out.split('\n').pop()?.slice(0, 160) ?? ''}`);
      }
      if (failed.length) log.warnOnce(`plugins:${dir}`, tr('Plugins do Habblaud em {0}: {1}', [dir, failed.join('; ')]));
    } catch (err) {
      log.warnOnce(`plugins:${dir}`, tr('Plugins do Habblaud em {0}: {1}', [dir, errMsg(err)]));
    }
  }
}
