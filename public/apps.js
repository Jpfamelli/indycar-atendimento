/* ============================================================
   IndyCar — apps.js (rodada 5): o ÚNICO lugar com os endereços dos apps
   do ecossistema e com o prefixo em que ESTE app está montado.

   Carrega antes de tudo (até do rede.js). Expõe:
     IndyCarApps.base            → "/" hoje; "/atendimento/" dentro da Central
     IndyCarApps.caminho('api/eu') ou ('/api/eu') → caminho dentro do prefixo
     IndyCarApps.url('?conversa=x') → endereço absoluto deste app
     IndyCarApps.apps            → { atendimento, crm, agenda, comunicar, orcador, site, patio, ads }
     IndyCarApps.link(app, '/?lead=x') → endereço no outro app (links do sino, da ficha…)

   O prefixo vem do <base href> que o servidor injeta no index.html (a Central
   monta cada app num caminho e o servidor põe a base certa). Sem base, "/".
   Quando a Central (onda B2) entrar no ar, basta trocar os endereços aqui.
   ============================================================ */
(function (raiz) {
  'use strict';
  function baseDoDocumento() {
    try {
      const b = document.querySelector('base[href]');
      const u = new URL(b ? b.getAttribute('href') : '.', location.href);
      let p = u.pathname || '/';
      if (!p.endsWith('/')) p = p.slice(0, p.lastIndexOf('/') + 1) || '/';
      return p;
    } catch { return '/'; }
  }
  const base = typeof document !== 'undefined' ? baseDoDocumento() : '/';

  /* Endereços atuais (produção). A Central vai servir tudo sob um domínio só:
     aí estes valores viram "https://indycar-agendamentos.onrender.com/crm/" etc. */
  const apps = {
    atendimento: { nome: 'Atendimento',  ico: '💬', url: 'https://indycar-atendimento.onrender.com' },
    crm:         { nome: 'CRM',          ico: '📈', url: 'https://indycar-crm.onrender.com' },
    agenda:      { nome: 'Agenda',       ico: '📅', url: 'https://indycar-agendamentos.onrender.com' },
    comunicar:   { nome: 'Comunicar',    ico: '📣', url: 'https://indycar-posvenda.onrender.com' },
    orcador:     { nome: 'Orçador',      ico: '🧾', url: 'https://indycar-orcador.netlify.app' },
    patio:       { nome: 'Pátio',        ico: '🔧', url: 'https://indycar-patio.netlify.app' },
    site:        { nome: 'Site',         ico: '🌐', url: 'https://indycar-taubate.netlify.app' },
    ads:         { nome: 'Tráfego pago', ico: '🎯', url: null },   // ainda não publicado
  };
  /* Dentro da Central, o próprio Atendimento é "o lugar onde estou": o endereço dele
     passa a ser a origem atual + o prefixo (não o onrender antigo). */
  try {
    if (typeof location !== 'undefined' && base !== '/' && /^https?:/.test(location.origin)) {
      apps.atendimento.url = location.origin + base.replace(/\/$/, '');
    }
  } catch { /* fora do navegador */ }

  /** Caminho dentro do prefixo: caminho('api/eu') e caminho('/api/eu') → "/atendimento/api/eu". */
  function caminho(p) {
    const s = String(p || '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return s;      // absoluto (outro domínio)
    return base + s.replace(/^\/+/, '');
  }
  /** Endereço absoluto deste app (para copiar/compartilhar). */
  function url(p = '') {
    try { return new URL(caminho(p), location.href).href; } catch { return caminho(p); }
  }
  /** Endereço em outro app do ecossistema; `rel` é "/?lead=x" ou "?tel=…". */
  function link(app, rel = '') {
    const a = apps[app];
    if (!a || !a.url) return null;
    const r = String(rel || '');
    if (!r) return a.url;
    return a.url.replace(/\/$/, '') + (r.startsWith('/') || r.startsWith('?') || r.startsWith('#') ? r : '/' + r);
  }
  /** Lista para seletores/menus: só os apps publicados, na ordem da casa. */
  function lista() {
    return ['agenda', 'crm', 'atendimento', 'comunicar', 'orcador', 'patio', 'site'].map(k => ({ chave: k, ...apps[k] })).filter(a => a.url);
  }

  raiz.IndyCarApps = { base, apps, caminho, url, link, lista, atual: 'atendimento' };
  if (typeof module !== 'undefined') module.exports = raiz.IndyCarApps;
})(typeof window !== 'undefined' ? window : globalThis);
