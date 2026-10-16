/* ============================================================
   ROTAS DA CENTRAL DA EQUIPE (todas com login; papel conferido aqui)

   GET    /api/eu                         meu perfil, apps, MFA, preferências
   PATCH  /api/eu                         nome, cargo, telefone, cor, preferências
   POST   /api/eu/senha-trocada           desliga a troca obrigatória
   GET    /api/equipe                     lista completa (admin/gestor)
   GET    /api/equipe/nomes               nomes para a plaquinha de dono (equipe)
   POST   /api/equipe                     convidar (admin) → senha temporária 1x
   PATCH  /api/equipe/:id                 papel/apps/equipe/cargo/telefone/rodízio (admin)
   POST   /api/equipe/:id/desativar       {motivo?, redistribuir?} (admin)
   POST   /api/equipe/:id/reativar        (admin)
   POST   /api/equipe/:id/senha           nova senha temporária (admin)
   POST   /api/equipe/:id/mfa/remover     tira a verificação em duas etapas (admin)
   POST   /api/equipe/papel|ativo|rodizio formato antigo da tela (continua valendo)
   GET    /api/auditoria                  filtros + paginação (admin)
   GET    /api/auditoria/exportar         CSV (admin, auditado)
   GET    /api/tarefas/equipe[?pessoa=]   carga da equipe / tarefas de alguém
   POST   /api/tarefas                    criar tarefa
   GET    /api/rodizio                    quem recebe o próximo cliente (admin/gestor)
   GET    /api/conversas/sem-dono         abertas sem dono há mais de X min (admin/gestor)
   POST   /api/conversas/:id/distribuir   dá dono pelo rodízio
   POST   /api/conversas/:id/transferir   {para, motivo}
   POST   /api/automacoes/rodar           {tarefa} roda uma automação agora (admin)
   ============================================================ */
'use strict';

const S = require('./seguranca.js');
const A = require('./acesso.js');
const AUD = require('./auditoria.js');

const GESTAO = ['admin', 'gestor'];

function criarRotasEquipe({ getSb, usuarioLogado, limitar, lerCorpo, equipe, auditoria, tarefas, rodizio, automacoes,
  esquecerPerfil = () => {}, log = console.error } = {}) {

  const enviar = (res, code, data) => {
    const corpo = JSON.stringify(data);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(corpo), 'Cache-Control': 'no-store' });
    res.end(corpo);
    return true;
  };
  const resultado = (res, r, ok = 200) => {
    if (!r) return enviar(res, 500, { ok: false, erro: 'Sem resposta.', codigo: 'erro_interno' });
    const { status, ...resto } = r;
    return enviar(res, status || (r.ok ? ok : 400), resto);
  };
  const negar = (res, status, codigo, erro) => enviar(res, status, { ok: false, codigo, erro });

  async function exigir(req, res, papeis = null, opcoes = undefined) {
    const quem = await usuarioLogado(req, opcoes);
    if (!quem) { negar(res, 401, 'sem_login', 'Faça login.'); return null; }
    if (papeis && !papeis.includes(quem.papel)) {
      negar(res, 403, papeis.length === 1 ? 'so_admin' : 'so_gestor',
        papeis.length === 1 ? 'Só o administrador faz isso.' : 'Só gestor ou administrador vê isso.');
      return null;
    }
    return quem;
  }
  function freio(req, res, chave, teto, janela, msg) {
    if (limitar(chave, teto, janela)) return true;
    negar(res, 429, 'muitas_tentativas', msg || 'Muitos pedidos seguidos. Espere um minuto.');
    return false;
  }
  async function corpo(req, res) {
    try { return await lerCorpo(req); }
    catch (e) {
      if (e instanceof S.ErroHttp) negar(res, e.status, e.codigo, e.erro);
      else negar(res, 400, 'corpo_ilegivel', 'Não consegui ler o corpo da requisição.');
      return null;
    }
  }
  const semBanco = res => negar(res, 503, 'servidor_sem_chave', 'Servidor sem a chave do banco configurada.');

  return async function tratar(req, res, pathname, parametros) {
    const ehDaqui = pathname === '/api/eu' || pathname.startsWith('/api/eu/') || pathname === '/api/equipe' || pathname.startsWith('/api/equipe/')
      || pathname.startsWith('/api/auditoria') || pathname.startsWith('/api/tarefas') || pathname === '/api/rodizio'
      || pathname === '/api/conversas/sem-dono' || /^\/api\/conversas\/[^/]+\/(transferir|distribuir)$/.test(pathname)
      || pathname === '/api/automacoes/rodar';
    if (!ehDaqui) return false;
    const M = req.method;
    const sb = getSb();

    /* ================= EU ================= */
    if (pathname === '/api/eu' && M === 'GET') {
      // responde mesmo com a verificação em duas etapas pendente: a tela precisa saber para pedir o código
      const quem = await exigir(req, res, null, { mfaPendenteOk: true }); if (!quem) return true;
      return enviar(res, 200, { ok: true, ...A.dadosDoEu(quem), mfa_pendente: !!quem.mfaPendente });
    }
    if (pathname === '/api/eu' && M === 'PATCH') {
      const quem = await exigir(req, res); if (!quem) return true;
      if (!freio(req, res, `eu:${quem.id}`, 30, 60_000)) return true;
      if (!sb) return semBanco(res);
      const b = await corpo(req, res); if (!b) return true;
      const muda = {};
      if (b.nome !== undefined) { const v = S.texto(b.nome, 80); if (v.length < 2) return negar(res, 400, 'invalido', 'Nome curto demais.'); muda.nome = v; }
      if (b.cargo !== undefined) muda.cargo = S.texto(b.cargo, 60) || null;
      if (b.telefone !== undefined) {
        if (b.telefone === null || b.telefone === '') muda.telefone = null;
        else { const t = S.telefone(b.telefone); if (!t) return negar(res, 400, 'invalido', 'Telefone inválido (DDD + número).'); muda.telefone = t; }
      }
      if (b.avatar_cor !== undefined) {
        if (!/^#[0-9a-f]{6}$/i.test(String(b.avatar_cor))) return negar(res, 400, 'invalido', 'Cor inválida (use #RRGGBB).');
        muda.avatar_cor = String(b.avatar_cor).toLowerCase();
      }
      if (b.preferencias !== undefined) {
        const p = validarPreferencias(b.preferencias);
        if (p.erro) return negar(res, 400, 'invalido', p.erro);
        /* Rodada 4: perfis.preferencias é de TODOS os apps (tema, avisos, tour visto,
           coisas da Agenda/CRM…). Antes: mesclava raso com a cópia do porteiro (até
           60 s velha) — gravar "notificacoes" apagava chave que outro app tinha posto
           ali, e o que outro app gravou no último minuto sumia. Agora lê o valor
           ATUAL do banco e faz merge profundo; só as chaves enviadas mudam. */
        const { data: atual, error: eLer } = await sb.from('perfis').select('preferencias').eq('id', quem.id).maybeSingle();
        if (eLer) { log('PATCH /api/eu (ler preferencias):', eLer.message); return negar(res, 503, 'banco_fora', 'Não consegui salvar agora. Tente de novo.'); }
        muda.preferencias = mesclarPreferencias(atual?.preferencias, p.preferencias);
      }
      if (!Object.keys(muda).length) return negar(res, 400, 'nada', 'Nada para mudar.');
      const { error } = await sb.from('perfis').update(muda).eq('id', quem.id);
      if (error) { log('PATCH /api/eu:', error.message); return negar(res, 503, 'banco_fora', 'Não consegui salvar agora. Tente de novo.'); }
      esquecerPerfil(quem.id);
      return enviar(res, 200, { ok: true, ...A.dadosDoEu({ ...quem, ...muda }) });
    }
    if (pathname === '/api/eu/senha-trocada' && M === 'POST') {
      const quem = await exigir(req, res); if (!quem) return true;
      if (!sb) return semBanco(res);
      if (!quem.precisa_trocar_senha) return enviar(res, 200, { ok: true, precisa_trocar_senha: false });
      const { error } = await sb.from('perfis').update({ precisa_trocar_senha: false }).eq('id', quem.id);
      if (error) return negar(res, 503, 'banco_fora', 'Não consegui salvar agora.');
      esquecerPerfil(quem.id);
      await auditoria.registrar({ perfil: quem.id, acao: 'perfil.senha_trocada', tabela: 'perfis', registro: quem.id });
      return enviar(res, 200, { ok: true, precisa_trocar_senha: false });
    }

    /* ================= EQUIPE ================= */
    if (pathname === '/api/equipe/nomes' && M === 'GET') {
      const quem = await exigir(req, res); if (!quem) return true;
      if (!sb) return semBanco(res);
      const { data, error } = await sb.from('perfis').select('id,nome,papel,ativo,recebe_leads,avatar_cor,apps,cargo').order('nome');
      if (error) return negar(res, 503, 'banco_fora', 'Não consegui ler a equipe agora.');
      // o mínimo: e-mail e telefone não saem daqui
      return enviar(res, 200, { ok: true, equipe: (data || []).map(p => ({ id: p.id, nome: p.nome, papel: p.papel, ativo: p.ativo,
        recebe_leads: p.recebe_leads, avatar_cor: p.avatar_cor || null, cargo: p.cargo || null,
        atende: !!(p.ativo && (p.papel === 'admin' || (['gestor', 'atendente'].includes(p.papel) && (p.apps || []).includes('atendimento')))) })) });
    }
    if (pathname === '/api/equipe' && M === 'GET') {
      const quem = await exigir(req, res, GESTAO); if (!quem) return true;
      if (!freio(req, res, `equipe-lista:${quem.id}`, 60, 60_000)) return true;
      if (!sb) return semBanco(res);
      return resultado(res, await equipe.listar(quem));
    }
    if (pathname === '/api/equipe' && M === 'POST') {
      const quem = await exigir(req, res, ['admin']); if (!quem) return true;
      if (!freio(req, res, `equipe:${quem.id}`, 10, 60_000, 'Muitos convites seguidos. Espere um minuto.')) return true;
      if (!sb) return semBanco(res);
      const b = await corpo(req, res); if (!b) return true;
      return resultado(res, await equipe.convidar(quem, b), 201);
    }

    // formato antigo da tela (POST {id,…}) — mesmas regras e auditoria das rotas novas
    if (['/api/equipe/papel', '/api/equipe/ativo', '/api/equipe/rodizio'].includes(pathname) && M === 'POST') {
      const quem = await exigir(req, res, ['admin']); if (!quem) return true;
      if (!freio(req, res, `equipe-editar:${quem.id}`, 30, 60_000)) return true;
      if (!sb) return semBanco(res);
      const b = await corpo(req, res); if (!b) return true;
      const id = S.texto(b.id, 60);
      if (!S.ehUuid(id)) return negar(res, 400, 'id_invalido', 'Informe quem você quer alterar.');
      let r;
      if (pathname === '/api/equipe/papel') r = await equipe.editar(quem, id, { papel: b.papel });
      else if (pathname === '/api/equipe/rodizio') r = await equipe.editar(quem, id, { recebe_leads: b.recebe === true });
      else r = b.ativo === true ? await equipe.reativar(quem, id) : await equipe.desativar(quem, id, { motivo: b.motivo });
      if (r.ok) Object.assign(r, pathname === '/api/equipe/papel' ? { papel: b.papel } : pathname === '/api/equipe/rodizio' ? { recebe: b.recebe === true } : { ativo: b.ativo === true });
      return resultado(res, r);
    }

    let m = /^\/api\/equipe\/([^/]+)$/.exec(pathname);
    if (m && M === 'PATCH') {
      const quem = await exigir(req, res, ['admin']); if (!quem) return true;
      if (!freio(req, res, `equipe-editar:${quem.id}`, 30, 60_000)) return true;
      if (!sb) return semBanco(res);
      const b = await corpo(req, res); if (!b) return true;
      return resultado(res, await equipe.editar(quem, decodeURIComponent(m[1]), b));
    }
    m = /^\/api\/equipe\/([^/]+)\/(desativar|reativar|senha|senha-temporaria|mfa\/remover)$/.exec(pathname);
    if (m && M === 'POST') {
      const quem = await exigir(req, res, ['admin']); if (!quem) return true;
      const acao = m[2] === 'senha-temporaria' ? 'senha' : m[2];       // a tela usa o nome longo
      if (acao === 'senha' && !freio(req, res, `equipe-senha:${quem.id}`, 10, 600_000, 'Muitas senhas geradas seguidas. Espere alguns minutos.')) return true;
      if (!freio(req, res, `equipe-editar:${quem.id}`, 30, 60_000)) return true;
      if (!sb) return semBanco(res);
      const b = await corpo(req, res); if (!b) return true;
      const id = decodeURIComponent(m[1]);
      if (acao === 'desativar') {
        const r = await equipe.desativar(quem, id, { motivo: b.motivo });
        if (r.ok && !r.jaEstava && b.redistribuir === true && rodizio) r.redistribuidas = await redistribuirDe(id, quem);
        return resultado(res, r);
      }
      if (acao === 'reativar') return resultado(res, await equipe.reativar(quem, id));
      if (acao === 'senha') return resultado(res, await equipe.redefinirSenha(quem, id));
      return resultado(res, await equipe.removerMfa(quem, id));
    }

    /* ================= AUDITORIA ================= */
    if (pathname === '/api/auditoria' && M === 'GET') {
      const quem = await exigir(req, res, ['admin']); if (!quem) return true;
      if (!freio(req, res, `auditoria:${quem.id}`, 60, 60_000)) return true;
      if (!sb) return semBanco(res);
      const f = auditoria.lerFiltros(parametros);
      if (f.erro) return negar(res, 400, 'filtro_invalido', f.erro);
      return resultado(res, await auditoria.consultar(f.filtros));
    }
    if ((pathname === '/api/auditoria/exportar' || pathname === '/api/auditoria.csv') && M === 'GET') {
      const quem = await exigir(req, res, ['admin']); if (!quem) return true;
      if (!freio(req, res, `auditoria-csv:${quem.id}`, 5, 60_000, 'Muitas exportações seguidas. Espere um minuto.')) return true;
      if (!sb) return semBanco(res);
      const f = auditoria.lerFiltros(parametros);
      if (f.erro) return negar(res, 400, 'filtro_invalido', f.erro);
      const r = await auditoria.paraExportar(f.filtros);
      if (!r.ok) return resultado(res, r);
      const { pagina, por_pagina, ...filtros } = f.filtros;
      await auditoria.registrar({ perfil: quem.id, acao: 'auditoria.exportar', tabela: 'auditoria', detalhes: { filtros, linhas: r.itens.length } });
      const csv = AUD.csv(r.itens);
      const nome = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"`,
        'Content-Length': Buffer.byteLength(csv), 'Cache-Control': 'no-store', 'X-Linhas': String(r.itens.length),
        'X-Limite': String(r.limite) });
      res.end(csv);
      return true;
    }

    /* ================= TAREFAS ================= */
    if (pathname === '/api/tarefas/equipe' && M === 'GET') {
      const quem = await exigir(req, res); if (!quem) return true;
      if (!freio(req, res, `tarefas-equipe:${quem.id}`, 60, 60_000)) return true;
      if (!sb) return semBanco(res);
      const pessoa = parametros.get('pessoa');
      if (pessoa) return resultado(res, await tarefas.daPessoa(quem, pessoa, { status: parametros.get('status') || 'aberta' }));
      if (!GESTAO.includes(quem.papel)) return negar(res, 403, 'so_gestor', 'A carga da equipe é do gestor ou do administrador.');
      return resultado(res, await tarefas.cargaDaEquipe(quem));
    }
    if (pathname === '/api/tarefas' && M === 'POST') {
      const quem = await exigir(req, res); if (!quem) return true;
      if (!freio(req, res, `tarefas:${quem.id}`, 30, 60_000)) return true;
      if (!sb) return semBanco(res);
      const b = await corpo(req, res); if (!b) return true;
      return resultado(res, await tarefas.criar(quem, b), 201);
    }

    /* ================= RODÍZIO E CONVERSAS ================= */
    if (pathname === '/api/rodizio' && M === 'GET') {
      const quem = await exigir(req, res, GESTAO); if (!quem) return true;
      if (!sb) return semBanco(res);
      return resultado(res, await rodizio.previa());
    }
    if (pathname === '/api/conversas/sem-dono' && M === 'GET') {
      const quem = await exigir(req, res, GESTAO); if (!quem) return true;
      if (!freio(req, res, `sem-dono:${quem.id}`, 60, 60_000)) return true;
      if (!sb) return semBanco(res);
      const minutos = S.inteiro(parametros.get('minutos'), { min: 0, max: 7 * 24 * 60, padrao: 15 });
      const dias = S.inteiro(parametros.get('dias'), { min: 1, max: 365, padrao: 30 });
      return resultado(res, await rodizio.semDono({ minutos, dias }));
    }
    m = /^\/api\/conversas\/([^/]+)\/(transferir|distribuir)$/.exec(pathname);
    if (m && M === 'POST') {
      const quem = await exigir(req, res); if (!quem) return true;
      if (!freio(req, res, `transferir:${quem.id}`, 60, 60_000, 'Muitas trocas seguidas. Espere um minuto.')) return true;
      if (!sb) return semBanco(res);
      const b = await corpo(req, res); if (!b) return true;
      const id = decodeURIComponent(m[1]);
      if (m[2] === 'transferir') return resultado(res, await rodizio.transferir(quem, id, { para: b.para, motivo: b.motivo }));
      return resultado(res, await rodizio.distribuir(id, quem, { motivo: 'pedido na tela' }));
    }

    /* ================= AUTOMAÇÕES ================= */
    if (pathname === '/api/automacoes/rodar' && M === 'POST') {
      const quem = await exigir(req, res, ['admin']); if (!quem) return true;
      if (!freio(req, res, `automacoes:${quem.id}`, 6, 60_000)) return true;
      if (!sb || !automacoes) return semBanco(res);
      const b = await corpo(req, res); if (!b) return true;
      const qual = { espera: () => automacoes.alertarEspera(), resumo: () => automacoes.resumoDoDia({ forcar: true }),
        donos: () => automacoes.corrigirDonos(), limpeza: () => automacoes.limpar({ forcar: true }),
        followup: () => automacoes.followUp24h() }[b.tarefa];
      if (!qual) return negar(res, 400, 'invalido', 'Tarefa: espera, resumo, donos, followup ou limpeza.');
      const r = await qual();
      await auditoria.registrar({ perfil: quem.id, acao: 'automacao.rodar', detalhes: { tarefa: b.tarefa } });
      return enviar(res, 200, { ok: true, tarefa: b.tarefa, resultado: r });
    }

    return false;
  };

  /** Conversas abertas de quem foi desativado voltam ao rodízio. */
  async function redistribuirDe(perfilId, quem) {
    const sb = getSb();
    const { data, error } = await sb.from('conversas').select('id').eq('atribuida_a', perfilId).neq('status', 'resolvida').limit(500);
    if (error) return { ok: false };
    let movidas = 0;
    for (const c of data || []) {
      const { error: e1 } = await sb.from('conversas').update({ atribuida_a: null }).eq('id', c.id).eq('atribuida_a', perfilId);
      if (e1) continue;
      const r = await rodizio.distribuir(c.id, quem, { motivo: 'dono desativado', donoAnterior: perfilId });
      if (r.ok) movidas++;
    }
    return { ok: true, total: (data || []).length, movidas };
  }
}

/**
 * Merge profundo de preferências (rodada 4): objetos se juntam chave a chave;
 * valor simples, lista ou null substitui. Nunca devolve o mesmo objeto (sem efeito
 * colateral) e ignora base que não seja objeto.
 */
function mesclarPreferencias(base, patch) {
  const ehObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const out = ehObj(base) ? { ...base } : {};
  if (!ehObj(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    out[k] = ehObj(v) && ehObj(out[k]) ? mesclarPreferencias(out[k], v) : (ehObj(v) ? mesclarPreferencias({}, v) : v);
  }
  return out;
}

/** Preferências aceitas (o resto é ignorado) → { preferencias } ou { erro }. */
function validarPreferencias(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { erro: 'Preferências precisam ser um objeto.' };
  if (JSON.stringify(p).length > 4000) return { erro: 'Preferências grandes demais.' };
  const out = {};
  if (p.tema !== undefined) { if (!['claro', 'escuro', 'sistema'].includes(p.tema)) return { erro: 'Tema: claro, escuro ou sistema.' }; out.tema = p.tema; }
  if (p.notificacoes !== undefined) {
    if (!p.notificacoes || typeof p.notificacoes !== 'object') return { erro: 'notificacoes precisa ser um objeto.' };
    out.notificacoes = {};
    for (const k of ['espera', 'resumo_dia', 'tarefa', 'conversa', 'lead', 'aguardando', 'som', 'navegador']) {
      if (p.notificacoes[k] !== undefined) out.notificacoes[k] = p.notificacoes[k] === true;
    }
  }
  if (p.expediente !== undefined) {
    if (p.expediente === null) out.expediente = null;
    else {
      const e = p.expediente;
      const hora = h => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ''));
      if (!e || !Array.isArray(e.dias) || !e.dias.every(d => Number.isInteger(d) && d >= 0 && d <= 6) || !hora(e.inicio) || !hora(e.fim) || e.fim <= e.inicio) {
        return { erro: 'Expediente: {dias:[1..6], inicio:"08:00", fim:"17:30"}.' };
      }
      out.expediente = { dias: [...new Set(e.dias)].sort(), inicio: e.inicio, fim: e.fim };
    }
  }
  if (p.ausente_ate !== undefined) {
    if (p.ausente_ate === null || p.ausente_ate === '') out.ausente_ate = null;
    else if (!S.dataISO(p.ausente_ate)) return { erro: 'ausente_ate: AAAA-MM-DD.' };
    else out.ausente_ate = p.ausente_ate;
  }
  if (p.copiloto_automatico !== undefined) out.copiloto_automatico = p.copiloto_automatico === true;
  if (p.lembrar_email !== undefined) out.lembrar_email = p.lembrar_email === true;
  // rodada 4: qual tour de boas-vindas a pessoa já viu (ex.: "v1-atendente")
  if (p.tour_visto !== undefined) {
    if (p.tour_visto !== null && !/^v[0-9]{1,2}-(atendente|gestor|admin)$/.test(String(p.tour_visto))) return { erro: 'tour_visto: v1-atendente, v1-gestor ou v1-admin.' };
    out.tour_visto = p.tour_visto;
  }
  return { preferencias: out };
}

module.exports = { criarRotasEquipe, validarPreferencias, mesclarPreferencias };
