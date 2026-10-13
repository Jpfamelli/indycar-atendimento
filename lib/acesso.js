/* ============================================================
   ACESSO — quem está chamando e se pode usar o Atendimento
   1) o token é de alguém logado? (Supabase /auth/v1/user)
   2) o perfil está ativo?                      senão 401 desativado
   3) papel de equipe (admin/gestor/atendente)? senão 403 sem_acesso_app
   4) 'atendimento' em perfis.apps (admin sempre)? senão 403 sem_acesso_app
   5) tem verificação em duas etapas? então o token precisa ser aal2
                                                senão 401 mfa_pendente
   Cache de 60 s por token (nunca além do vencimento do JWT); recusa
   lembrada por 15–30 s. Último acesso gravado no máximo a cada 5 min.
   As dependências entram por fora para testar com dublês.
   ============================================================ */
'use strict';

const APP = 'atendimento';
const PAPEIS_EQUIPE = ['admin', 'gestor', 'atendente'];
const APPS = ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'];
const CACHE_OK_MS = 60_000;
const CACHE_NEGADO_MS = 30_000;
const CACHE_BLOQUEADO_MS = 15_000;
const INTERVALO_ACESSO_MS = 5 * 60_000;
const MAX_CACHE = 2000;

const NOMES_APPS = { atendimento: 'Atendimento', crm: 'CRM', agenda: 'Agenda', comunicar: 'Comunicar', orcador: 'Orçador', ads: 'Tráfego pago' };
const LINKS_APPS = {
  atendimento: 'https://indycar-atendimento.onrender.com', crm: 'https://indycar-crm.onrender.com',
  agenda: 'https://indycar-agendamentos.onrender.com', comunicar: 'https://indycar-posvenda.onrender.com',
  orcador: 'https://indycar-orcador.netlify.app', ads: 'https://indycar-ads.onrender.com',
};

/** Token do cabeçalho Authorization ("Bearer" sem diferenciar maiúsculas). */
function tokenDe(req) {
  const m = /^\s*bearer\s+(\S+)\s*$/i.exec(req.headers?.authorization || '');
  return m ? m[1] : null;
}

/** Carga do JWT (sem verificar a assinatura — quem verifica é o Supabase). */
function cargaDoToken(token) {
  try {
    const [, carga] = String(token).split('.');
    return JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) || {};
  } catch { return {}; }
}

/** Regra pura: este perfil pode usar o app? Devolve { ok } ou { status, codigo, erro }. */
function conferirPerfil(p, app = APP) {
  if (!p) return { ok: false, status: 403, codigo: 'sem_perfil', erro: 'Seu usuário ainda não tem perfil na equipe. Peça ao administrador.' };
  if (!p.ativo) return { ok: false, status: 401, codigo: 'desativado', erro: 'Seu acesso foi desativado. Fale com o administrador.' };
  const apps = Array.isArray(p.apps) ? p.apps : [];
  const permitidos = p.papel === 'admin' ? APPS : apps.filter(a => APPS.includes(a));
  const outros = permitidos.filter(a => a !== app).map(a => ({ app: a, nome: NOMES_APPS[a], link: LINKS_APPS[a] }));
  if (!PAPEIS_EQUIPE.includes(p.papel)) {
    return { ok: false, status: 403, codigo: 'sem_acesso_app', erro: `Você não tem acesso ao ${NOMES_APPS[app] || app}.`, apps: outros };
  }
  if (p.papel !== 'admin' && !apps.includes(app)) {
    return { ok: false, status: 403, codigo: 'sem_acesso_app', erro: `Você não tem acesso ao ${NOMES_APPS[app] || app}.`, apps: outros };
  }
  return { ok: true };
}

/** O que a tela recebe em GET /api/eu. */
function dadosDoEu(u) {
  return {
    id: u.id, nome: u.nome || null, email: u.email || null, papel: u.papel,
    apps: u.papel === 'admin' ? APPS.slice() : (u.apps || []),
    cargo: u.cargo || null, telefone: u.telefone || null, avatar_cor: u.avatar_cor || null,
    equipe_id: u.equipe_id || null, recebe_leads: u.recebe_leads !== false,
    precisa_trocar_senha: !!u.precisa_trocar_senha,
    mfa: { ativo: !!u.mfa?.ativo, nivel: u.mfa?.nivel || 'aal1' },
    preferencias: u.preferencias && typeof u.preferencias === 'object' ? u.preferencias : {},
    ultimo_acesso_em: u.ultimo_acesso_em || null,
    pode: {
      gerenciar_equipe: u.papel === 'admin',
      ver_equipe: ['admin', 'gestor'].includes(u.papel),
      ver_auditoria: u.papel === 'admin',
      apagar: ['admin', 'gestor'].includes(u.papel),
      configurar: u.papel === 'admin',
    },
  };
}

const COLUNAS_PERFIL = 'id,nome,email,papel,ativo,apps,cargo,telefone,avatar_cor,equipe_id,recebe_leads,precisa_trocar_senha,preferencias,ultimo_acesso_em,ultimo_app';

/**
 * @param getSb        () => cliente supabase com service role (ou null)
 * @param buscarUsuario async token => { ok, usuario } (padrão: GET /auth/v1/user)
 */
function criarAcesso({ getSb, buscarUsuario, app = APP, agora = () => Date.now(), log = console.error } = {}) {
  const cache = new Map();          // token -> { expira, r }
  const ultimaMarca = new Map();    // perfilId -> ms da última gravação de acesso

  function guardar(token, r, ms) {
    if (cache.size >= MAX_CACHE) {
      const t = agora();
      for (const [k, v] of cache) if (v.expira <= t) cache.delete(k);
      while (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    }
    cache.set(token, { expira: agora() + ms, r });
    return r;
  }

  /** @returns {Promise<{ok:true, usuario}|{ok:false,status,codigo,erro}>} */
  async function autenticar(req) {
    const token = tokenDe(req);
    if (!token) return { ok: false, status: 401, codigo: 'sem_login', erro: 'Faça login.' };
    const lembrado = cache.get(token);
    if (lembrado && lembrado.expira > agora()) return lembrado.r;

    const carga = cargaDoToken(token);
    const vence = Number.isFinite(carga.exp) ? carga.exp * 1000 : 0;
    if (vence && vence <= agora()) return { ok: false, status: 401, codigo: 'sessao_expirada', erro: 'Sua sessão venceu. Entre de novo.' };

    const sb = getSb();
    // sem a chave de servidor não dá para conferir se a pessoa segue ativa: fecha (fail-closed)
    if (!sb) return { ok: false, status: 503, codigo: 'servidor_sem_chave', erro: 'Servidor sem a chave do banco configurada.' };

    let u;
    try { u = await buscarUsuario(token); }
    catch { return { ok: false, status: 503, codigo: 'auth_fora', erro: 'Não consegui conferir seu login agora. Tente de novo.' }; }
    if (!u?.ok || !u.usuario?.id) {
      return guardar(token, { ok: false, status: 401, codigo: 'sessao_invalida', erro: 'Sessão inválida. Entre de novo.' }, CACHE_NEGADO_MS);
    }
    const usuario = u.usuario;

    let perfil;
    try {
      const { data, error } = await sb.from('perfis').select(COLUNAS_PERFIL).eq('id', usuario.id).maybeSingle();
      if (error) return { ok: false, status: 503, codigo: 'banco_fora', erro: 'Não consegui ler seu perfil agora. Tente de novo.' };
      perfil = data;
    } catch { return { ok: false, status: 503, codigo: 'banco_fora', erro: 'Não consegui ler seu perfil agora. Tente de novo.' }; }

    const conf = conferirPerfil(perfil, app);
    if (!conf.ok) return guardar(token, { ...conf, perfilId: usuario.id }, CACHE_BLOQUEADO_MS);

    const fatores = Array.isArray(usuario.factors) ? usuario.factors : [];
    const mfaAtivo = fatores.some(f => f && f.status === 'verified');
    const nivel = carga.aal === 'aal2' ? 'aal2' : 'aal1';
    const quem = {
      ...perfil, id: usuario.id, email: usuario.email || perfil.email || null,
      mfa: { ativo: mfaAtivo, nivel }, mfaPendente: mfaAtivo && nivel !== 'aal2',
    };
    const ate = Math.min(agora() + CACHE_OK_MS, vence || Infinity);
    return guardar(token, { ok: true, usuario: quem }, Math.max(0, ate - agora()));
  }

  /** Grava ultimo_acesso_em/ultimo_app no máximo a cada 5 min (não espera; erro não importa). */
  function marcarAcesso(usuario) {
    if (!usuario?.id) return false;
    const t = agora();
    const ultima = ultimaMarca.get(usuario.id)
      ?? (usuario.ultimo_acesso_em && usuario.ultimo_app === app ? Date.parse(usuario.ultimo_acesso_em) : 0);
    if (t - ultima < INTERVALO_ACESSO_MS) return false;
    ultimaMarca.set(usuario.id, t);
    if (ultimaMarca.size > MAX_CACHE) ultimaMarca.delete(ultimaMarca.keys().next().value);
    const sb = getSb();
    if (!sb) return false;
    Promise.resolve(sb.from('perfis').update({ ultimo_acesso_em: new Date(t).toISOString(), ultimo_app: app }).eq('id', usuario.id))
      .then(r => { if (r?.error) log('último acesso:', r.error.message); }, e => log('último acesso:', e.message));
    return true;
  }

  /** Esquece tudo o que estava lembrado desta pessoa (desativou, mudou papel/apps). */
  function esquecerPerfil(id) {
    let n = 0;
    for (const [k, v] of cache) if (v.r?.usuario?.id === id || v.r?.perfilId === id) { cache.delete(k); n++; }
    return n;
  }
  /** Esquece um token (mudança no próprio perfil). */
  const esquecerToken = token => cache.delete(token);
  const limparCache = () => cache.clear();

  return { autenticar, marcarAcesso, esquecerPerfil, esquecerToken, limparCache, _cache: cache };
}

/** buscarUsuario padrão: pergunta ao Supabase quem é o dono do token. */
function buscarUsuarioSupabase({ url, anonKey, timeoutMs = 8000 }) {
  return async token => {
    if (!url || !anonKey) return { ok: false };
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status >= 500) throw new Error(`auth ${r.status}`);
    if (!r.ok) return { ok: false };
    const usuario = await r.json();
    return { ok: !!usuario?.id, usuario };
  };
}

module.exports = {
  criarAcesso, buscarUsuarioSupabase, conferirPerfil, dadosDoEu, tokenDe, cargaDoToken,
  APP, APPS, PAPEIS_EQUIPE, NOMES_APPS, LINKS_APPS, INTERVALO_ACESSO_MS, COLUNAS_PERFIL,
};
