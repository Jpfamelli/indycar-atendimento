'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lib/equipe.js');
const AUD = require('../lib/auditoria.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');
const { criarAuthFalsa } = require('./apoio/auth-falsa.js');

const ID = { admin: 'bbbbbbbb-0000-4000-8000-000000000001', admin2: 'bbbbbbbb-0000-4000-8000-000000000002',
  gestor: 'bbbbbbbb-0000-4000-8000-000000000003', ana: 'bbbbbbbb-0000-4000-8000-000000000004',
  bia: 'bbbbbbbb-0000-4000-8000-000000000005', franklin: 'bbbbbbbb-0000-4000-8000-000000000006' };
const TODOS = ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'];
const ADMIN = { id: ID.admin, papel: 'admin' }, GESTOR = { id: ID.gestor, papel: 'gestor' }, ANA = { id: ID.ana, papel: 'atendente' };

function montar({ doisAdmins = false, falhar = {}, falhasDb = {}, semGatilho = false } = {}) {
  const t = {
    perfis: [
      { id: ID.admin, nome: 'Dono', email: 'dono@x.com', papel: 'admin', ativo: true, apps: TODOS, recebe_leads: false },
      ...(doisAdmins ? [{ id: ID.admin2, nome: 'Sócio', email: 'socio@x.com', papel: 'admin', ativo: true, apps: TODOS, recebe_leads: false }] : []),
      { id: ID.gestor, nome: 'Gê', email: 'ge@x.com', papel: 'gestor', ativo: true, apps: TODOS, recebe_leads: false },
      { id: ID.ana, nome: 'Ana', email: 'ana@x.com', papel: 'atendente', ativo: true, apps: TODOS, recebe_leads: true, ultimo_acesso_em: '2026-10-13T11:00:00Z' },
      { id: ID.bia, nome: 'Bia', email: 'bia@x.com', papel: 'atendente', ativo: true, apps: ['crm'], recebe_leads: false },
      { id: ID.franklin, nome: 'Franklin', email: 'f@x.com', papel: 'agenda', ativo: true, apps: ['agenda'], recebe_leads: false },
    ],
    conversas: [{ id: 'c1', atribuida_a: ID.ana, status: 'aberta' }, { id: 'c2', atribuida_a: ID.ana, status: 'resolvida' }],
    tarefas: [{ id: 't1', responsavel_id: ID.ana, status: 'aberta', vence_em: '2026-10-01T12:00:00Z' }],
    equipes: [{ id: 'e1', nome: 'Balcão', cor: '#f00' }],
    auditoria: [],
  };
  const rpcs = [];
  const sb = criarSbFalso(t, { falhas: falhasDb, rpc: {
    registrar_auditoria: (args, db) => { rpcs.push(args); db.auditoria.push({ id: db.auditoria.length + 1, ...args }); return { data: db.auditoria.length, error: null }; },
  } });
  const auth = criarAuthFalsa({ db: sb.db, falhar, semGatilho });
  for (const p of t.perfis) auth.semear({ id: p.id, email: p.email, last_sign_in_at: p.id === ID.bia ? null : '2026-10-12T10:00:00Z',
    factors: p.id === ID.gestor ? [{ id: 'f1', status: 'verified', factor_type: 'totp' }, { id: 'f2', status: 'unverified' }] : [] });
  const esquecidos = [];
  const logs = [];
  const aud = AUD.criarAuditoria({ sb, log: (...a) => logs.push(a.join(' ')) });
  const eq = E.criarEquipe({ sb, authAdmin: auth.admin, auditar: aud.registrar, esquecerPerfil: id => esquecidos.push(id),
    agora: () => new Date('2026-10-13T13:00:00Z'), log: (...a) => logs.push(a.join(' ')) });
  return { sb, db: sb.db, auth, eq, rpcs, esquecidos, logs };
}

/** Captura tudo que vai para o console durante fn. */
async function capturarConsole(fn) {
  const saida = [];
  const orig = {};
  for (const k of ['log', 'error', 'warn', 'info', 'debug']) { orig[k] = console[k]; console[k] = (...a) => saida.push(a.map(String).join(' ')); }
  try { return { r: await fn(), saida }; } finally { Object.assign(console, orig); }
}

test('senha temporária: 3 blocos de 4, maiúscula+minúscula+número, sem letras ambíguas, nunca repete', () => {
  const vistas = new Set();
  for (let i = 0; i < 300; i++) {
    const s = E.gerarSenhaTemporaria();
    assert.match(s, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    assert.match(s, /[A-Z]/); assert.match(s, /[a-z]/); assert.match(s, /\d/);
    assert.doesNotMatch(s, /[0O1lI]/);
    vistas.add(s);
  }
  assert.equal(vistas.size, 300);
});

test('convidar: só admin; cria no Auth com email_confirm, perfil completo com precisa_trocar_senha e convidado_por; auditado', async () => {
  const { eq, db, auth, rpcs } = montar();
  assert.equal((await eq.convidar(GESTOR, { nome: 'X', email: 'x@x.com' })).status, 403);
  assert.equal((await eq.convidar(ANA, { nome: 'X', email: 'x@x.com' })).codigo, 'so_admin');
  const r = await eq.convidar(ADMIN, { nome: '  Carla Dias ', email: 'Carla@IndyCar.com', papel: 'atendente', cargo: 'Recepção', telefone: '(12) 99999-0000', equipe_id: 'e1aaaaaa-0000-4000-8000-000000000000' });
  assert.equal(r.ok, true); assert.equal(r.status, 201);
  assert.match(r.senha_temporaria, /^\w{4}-\w{4}-\w{4}$/);
  const c = auth.chamadas.find(x => x.nome === 'createUser');
  assert.equal(c.args.email, 'carla@indycar.com');
  assert.equal(c.args.email_confirm, true);
  assert.equal(auth.senhas.get(r.pessoa.id), r.senha_temporaria, 'a senha aplicada é a devolvida');
  const p = db.perfis.find(x => x.id === r.pessoa.id);
  assert.equal(p.nome, 'Carla Dias'); assert.equal(p.papel, 'atendente'); assert.equal(p.precisa_trocar_senha, true);
  assert.equal(p.convidado_por, ID.admin); assert.equal(p.cargo, 'Recepção'); assert.equal(p.telefone, '12999990000');
  assert.deepEqual(p.apps, E.APPS_PADRAO.atendente);
  const a = rpcs.find(x => x.p_acao === 'equipe.convidar');
  assert.equal(a.p_perfil, ID.admin); assert.equal(a.p_registro, r.pessoa.id); assert.equal(a.p_app, 'atendimento');
  assert.equal(a.p_detalhes.email, 'carla@indycar.com');
});

test('senha temporária nunca é logada nem auditada nem guardada no registro do Auth', async () => {
  const m = montar();
  const { r, saida } = await capturarConsole(async () => {
    const c = await m.eq.convidar(ADMIN, { nome: 'Dani', email: 'dani@x.com' });
    const s = await m.eq.redefinirSenha(ADMIN, ID.ana);
    return [c.senha_temporaria, s.senha_temporaria];
  });
  for (const senha of r) {
    assert.ok(senha);
    assert.ok(!saida.some(l => l.includes(senha)), 'console');
    assert.ok(!m.logs.some(l => l.includes(senha)), 'log injetado');
    assert.ok(!JSON.stringify(m.rpcs).includes(senha), 'auditoria');
    assert.ok(!JSON.stringify(m.auth.chamadas).includes(senha), 'registro de chamadas');
    assert.ok(!JSON.stringify(m.db.perfis).includes(senha), 'perfis');
  }
});

test('convidar: validação, e-mail repetido (ativo e desativado), papel agenda só com a Agenda, rollback se o perfil falhar', async () => {
  const m = montar();
  assert.equal((await m.eq.convidar(ADMIN, { nome: 'A', email: 'a@x.com' })).campo, 'nome');
  assert.equal((await m.eq.convidar(ADMIN, { nome: 'Ana', email: 'nao-e-email' })).campo, 'email');
  assert.equal((await m.eq.convidar(ADMIN, { nome: 'Ana', email: 'a@x.com', papel: 'chefe' })).campo, 'papel');
  assert.equal((await m.eq.convidar(ADMIN, { nome: 'Ana', email: 'a@x.com', apps: 'crm' })).campo, 'apps');
  assert.equal((await m.eq.convidar(ADMIN, { nome: 'Ana', email: 'a@x.com', apps: ['nada'] })).campo, 'apps');
  const rep = await m.eq.convidar(ADMIN, { nome: 'Ana 2', email: 'ana@x.com' });
  assert.equal(rep.status, 409); assert.equal(rep.codigo, 'email_existe');
  m.db.perfis.find(p => p.id === ID.bia).ativo = false;
  assert.match((await m.eq.convidar(ADMIN, { nome: 'Bia', email: 'bia@x.com' })).erro, /Reative/);
  const ag = await m.eq.convidar(ADMIN, { nome: 'Zé Pátio', email: 'ze@x.com', papel: 'agenda', apps: TODOS });
  const pz = m.db.perfis.find(p => p.id === ag.pessoa.id);
  assert.deepEqual(pz.apps, ['agenda']); assert.equal(pz.recebe_leads, false);

  const f = montar({ falhasDb: { perfis: { op: 'update', msg: 'new row violates check constraint "perfis_papel_check"' } } });
  const g = await f.eq.convidar(ADMIN, { nome: 'Gestora', email: 'g2@x.com', papel: 'gestor' });
  assert.equal(g.ok, false); assert.equal(g.codigo, 'papel_nao_aceito');
  assert.ok(f.auth.chamadas.some(c => c.nome === 'deleteUser'), 'login desfeito: não fica conta solta');
  assert.ok(!f.rpcs.some(x => x.p_acao === 'equipe.convidar'));
});

test('convidar sem o gatilho do banco: o servidor cria o perfil', async () => {
  const m = montar({ semGatilho: true });
  const r = await m.eq.convidar(ADMIN, { nome: 'Edu', email: 'edu@x.com', papel: 'gestor' });
  assert.equal(r.ok, true);
  const p = m.db.perfis.find(x => x.id === r.pessoa.id);
  assert.equal(p.papel, 'gestor'); assert.deepEqual(p.apps, TODOS);
});

test('editar: atendente e gestor não mudam papel; ninguém muda o próprio papel; último admin protegido; auditoria com antes/depois', async () => {
  const m = montar();
  assert.equal((await m.eq.editar(ANA, ID.ana, { papel: 'admin' })).status, 403, 'atendente não se promove');
  assert.equal((await m.eq.editar(GESTOR, ID.ana, { papel: 'gestor' })).status, 403, 'gestor só vê');
  const proprio = await m.eq.editar(ADMIN, ID.admin, { papel: 'atendente' });
  assert.equal(proprio.codigo, 'proprio_papel');
  const m2 = montar({ doisAdmins: true });
  m2.db.perfis.find(p => p.id === ID.admin2).ativo = false;
  assert.equal((await m2.eq.editar({ id: ID.admin2, papel: 'admin' }, ID.admin, { papel: 'gestor' })).codigo, 'ultimo_admin');
  m2.db.perfis.find(p => p.id === ID.admin2).ativo = true;
  const ok = await m2.eq.editar(ADMIN, ID.admin2, { papel: 'gestor' });
  assert.equal(ok.ok, true); assert.deepEqual(ok.mudou, ['papel']);
  const a = m2.rpcs.find(x => x.p_acao === 'equipe.editar');
  assert.deepEqual(a.p_detalhes, { antes: { papel: 'admin' }, depois: { papel: 'gestor' } });
  assert.ok(m2.esquecidos.includes(ID.admin2), 'cache do porteiro esquecido');
});

test('editar: apps, cargo, equipe, telefone; papel agenda força só a Agenda; último do rodízio protegido; nada mudou = ok sem gravar', async () => {
  const m = montar();
  const r = await m.eq.editar(ADMIN, ID.bia, { apps: ['atendimento', 'crm', 'x'], cargo: 'Vendas', telefone: '12 98888-7777', recebe_leads: true });
  assert.equal(r.ok, true);
  const b = m.db.perfis.find(p => p.id === ID.bia);
  assert.deepEqual(b.apps, ['atendimento', 'crm']); assert.equal(b.cargo, 'Vendas'); assert.equal(b.telefone, '12988887777'); assert.equal(b.recebe_leads, true);
  const ag = await m.eq.editar(ADMIN, ID.bia, { papel: 'agenda' });
  assert.equal(ag.ok, true);
  assert.deepEqual(b.apps, ['agenda']); assert.equal(b.recebe_leads, false);
  assert.equal((await m.eq.editar(ADMIN, ID.ana, { recebe_leads: false })).codigo, 'ultimo_rodizio');
  assert.equal((await m.eq.editar(ADMIN, ID.ana, { apps: [] })).campo, 'apps');
  assert.equal((await m.eq.editar(ADMIN, ID.ana, { telefone: '12' })).campo, 'telefone');
  assert.equal((await m.eq.editar(ADMIN, ID.ana, { recebe_leads: 'sim' })).campo, 'recebe_leads');
  assert.equal((await m.eq.editar(ADMIN, 'nao-uuid', { cargo: 'x' })).status, 400);
  assert.equal((await m.eq.editar(ADMIN, 'bbbbbbbb-0000-4000-8000-0000000000ff', { cargo: 'x' })).status, 404);
  const antes = m.rpcs.length;
  const nada = await m.eq.editar(ADMIN, ID.ana, { cargo: undefined, nome: 'Ana' });
  assert.deepEqual(nada.mudou, []); assert.equal(m.rpcs.length, antes, 'sem auditoria à toa');
});

test('desativar: não a si mesmo, não o último admin; ban de 100 anos no Auth, sai do rodízio, cache esquecido, auditado; reativar tira o ban', async () => {
  const m = montar();
  assert.equal((await m.eq.desativar(ADMIN, ID.admin)).codigo, 'proprio_acesso');
  assert.equal((await m.eq.desativar(ANA, ID.bia)).status, 403);
  const m2 = montar({ doisAdmins: true });
  m2.db.perfis.find(p => p.id === ID.admin).ativo = false;
  assert.equal((await m2.eq.desativar({ id: ID.gestor, papel: 'admin' }, ID.admin2)).codigo, 'ultimo_admin');

  const r = await m.eq.desativar(ADMIN, ID.ana, { motivo: 'saiu da empresa' });
  assert.equal(r.ok, true); assert.equal(r.sessoes, 'derrubadas');
  const p = m.db.perfis.find(x => x.id === ID.ana);
  assert.equal(p.ativo, false); assert.equal(p.desativado_por, ID.admin); assert.ok(p.desativado_em); assert.equal(p.recebe_leads, false);
  assert.deepEqual(m.auth.chamadas.find(c => c.nome === 'updateUserById').args, { id: ID.ana, ban_duration: E.BAN_DESATIVADO });
  assert.ok(m.esquecidos.includes(ID.ana));
  assert.equal(m.rpcs.find(x => x.p_acao === 'equipe.desativar').p_detalhes.motivo, 'saiu da empresa');
  assert.equal((await m.eq.desativar(ADMIN, ID.ana)).jaEstava, true);

  const v = await m.eq.reativar(ADMIN, ID.ana);
  assert.equal(v.ok, true);
  assert.equal(p.ativo, true); assert.equal(p.desativado_em, null);
  assert.ok(m.auth.chamadas.some(c => c.nome === 'updateUserById' && c.args.ban_duration === 'none'));
  assert.ok(m.rpcs.some(x => x.p_acao === 'equipe.reativar'));
});

test('desativar com o Auth fora: acesso desligado aqui e aviso claro', async () => {
  const m = montar({ falhar: { updateUserById: 'down' } });
  const r = await m.eq.desativar(ADMIN, ID.bia);
  assert.equal(r.ok, true); assert.equal(r.sessoes, 'nao_derrubadas'); assert.match(r.aviso, /não confirmou/);
  assert.equal(m.db.perfis.find(x => x.id === ID.bia).ativo, false);
  assert.equal((await m.eq.reativar(ADMIN, ID.bia)).status, 502, 'sem tirar o ban não reativa pela metade');
});

test('redefinir senha: só admin, não a própria, não de desativado; marca troca obrigatória; auditado sem a senha', async () => {
  const m = montar();
  assert.equal((await m.eq.redefinirSenha(GESTOR, ID.ana)).status, 403);
  assert.equal((await m.eq.redefinirSenha(ADMIN, ID.admin)).codigo, 'propria_senha');
  m.db.perfis.find(p => p.id === ID.bia).ativo = false;
  assert.equal((await m.eq.redefinirSenha(ADMIN, ID.bia)).codigo, 'desativado');
  const r = await m.eq.redefinirSenha(ADMIN, ID.ana);
  assert.equal(r.ok, true);
  assert.equal(m.auth.senhas.get(ID.ana), r.senha_temporaria);
  assert.equal(m.db.perfis.find(p => p.id === ID.ana).precisa_trocar_senha, true);
  assert.deepEqual(m.rpcs.find(x => x.p_acao === 'equipe.redefinir_senha').p_detalhes, { troca_obrigatoria: true });
});

test('remover MFA (perdeu o celular): apaga os fatores no Auth e audita', async () => {
  const m = montar();
  const r = await m.eq.removerMfa(ADMIN, ID.gestor);
  assert.equal(r.ok, true); assert.equal(r.removidos, 2);
  assert.equal(m.auth.usuarios.get(ID.gestor).factors.length, 0);
  assert.equal(m.rpcs.find(x => x.p_acao === 'equipe.remover_mfa').p_detalhes.fatores_removidos, 2);
  assert.equal((await m.eq.removerMfa(ANA, ID.gestor)).status, 403);
});

test('listar: admin e gestor; último acesso/login, apps, MFA verificado, situação, carga e quem convidou', async () => {
  const m = montar();
  assert.equal((await m.eq.listar(ANA)).status, 403);
  m.db.perfis.find(p => p.id === ID.bia).convidado_por = ID.admin;
  const r = await m.eq.listar(GESTOR);
  assert.equal(r.ok, true); assert.equal(r.podeEditar, false);
  const por = Object.fromEntries(r.pessoas.map(p => [p.nome, p]));
  assert.deepEqual(por['Gê'].mfa, { ativo: true, fatores: 1 });
  assert.equal(por['Ana'].mfa.ativo, false);
  assert.equal(por['Ana'].ultimo_acesso_em, '2026-10-13T11:00:00Z');
  assert.equal(por['Ana'].ultimo_login_em, '2026-10-12T10:00:00Z');
  assert.deepEqual(por['Ana'].carga, { conversas_abertas: 1, tarefas_abertas: 1, tarefas_atrasadas: 1 });
  assert.equal(por['Bia'].situacao, 'convite_pendente');
  assert.equal(por['Bia'].convidado_por_nome, 'Dono');
  assert.equal(por['Gê'].eu, true);
  assert.equal(por['Franklin'].papel_nome, 'agenda (só presença)');
  assert.deepEqual(por['Dono'].apps, TODOS);
  assert.equal(r.equipes[0].nome, 'Balcão');
  assert.equal((await m.eq.listar(ADMIN)).podeEditar, true);
});

test('listar com o Auth fora: lista do banco e aviso', async () => {
  const m = montar({ falhar: { listUsers: 'fora' } });
  const r = await m.eq.listar(ADMIN);
  assert.equal(r.ok, true); assert.equal(r.avisos.length, 1);
  assert.equal(r.pessoas.find(p => p.nome === 'Ana').mfa.ativo, null);
});

test('regras puras: checarMudanca / checarDesativar / situacao / appsDoPapel', () => {
  const c = { adminsAtivos: 2, rodizioAtivos: 2 };
  assert.equal(E.checarMudanca({ quem: ADMIN, alvo: { id: ID.ana, papel: 'atendente', ativo: true }, muda: { papel: 'gestor' }, contagem: c }), null);
  assert.equal(E.checarDesativar({ quem: ADMIN, alvo: { id: ID.ana, papel: 'admin', ativo: true }, contagem: { adminsAtivos: 1 } }).codigo, 'ultimo_admin');
  assert.equal(E.situacao({ ativo: true, precisa_trocar_senha: true }, { last_sign_in_at: 'x' }), 'precisa_trocar_senha');
  assert.equal(E.situacao({ ativo: false }, null), 'desativado');
  assert.deepEqual(E.appsDoPapel('admin', ['crm']), TODOS);
});
