'use strict';
/* As rotas da central da equipe por HTTP de verdade (porta livre), com banco
   e Auth Admin de mentira. "Authorization: Bearer <apelido>" faz o login falso. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const S = require('../lib/seguranca.js');
const AUD = require('../lib/auditoria.js');
const EQ = require('../lib/equipe.js');
const ROD = require('../lib/rodizio.js');
const TAR = require('../lib/tarefas.js');
const AUT = require('../lib/automacoes.js');
const { criarRotasEquipe, validarPreferencias } = require('../lib/rotas-equipe.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');
const { criarAuthFalsa } = require('./apoio/auth-falsa.js');

const ID = { admin: '90000000-0000-4000-8000-000000000001', gestor: '90000000-0000-4000-8000-000000000002',
  ana: '90000000-0000-4000-8000-000000000003', bia: '90000000-0000-4000-8000-000000000004',
  conv: '91000000-0000-4000-8000-000000000001', conv2: '91000000-0000-4000-8000-000000000002', cli: '92000000-0000-4000-8000-000000000001' };
const TODOS = ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'];
const AGORA = new Date('2026-10-14T13:00:00Z');

async function subir() {
  const t = {
    perfis: [
      { id: ID.admin, nome: 'Dono', email: 'dono@x.com', papel: 'admin', ativo: true, apps: TODOS, recebe_leads: false, preferencias: {} },
      { id: ID.gestor, nome: 'Gê', email: 'ge@x.com', papel: 'gestor', ativo: true, apps: TODOS, recebe_leads: false },
      { id: ID.ana, nome: 'Ana', email: 'ana@x.com', papel: 'atendente', ativo: true, apps: TODOS, recebe_leads: true, telefone: '12999990000' },
      { id: ID.bia, nome: 'Bia', email: 'bia@x.com', papel: 'atendente', ativo: true, apps: TODOS, recebe_leads: true },
    ],
    conversas: [
      { id: ID.conv, nome: 'Camila', cliente_id: ID.cli, atribuida_a: ID.ana, status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: '2026-10-14T12:00:00Z' },
      { id: ID.conv2, nome: 'Sem dono', atribuida_a: null, status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: '2026-10-14T12:00:00Z' },
    ],
    leads: [{ id: 'l1', cliente_id: ID.cli, status: 'contato', responsavel_id: ID.ana }],
    tarefas: [], auditoria: [], conversa_eventos: [], equipes: [],
  };
  const sb = criarSbFalso(t, { rpc: {
    registrar_auditoria: (a, db) => { db.auditoria.push({ id: db.auditoria.length + 1, perfil_id: a.p_perfil, app: a.p_app, acao: a.p_acao, tabela: a.p_tabela,
      registro_id: a.p_registro, detalhes: a.p_detalhes, created_at: new Date().toISOString() }); return { data: db.auditoria.length, error: null }; },
  } });
  const auth = criarAuthFalsa({ db: sb.db });
  for (const p of t.perfis) auth.semear({ id: p.id, email: p.email, last_sign_in_at: '2026-10-13T10:00:00Z' });
  const auditoria = AUD.criarAuditoria({ sb, log: () => {} });
  const auditar = auditoria.registrar;
  const esquecidos = [];
  const rodizio = ROD.criarRodizio({ sb, auditar, agora: () => AGORA, log: () => {} });
  const tratar = criarRotasEquipe({
    getSb: () => sb,
    usuarioLogado: async (req, opc = {}) => {
      const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
      if (!m) return null;
      if (m[1] === 'mfa') return opc.mfaPendenteOk ? { ...t.perfis[2], mfa: { ativo: true, nivel: 'aal1' }, mfaPendente: true } : null;
      const p = sb.db.perfis.find(x => x.nome.toLowerCase() === m[1] || x.papel === m[1]);
      return p && p.ativo ? { ...p, mfa: { ativo: false, nivel: 'aal1' } } : null;
    },
    limitar: (() => { const L = S.criarLimitador(); return (k, teto, j) => L.permitir(k, teto, j); })(),
    lerCorpo: req => S.lerCorpoJson(req),
    equipe: EQ.criarEquipe({ sb, authAdmin: auth.admin, auditar, esquecerPerfil: id => esquecidos.push(id), agora: () => AGORA, log: () => {} }),
    auditoria, tarefas: TAR.criarTarefas({ sb, auditar, agora: () => AGORA }), rodizio,
    automacoes: AUT.criarAutomacoes({ sb, rodizio, auditar, agora: () => AGORA, log: () => {} }),
    esquecerPerfil: id => esquecidos.push(id), log: () => {},
  });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!(await tratar(req, res, u.pathname, u.searchParams))) { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const chamar = async (metodo, caminho, { quem = 'admin', corpo, cru } = {}) => {
    const r = await fetch(base + caminho, { method: metodo, body: cru ?? (corpo ? JSON.stringify(corpo) : undefined),
      headers: { ...(quem ? { Authorization: `Bearer ${quem}` } : {}), 'Content-Type': 'application/json' } });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* csv */ }
    return { status: r.status, j, txt, h: r.headers };
  };
  return { sb, db: sb.db, auth, chamar, esquecidos, fechar: () => new Promise(r => server.close(r)) };
}

test('todas as rotas novas exigem login (401 com código)', async () => {
  const s = await subir();
  try {
    for (const [m, c] of [['GET', '/api/eu'], ['PATCH', '/api/eu'], ['GET', '/api/equipe'], ['POST', '/api/equipe'], ['GET', '/api/equipe/nomes'],
      ['PATCH', `/api/equipe/${ID.ana}`], ['POST', `/api/equipe/${ID.ana}/desativar`], ['POST', `/api/equipe/${ID.ana}/senha`],
      ['GET', '/api/auditoria'], ['GET', '/api/auditoria/exportar'], ['GET', '/api/tarefas/equipe'], ['POST', '/api/tarefas'],
      ['GET', '/api/rodizio'], ['GET', '/api/conversas/sem-dono'], ['POST', `/api/conversas/${ID.conv}/transferir`], ['POST', '/api/automacoes/rodar']]) {
      const r = await s.chamar(m, c, { quem: null, corpo: m === 'GET' ? undefined : {} });
      assert.equal(r.status, 401, `${m} ${c}`);
      assert.equal(r.j.codigo, 'sem_login');
    }
  } finally { await s.fechar(); }
});

test('GET /api/eu: contrato combinado com a tela; responde com MFA pendente; PATCH /api/eu valida e grava', async () => {
  const s = await subir();
  try {
    const r = await s.chamar('GET', '/api/eu', { quem: 'ana' });
    assert.equal(r.status, 200);
    for (const k of ['id', 'nome', 'email', 'papel', 'apps', 'cargo', 'telefone', 'precisa_trocar_senha', 'mfa', 'preferencias', 'pode']) assert.ok(k in r.j, k);
    assert.deepEqual(r.j.mfa, { ativo: false, nivel: 'aal1' });
    const m = await s.chamar('GET', '/api/eu', { quem: 'mfa' });
    assert.equal(m.status, 200); assert.equal(m.j.mfa_pendente, true);
    assert.equal((await s.chamar('PATCH', '/api/eu', { quem: 'ana', corpo: { avatar_cor: 'vermelho' } })).status, 400);
    assert.equal((await s.chamar('PATCH', '/api/eu', { quem: 'ana', corpo: { preferencias: { expediente: { dias: [1], inicio: '18:00', fim: '08:00' } } } })).status, 400);
    const ok = await s.chamar('PATCH', '/api/eu', { quem: 'ana', corpo: { cargo: 'Recepção', avatar_cor: '#AA0000', preferencias: { tema: 'escuro', notificacoes: { espera: false }, ausente_ate: '2026-10-20' }, papel: 'admin' } });
    assert.equal(ok.status, 200);
    const p = s.db.perfis.find(x => x.id === ID.ana);
    assert.equal(p.cargo, 'Recepção'); assert.equal(p.avatar_cor, '#aa0000');
    assert.deepEqual(p.preferencias, { tema: 'escuro', notificacoes: { espera: false }, ausente_ate: '2026-10-20' });
    assert.equal(p.papel, 'atendente', 'papel não muda por aqui');
    assert.ok(s.esquecidos.includes(ID.ana));
    assert.equal((await s.chamar('PATCH', '/api/eu', { quem: 'ana', cru: '{quebrado' })).j.codigo, 'json_invalido');
  } finally { await s.fechar(); }
});

test('equipe por HTTP: atendente não muda papel (403); gestor vê mas não convida; admin convida com senha 1x e edita', async () => {
  const s = await subir();
  try {
    assert.equal((await s.chamar('PATCH', `/api/equipe/${ID.ana}`, { quem: 'ana', corpo: { papel: 'admin' } })).status, 403);
    assert.equal((await s.chamar('POST', '/api/equipe/papel', { quem: 'ana', corpo: { id: ID.ana, papel: 'admin' } })).status, 403);
    assert.equal(s.db.perfis.find(p => p.id === ID.ana).papel, 'atendente');
    const g = await s.chamar('GET', '/api/equipe', { quem: 'gestor' });
    assert.equal(g.status, 200); assert.equal(g.j.pessoas.length, 4); assert.equal(g.j.podeEditar, false);
    assert.equal(g.j.equipe.length, 4); assert.equal(g.j.equipe[0].mfa_ativo, false);
    assert.equal((await s.chamar('GET', '/api/equipe', { quem: 'ana' })).status, 403);
    assert.equal((await s.chamar('POST', '/api/equipe', { quem: 'gestor', corpo: { nome: 'X', email: 'x@x.com' } })).status, 403);
    const c = await s.chamar('POST', '/api/equipe', { corpo: { nome: 'Carla', email: 'carla@x.com', senha: 'ignorada123' } });   // segredos:ignorar
    assert.equal(c.status, 201); assert.match(c.j.senha_temporaria, /^\w{4}-\w{4}-\w{4}$/);
    assert.equal(c.j.perfil.email, 'carla@x.com');
    assert.notEqual(s.auth.senhas.get(c.j.pessoa.id), 'ignorada123', 'senha vinda da tela é ignorada: o servidor gera');
    const e = await s.chamar('PATCH', `/api/equipe/${c.j.pessoa.id}`, { corpo: { cargo: 'Vendas', apps: ['atendimento'] } });
    assert.equal(e.status, 200); assert.deepEqual(e.j.mudou.sort(), ['apps', 'cargo']);
    const antigo = await s.chamar('POST', '/api/equipe/rodizio', { corpo: { id: c.j.pessoa.id, recebe: false } });
    assert.equal(antigo.status, 200); assert.equal(antigo.j.recebe, false);
    const n = await s.chamar('GET', '/api/equipe/nomes', { quem: 'ana' });
    assert.ok(n.j.equipe.every(p => !('email' in p) && !('telefone' in p)), 'nomes não leva e-mail/telefone');
    assert.equal(n.j.equipe.find(p => p.nome === 'Ana').atende, true);
  } finally { await s.fechar(); }
});

test('desativar com redistribuir: conversas abertas voltam ao rodízio; não desativa a si mesmo', async () => {
  const s = await subir();
  try {
    assert.equal((await s.chamar('POST', `/api/equipe/${ID.admin}/desativar`, { corpo: {} })).j.codigo, 'proprio_acesso');
    const r = await s.chamar('POST', `/api/equipe/${ID.ana}/desativar`, { corpo: { motivo: 'férias longas', redistribuir: true } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.j.redistribuidas, { ok: true, total: 1, movidas: 1 });
    assert.equal(s.db.conversas.find(c => c.id === ID.conv).atribuida_a, ID.bia);
    assert.equal(s.db.leads[0].responsavel_id, ID.bia, 'lead acompanhou');
    assert.equal((await s.chamar('GET', '/api/eu', { quem: 'ana' })).status, 401, 'desativado perde acesso');
    const v = await s.chamar('POST', `/api/equipe/${ID.ana}/reativar`, { corpo: {} });
    assert.equal(v.status, 200);
    const longo = await s.chamar('POST', `/api/equipe/${ID.ana}/senha-temporaria`);
    assert.equal(longo.status, 200, 'nome que a tela usa'); assert.ok(longo.j.senha_temporaria);
    const senha = await s.chamar('POST', `/api/equipe/${ID.ana}/senha`, { corpo: {} });
    assert.equal(senha.status, 200); assert.ok(senha.j.senha_temporaria);
  } finally { await s.fechar(); }
});

test('auditoria por HTTP: só admin; filtros; CSV auditado com nome de arquivo e sem segredos', async () => {
  const s = await subir();
  try {
    await s.chamar('POST', '/api/equipe', { corpo: { nome: 'Dani', email: 'dani@x.com' } });
    assert.equal((await s.chamar('GET', '/api/auditoria', { quem: 'gestor' })).status, 403);
    assert.equal((await s.chamar('GET', '/api/auditoria?pessoa=xx')).status, 400);
    const r = await s.chamar('GET', '/api/auditoria?acao=equipe&por_pagina=10');
    assert.equal(r.status, 200); assert.equal(r.j.total, 1); assert.equal(r.j.itens[0].acao, 'equipe.convidar'); assert.equal(r.j.itens[0].pessoa, 'Dono');
    assert.equal(r.j.itens[0].perfil_nome, 'Dono');
    assert.equal((await s.chamar('GET', '/api/auditoria.csv?acao=equipe')).status, 200, 'nome que a tela usa');
    const csv = await s.chamar('GET', '/api/auditoria/exportar?acao=equipe');
    assert.equal(csv.status, 200);
    assert.match(csv.h.get('content-type'), /text\/csv/);
    assert.match(csv.h.get('content-disposition'), /attachment; filename="auditoria-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.match(csv.txt, /equipe\.convidar/);
    assert.ok(s.db.auditoria.some(a => a.acao === 'auditoria.exportar' && a.detalhes.linhas === 1), 'exportar fica auditado');
  } finally { await s.fechar(); }
});

test('tarefas, rodízio, sem dono e transferência por HTTP', async () => {
  const s = await subir();
  try {
    const t = await s.chamar('POST', '/api/tarefas', { quem: 'ana', corpo: { titulo: 'Ligar para a Camila', conversa_id: ID.conv, vence_em: '2026-10-15' } });
    assert.equal(t.status, 201); assert.equal(t.j.tarefa.responsavel_id, ID.ana);
    assert.equal((await s.chamar('GET', '/api/tarefas/equipe', { quem: 'ana' })).status, 403);
    assert.equal((await s.chamar('GET', `/api/tarefas/equipe?pessoa=${ID.ana}`, { quem: 'ana' })).j.tarefas.length, 1);
    const carga = await s.chamar('GET', '/api/tarefas/equipe', { quem: 'gestor' });
    assert.equal(carga.j.pessoas.find(p => p.nome === 'Ana').abertas, 1);
    assert.equal((await s.chamar('GET', '/api/rodizio', { quem: 'gestor' })).j.proximo.nome, 'Bia');
    const sd = await s.chamar('GET', '/api/conversas/sem-dono?minutos=30', { quem: 'gestor' });
    assert.equal(sd.j.total, 1);
    assert.equal((await s.chamar('GET', '/api/conversas/sem-dono', { quem: 'ana' })).status, 403);
    const d = await s.chamar('POST', `/api/conversas/${ID.conv2}/distribuir`, { quem: 'ana', corpo: {} });
    assert.equal(d.status, 200); assert.equal(d.j.para.nome, 'Bia');
    assert.equal((await s.chamar('POST', `/api/conversas/${ID.conv}/transferir`, { quem: 'bia', corpo: { para: ID.bia, motivo: 'quero' } })).status, 403);
    const tr = await s.chamar('POST', `/api/conversas/${ID.conv}/transferir`, { quem: 'ana', corpo: { para: ID.bia, motivo: 'vou sair mais cedo' } });
    assert.equal(tr.status, 200); assert.equal(tr.j.leads_movidos, 1);
    assert.ok(s.db.auditoria.some(a => a.acao === 'conversa.transferir' && a.detalhes.motivo === 'vou sair mais cedo'));
  } finally { await s.fechar(); }
});

test('automações sob demanda: só admin, tarefa válida, auditado', async () => {
  const s = await subir();
  try {
    assert.equal((await s.chamar('POST', '/api/automacoes/rodar', { quem: 'gestor', corpo: { tarefa: 'resumo' } })).status, 403);
    assert.equal((await s.chamar('POST', '/api/automacoes/rodar', { corpo: { tarefa: 'xpto' } })).status, 400);
    const r = await s.chamar('POST', '/api/automacoes/rodar', { corpo: { tarefa: 'donos' } });
    assert.equal(r.status, 200); assert.equal(r.j.tarefa, 'donos');
    assert.ok(s.db.auditoria.some(a => a.acao === 'automacao.rodar'));
  } finally { await s.fechar(); }
});

test('validarPreferencias: só o que é conhecido passa', () => {
  assert.deepEqual(validarPreferencias({ tema: 'claro', qualquer: 1, notificacoes: { espera: 'sim', som: true, x: 1 } }).preferencias,
    { tema: 'claro', notificacoes: { espera: false, som: true } });
  assert.ok(validarPreferencias([]).erro);
  assert.ok(validarPreferencias({ tema: 'rosa' }).erro);
  assert.ok(validarPreferencias({ x: 'a'.repeat(5000) }).erro);
  assert.deepEqual(validarPreferencias({ expediente: { dias: [3, 1, 1], inicio: '08:00', fim: '12:00' } }).preferencias.expediente, { dias: [1, 3], inicio: '08:00', fim: '12:00' });
});

/* ---------------- rodada 4: preferências são de todos os apps ---------------- */
const { mesclarPreferencias } = require('../lib/rotas-equipe.js');
test('mesclarPreferencias: merge profundo, sem efeito colateral; valor simples/lista/null substitui', () => {
  const base = { tema: 'claro', notificacoes: { espera: true, agenda_x: true }, agenda: { visao: 'semana' } };
  const r = mesclarPreferencias(base, { notificacoes: { espera: false }, tour_visto: 'v1-gestor' });
  assert.deepEqual(r, { tema: 'claro', notificacoes: { espera: false, agenda_x: true }, agenda: { visao: 'semana' }, tour_visto: 'v1-gestor' });
  assert.deepEqual(base.notificacoes, { espera: true, agenda_x: true }, 'não mexe no original');
  assert.deepEqual(mesclarPreferencias(null, { a: 1 }), { a: 1 });
  assert.deepEqual(mesclarPreferencias({ a: { b: 1 } }, { a: null }), { a: null });
  assert.deepEqual(mesclarPreferencias({ l: [1, 2] }, { l: [3] }), { l: [3] });
  assert.deepEqual(mesclarPreferencias({ a: 1 }, 'lixo'), { a: 1 });
});

test('PATCH /api/eu: lê o valor ATUAL do banco e não apaga o que outro app guardou', async () => {
  const s = await subir();
  try {
    await s.chamar('GET', '/api/eu', { quem: 'ana' });                 // porteiro guarda a cópia
    const p = s.db.perfis.find(x => x.id === ID.ana);
    // outro app (Agenda/CRM) grava depois da cópia do porteiro
    p.preferencias = { tema: 'claro', agenda: { visao: 'semana' }, notificacoes: { espera: true, lead: false, chave_do_crm: true } };
    const r = await s.chamar('PATCH', '/api/eu', { quem: 'ana', corpo: { preferencias: { notificacoes: { espera: false } } } });
    assert.equal(r.status, 200);
    assert.deepEqual(p.preferencias, { tema: 'claro', agenda: { visao: 'semana' }, notificacoes: { espera: false, lead: false, chave_do_crm: true } });
    assert.deepEqual(r.j.preferencias, p.preferencias, 'a tela recebe o valor mesclado');
    await s.chamar('PATCH', '/api/eu', { quem: 'ana', corpo: { preferencias: { tour_visto: 'v1-atendente' } } });
    assert.equal(p.preferencias.agenda.visao, 'semana'); assert.equal(p.preferencias.tour_visto, 'v1-atendente');
    assert.equal(p.preferencias.notificacoes.chave_do_crm, true);
  } finally { await s.fechar(); }
});
