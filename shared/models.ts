// Modelo do Claude Code escolhido no "Novo agente" (`claude --model <apelido>`). O apelido sempre aponta para o modelo mais
// novo da família, então a lista não precisa mudar a cada versão. Vazio = o padrão da conta. Código puro.
export const MODEL_IDS = ['fable', 'opus', 'sonnet', 'haiku'] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const isModelId = (v: unknown): v is ModelId => typeof v === 'string' && (MODEL_IDS as readonly string[]).includes(v);
