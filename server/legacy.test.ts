import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeStateMigration, legacyEnvVars, legacyEnvWarning, migrateLegacyStateDir } from './legacy';
import { tempDir } from './test/fixtures';

describe('variáveis do nome antigo', () => {
  it('lista só as CODETOWN_*, com o nome novo, em ordem', () => {
    expect(legacyEnvVars(['PATH', 'CODETOWN_PORT', 'DEVLAND_BIND', 'CODETOWN_BIND'])).toEqual([
      { from: 'CODETOWN_BIND', to: 'DEVLAND_BIND' },
      { from: 'CODETOWN_PORT', to: 'DEVLAND_PORT' },
    ]);
  });

  it('avisa só quando há alguma', () => {
    expect(legacyEnvWarning(['PATH', 'DEVLAND_PORT'])).toBeUndefined();
    expect(legacyEnvWarning(['CODETOWN_PORT'], 'no .env')).toBe(
      'variável do nome antigo ignorada no .env: CODETOWN_PORT → DEVLAND_PORT. Renomeie para valer de novo.',
    );
  });
});

describe('migrateLegacyStateDir', () => {
  let tmp: ReturnType<typeof tempDir>;
  let home: string;
  const write = (rel: string, text: string) => {
    mkdirSync(join(home, rel, '..'), { recursive: true });
    writeFileSync(join(home, rel), text);
  };
  const read = (rel: string) => readFileSync(join(home, rel), 'utf8');

  beforeEach(() => {
    tmp = tempDir('devland-legacy-');
    home = tmp.dir;
  });
  afterEach(() => tmp.cleanup());

  it('sem a pasta antiga, não faz nada', () => {
    expect(migrateLegacyStateDir(home)).toEqual({ moved: [] });
    expect(existsSync(join(home, '.devland'))).toBe(false);
  });

  it('sem a pasta nova, renomeia a antiga inteira', () => {
    write('.codetown/names.json', '{"a":"Marina"}');
    write('.codetown/usage/.claude.json', '{}');
    const r = migrateLegacyStateDir(home);
    expect(r).toEqual({ moved: ['.'], from: 'codetown' });
    expect(read('.devland/names.json')).toBe('{"a":"Marina"}');
    expect(existsSync(join(home, '.devland/usage/.claude.json'))).toBe(true);
    expect(existsSync(join(home, '.codetown'))).toBe(false);
    expect(describeStateMigration(r)).toBe('~/.codetown (nome antigo) agora é ~/.devland.');
  });

  it('com a pasta nova já criada, move o que falta e, nos arquivos dos dois lados, fica o mais recente', () => {
    const at = (rel: string, minutes: number) => {
      const t = new Date(2026, 9, 8, 18, minutes);
      utimesSync(join(home, rel), t, t);
    };
    write('.codetown/names.json', 'antigo');
    write('.codetown/usage/.claude.json', 'antigo');
    write('.codetown/usage/.claude-conta2.json', 'antigo, mas mais recente');
    write('.devland/usage/.claude.json', 'novo');
    write('.devland/usage/.claude-conta2.json', 'novo, mas parado');
    at('.codetown/usage/.claude.json', 10);
    at('.devland/usage/.claude.json', 20);
    at('.codetown/usage/.claude-conta2.json', 30);
    at('.devland/usage/.claude-conta2.json', 20);
    const r = migrateLegacyStateDir(home);
    expect(r.moved.sort()).toEqual(['names.json', 'usage/.claude-conta2.json']);
    expect(read('.devland/names.json')).toBe('antigo');
    expect(read('.devland/usage/.claude.json')).toBe('novo');
    expect(read('.devland/usage/.claude-conta2.json')).toBe('antigo, mas mais recente');
    // O que perdeu para um arquivo mais novo fica na pasta antiga, que então não some.
    expect(read('.codetown/usage/.claude.json')).toBe('antigo');
    expect(describeStateMigration(r)).toContain('names.json, usage/.claude-conta2.json');
  });

  it('pasta antiga sem nada que falte: some', () => {
    mkdirSync(join(home, '.codetown'));
    mkdirSync(join(home, '.devland'));
    expect(migrateLegacyStateDir(home)).toEqual({ moved: [] });
    expect(existsSync(join(home, '.codetown'))).toBe(false);
  });

  it('não lança: devolve o erro (ex.: ~/.devland é um arquivo)', () => {
    write('.codetown/names.json', '{}');
    write('.devland', 'arquivo');
    const r = migrateLegacyStateDir(home);
    expect(r).toEqual({ moved: [], from: 'codetown', error: `${join(home, '.devland')} existe e não é uma pasta` });
    expect(existsSync(join(home, '.codetown/names.json'))).toBe(true);
    expect(describeStateMigration(r)).toMatch(/^não consegui levar ~\/\.codetown para ~\/\.devland/);
  });
  it('leva ~/.habblaud (nome anterior) para ~/.devland', () => {
    mkdirSync(join(home, '.habblaud'));
    writeFileSync(join(home, '.habblaud', 'names.json'), '{}');
    expect(migrateLegacyStateDir(home)).toEqual({ moved: ['.'], from: 'habblaud' });
    expect(existsSync(join(home, '.devland', 'names.json'))).toBe(true);
  });
});
