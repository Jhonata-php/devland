// Tokens da API de IA para outros sistemas (/v1, ai/openai.ts): vários, cada um com nome e a lista de modelos que pode usar
// (vazia = todos). Ficam num arquivo na pasta de dados (0600); a tela "IA local" lista, cria, edita e revoga. O token
// antigo único (arquivo ai-api-token) vira o "Principal"; DEVLAND_AI_TOKEN entra como um token só de leitura.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ApiToken {
  id: string;
  name: string;
  token: string;
  /** Modelos permitidos; vazia = todos. */
  models: string[];
  createdAt: number;
  lastUsedAt?: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  /** Vem da variável DEVLAND_AI_TOKEN (não dá para editar nem revogar pela tela). */
  fromEnv?: boolean;
}

const safeEq = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export class ApiTokens {
  private items: ApiToken[] = [];

  constructor(private readonly file: string, private readonly legacyFile?: string, private readonly env: () => string | undefined = () => process.env.DEVLAND_AI_TOKEN || undefined) {
    try {
      this.items = (JSON.parse(readFileSync(file, 'utf8')) as ApiToken[]).filter((t) => t && typeof t.token === 'string');
    } catch { /* primeira vez */ }
    if (!this.items.length && legacyFile && existsSync(legacyFile)) {
      try {
        const token = readFileSync(legacyFile, 'utf8').trim();
        if (token) this.items.push(this.blank('Principal', [], token));
        rmSync(legacyFile, { force: true });
        this.save();
      } catch { /* sem como migrar: o token antigo some, gera-se outro */ }
    }
  }

  private blank(name: string, models: string[], token = randomBytes(32).toString('hex')): ApiToken {
    return { id: randomUUID(), name: name.trim().slice(0, 60) || 'Sem nome', token, models: [...new Set(models)].slice(0, 100), createdAt: Date.now(), requests: 0, promptTokens: 0, completionTokens: 0 };
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.items), { mode: 0o600 });
  }

  /** Os da tela mais o da variável de ambiente (primeiro, só de leitura). */
  list(): ApiToken[] {
    const e = this.env();
    return e ? [{ id: 'env', name: 'DEVLAND_AI_TOKEN', token: e, models: [], createdAt: 0, requests: 0, promptTokens: 0, completionTokens: 0, fromEnv: true }, ...this.items] : [...this.items];
  }

  any(): boolean {
    return this.list().length > 0;
  }

  create(name: string, models: string[]): ApiToken {
    const t = this.blank(name, models);
    this.items.push(t);
    this.save();
    return t;
  }

  update(id: string, p: { name?: string; models?: string[] }): void {
    const t = this.items.find((x) => x.id === id);
    if (!t) throw new Error('Token não encontrado.');
    if (typeof p.name === 'string' && p.name.trim()) t.name = p.name.trim().slice(0, 60);
    if (Array.isArray(p.models)) t.models = [...new Set(p.models.filter((m) => typeof m === 'string'))].slice(0, 100);
    this.save();
  }

  remove(id: string): void {
    this.items = this.items.filter((x) => x.id !== id);
    this.save();
  }

  /** O token que bate com o Bearer (comparando todos, em tempo constante por token). */
  find(bearer: string): ApiToken | undefined {
    let hit: ApiToken | undefined;
    for (const t of this.list()) if (safeEq(t.token, bearer)) hit = t;
    return hit;
  }

  allows(t: ApiToken, model: string): boolean {
    return t.models.length === 0 || t.models.includes(model) || t.models.includes(`${model}:latest`) || t.models.some((m) => `${m}:latest` === model);
  }

  /** Soma o uso de um pedido ao token. */
  touch(id: string, promptTokens: number, completionTokens: number): void {
    const t = this.items.find((x) => x.id === id);
    if (!t) return;
    t.lastUsedAt = Date.now();
    t.requests++;
    t.promptTokens += promptTokens;
    t.completionTokens += completionTokens;
    try {
      this.save();
    } catch { /* sem disco: fica só em memória */ }
  }
}
