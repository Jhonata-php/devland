import { describe, expect, it } from 'vitest';
import { findWhisper, opcoesRapidas, parseWhisperJson } from './whisper';

describe('Whisper local', () => {
  it('lê texto e idioma do JSON do whisper-cli, sem marcas de silêncio', () => {
    const raw = JSON.stringify({ result: { language: 'pt' }, transcription: [{ text: ' Crie um agente' }, { text: ' para o relatório. [BLANK_AUDIO]' }] });
    expect(parseWhisperJson(raw)).toEqual({ text: 'Crie um agente para o relatório.', lang: 'pt' });
    expect(parseWhisperJson('{}')).toEqual({ text: '', lang: '' });
  });

  it('acha binários e o melhor modelo multilíngue (nunca um .en)', () => {
    const have = new Set(['/opt/homebrew/bin/whisper-cli', '/opt/homebrew/bin/ffmpeg', '/h/.whisper/ggml-base.en.bin', '/h/.local/share/whisper/ggml-base.bin', '/h/.local/share/whisper/ggml-small.bin']);
    const setup = findWhisper({ HOME: '/h', PATH: '' }, (p) => have.has(p));
    expect(setup).toEqual({ bin: '/opt/homebrew/bin/whisper-cli', ffmpeg: '/opt/homebrew/bin/ffmpeg', model: '/h/.local/share/whisper/ggml-small.bin', langs: ['pt', 'en'] });
    have.delete('/h/.local/share/whisper/ggml-small.bin');
    have.delete('/h/.local/share/whisper/ggml-base.bin');
    expect(findWhisper({ HOME: '/h', PATH: '' }, (p) => have.has(p))).toHaveProperty('missing');
    expect(findWhisper({ HOME: '/h', PATH: '' }, () => false)).toEqual({ missing: 'whisper-cli (brew install whisper-cpp)' });
    expect(findWhisper({ HOME: '/h', PATH: '', DEVLAND_DICTATION_LANGS: 'en, pt, xx-bad' }, () => true)).toMatchObject({ langs: ['en', 'pt'] });
  });
});

describe('opcoesRapidas', () => {
  it('decodificação gulosa, sem refazer e com os núcleos (até 8); DEVLAND_WHISPER_FAST=0 desliga', () => {
    expect(opcoesRapidas({}, 4)).toEqual(['-t', '4', '-bs', '1', '-bo', '1', '-nf']);
    expect(opcoesRapidas({}, 32)).toContain('8');
    expect(opcoesRapidas({ DEVLAND_WHISPER_THREADS: '3' }, 16)).toEqual(['-t', '3', '-bs', '1', '-bo', '1', '-nf']);
    expect(opcoesRapidas({ DEVLAND_WHISPER_FAST: '0' }, 8)).toEqual([]);
  });
});
