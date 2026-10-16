// Service Worker do IndyCar Atendimento — é o que torna o app instalável
// e faz a casca abrir rápido mesmo com internet ruim na oficina.
// Versão nova a cada mudança da tela: o "activate" apaga os caches antigos.
//
// Rodada 4 (14/10/2026): o Render gratuito às vezes dorme e responde 503
// "hibernate-wake-error" por minutos. Antes, a página desse 503 ia direto
// para a tela (fetch não falha em 503 — só em falta de rede). Agora:
//  - página e arquivos nossos: rede primeiro (versão nova chega na hora e a
//    página nova nunca roda com JS velho), com limite de 4 s (página) / 3 s
//    (arquivos); demorou, deu 5xx/4xx ou caiu → cópia do cache.
// As conversas vêm direto do Supabase (que não dorme), então com a casca de pé
// o atendente segue lendo e respondendo enquanto o servidor acorda.
const CACHE = 'indycar-atendimento-v16';

/* Rodada 5 (Central): o service worker pode estar servido em /atendimento/sw.js. Tudo é
   relativo à pasta dele (RAIZ): a casca, os arquivos e a fronteira do /api/. */
const RAIZ = self.location.pathname.replace(/sw\.js$/, '');

/* Se QUALQUER item desta lista faltar, o addAll rejeita e o service worker
   NÃO instala — o app deixa de ser instalável sem dizer por quê. Mantenha
   aqui só o que existe de verdade (o copiloto.js/.css do painel da IA também). */
const ARQUIVOS = ['', 'styles.css', 'apps.js', 'rede.js', 'vendor/supabase.js', 'app.js', 'acesso.js', 'equipe.js', 'tarefas.js',
                  'ajuda.js', 'casca.js', 'copiloto.js', 'copiloto.css', 'manifest.json', 'logo.png',
                  'icon-192.png', 'icon-512.png'];
const CORE = ARQUIVOS.map((u) => RAIZ + u);
const LIMITE_PAGINA_MS = 4000;

self.addEventListener('install', (e) => {
  // cache:'reload' = baixa do servidor de verdade, sem pegar do cache HTTP velho
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('indycar-atendimento-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Resposta "boa" para guardar: 200 do nosso próprio servidor. Um 503 do
   roteador do Render (ou um 404 passageiro) nunca entra no cache. */
const boa = (r) => r && r.ok && r.type === 'basic';

function guardar(chave, r) {
  const cp = r.clone();
  caches.open(CACHE).then((c) => c.put(chave, cp)).catch(() => {});
}

const PAGINA_OFFLINE = () => new Response('<!doctype html><meta charset="utf-8"><title>IndyCar · Atendimento</title>'
  + '<body style="font-family:system-ui;background:#0a0a0b;color:#f5f5f7;display:grid;place-items:center;height:100vh;margin:0;text-align:center">'
  + '<div><h1 style="font-size:1.3rem">Sem conexão com o Atendimento</h1><p>Confira a internet. Esta página tenta de novo sozinha.</p>'
  + '<script>setTimeout(function(){location.reload()},15000)</script></div>',
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/* Rede primeiro, com limite. Rede boa → guarda e entrega. Demorou, caiu ou
   veio 5xx (servidor dormindo) → cópia do cache; sem cópia, o que veio. */
function redePrimeiro(req, chave, limiteMs, ehPagina) {
  return new Promise((resolve) => {
    let entregue = false;
    const doCache = () => caches.match(chave, { ignoreSearch: ehPagina }).then((m) => m || (ehPagina ? caches.match(RAIZ) : null));
    const entregar = (r) => { if (!entregue && r) { entregue = true; resolve(r); } };
    const t = setTimeout(() => doCache().then((m) => entregar(m)), limiteMs);
    fetch(req).then((r) => {
      if (boa(r)) { guardar(chave, r); clearTimeout(t); return entregar(r); }
      return doCache().then((m) => { clearTimeout(t); entregar(m || r); });
    }).catch(() => doCache().then((m) => {
      clearTimeout(t);
      entregar(m || (ehPagina ? PAGINA_OFFLINE() : Response.error()));
    }));
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  /* NUNCA servir /api/ do cache. Conversa de cliente e situação da conexão
     mudam a cada minuto; mostrar resposta velha aqui faria o atendente
     responder com base em mensagem que já não vale. Também não mexe em
     nada de fora (Supabase, fontes, CDN): o navegador cuida sozinho. */
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(RAIZ + 'api/')) return;
  if (!url.pathname.startsWith(RAIZ)) return;   // outro app montado no mesmo domínio (Central): não é nosso

  // a página em si (com ?conversa=… ou não) cai sempre na mesma casca (a RAIZ)
  const ehPagina = e.request.mode === 'navigate';
  e.respondWith(redePrimeiro(e.request, ehPagina ? RAIZ : e.request, ehPagina ? LIMITE_PAGINA_MS : 3000, ehPagina));
});

/* A tela pergunta a versão (casca.js mostra em "Ajuda"). */
self.addEventListener('message', (e) => {
  if (e.data === 'versao' && e.ports && e.ports[0]) e.ports[0].postMessage(CACHE);
});

/* Clique na notificação de mensagem nova (quando vier pelo service worker):
   traz o painel para a frente já na conversa. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const alvo = e.notification.data?.url || RAIZ;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    const aberta = lista.find((c) => new URL(c.url).origin === self.location.origin);
    if (aberta) { aberta.focus(); return aberta.navigate ? aberta.navigate(alvo) : null; }
    return self.clients.openWindow(alvo);
  }));
});
