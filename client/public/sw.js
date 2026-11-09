// Service worker do DevLand: recebe as notificações push do servidor (um agente terminou ou precisa de você) e as mostra, mesmo
// com a página fechada (iPhone: o DevLand precisa estar na Tela de Início). Tocar na notificação abre o agente; no Android e no computador, Permitir/Negar respondem o pedido de permissão ali mesmo.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // mensagem sem JSON: mostra o aviso genérico
  }
  // Todo push mostra uma notificação (o iOS cancela a assinatura de quem recebe push "mudo").
  event.waitUntil(
    self.registration.showNotification(data.title || 'DevLand', {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: '/assets/brand/icon-192.png',
      badge: '/assets/brand/favicon-32.png',
      data: { url: data.url || '/', permissionId: data.permissionId, labels: data.labels },
      // Android e computador: Permitir/Negar na própria notificação (o iPhone não mostra botões; tocar abre o pedido).
      actions: data.permissionId && data.labels
        ? [{ action: 'allow', title: data.labels.allow }, { action: 'deny', title: data.labels.deny }]
        : [],
    }),
  );
});

/** Responde o pedido de permissão pela notificação e avisa se deu certo. */
async function decide(data, behavior) {
  let ok = false;
  try {
    const r = await fetch(`/api/permissions/${encodeURIComponent(data.permissionId)}/decision`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ behavior }),
    });
    ok = r.ok;
  } catch {
    // sem rede: cai no aviso de falha
  }
  const labels = data.labels || {};
  await self.registration.showNotification('DevLand', {
    body: ok ? labels.done || 'OK' : labels.failed || 'Abra o DevLand para responder.',
    tag: `decided-${data.permissionId}`,
    icon: '/assets/brand/icon-192.png',
    data: { url: data.url || '/' },
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if ((event.action === 'allow' || event.action === 'deny') && data.permissionId) {
    event.waitUntil(decide(data, event.action));
    return;
  }
  const url = data.url || '/';
  // App aberto: foca e pede para ele abrir o agente; fechado: abre já no agente (?agent=).
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      if (!open) return self.clients.openWindow(url);
      open.postMessage({ devlandOpen: url });
      return open.focus();
    }),
  );
});
