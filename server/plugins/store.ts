// Loja de plugins do Claude Code: lista os plugins dos marketplaces já configurados (`claude plugin list --available
// --json`) e instala ou remove em todas as contas do Claude. Plugin roda código no servidor: só admin (Cloud) ou o
// próprio computador mexe, e só dá para instalar o que está no catálogo dos marketplaces (nada de endereço solto).
import { tr } from '../../shared/i18n';
import { runClaude } from '../accounts/plugins';

export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  marketplace: string;
  version?: string;
  installed: boolean;
}

interface Catalog {
  at: number;
  available: PluginEntry[];
  installed: Set<string>;
}

const CACHE_MS = 10 * 60_000;
export const PLUGIN_ID = /^[\w.-]{1,80}@[\w.-]{1,80}$/;
const LIST_MAX = 60;

/** Lê o JSON do `claude plugin list --available --json` (formato do Claude Code 2.x). */
export function parseCatalog(raw: string): { available: PluginEntry[]; installed: Set<string> } {
  const d = JSON.parse(raw) as { installed?: { id?: unknown }[]; available?: { pluginId?: unknown; name?: unknown; description?: unknown; marketplaceName?: unknown; version?: unknown }[] };
  const installed = new Set((d.installed ?? []).map((p) => (typeof p.id === 'string' ? p.id : '')).filter(Boolean));
  const available: PluginEntry[] = [];
  for (const p of d.available ?? []) {
    if (typeof p.pluginId !== 'string' || !PLUGIN_ID.test(p.pluginId)) continue;
    available.push({
      id: p.pluginId,
      name: typeof p.name === 'string' ? p.name : p.pluginId.split('@')[0],
      description: typeof p.description === 'string' ? p.description.slice(0, 300) : '',
      marketplace: typeof p.marketplaceName === 'string' ? p.marketplaceName : p.pluginId.split('@')[1],
      ...(typeof p.version === 'string' ? { version: p.version } : {}),
      installed: installed.has(p.pluginId),
    });
  }
  return { available, installed };
}

/** Busca por nome/descrição; os instalados primeiro. */
export function searchPlugins(list: readonly PluginEntry[], q: string, max = LIST_MAX): PluginEntry[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (p: PluginEntry) => words.every((w) => `${p.name} ${p.description} ${p.marketplace}`.toLowerCase().includes(w));
  return list.filter(hit).sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name)).slice(0, max);
}

export class PluginStore {
  private catalog: Catalog | null = null;
  private loading: Promise<Catalog> | null = null;
  private busy = false;

  constructor(
    private readonly bin: string,
    private readonly dirs: () => string[],
  ) {}

  private async load(force = false): Promise<Catalog> {
    if (!force && this.catalog && Date.now() - this.catalog.at < CACHE_MS) return this.catalog;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const dir = this.dirs()[0];
      if (!dir) throw new Error(tr('Nenhuma conta do Claude Code neste servidor.'));
      const r = await runClaude(this.bin, ['plugin', 'list', '--available', '--json'], dir);
      if (!r.ok) throw new Error(tr('Não deu para ler o catálogo de plugins: {0}', [r.out.split('\n').pop()?.slice(0, 200) ?? '']));
      const c = parseCatalog(r.stdout);
      this.catalog = { at: Date.now(), ...c };
      return this.catalog;
    })().finally(() => (this.loading = null));
    return this.loading;
  }

  async list(q: string): Promise<{ plugins: PluginEntry[]; total: number }> {
    const c = await this.load();
    // Instalados que não estão em nenhum marketplace configurado (ex.: o marketplace foi removido) também aparecem.
    const known = new Set(c.available.map((p) => p.id));
    const orphans: PluginEntry[] = [...c.installed].filter((id) => !known.has(id)).map((id) => ({ id, name: id.split('@')[0]!, description: '', marketplace: id.split('@')[1] ?? '', installed: true }));
    const all = [...c.available, ...orphans];
    return { plugins: searchPlugins(all, q), total: all.length };
  }

  /** Marketplaces configurados (de onde vêm os plugins). */
  async marketplaces(): Promise<{ name: string; source: string }[]> {
    const dir = this.dirs()[0];
    if (!dir) return [];
    const r = await runClaude(this.bin, ['plugin', 'marketplace', 'list', '--json'], dir);
    try {
      return (JSON.parse(r.stdout) as { name: string; source: string; repo?: string; url?: string; path?: string }[]).map((m) => ({ name: m.name, source: m.repo ?? m.url ?? m.path ?? m.source }));
    } catch {
      return [];
    }
  }

  /** Acrescenta um marketplace (dono/repositório do GitHub ou endereço git) em todas as contas. */
  async addMarketplace(source: string): Promise<{ ok: true }> {
    const src = source.trim().replace(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(\.git)?\/?$/, '$1');
    if (!/^[\w.-]+\/[\w.-]+$/.test(src) && !/^https:\/\/[\w.-]+\/[\w./-]+$/.test(src)) throw new Error(tr('Use dono/repositório do GitHub (ex.: obra/superpowers-marketplace) ou o endereço https do repositório.'));
    if (this.busy) throw new Error(tr('Outra instalação está em andamento: espere terminar.'));
    this.busy = true;
    try {
      const failed: string[] = [];
      for (const dir of this.dirs()) {
        const r = await runClaude(this.bin, ['plugin', 'marketplace', 'add', src], dir);
        if (!r.ok && !/already|já/i.test(r.out)) failed.push(r.out.split('\n').pop()?.slice(0, 200) ?? '');
      }
      if (failed.length) throw new Error(failed[0]!);
      return { ok: true };
    } finally {
      this.busy = false;
      this.catalog = null;
    }
  }

  async removeMarketplace(name: string): Promise<{ ok: true }> {
    if (!/^[\w.-]{1,80}$/.test(name)) throw new Error(tr('Marketplace inválido.'));
    for (const dir of this.dirs()) await runClaude(this.bin, ['plugin', 'marketplace', 'remove', name], dir);
    this.catalog = null;
    return { ok: true };
  }

  /** Instala ou remove em todas as contas; só ids do catálogo. */
  async change(id: string, action: 'install' | 'uninstall'): Promise<{ ok: true }> {
    if (!PLUGIN_ID.test(id)) throw new Error(tr('Plugin inválido.'));
    if (this.busy) throw new Error(tr('Outra instalação está em andamento: espere terminar.'));
    const c = await this.load();
    if (action === 'install' && !c.available.some((p) => p.id === id)) throw new Error(tr('Esse plugin não está nos marketplaces configurados.'));
    this.busy = true;
    try {
      const failed: string[] = [];
      for (const dir of this.dirs()) {
        const r = await runClaude(this.bin, ['plugin', action, id], dir);
        if (!r.ok && !/already|não está|not installed|já/i.test(r.out)) failed.push(r.out.split('\n').pop()?.slice(0, 200) ?? '');
      }
      if (failed.length) throw new Error(failed.join('; '));
      return { ok: true };
    } finally {
      this.busy = false;
      this.catalog = null;
    }
  }
}
