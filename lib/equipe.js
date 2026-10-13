/* ============================================================
   EQUIPE — a central de pessoas do ecossistema IndyCar
   Convidar (Auth Admin + perfil), editar papel/apps/equipe/cargo/
   rodízio, desativar/reativar (com ban no Auth para derrubar as
   sessões), redefinir senha (temporária) e listar com último acesso,
   apps e verificação em duas etapas.

   Regras que valem sempre:
   - só admin muda; gestor só vê
   - ninguém muda o próprio papel nem desativa a si mesmo
   - o último admin ativo não é rebaixado nem desativado
   - a última pessoa do rodízio não sai dele
   - senha temporária só aparece UMA vez, na resposta; nunca em log
     nem auditoria
   Sobre derrubar sessões: a Admin API do Supabase só faz signOut com
   o JWT da própria pessoa (que o servidor não tem). Por isso desativar
   = perfis.ativo=false (o servidor e o RLS recusam na hora, cache de
   no máximo 60 s) + ban_duration de 100 anos no Auth (o refresh token
   para de funcionar e não dá para entrar de novo). Reativar tira o ban.
   ============================================================ */
'use strict';

const crypto = require('node:crypto');
const S = require('./seguranca.js');
const { APPS } = require('./acesso.js');

const PAPEIS = ['admin', 'gestor', 'atendente', 'agenda'];
const APPS_PADRAO = {
  admin: APPS.slice(), gestor: APPS.slice(),
  atendente: ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador'],
  agenda: ['agenda'],
};
const BAN_DESATIVADO = '876000h';     // ~100 anos
const NOMES_PAPEL = { admin: 'administrador', gestor: 'gestor', atendente: 'atendente', agenda: 'agenda (só presença)' };

/* ------------------------------------------------------------
   Senha temporária: 3 blocos de 4 (ex.: Kp7x-Qm4r-Tz9w), sem letras
   que se confundem (0 O 1 l I). ~69 bits, fácil de ditar.
   ------------------------------------------------------------ */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function gerarSenhaTemporaria() {
  for (;;) {
    const blocos = [];
    for (let b = 0; b < 3; b++) {
      let s = '';
      for (let i = 0; i < 4; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
      blocos.push(s);
    }
    const senha = blocos.join('-');
    if (/[A-Z]/.test(senha) && /[a-z]/.test(senha) && /\d/.test(senha)) return senha;
  }
}

/* ------------------------------------------------------------
   Validação (pura)
   ------------------------------------------------------------ */
function appsDoPapel(papel, apps) {
  if (papel === 'agenda') return ['agenda'];
  if (papel === 'admin') return APPS.slice();
  const lista = apps == null ? APPS_PADRAO[papel] : S.listaDe(apps, APPS);
  return lista;
}

/** Corpo do convite → { dados } ou { erro, campo }. */
function validarConvite(b = {}) {
  const nome = S.texto(b.nome, 80);
  if (nome.length < 2) return { erro: 'Informe o nome da pessoa.', campo: 'nome' };
  const email = S.texto(b.email, 160).toLowerCase();
  if (!S.ehEmail(email)) return { erro: 'Esse e-mail não parece válido.', campo: 'email' };
  const papel = b.papel === undefined ? 'atendente' : b.papel;
  if (!PAPEIS.includes(papel)) return { erro: 'Papel inválido. Use admin, gestor, atendente ou agenda.', campo: 'papel' };
  if (b.apps !== undefined && !Array.isArray(b.apps)) return { erro: 'Apps precisa ser uma lista.', campo: 'apps' };
  const apps = appsDoPapel(papel, b.apps);
  if (!apps.length) return { erro: 'Escolha pelo menos um app.', campo: 'apps' };
  const dados = { nome, email, papel, apps };
  if (b.equipe_id !== undefined && b.equipe_id !== null && b.equipe_id !== '') {
    if (!S.ehUuid(b.equipe_id)) return { erro: 'Equipe inválida.', campo: 'equipe_id' };
    dados.equipe_id = b.equipe_id;
  }
  if (b.cargo !== undefined) dados.cargo = S.texto(b.cargo, 60) || null;
  if (b.telefone !== undefined && b.telefone !== null && b.telefone !== '') {
    const t = S.telefone(b.telefone);
    if (!t) return { erro: 'Telefone inválido (DDD + número).', campo: 'telefone' };
    dados.telefone = t;
  }
  dados.recebe_leads = papel === 'agenda' ? false : b.recebe_leads !== false;
  return { dados };
}

/** Corpo da edição → { muda } (só o que veio) ou { erro, campo }. */
function validarEdicao(b = {}, alvo = {}) {
  const muda = {};
  if (b.nome !== undefined) { const v = S.texto(b.nome, 80); if (v.length < 2) return { erro: 'Nome curto demais.', campo: 'nome' }; muda.nome = v; }
  if (b.papel !== undefined) { if (!PAPEIS.includes(b.papel)) return { erro: 'Papel inválido. Use admin, gestor, atendente ou agenda.', campo: 'papel' }; muda.papel = b.papel; }
  if (b.apps !== undefined) {
    if (!Array.isArray(b.apps)) return { erro: 'Apps precisa ser uma lista.', campo: 'apps' };
    muda.apps = S.listaDe(b.apps, APPS);
  }
  const papelFinal = muda.papel || alvo.papel;
  if (muda.papel !== undefined || muda.apps !== undefined) {
    const apps = appsDoPapel(papelFinal, muda.apps !== undefined ? muda.apps : alvo.apps);
    if (!apps || !apps.length) return { erro: 'Escolha pelo menos um app.', campo: 'apps' };
    muda.apps = apps;
  }
  if (b.equipe_id !== undefined) {
    if (b.equipe_id === null || b.equipe_id === '') muda.equipe_id = null;
    else if (!S.ehUuid(b.equipe_id)) return { erro: 'Equipe inválida.', campo: 'equipe_id' };
    else muda.equipe_id = b.equipe_id;
  }
  if (b.cargo !== undefined) muda.cargo = S.texto(b.cargo, 60) || null;
  if (b.telefone !== undefined) {
    if (b.telefone === null || b.telefone === '') muda.telefone = null;
    else { const t = S.telefone(b.telefone); if (!t) return { erro: 'Telefone inválido (DDD + número).', campo: 'telefone' }; muda.telefone = t; }
  }
  if (b.recebe_leads !== undefined) {
    if (typeof b.recebe_leads !== 'boolean') return { erro: 'recebe_leads precisa ser verdadeiro ou falso.', campo: 'recebe_leads' };
    muda.recebe_leads = b.recebe_leads;
  }
  if (papelFinal === 'agenda') muda.recebe_leads = false;          // quem só marca presença não recebe cliente
  for (const k of Object.keys(muda)) {
    const igual = Array.isArray(muda[k]) ? JSON.stringify(muda[k]) === JSON.stringify(alvo[k] || []) : muda[k] === (alvo[k] ?? null);
    if (igual) delete muda[k];
  }
  return { muda };
}

/** Regras de proteção (pura). contagem = { adminsAtivos, rodizioAtivos }. */
function checarMudanca({ quem, alvo, muda, contagem }) {
  const proprio = quem.id === alvo.id;
  if (muda.papel !== undefined && muda.papel !== alvo.papel) {
    if (proprio) return { status: 409, codigo: 'proprio_papel', erro: 'Você não pode mudar o seu próprio papel. Peça a outro administrador.' };
    if (alvo.papel === 'admin' && alvo.ativo && contagem.adminsAtivos <= 1) {
      return { status: 409, codigo: 'ultimo_admin', erro: 'Este é o único administrador ativo. Promova outra pessoa antes de rebaixar esta.' };
    }
  }
  if (muda.recebe_leads === false && alvo.recebe_leads && alvo.ativo && contagem.rodizioAtivos <= 1) {
    return { status: 409, codigo: 'ultimo_rodizio', erro: 'É a única pessoa recebendo clientes. Coloque outra antes de tirar esta, senão o cliente novo chega sem responsável.' };
  }
  return null;
}

function checarDesativar({ quem, alvo, contagem }) {
  if (quem.id === alvo.id) return { status: 409, codigo: 'proprio_acesso', erro: 'Você não pode desativar o próprio acesso.' };
  if (alvo.papel === 'admin' && alvo.ativo && contagem.adminsAtivos <= 1) {
    return { status: 409, codigo: 'ultimo_admin', erro: 'Este é o único administrador ativo. Promova outra pessoa antes de tirar o acesso desta.' };
  }
  return null;
}

/** Situação legível da pessoa na lista. */
function situacao(p, auth) {
  if (!p.ativo) return 'desativado';
  if (auth && !auth.last_sign_in_at) return 'convite_pendente';
  if (p.precisa_trocar_senha) return 'precisa_trocar_senha';
  return 'ativo';
}

/* ------------------------------------------------------------
   Operações (banco + Auth Admin API)
   ------------------------------------------------------------ */
const COLUNAS = 'id,nome,email,papel,ativo,apps,equipe_id,cargo,telefone,avatar_cor,recebe_leads,precisa_trocar_senha,ultimo_acesso_em,ultimo_app,convidado_por,desativado_em,desativado_por,created_at';

function criarEquipe({ sb, authAdmin, auditar = async () => ({ ok: true }), esquecerPerfil = () => {}, agora = () => new Date(), log = console.error } = {}) {
  const falha = (status, codigo, erro, extra = {}) => ({ ok: false, status, codigo, erro, ...extra });
  const soAdmin = quem => (quem?.papel === 'admin' ? null : falha(403, 'so_admin', 'Só o administrador gerencia a equipe.'));

  async function lerAlvo(id) {
    if (!S.ehUuid(id)) return { r: falha(400, 'id_invalido', 'Pessoa inválida.') };
    const { data, error } = await sb.from('perfis').select(COLUNAS).eq('id', id).maybeSingle();
    if (error) return { r: falha(503, 'banco_fora', 'Não consegui ler a equipe agora.') };
    if (!data) return { r: falha(404, 'nao_encontrado', 'Não achei essa pessoa.') };
    return { alvo: data };
  }

  async function contar() {
    const { data, error } = await sb.from('perfis').select('id,papel,ativo,recebe_leads,apps');
    if (error) return null;
    const lista = data || [];
    return {
      adminsAtivos: lista.filter(p => p.ativo && p.papel === 'admin').length,
      rodizioAtivos: lista.filter(p => p.ativo && p.recebe_leads && ['admin', 'gestor', 'atendente'].includes(p.papel)
        && (p.papel === 'admin' || (p.apps || []).includes('atendimento'))).length,
    };
  }

  /** Erro do banco ao gravar perfil → mensagem clara (sem detalhe interno). */
  function erroDoPerfil(error) {
    if (/perfis_papel_check|23514/.test(`${error?.message} ${error?.code}`)) {
      return falha(409, 'papel_nao_aceito', 'O banco ainda não aceita esse papel (o papel "gestor" depende de uma atualização da base). Use admin ou atendente por enquanto.');
    }
    log('perfil:', error?.message);
    return falha(503, 'banco_fora', 'Não consegui gravar o perfil agora. Tente de novo.');
  }

  /* ---------- convidar ---------- */
  async function convidar(quem, corpo) {
    const neg = soAdmin(quem); if (neg) return neg;
    const v = validarConvite(corpo);
    if (v.erro) return falha(400, 'invalido', v.erro, { campo: v.campo });
    const d = v.dados;

    const { data: existe } = await sb.from('perfis').select('id,ativo').eq('email', d.email).maybeSingle();
    if (existe) {
      return falha(409, 'email_existe', existe.ativo ? 'Já existe alguém da equipe com esse e-mail.'
        : 'Esse e-mail é de uma pessoa desativada. Reative em vez de convidar de novo.', { id: existe.id, desativado: !existe.ativo });
    }

    const senha = gerarSenhaTemporaria();
    let criado;
    try {
      const { data, error } = await authAdmin.createUser({ email: d.email, password: senha, email_confirm: true,
        user_metadata: { nome: d.nome }, app_metadata: { convidado_por: quem.id } });
      if (error) {
        if (/already been registered|already exists|email_exists/i.test(`${error.message} ${error.code}`)) {
          return falha(409, 'email_existe', 'Já existe um login com esse e-mail.');
        }
        log('convite (auth):', error.message);
        return falha(502, 'auth_falhou', 'O Supabase não criou o login agora. Tente de novo em instantes.');
      }
      criado = data.user;
    } catch (e) {
      log('convite (auth):', e.message);
      return falha(502, 'auth_falhou', 'O Supabase não criou o login agora. Tente de novo em instantes.');
    }

    // o gatilho do banco cria o perfil; aqui acertamos tudo (e criamos, se o gatilho não criou)
    const campos = { nome: d.nome, email: d.email, papel: d.papel, apps: d.apps, ativo: true, precisa_trocar_senha: true,
      convidado_por: quem.id, recebe_leads: d.recebe_leads, desativado_em: null, desativado_por: null,
      ...(d.equipe_id !== undefined ? { equipe_id: d.equipe_id } : {}), ...(d.cargo !== undefined ? { cargo: d.cargo } : {}),
      ...(d.telefone !== undefined ? { telefone: d.telefone } : {}) };
    let { data: linhas, error } = await sb.from('perfis').update(campos).eq('id', criado.id).select('id');
    if (!error && (!linhas || !linhas.length)) ({ error } = await sb.from('perfis').insert({ id: criado.id, ...campos }).select('id').single());
    if (error) {
      // sem perfil certo o login ficaria solto (sem papel nem apps): desfaz
      try { await authAdmin.deleteUser(criado.id); } catch (e) { log('convite (desfazer):', e.message); }
      return erroDoPerfil(error);
    }

    await auditar({ perfil: quem.id, acao: 'equipe.convidar', tabela: 'perfis', registro: criado.id,
      detalhes: { email: d.email, papel: d.papel, apps: d.apps, equipe_id: d.equipe_id || null, cargo: d.cargo || null, recebe_leads: d.recebe_leads } });
    const pessoa = { id: criado.id, ...S.semSegredos(campos) };
    return { ok: true, status: 201, pessoa, perfil: pessoa, senha_temporaria: senha,
      aviso: 'Anote e passe esta senha para a pessoa agora: ela não aparece de novo. No primeiro acesso o sistema pede uma senha nova.' };
  }

  /* ---------- editar ---------- */
  async function editar(quem, id, corpo) {
    const neg = soAdmin(quem); if (neg) return neg;
    const { alvo, r } = await lerAlvo(id); if (r) return r;
    const v = validarEdicao(corpo, alvo);
    if (v.erro) return falha(400, 'invalido', v.erro, { campo: v.campo });
    if (!Object.keys(v.muda).length) return { ok: true, status: 200, pessoa: alvo, mudou: [] };
    const contagem = await contar();
    if (!contagem) return falha(503, 'banco_fora', 'Não consegui conferir a equipe agora.');
    const bloq = checarMudanca({ quem, alvo, muda: v.muda, contagem });
    if (bloq) return { ok: false, ...bloq };
    const { data, error } = await sb.from('perfis').update(v.muda).eq('id', id).select(COLUNAS);
    if (error) return erroDoPerfil(error);
    if (!data?.length) return falha(404, 'nao_encontrado', 'Não achei essa pessoa.');
    esquecerPerfil(id);
    const antes = Object.fromEntries(Object.keys(v.muda).map(k => [k, alvo[k] ?? null]));
    await auditar({ perfil: quem.id, acao: 'equipe.editar', tabela: 'perfis', registro: id, detalhes: { antes, depois: v.muda } });
    return { ok: true, status: 200, pessoa: data[0], perfil: data[0], mudou: Object.keys(v.muda) };
  }

  /* ---------- desativar / reativar ---------- */
  async function desativar(quem, id, { motivo = '' } = {}) {
    const neg = soAdmin(quem); if (neg) return neg;
    const { alvo, r } = await lerAlvo(id); if (r) return r;
    if (!alvo.ativo) return { ok: true, status: 200, jaEstava: true, pessoa: alvo };
    const contagem = await contar();
    if (!contagem) return falha(503, 'banco_fora', 'Não consegui conferir a equipe agora.');
    const bloq = checarDesativar({ quem, alvo, contagem });
    if (bloq) return { ok: false, ...bloq };
    const quando = agora().toISOString();
    const { error } = await sb.from('perfis').update({ ativo: false, desativado_em: quando, desativado_por: quem.id, recebe_leads: false }).eq('id', id);
    if (error) return erroDoPerfil(error);
    esquecerPerfil(id);
    let sessoes = 'derrubadas';
    try {
      const { error: e2 } = await authAdmin.updateUserById(id, { ban_duration: BAN_DESATIVADO });
      if (e2) { sessoes = 'nao_derrubadas'; log('desativar (ban):', e2.message); }
    } catch (e) { sessoes = 'nao_derrubadas'; log('desativar (ban):', e.message); }
    await auditar({ perfil: quem.id, acao: 'equipe.desativar', tabela: 'perfis', registro: id,
      detalhes: { motivo: S.texto(motivo, 200) || null, sessoes, recebia_leads: !!alvo.recebe_leads } });
    return { ok: true, status: 200, sessoes, desativado_em: quando,
      aviso: sessoes === 'derrubadas' ? null : 'Acesso desligado aqui, mas o Supabase não confirmou o bloqueio do login. Tente "Desativar" de novo.' };
  }

  async function reativar(quem, id) {
    const neg = soAdmin(quem); if (neg) return neg;
    const { alvo, r } = await lerAlvo(id); if (r) return r;
    let banTirado = true;
    try {
      const { error } = await authAdmin.updateUserById(id, { ban_duration: 'none' });
      if (error) { banTirado = false; log('reativar (ban):', error.message); }
    } catch (e) { banTirado = false; log('reativar (ban):', e.message); }
    if (!banTirado) return falha(502, 'auth_falhou', 'O Supabase não liberou o login agora. Tente de novo.');
    if (alvo.ativo) return { ok: true, status: 200, jaEstava: true };
    const { error } = await sb.from('perfis').update({ ativo: true, desativado_em: null, desativado_por: null }).eq('id', id);
    if (error) return erroDoPerfil(error);
    esquecerPerfil(id);
    await auditar({ perfil: quem.id, acao: 'equipe.reativar', tabela: 'perfis', registro: id, detalhes: { desativado_em: alvo.desativado_em } });
    return { ok: true, status: 200 };
  }

  /* ---------- redefinir senha ---------- */
  async function redefinirSenha(quem, id) {
    const neg = soAdmin(quem); if (neg) return neg;
    const { alvo, r } = await lerAlvo(id); if (r) return r;
    if (alvo.id === quem.id) return falha(409, 'propria_senha', 'Para trocar a sua senha use "Meu perfil › Trocar senha".');
    if (!alvo.ativo) return falha(409, 'desativado', 'Essa pessoa está desativada. Reative antes de gerar senha.');
    const senha = gerarSenhaTemporaria();
    try {
      const { error } = await authAdmin.updateUserById(id, { password: senha });
      if (error) { log('redefinir senha:', error.message); return falha(502, 'auth_falhou', 'O Supabase não trocou a senha agora. Tente de novo.'); }
    } catch (e) { log('redefinir senha:', e.message); return falha(502, 'auth_falhou', 'O Supabase não trocou a senha agora. Tente de novo.'); }
    const { error } = await sb.from('perfis').update({ precisa_trocar_senha: true }).eq('id', id);
    if (error) log('redefinir senha (perfil):', error.message);
    esquecerPerfil(id);
    await auditar({ perfil: quem.id, acao: 'equipe.redefinir_senha', tabela: 'perfis', registro: id, detalhes: { troca_obrigatoria: !error } });
    return { ok: true, status: 200, senha_temporaria: senha,
      aviso: 'Passe esta senha para a pessoa agora: ela não aparece de novo. No próximo acesso o sistema pede uma senha nova.' };
  }

  /* ---------- tirar a verificação em duas etapas (perdeu o celular) ---------- */
  async function removerMfa(quem, id) {
    const neg = soAdmin(quem); if (neg) return neg;
    const { r } = await lerAlvo(id); if (r) return r;
    let removidos = 0;
    try {
      const { data, error } = await authAdmin.mfa.listFactors({ userId: id });
      if (error) return falha(502, 'auth_falhou', 'Não consegui ler a verificação em duas etapas agora.');
      for (const f of data?.factors || []) {
        const { error: e2 } = await authAdmin.mfa.deleteFactor({ id: f.id, userId: id });
        if (!e2) removidos++;
      }
    } catch (e) { log('remover mfa:', e.message); return falha(502, 'auth_falhou', 'Não consegui mexer na verificação em duas etapas agora.'); }
    esquecerPerfil(id);
    await auditar({ perfil: quem.id, acao: 'equipe.remover_mfa', tabela: 'perfis', registro: id, detalhes: { fatores_removidos: removidos } });
    return { ok: true, status: 200, removidos };
  }

  /* ---------- listar ---------- */
  async function usuariosDoAuth() {
    const mapa = new Map();
    let erro = false;
    for (let pagina = 1; pagina <= 10; pagina++) {
      try {
        const { data, error } = await authAdmin.listUsers({ page: pagina, perPage: 200 });
        if (error) { erro = true; break; }
        const us = data?.users || [];
        for (const u of us) mapa.set(u.id, u);
        if (us.length < 200) break;
      } catch { erro = true; break; }
    }
    return { mapa, erro };
  }

  async function listar(quem) {
    if (!['admin', 'gestor'].includes(quem?.papel)) return falha(403, 'so_gestor', 'Só gestor ou administrador vê a equipe completa.');
    const [perfis, auth, convs, tarefas, equipes] = await Promise.all([
      sb.from('perfis').select(COLUNAS).order('nome'),
      usuariosDoAuth(),
      sb.from('conversas').select('atribuida_a,status').neq('status', 'resolvida').limit(10000),
      sb.from('tarefas').select('responsavel_id,vence_em,status').eq('status', 'aberta').limit(10000),
      sb.from('equipes').select('id,nome,cor').order('nome'),
    ]);
    if (perfis.error) return falha(503, 'banco_fora', 'Não consegui ler a equipe agora.');
    const agoraIso = agora().toISOString();
    const carga = {};
    const soma = (id, k) => { if (!id) return; (carga[id] = carga[id] || { conversas_abertas: 0, tarefas_abertas: 0, tarefas_atrasadas: 0 })[k]++; };
    for (const c of convs.data || []) soma(c.atribuida_a, 'conversas_abertas');
    for (const t of tarefas.data || []) { soma(t.responsavel_id, 'tarefas_abertas'); if (t.vence_em && t.vence_em < agoraIso) soma(t.responsavel_id, 'tarefas_atrasadas'); }
    const nomes = Object.fromEntries((perfis.data || []).map(p => [p.id, p.nome]));
    const pessoas = (perfis.data || []).map(p => {
      const a = auth.mapa.get(p.id);
      const fatores = Array.isArray(a?.factors) ? a.factors.filter(f => f.status === 'verified') : [];
      return {
        ...p, apps: p.papel === 'admin' ? APPS.slice() : (p.apps || []),
        papel_nome: NOMES_PAPEL[p.papel] || p.papel,
        situacao: situacao(p, a), eu: p.id === quem.id,
        ultimo_login_em: a?.last_sign_in_at || null,
        banido: !!(a?.banned_until && Date.parse(a.banned_until) > agora().getTime()),
        mfa: a ? { ativo: fatores.length > 0, fatores: fatores.length } : { ativo: null, fatores: null },
        mfa_ativo: a ? fatores.length > 0 : null,
        convidado_por_nome: p.convidado_por ? (nomes[p.convidado_por] || null) : null,
        carga: carga[p.id] || { conversas_abertas: 0, tarefas_abertas: 0, tarefas_atrasadas: 0 },
      };
    });
    return {
      ok: true, status: 200, pessoas, equipe: pessoas, equipes: equipes.error ? [] : (equipes.data || []),
      papeis: PAPEIS.map(p => ({ papel: p, nome: NOMES_PAPEL[p] })), apps: APPS.slice(),
      podeEditar: quem.papel === 'admin',
      avisos: auth.erro ? ['Não consegui ler o último login e a verificação em duas etapas agora (Auth fora do ar).'] : [],
    };
  }

  return { convidar, editar, desativar, reativar, redefinirSenha, removerMfa, listar, contar };
}

module.exports = {
  criarEquipe, gerarSenhaTemporaria, validarConvite, validarEdicao, checarMudanca, checarDesativar, situacao, appsDoPapel,
  PAPEIS, APPS_PADRAO, BAN_DESATIVADO, NOMES_PAPEL,
};
