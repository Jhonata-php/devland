// Nome antigo (Habblaud): as variáveis HABBLAUD_* valem como DEVLAND_* quando a nova não está definida (Velix, .env e
// scripts que já existiam). As do Habblaud World (HABBLAUD_WORLD*) seguem com o nome antigo. Importado antes de tudo.
for (const [k, v] of Object.entries(process.env)) {
  if (!k.startsWith('HABBLAUD_') || k.startsWith('HABBLAUD_WORLD')) continue;
  const next = `DEVLAND_${k.slice('HABBLAUD_'.length)}`;
  if (process.env[next] === undefined) process.env[next] = v;
}
