// Service worker do Habblaud: recebe as notificações push do servidor (um agente terminou ou precisa de você) e as mostra, mesmo
// com a página fechada (iPhone: o Habblaud precisa estar na Tela de Início). Tocar na notificação abre/foca o Habblaud.
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
      data: { url: '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow('/');
    }),
  );
});
