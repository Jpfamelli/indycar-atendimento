// Service Worker do IndyCar Atendimento — é o que torna o app instalável
// e faz a casca abrir rápido mesmo com internet ruim na oficina.
// Versão nova a cada mudança da tela: o "activate" apaga os caches antigos.
const CACHE = 'indycar-atendimento-v12';

/* Se QUALQUER item desta lista faltar, o addAll rejeita e o service worker
   NÃO instala — o app deixa de ser instalável sem dizer por quê. Mantenha
   aqui só o que existe de verdade (o copiloto.js/.css do painel da IA também). */
const CORE = ['/', '/styles.css', '/app.js', '/copiloto.js', '/copiloto.css', '/manifest.json', '/logo.png',
              '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  /* NUNCA servir /api/ do cache. Conversa de cliente e situação da conexão
     mudam a cada minuto; mostrar resposta velha aqui faria o atendente
     responder com base em mensagem que já não vale. Também não mexe em
     nada de fora (Supabase, fontes, CDN): o navegador cuida sozinho. */
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // a página em si (com ?conversa=… ou não) cai sempre na mesma casca "/"
  const ehPagina = e.request.mode === 'navigate';

  // estático: rede primeiro (pega a versão nova), cache só quando cai
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        /* Só guarda resposta BOA: antes um 404/500 passageiro ficava no cache
           e era servido quando a rede caía. */
        if (r.ok && r.type === 'basic') {
          const cp = r.clone();
          caches.open(CACHE).then((c) => c.put(ehPagina ? '/' : e.request, cp));
        }
        return r;
      })
      .catch(() => caches.match(ehPagina ? '/' : e.request, { ignoreSearch: ehPagina })
        .then((m) => m || (ehPagina ? caches.match('/') : Response.error())))
  );
});

/* Clique na notificação de mensagem nova (quando vier pelo service worker):
   traz o painel para a frente já na conversa. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const alvo = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    const aberta = lista.find((c) => new URL(c.url).origin === self.location.origin);
    if (aberta) { aberta.focus(); return aberta.navigate ? aberta.navigate(alvo) : null; }
    return self.clients.openWindow(alvo);
  }));
});
