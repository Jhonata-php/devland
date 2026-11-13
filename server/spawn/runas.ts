// DevLand Cloud: os agentes (claude, codex) rodam com outro usuário do Linux, sem acesso a /data (usuários, segredo
// das sessões). Ligado por DEVLAND_AGENT_UID + DEVLAND_AGENT_GID (o Dockerfile.cloud cria o usuário "dev"); exige
// o servidor como root no container. Sem as duas variáveis, tudo roda como o próprio servidor (o DevLand no Mac).
import { userInfo } from 'node:os';

export interface RunAs {
  uid: number;
  gid: number;
  home: string;
  user: string;
}

export function agentRunAs(env: NodeJS.ProcessEnv = process.env): RunAs | undefined {
  const uid = Number.parseInt(env.DEVLAND_AGENT_UID ?? '', 10);
  const gid = Number.parseInt(env.DEVLAND_AGENT_GID ?? '', 10);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid <= 0 || gid <= 0) return undefined;
  let user = env.DEVLAND_AGENT_USER?.trim() || 'dev';
  let home = env.DEVLAND_AGENT_HOME?.trim() || `/home/${user}`;
  try {
    const info = userInfo({ encoding: 'utf8' });
    if (info.uid === uid) ({ username: user, homedir: home } = info);
  } catch {
    // sem passwd: fica o que veio do ambiente
  }
  return { uid, gid, home, user };
}

/** Opções do child_process/node-pty para rodar como o usuário dos agentes (vazio sem ele). */
export function runAsOptions(env: NodeJS.ProcessEnv, runAs: RunAs | undefined = agentRunAs()): { uid?: number; gid?: number; env: NodeJS.ProcessEnv } {
  if (!runAs) return { env };
  return { uid: runAs.uid, gid: runAs.gid, env: { ...env, HOME: runAs.home, USER: runAs.user, LOGNAME: runAs.user } };
}
