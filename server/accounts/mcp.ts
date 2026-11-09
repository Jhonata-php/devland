// Conectores (servidores MCP) do Claude Code: lista, adiciona e remove em todas as contas do Claude, no escopo do usuário
// (valem em qualquer projeto). Pelo próprio CLI (`claude mcp list|add|remove`), como os plugins. Só admin (Cloud) ou o
// próprio computador mexe.
import { tr } from '../../shared/i18n';
import { homedir } from 'node:os';
import { isDefaultDir } from './detect';
import { runClaude } from './plugins';
import { agentRunAs } from '../spawn/runas';

export interface McpServer {
  name: string;
  /** Endereço (http/sse) ou comando (stdio). */
  target: string;
  status: 'ok' | 'fail' | 'auth' | 'unknown';
  detail: string;
}

/** Conectores conhecidos, para adicionar com um toque. ponytail: lista fixa; acrescentar à mão. */
export const mcpCatalog = () => [
  { name: 'context7', title: 'Context7', desc: tr('Documentação atualizada de bibliotecas e frameworks'), transport: 'http', target: 'https://mcp.context7.com/mcp' },
  { name: 'playwright', title: 'Playwright', desc: tr('Navegador para o agente abrir o site, clicar e testar fluxos'), transport: 'stdio', target: 'npx @playwright/mcp@latest --headless' },
  { name: 'sentry', title: 'Sentry', desc: tr('Erros de produção para o agente investigar'), transport: 'http', target: 'https://mcp.sentry.dev/mcp' },
  { name: 'notion', title: 'Notion', desc: tr('Páginas e bancos de dados do Notion'), transport: 'http', target: 'https://mcp.notion.com/mcp' },
  { name: 'linear', title: 'Linear', desc: tr('Tarefas e projetos do Linear'), transport: 'sse', target: 'https://mcp.linear.app/sse' },
  { name: 'figma', title: 'Figma', desc: tr('Designs do Figma (app do Figma com o Dev Mode)'), transport: 'http', target: 'http://127.0.0.1:3845/mcp' },
] as const;

export const MCP_NAME = /^[a-zA-Z0-9][\w.-]{0,40}$/;

/** Lê a saída do `claude mcp list` ("nome: alvo (HTTP) - ✔ Connected"). */
export function parseMcpList(out: string): McpServer[] {
  const list: McpServer[] = [];
  for (const line of out.split('\n')) {
    const m = /^([\w.-]+): (.+?) - (.+)$/.exec(line.trim());
    if (!m) continue;
    const detail = m[3]!.trim();
    const status = /connected/i.test(detail) && !/fail|not/i.test(detail) ? 'ok' : /auth/i.test(detail) ? 'auth' : /fail|error/i.test(detail) ? 'fail' : 'unknown';
    list.push({ name: m[1]!, target: m[2]!.trim(), status, detail: detail.replace(/^[✔✓✗✘!⚠]\s*/u, '') });
  }
  return list;
}

export class McpStore {
  constructor(private bin: string, private dirs: () => string[]) {}

  /** Os conectores do escopo do usuário ficam no .claude.json; o da conta padrão fica em HOME (sem CLAUDE_CONFIG_DIR). */
  private run(args: string[], dir: string) {
    return runClaude(this.bin, args, dir, { defaultDir: isDefaultDir(dir, agentRunAs()?.home ?? homedir()) });
  }

  /** Os conectores da primeira conta (todas recebem os mesmos por aqui). */
  async list(): Promise<McpServer[]> {
    const dir = this.dirs()[0];
    if (!dir) return [];
    const r = await this.run(['mcp', 'list'], dir);
    return parseMcpList(r.out);
  }

  async add(name: string, transport: string, target: string): Promise<void> {
    if (!MCP_NAME.test(name)) throw new Error(tr('Nome inválido: use letras, números, ponto, traço ou sublinhado.'));
    const t = target.trim();
    if (!t || t.length > 500 || t.includes('\0')) throw new Error(tr('Informe o endereço ou o comando do conector.'));
    let args: string[];
    if (transport === 'http' || transport === 'sse') {
      if (!/^https?:\/\/\S+$/.test(t)) throw new Error(tr('O endereço precisa começar com http:// ou https://.'));
      args = ['mcp', 'add', '--scope', 'user', '--transport', transport, name, t];
    } else {
      const parts = t.split(/\s+/);
      args = ['mcp', 'add', '--scope', 'user', name, '--', ...parts];
    }
    const errors: string[] = [];
    for (const dir of this.dirs()) {
      await this.run(['mcp', 'remove', '--scope', 'user', name], dir);
      const r = await this.run(args, dir);
      if (!r.ok) errors.push(r.out.slice(0, 200));
    }
    if (errors.length) throw new Error(errors[0]!);
  }

  async remove(name: string): Promise<void> {
    if (!MCP_NAME.test(name)) throw new Error(tr('Nome inválido: use letras, números, ponto, traço ou sublinhado.'));
    for (const dir of this.dirs()) await this.run(['mcp', 'remove', '--scope', 'user', name], dir);
  }
}
