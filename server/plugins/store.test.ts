import { describe, expect, it } from 'vitest';
import { parseCatalog, searchPlugins } from './store';

const RAW = JSON.stringify({
  installed: [{ id: 'a@m' }],
  available: [
    { pluginId: 'a@m', name: 'a', description: 'Revisão de código', marketplaceName: 'm', version: '1.0.0' },
    { pluginId: 'b@m', name: 'b', description: 'Testes automáticos', marketplaceName: 'm' },
    { pluginId: 'ruim; rm -rf', name: 'x' },
  ],
});

describe('loja de plugins', () => {
  it('lê o catálogo e descarta ids estranhos', () => {
    const c = parseCatalog(RAW);
    expect(c.available.map((p) => p.id)).toEqual(['a@m', 'b@m']);
    expect(c.available[0].installed).toBe(true);
    expect(c.available[1].installed).toBe(false);
  });
  it('busca por palavras, instalados primeiro', () => {
    const { available } = parseCatalog(RAW);
    expect(searchPlugins(available, '').map((p) => p.id)).toEqual(['a@m', 'b@m']);
    expect(searchPlugins(available, 'testes').map((p) => p.id)).toEqual(['b@m']);
    expect(searchPlugins(available, 'nada disso')).toEqual([]);
  });
});
