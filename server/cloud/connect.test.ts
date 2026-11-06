import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import type { PtyProcess, SpawnPty } from '../pty/manager';
import { ConnectService } from './connect';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

/** Terminal falso: devolve a saída que a ferramenta mostraria e guarda o que a página mandou. */
function fakeSpawn() {
  const procs: { file: string; args: string[]; env: NodeJS.ProcessEnv; written: string[]; emit(d: string): void; exit(code: number): void }[] = [];
  const spawn: SpawnPty = (file, args, o) => {
    let onData: (d: string) => void = () => {};
    let onExit: (e: { exitCode: number }) => void = () => {};
    const rec = { file, args, env: o.env, written: [] as string[], emit: (d: string) => onData(d), exit: (c: number) => onExit({ exitCode: c }) };
    procs.push(rec);
    const p: PtyProcess = { pid: 1, onData: (cb) => void (onData = cb), onExit: (cb) => void (onExit = cb), write: (d) => void rec.written.push(d), resize: () => {}, kill: () => {} };
    return p;
  };
  return { spawn, procs };
}

function service() {
  const t = tempDir();
  cleanups.push(t.cleanup);
  const { spawn, procs } = fakeSpawn();
  const dirs: string[] = [];
  const svc = new ConnectService({ spawn, home: t.dir, env: {}, claudeBin: 'claude', codexBin: 'codex', ghBin: 'gh', onClaudeDir: (d) => dirs.push(d), onChange: () => {} });
  return { svc, procs, dirs, home: t.dir };
}

describe('conectar contas pela web', () => {
  it('Claude: lê o link (dentro do OSC 8), manda o código colado e registra a pasta', async () => {
    const { svc, procs, dirs, home } = service();
    const job = svc.start('claude');
    expect(procs[0].env.CLAUDE_CONFIG_DIR).toBe(`${home}/.claude`);
    const url = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz';
    procs[0].emit(`If the browser didn't open, visit: \x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\\r\nPaste code here if prompted > `);
    expect(svc.get(job.id)).toMatchObject({ state: 'waiting', url, needsPaste: true });
    expect(() => svc.paste(job.id, 'x')).toThrow();
    svc.paste(job.id, '  abcDEF123#state456  ');
    expect(procs[0].written).toEqual(['abcDEF123#state456\r']);
    procs[0].exit(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.get(job.id)?.state).toBe('done');
    expect(dirs).toEqual([`${home}/.claude`]);
  });

  it('Codex e GitHub: link e código de dispositivo; saída com erro vira falha com o motivo', () => {
    const { svc, procs } = service();
    const codex = svc.start('codex');
    procs[0].emit('1. Open this link in your browser\r\n   https://auth.openai.com/codex/device\r\n2. Enter this one-time code (expires in 15 minutes)\r\n   33VW-UL4I0\r\n');
    expect(svc.get(codex.id)).toMatchObject({ state: 'waiting', url: 'https://auth.openai.com/codex/device', code: '33VW-UL4I0', needsPaste: false });
    const gh = svc.start('github');
    expect(procs[1].env.GH_PROMPT_DISABLED).toBe('1');
    procs[1].emit('! First copy your one-time code: B551-1BF8\r\nOpen this URL to continue in your web browser: https://github.com/login/device\r\n');
    expect(svc.get(gh.id)).toMatchObject({ state: 'waiting', url: 'https://github.com/login/device', code: 'B551-1BF8' });
    procs[1].emit('error: authorization expired\r\n');
    procs[1].exit(1);
    expect(svc.get(gh.id)).toMatchObject({ state: 'failed', error: expect.stringContaining('expired') });
  });
});
