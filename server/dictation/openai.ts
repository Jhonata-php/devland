// Ditado pela API de transcrição da OpenAI (Whisper na nuvem): para o Cloud, onde não há Whisper local. Só liga com a
// chave configurada (OPENAI_API_KEY ou HABBLAUD_OPENAI_API_KEY): o áudio vai para a OpenAI, então é opt-in explícito.
// Modelo: HABBLAUD_DICTATION_MODEL (padrão whisper-1, que devolve o idioma reconhecido).
import type { Transcriber } from './whisper';

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const TIMEOUT_MS = 120_000;

/** Nome do idioma devolvido pela API ("portuguese") → código ISO ("pt"). */
const LANGS: Record<string, string> = { portuguese: 'pt', english: 'en', spanish: 'es', french: 'fr' };

export function openAIKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (env.HABBLAUD_OPENAI_API_KEY ?? env.OPENAI_API_KEY)?.trim() || undefined;
}

/** Extensão do arquivo pelo tipo gravado (a API escolhe o decodificador pelo nome). */
export function audioFileName(type: string): string {
  if (type.includes('mp4') || type.includes('aac') || type.includes('m4a')) return 'audio.m4a';
  if (type.includes('ogg')) return 'audio.ogg';
  if (type.includes('wav')) return 'audio.wav';
  if (type.includes('mpeg') || type.includes('mp3')) return 'audio.mp3';
  return 'audio.webm';
}

export function createOpenAITranscriber(apiKey: string, model = 'whisper-1', fetchFn: typeof fetch = fetch): Transcriber {
  return async (audio, type) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: type || 'application/octet-stream' }), audioFileName(type));
    form.append('model', model);
    if (model === 'whisper-1') form.append('response_format', 'verbose_json');
    const r = await fetchFn(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await r.json().catch(() => ({}))) as { text?: unknown; language?: unknown; error?: { message?: unknown } };
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${typeof body.error?.message === 'string' ? body.error.message.slice(0, 200) : 'erro'}`);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const lang = typeof body.language === 'string' ? (LANGS[body.language.toLowerCase()] ?? body.language.slice(0, 2).toLowerCase()) : '';
    return { text, lang };
  };
}
