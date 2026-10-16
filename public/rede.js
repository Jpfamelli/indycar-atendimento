/* ============================================================
   IndyCar Atendimento — rede.js (rodada 4)
   O Render gratuito às vezes dorme e responde 503 "hibernate-wake-error"
   por alguns minutos. Este módulo fica na frente de TODA chamada ao nosso
   servidor (/api/…) e:
   - reconhece quando a resposta NÃO veio do app (502/503/504 do roteador do
     Render, página HTML no lugar do JSON, falha de rede);
   - tenta de novo sozinho, esperando cada vez um pouco mais (até ~3 min);
   - mostra a faixa "O sistema está acordando…" com contagem e "Tentar agora";
   - avisa quando o sistema voltou (evento `indycar:servidor`);
   - nunca entrega HTML para quem espera JSON: se desistir, devolve um JSON
     com erro em português claro.
   As conversas continuam funcionando enquanto isso: elas vêm direto do
   Supabase, que não dorme. Só envio pelo WhatsApp, IA e equipe esperam.

   Regras puras no topo (testadas em test/rede.test.js); o resto só no navegador.
   ============================================================ */
(function (raiz) {
  'use strict';

  /* Espera entre tentativas, em segundos: soma 180 s (3 min). */
  const ESPERAS = [2, 3, 5, 8, 12, 15, 20, 25, 30, 30, 30];
  const TETO_MS = 180_000;
  const STATUS_DO_ROTEADOR = new Set([502, 503, 504]);
  const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

  function proximaEspera(tentativa) {
    const i = Math.max(0, Math.min(tentativa | 0, ESPERAS.length - 1));
    return ESPERAS[i] * 1000;
  }

  /**
   * O que fazer com uma resposta (ou falha) do servidor.
   *  'ok'        → entrega para quem chamou (inclui 4xx/5xx do PRÓPRIO app);
   *  'acordando' → o servidor não está de pé: espera e tenta de novo;
   *  'falha'     → não dá para repetir com segurança (POST que pode ter chegado).
   * Resposta do app = tem o cabeçalho X-IndyCar-App. 503 sem ele é o roteador
   * do Render dizendo que o processo não acordou: o pedido nunca chegou ao app,
   * então repetir é seguro até para POST. 502/504 sem ele são ambíguos para
   * POST (o app pode ter recebido) — só repete se o pedido for idempotente.
   */
  function classificar({ status = 0, doApp = false, erroRede = false, metodo = 'GET', idempotente = false } = {}) {
    const seguro = SEGUROS.has(String(metodo).toUpperCase()) || idempotente;
    if (erroRede) return seguro ? 'acordando' : 'falha';
    if (doApp) return 'ok';
    if (STATUS_DO_ROTEADOR.has(status)) return (seguro || status === 503) ? 'acordando' : 'falha';
    return 'ok';
  }

  /** Texto da faixa: "tentando de novo em 8 s (3ª tentativa)". */
  function textoDaEspera(ms, tentativa) {
    const s = Math.max(1, Math.round(ms / 1000));
    return `tentando de novo em ${s} s` + (tentativa > 0 ? ` (${tentativa + 1}ª tentativa)` : '');
  }

  /** Corpo do JSON que a tela recebe quando o servidor não acordou a tempo. */
  function erroAmigavel(tipo, status) {
    if (tipo === 'acordando') return { ok: false, codigo: 'servidor_acordando', status: status || 503,
      erro: 'O sistema está acordando e ainda não respondeu. Já tentei por 3 minutos — tente de novo daqui a pouco.' };
    if (tipo === 'rede') return { ok: false, codigo: 'sem_conexao', status: 0,
      erro: 'Sem conexão com o sistema. Confira a internet e tente de novo.' };
    return { ok: false, codigo: 'servidor_fora', status: status || 502,
      erro: `O sistema não respondeu (erro ${status || 502}). Tente de novo em instantes.` };
  }

  const PURO = { ESPERAS, TETO_MS, proximaEspera, classificar, textoDaEspera, erroAmigavel };
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = PURO;
    return;
  }

  /* ======================= navegador ======================= */
  const fetchOriginal = raiz.fetch.bind(raiz);
  let estado = 'ok';               // 'ok' | 'acordando' | 'parado'
  let desde = 0;                   // quando começou a cair
  let esperando = 0;               // pedidos parados esperando o servidor
  let proximaEm = 0, tentativaAtual = 0;
  let acordar = null, acordarResolve = null;    // promessa compartilhada: "voltou" ou "tente agora"
  let sondaTimer = null, relogio = null;
  const ouvintes = new Set();

  const novaPromessaDeAcordar = () => { acordar = new Promise(r => { acordarResolve = r; }); };
  novaPromessaDeAcordar();
  const despertar = () => { const r = acordarResolve; novaPromessaDeAcordar(); r && r(); };

  function avisar(extra = {}) {
    const det = { estado, desde, esperando, proximaEm, tentativa: tentativaAtual, ...extra };
    ouvintes.forEach(cb => { try { cb(det); } catch { /* ignora */ } });
    try { raiz.dispatchEvent(new CustomEvent('indycar:servidor', { detail: det })); } catch { /* ignora */ }
    pintar(det);
  }

  function marcarAcordando(ms, tentativa) {
    proximaEm = Date.now() + ms; tentativaAtual = tentativa;
    if (estado === 'ok') { estado = 'acordando'; desde = Date.now(); }
    else if (estado === 'parado') estado = 'acordando';
    avisar();
  }
  function marcarVolta() {
    if (estado === 'ok') return;
    const fora = Date.now() - desde;
    estado = 'ok'; desde = 0; tentativaAtual = 0; proximaEm = 0;
    clearTimeout(sondaTimer); sondaTimer = null;
    despertar();
    avisar({ voltou: true, foraMs: fora });
  }
  function marcarParado() {
    if (esperando > 0) return;           // ainda tem pedido tentando: segue "acordando"
    estado = 'parado'; proximaEm = 0;
    avisar();
    sondarDepois(30_000);
  }

  /* Com a tela parada (ninguém esperando), uma sonda leve em /api/status
     descobre quando o servidor voltou — e a tela reage (fila de entregas,
     faixa some, aviso "voltou"). */
  function sondarDepois(ms) {
    clearTimeout(sondaTimer);
    sondaTimer = setTimeout(sondar, ms);
    if (estado === 'acordando' && esperando === 0) { proximaEm = Date.now() + ms; atualizarRelogio(); }
  }
  async function sondar() {
    sondaTimer = null;
    if (estado === 'ok') return true;
    try {
      const r = await fetchOriginal(BASE() + 'api/status', { cache: 'no-store' });
      if (r.headers.get('x-indycar-app') || (r.ok && /json/.test(r.headers.get('content-type') || ''))) { marcarVolta(); return true; }
    } catch { /* ainda fora */ }
    if (estado !== 'ok' && esperando === 0) sondarDepois(estado === 'parado' ? 30_000 : 10_000);
    return false;
  }

  function esperar(ms, sinal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(fim, ms);
      const aoOnline = () => fim();
      function fim() { clearTimeout(t); raiz.removeEventListener('online', aoOnline); sinal?.removeEventListener?.('abort', aoAbortar); resolve(); }
      function aoAbortar() { clearTimeout(t); raiz.removeEventListener('online', aoOnline); reject(new DOMException('Abortado', 'AbortError')); }
      raiz.addEventListener('online', aoOnline);
      if (sinal) { if (sinal.aborted) return aoAbortar(); sinal.addEventListener('abort', aoAbortar, { once: true }); }
      acordar.then(fim);
    });
  }

  const sintetica = (corpo) => new Response(JSON.stringify(corpo), {
    status: corpo.status || 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-IndyCar-Sintetica': '1' } });

  /* Rodada 5 (Central): o app pode estar montado num prefixo (/atendimento/). O prefixo vem do
     <base href> (apps.js). Um pedido escrito como '/api/eu' vira '<prefixo>api/eu' aqui, num lugar
     só — toda a tela continua escrevendo '/api/…' e funciona em qualquer montagem. */
  const BASE = () => (raiz.IndyCarApps && raiz.IndyCarApps.base) || '/';
  function noPrefixo(input) {
    if (typeof input !== 'string') return input;
    if (BASE() === '/' || !input.startsWith('/api/')) return input;
    return BASE() + input.slice(1);
  }
  function ehDoNossoServidor(input) {
    try {
      const u = new URL(typeof input === 'string' ? input : (input && input.url) || String(input), location.href);
      const api = BASE() + 'api/';
      return u.origin === location.origin && u.pathname.startsWith(api) && u.pathname !== api + '_mock';
    } catch { return false; }
  }

  /**
   * fetch com novas tentativas. Opções extras (fora do padrão do fetch):
   *  tetoMs      — quanto tempo no máximo insistir (padrão 3 min; 0 = não insiste);
   *  idempotente — repetir é seguro mesmo para POST (também pelo cabeçalho X-Idempotente: 1).
   */
  async function fetchComRetentativa(input, init = {}) {
    input = noPrefixo(input);
    if (!ehDoNossoServidor(input)) return fetchOriginal(input, init);
    const metodo = String(init.method || (input && input.method) || 'GET').toUpperCase();
    let idempotente = !!init.idempotente;
    try { idempotente = idempotente || new Headers(init.headers || undefined).get('x-idempotente') === '1'; } catch { /* ignora */ }
    const teto = Number.isFinite(init.tetoMs) ? init.tetoMs : TETO_MS;
    const { tetoMs: _t, idempotente: _i, ...limpo } = init;
    const inicio = Date.now();
    for (let tentativa = 0; ; tentativa++) {
      let resp = null, erroRede = null;
      try { resp = await fetchOriginal(input, limpo); }
      catch (e) { if (e && e.name === 'AbortError') throw e; erroRede = e || new Error('falha de rede'); }
      const doApp = !!resp?.headers?.get('x-indycar-app');
      const c = classificar({ status: resp?.status, doApp, erroRede: !!erroRede, metodo, idempotente });
      if (c === 'ok') {
        if (doApp || (resp && resp.ok)) marcarVolta();
        return resp;
      }
      if (c === 'falha') {
        if (erroRede) throw new TypeError(erroAmigavel('rede').erro);
        return sintetica(erroAmigavel('fora', resp.status));
      }
      // acordando: espera e tenta de novo (enquanto couber no teto)
      const espera = proximaEspera(tentativa);
      if (Date.now() - inicio + espera > teto) {
        if (teto > 0) marcarParado(); else if (estado === 'ok') { estado = 'acordando'; desde = Date.now(); avisar(); sondarDepois(5_000); }
        if (erroRede && navigator.onLine === false) throw new TypeError(erroAmigavel('rede').erro);
        return sintetica(erroAmigavel('acordando', resp?.status));
      }
      esperando++;
      marcarAcordando(espera, tentativa);
      try { await esperar(espera, limpo.signal); }
      finally { esperando--; }
    }
  }

  /* ---------------- faixa "acordando" ---------------- */
  let faixa = null;
  function montarFaixa() {
    if (faixa || !document.body) return faixa;
    faixa = document.createElement('div');
    faixa.className = 'faixa-servidor';
    faixa.id = 'faixaServidor';
    faixa.hidden = true;
    faixa.setAttribute('role', 'region');
    faixa.setAttribute('aria-label', 'Situação do sistema');
    /* Leitor de tela: anuncia só a MUDANÇA de estado (título); a contagem que muda
       a cada segundo fica fora do anúncio — senão ele fala sem parar. */
    faixa.innerHTML = '<span class="fs-giro" aria-hidden="true"></span>'
      + '<span class="fs-textos"><b class="fs-titulo" role="status" aria-live="polite">O sistema está acordando…</b>'
      + '<span class="fs-sub" aria-live="off">As conversas continuam aqui. Envio pelo WhatsApp e IA voltam sozinhos.</span></span>'
      + '<button type="button" class="fs-btn">Tentar agora</button>';
    faixa.querySelector('.fs-btn').addEventListener('click', tentarAgora);
    document.body.appendChild(faixa);
    return faixa;
  }
  let escondeT = null;
  function pintar(det) {
    const f = montarFaixa();
    if (!f) return;
    clearTimeout(escondeT);
    const titulo = f.querySelector('.fs-titulo'), sub = f.querySelector('.fs-sub'), btn = f.querySelector('.fs-btn');
    if (det.voltou) {
      f.className = 'faixa-servidor voltou';
      titulo.textContent = '✅ O sistema voltou';
      sub.textContent = det.foraMs > 60_000 ? `Ficou fora por ${Math.round(det.foraMs / 60_000)} min. Tudo que estava esperando seguiu.` : 'Tudo que estava esperando seguiu.';
      btn.hidden = true; f.hidden = false;
      escondeT = setTimeout(() => { f.hidden = true; }, 3500);
      return;
    }
    if (det.estado === 'ok') { f.hidden = true; return; }
    // sem internet quem avisa é a faixa de offline (a do app); esta fica quieta
    if (navigator.onLine === false) { f.hidden = true; return; }
    f.className = 'faixa-servidor' + (det.estado === 'parado' ? ' parado' : '');
    btn.hidden = false;
    titulo.textContent = det.estado === 'parado' ? 'O sistema não respondeu ainda' : 'O sistema está acordando…';
    f.hidden = false;
    atualizarRelogio();
    clearInterval(relogio);
    if (det.estado === 'acordando') relogio = setInterval(atualizarRelogio, 1000);
  }
  function atualizarRelogio() {
    if (!faixa) return;
    const sub = faixa.querySelector('.fs-sub');
    if (estado === 'ok') { clearInterval(relogio); return; }
    if (estado === 'parado') {
      sub.textContent = 'Continuo conferindo sozinho a cada 30 s. As conversas continuam aqui; o que não saiu fica guardado.';
      clearInterval(relogio); return;
    }
    const falta = proximaEm - Date.now();
    sub.textContent = 'As conversas continuam aqui — ' + (falta > 0 ? textoDaEspera(falta, tentativaAtual) : 'tentando agora…') + '.';
  }
  function tentarAgora() {
    if (estado === 'parado' || esperando === 0) { sondar(); }
    despertar();
  }

  raiz.addEventListener('online', () => { if (estado !== 'ok') { despertar(); if (!esperando) sondar(); } });
  raiz.addEventListener('offline', () => faixa && pintar({ estado }));

  /* Velocidade: já abre a conexão com o Supabase (endereço da configuração guardada)
     enquanto o resto da tela carrega — o primeiro pedido ao banco sai mais rápido. */
  try {
    const cfg = JSON.parse(localStorage.getItem('indycar_cfg_publica') || 'null');
    const u = cfg && new URL(cfg.supabaseUrl);
    if (u && u.protocol === 'https:' && document.head) {
      const l = document.createElement('link'); l.rel = 'preconnect'; l.href = u.origin; l.crossOrigin = '';
      document.head.appendChild(l);
    }
  } catch { /* sem cópia: segue normal */ }

  raiz.fetch = fetchComRetentativa;
  raiz.Rede = {
    ...PURO,
    fetch: fetchComRetentativa,
    fetchOriginal,
    noPrefixo,
    get estado() { return estado; },
    get esperando() { return esperando; },
    aoMudar(cb) { ouvintes.add(cb); return () => ouvintes.delete(cb); },
    tentarAgora,
    sondar,
    /** O boot usou a configuração guardada (servidor fora): mostra a faixa e fica de olho. */
    vigiarAteVoltar() {
      if (estado === 'ok') { estado = 'acordando'; desde = Date.now(); }
      avisar(); sondarDepois(3_000);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
