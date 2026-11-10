import { describe, expect, it } from 'vitest';
import { audioFileName, createOpenAITranscriber, openAIKeyFromEnv } from './openai';

describe('ditado pela OpenAI', () => {
  it('chave do ambiente (HABBLAUD_ vale mais)', () => {
    expect(openAIKeyFromEnv({ OPENAI_API_KEY: ' a ' })).toBe('a');
    expect(openAIKeyFromEnv({ OPENAI_API_KEY: 'a', HABBLAUD_OPENAI_API_KEY: 'b' })).toBe('b');
    expect(openAIKeyFromEnv({})).toBeUndefined();
  });
  it('nome do arquivo pelo tipo gravado', () => {
    expect(audioFileName('audio/mp4')).toBe('audio.m4a');
    expect(audioFileName('audio/webm;codecs=opus')).toBe('audio.webm');
    expect(audioFileName('audio/ogg;codecs=opus')).toBe('audio.ogg');
  });
  it('manda o áudio e devolve texto e idioma', async () => {
    let auth = '';
    const fake = (async (_url: string, init: RequestInit) => {
      auth = String((init.headers as Record<string, string>).Authorization);
      expect(init.body).toBeInstanceOf(FormData);
      return new Response(JSON.stringify({ text: ' olá mundo ', language: 'portuguese' }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = createOpenAITranscriber('k', 'whisper-1', fake);
    expect(await t(Buffer.from('x'), 'audio/mp4')).toEqual({ text: 'olá mundo', lang: 'pt' });
    expect(auth).toBe('Bearer k');
  });
  it('erro da API vira exceção com a mensagem', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { message: 'chave inválida' } }), { status: 401 })) as unknown as typeof fetch;
    await expect(createOpenAITranscriber('k', 'whisper-1', fake)(Buffer.from('x'), 'audio/webm')).rejects.toThrow('OpenAI 401: chave inválida');
  });
});
