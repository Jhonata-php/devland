import { describe, expect, it } from 'vitest';
import { applyGitRules, GIT_RULES, gitRulesOn } from './git-permissions';

describe('push e merge pelos agentes', () => {
  it('liga sem apagar o resto do settings e sem repetir', () => {
    const s = { model: 'x', permissions: { allow: ['Bash(npm test:*)'], deny: ['Read(.env)'] } };
    const on = applyGitRules(applyGitRules(s, true), true);
    expect(on.model).toBe('x');
    expect(on.permissions?.deny).toEqual(['Read(.env)']);
    expect(on.permissions?.allow).toEqual(['Bash(npm test:*)', ...GIT_RULES]);
    expect(gitRulesOn(on)).toBe(true);
  });
  it('desliga tirando só as regras do DevLand', () => {
    const off = applyGitRules({ permissions: { allow: ['Bash(npm test:*)', ...GIT_RULES] } }, false);
    expect(off.permissions?.allow).toEqual(['Bash(npm test:*)']);
    expect(gitRulesOn(off)).toBe(false);
    expect(gitRulesOn({})).toBe(false);
  });
});
