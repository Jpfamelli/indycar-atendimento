/* ============================================================
   SEGURANÇA DO SERVIDOR (regras puras + utilidades HTTP)
   - cabeçalhos (CSP com hash dos <script> embutidos, HSTS, nosniff…)
   - CORS só para os apps do ecossistema IndyCar
   - limites por IP e por usuário (janela deslizante, memória limitada)
   - leitura de corpo JSON com limite e JSON inválido → 400
   - validações (UUID, e-mail, texto, data, inteiro, lista)
   - erro seguro: o cliente recebe um código, o detalhe fica no log
   Tudo testado em test/seguranca.test.js.
   ============================================================ */
'use strict';

const crypto = require('node:crypto');

/* Apps do ecossistema que podem chamar o servidor pelo navegador
   (mesmo login do Supabase). Qualquer outra origem fica sem CORS. */
const ORIGENS_ECOSSISTEMA = new Set([
  'https://indycar-crm.onrender.com', 'https://indycar-agendamentos.onrender.com',
  'https://indycar-posvenda.onrender.com', 'https://indycar-orcador.netlify.app',
  'https://indycar-atendimento.onrender.com', 'https://indycar-ads.onrender.com',
  'http://localhost:3100', 'http://localhost:3110', 'http://localhost:3000', 'http://localhost:3500',
  'http://localhost:3510', 'http://localhost:3200', 'http://localhost:3210', 'http://localhost:3211',
]);

const METODOS_CORS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

/** Cabeçalhos CORS para a origem (vazio se a origem não é do ecossistema). */
function cabecalhosCors(origem, { preflight = false } = {}) {
  if (!origem || !ORIGENS_ECOSSISTEMA.has(origem)) return {};
  const cab = { 'Access-Control-Allow-Origin': origem, Vary: 'Origin' };
  if (preflight) Object.assign(cab, {
    'Access-Control-Allow-Methods': METODOS_CORS,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  });
  return cab;
}

/** sha256 em base64 de cada <script> embutido (sem src) de um HTML. */
function hashesDosScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    out.push(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  return out;
}

/** CSP da interface. `supabaseUrl` entra em connect/img/media (anexos assinados e tempo real). */
function politicaCSP({ supabaseUrl = '', hashes = [] } = {}) {
  let sb = '', sbWs = '';
  try {
    const u = new URL(supabaseUrl);
    sb = `${u.protocol}//${u.host}`;
    sbWs = `wss://${u.host}`;
  } catch { /* sem Supabase configurado: só 'self' */ }
  const dir = {
    'default-src': ["'self'"],
    'script-src': ["'self'", 'https://cdn.jsdelivr.net', ...hashes],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    'img-src': ["'self'", 'data:', 'blob:', sb].filter(Boolean),
    'media-src': ["'self'", 'blob:', 'data:', sb].filter(Boolean),
    'connect-src': ["'self'", sb, sbWs, 'https://cdn.jsdelivr.net'].filter(Boolean),
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'frame-ancestors': ["'none'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  return Object.entries(dir).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

/** Cabeçalhos comuns a TODA resposta (API e arquivos). */
function cabecalhosBase({ https = false } = {}) {
  const cab = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    // microfone fica liberado para o próprio app (botão 🎤); o resto, desligado
    'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self), interest-cohort=()',
  };
  if (https) cab['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return cab;
}

/** Aplica cabeçalhos numa resposta antes do writeHead (setHeader respeita os do writeHead). */
function aplicarCabecalhos(res, cab) {
  for (const [k, v] of Object.entries(cab)) if (!res.headersSent && !res.hasHeader(k)) res.setHeader(k, v);
}

/* ------------------------------------------------------------
   IP do cliente. No Render o processo fica atrás do proxy, que
   põe o IP real no INÍCIO do X-Forwarded-For. Fora da nuvem o
   cabeçalho é ignorado (qualquer um poderia forjá-lo).
   ------------------------------------------------------------ */
function ipDoCliente(req, { confiarProxy = false } = {}) {
  if (confiarProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff && /^[0-9a-f:.]{3,45}$/i.test(xff)) return xff;
  }
  return String(req.socket?.remoteAddress || 'desconhecido').replace(/^::ffff:/, '');
}

/* ------------------------------------------------------------
   Limitador por chave (IP, usuário, rota). Janela fixa por chave,
   memória limitada: ao passar do teto de chaves, joga fora as que
   já venceram e, se ainda faltar espaço, as mais antigas — antes
   o Map era zerado inteiro, o que liberava todo mundo de uma vez.
   ------------------------------------------------------------ */
function criarLimitador({ maxChaves = 5000, agora = () => Date.now() } = {}) {
  const uso = new Map();   // chave -> { qtd, zeraEm }
  function limpar() {
    const t = agora();
    for (const [k, v] of uso) if (v.zeraEm <= t) uso.delete(k);
    while (uso.size >= maxChaves) uso.delete(uso.keys().next().value);
  }
  /** true = pode; false = passou do teto nesta janela. */
  function permitir(chave, teto, janelaMs) {
    const t = agora();
    const atual = uso.get(chave);
    if (!atual || atual.zeraEm <= t) {
      if (uso.size >= maxChaves) limpar();
      uso.set(chave, { qtd: 1, zeraEm: t + janelaMs });
      return true;
    }
    if (atual.qtd >= teto) return false;
    atual.qtd++;
    return true;
  }
  /** Quantos segundos faltam para a chave liberar (para o Retry-After). */
  function espera(chave) {
    const a = uso.get(chave);
    return a ? Math.max(1, Math.ceil((a.zeraEm - agora()) / 1000)) : 0;
  }
  /** Conta sem bloquear (ex.: falhas de login por IP). */
  function contar(chave, janelaMs) {
    const t = agora();
    const a = uso.get(chave);
    if (!a || a.zeraEm <= t) { if (uso.size >= maxChaves) limpar(); uso.set(chave, { qtd: 1, zeraEm: t + janelaMs }); return 1; }
    return ++a.qtd;
  }
  const quantas = chave => { const a = uso.get(chave); return a && a.zeraEm > agora() ? a.qtd : 0; };
  return { permitir, espera, contar, quantas, tamanho: () => uso.size, zerar: () => uso.clear() };
}

/* ------------------------------------------------------------
   Corpo JSON
   ------------------------------------------------------------ */
class ErroHttp extends Error {
  constructor(status, erro, codigo) { super(erro); this.status = status; this.erro = erro; this.codigo = codigo; }
}

/** Lê o corpo como JSON. Vazio = {}. Inválido = ErroHttp 400. Grande = ErroHttp 413.
    Só aceita objeto ou lista no topo (um número solto não é corpo de API). */
function lerCorpoJson(req, { limite = 1e6 } = {}) {
  return new Promise((resolve, reject) => {
    const declarado = Number(req.headers['content-length']);
    if (Number.isFinite(declarado) && declarado > limite) {
      req.resume();                                  // drena para a resposta conseguir sair
      return reject(new ErroHttp(413, 'Conteúdo grande demais para esta rota.', 'corpo_grande'));
    }
    const partes = []; let total = 0, excedeu = false;
    req.on('data', c => {
      if (excedeu) return;
      total += c.length;
      if (total > limite) { excedeu = true; partes.length = 0; reject(new ErroHttp(413, 'Conteúdo grande demais para esta rota.', 'corpo_grande')); return; }
      partes.push(c);
    });
    req.on('end', () => {
      if (excedeu) return;
      const txt = Buffer.concat(partes).toString('utf8').replace(/^﻿/, '');
      if (!txt.trim()) return resolve({});
      try {
        const v = JSON.parse(txt);
        if (v === null || typeof v !== 'object') return reject(new ErroHttp(400, 'O corpo precisa ser um objeto JSON.', 'json_invalido'));
        resolve(v);
      } catch { reject(new ErroHttp(400, 'JSON inválido no corpo da requisição.', 'json_invalido')); }
    });
    req.on('error', () => reject(new ErroHttp(400, 'Falha ao ler o corpo.', 'corpo_ilegivel')));
  });
}

/* ------------------------------------------------------------
   Validações
   ------------------------------------------------------------ */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = v => typeof v === 'string' && RE_UUID.test(v);
const ehEmail = v => typeof v === 'string' && v.length <= 160 && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i.test(v);

/** Texto limpo: só string/número; tira caracteres de controle; corta no máximo. */
function texto(v, max = 200) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

/** Inteiro entre min e max, ou `padrao`. */
function inteiro(v, { min = -Infinity, max = Infinity, padrao = null } = {}) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n) || !Number.isInteger(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}

/** AAAA-MM-DD válido (dia que existe). */
function dataISO(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** Instante ISO (com ou sem hora) → Date ou null. */
function instante(v) {
  if (typeof v !== 'string' || v.length > 40) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Lista de valores permitidos (sem repetição, na ordem da entrada). */
function listaDe(v, permitidos, { max = 20 } = {}) {
  if (!Array.isArray(v)) return null;
  const ok = new Set(permitidos);
  const out = [];
  for (const x of v.slice(0, max)) if (typeof x === 'string' && ok.has(x) && !out.includes(x)) out.push(x);
  return out;
}

/** Telefone da equipe: só dígitos, 10 a 13 (com ou sem 55). */
function telefone(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 13 ? d : null;
}

/* ------------------------------------------------------------
   Segredos: nada que pareça chave sai em log/auditoria/resposta
   ------------------------------------------------------------ */
const CHAVES_SENSIVEIS = /senha|password|secret|token|api_?key|apikey|authorization|service_?role|cw_api_key|refresh/i;

/** Copia o objeto trocando os campos sensíveis por "•••" (recursivo, com limite). */
function semSegredos(obj, prof = 0) {
  if (prof > 6 || obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.slice(0, 200).map(x => semSegredos(x, prof + 1));
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = CHAVES_SENSIVEIS.test(k) ? '•••' : semSegredos(v, prof + 1);
  return out;
}

/** Erro inesperado: o cliente recebe só um código para o suporte; o detalhe vai para o log. */
function erroSeguro(err, { log = console.error } = {}) {
  const ref = crypto.randomBytes(4).toString('hex');
  try { log(`[erro ${ref}]`, err?.stack || err?.message || err); } catch { /* log não derruba */ }
  return { erro: `Algo deu errado no servidor. Tente de novo; se continuar, avise o suporte (código ${ref}).`, codigo: 'erro_interno', ref };
}

module.exports = {
  ORIGENS_ECOSSISTEMA, METODOS_CORS, cabecalhosCors, hashesDosScripts, politicaCSP, cabecalhosBase, aplicarCabecalhos,
  ipDoCliente, criarLimitador, ErroHttp, lerCorpoJson,
  ehUuid, ehEmail, texto, inteiro, dataISO, instante, listaDe, telefone,
  CHAVES_SENSIVEIS, semSegredos, erroSeguro,
};
