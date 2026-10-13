'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tarefas.js');
const AUD = require('../lib/auditoria.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');

const ID = { ana: 'f0000000-0000-4000-8000-000000000001', bia: 'f0000000-0000-4000-8000-000000000002',
  gestor: 'f0000000-0000-4000-8000-000000000003', fora: 'f0000000-0000-4000-8000-000000000004',
  conv: 'f0000000-0000-4000-8000-0000000000c1' };
const AGORA = new Date('2026-10-14T13:00:00Z');       // quarta 10h em SP

/* ---------------- tarefas ---------------- */
test('prazoPadrao: hoje 17:30; depois das 17h ou domingo → próximo dia útil 17:30', () => {
  assert.equal(T.prazoPadrao(AGORA), '2026-10-14T20:30:00.000Z');
  assert.equal(T.prazoPadrao(new Date('2026-10-14T21:00:00Z')), '2026-10-15T20:30:00.000Z');
  assert.equal(T.prazoPadrao(new Date('2026-10-17T21:00:00Z')), '2026-10-19T20:30:00.000Z', 'sábado à noite → segunda');
  assert.equal(T.prazoPadrao(new Date('2026-10-18T13:00:00Z')), '2026-10-19T20:30:00.000Z', 'domingo → segunda');
});

test('validarTarefa: título, UUIDs, prioridade 1–3, prazo (só o dia = 17:30), passado e longe demais recusados', () => {
  assert.equal(T.validarTarefa({}).campo, 'titulo');
  assert.equal(T.validarTarefa({ titulo: 'x', conversa_id: 'abc' }).campo, 'conversa_id');
  assert.equal(T.validarTarefa({ titulo: 'x', prioridade: 5 }).campo, 'prioridade');
  assert.equal(T.validarTarefa({ titulo: 'x', vence_em: 'amanhã' }).campo, 'vence_em');
  assert.equal(T.validarTarefa({ titulo: 'x', vence_em: '2026-10-01' }, { agora: AGORA }).campo, 'vence_em');
  assert.equal(T.validarTarefa({ titulo: 'x', vence_em: '2028-01-01' }, { agora: AGORA }).campo, 'vence_em');
  const ok = T.validarTarefa({ titulo: '  Ligar para a Camila ', vence_em: '2026-10-15', prioridade: '1', conversa_id: ID.conv }, { agora: AGORA, origem: 'ia' });
  assert.deepEqual(ok.dados, { titulo: 'Ligar para a Camila', descricao: null, conversa_id: ID.conv, prioridade: 1, vence_em: '2026-10-15T20:30:00.000Z', origem: 'ia' });
});

function montarTarefas() {
  const sb = criarSbFalso({
    perfis: [{ id: ID.ana, nome: 'Ana', papel: 'atendente', ativo: true }, { id: ID.bia, nome: 'Bia', papel: 'atendente', ativo: true },
             { id: ID.gestor, nome: 'Gê', papel: 'gestor', ativo: true }, { id: ID.fora, nome: 'Ex', papel: 'atendente', ativo: false }],
    tarefas: [
      { id: 't1', responsavel_id: ID.ana, status: 'aberta', vence_em: '2026-10-13T20:30:00Z', prioridade: 1 },
      { id: 't2', responsavel_id: ID.ana, status: 'aberta', vence_em: '2026-10-14T20:30:00Z', prioridade: 2 },
      { id: 't3', responsavel_id: ID.bia, status: 'aberta', vence_em: null, prioridade: 2 },
      { id: 't4', responsavel_id: null, status: 'aberta' }, { id: 't5', responsavel_id: ID.bia, status: 'feita' },
    ],
    conversas: [{ atribuida_a: ID.ana, status: 'aberta', aguardando_consultor: true }, { atribuida_a: ID.bia, status: 'aberta' }, { atribuida_a: ID.bia, status: 'resolvida' }],
  });
  const auds = [];
  return { sb, db: sb.db, auds, t: T.criarTarefas({ sb, auditar: async a => { auds.push(a); return { ok: true }; }, agora: () => AGORA }) };
}

test('criar: para si (padrão), para outra pessoa só gestor; responsável inativo recusado; criado_por do servidor; auditado', async () => {
  const { t, db, auds } = montarTarefas();
  const ANA = { id: ID.ana, papel: 'atendente' };
  const r = await t.criar(ANA, { titulo: 'Conferir peça', conversa_id: ID.conv });
  assert.equal(r.status, 201);
  const nova = db.tarefas.find(x => x.id === r.tarefa.id);
  assert.equal(nova.responsavel_id, ID.ana); assert.equal(nova.criado_por, ID.ana); assert.equal(nova.origem, 'atendimento'); assert.equal(nova.status, 'aberta');
  assert.equal((await t.criar(ANA, { titulo: 'Para a Bia', responsavel_id: ID.bia })).codigo, 'so_gestor');
  assert.equal((await t.criar({ id: ID.gestor, papel: 'gestor' }, { titulo: 'Para a Bia', responsavel_id: ID.bia })).status, 201);
  assert.equal((await t.criar({ id: ID.gestor, papel: 'gestor' }, { titulo: 'Para o Ex', responsavel_id: ID.fora })).codigo, 'responsavel_invalido');
  assert.equal((await t.criar(ANA, { titulo: 'x', origem: 'automacao' })).tarefa.origem, 'atendimento', 'origem livre não passa pela rota');
  assert.equal(auds.filter(a => a.acao === 'tarefa.criar').length, 3);
});

test('carga da equipe (gestor): abertas, atrasadas, vencem hoje, urgentes, conversas; atendente → 403', async () => {
  const { t } = montarTarefas();
  assert.equal((await t.cargaDaEquipe({ id: ID.ana, papel: 'atendente' })).status, 403);
  const r = await t.cargaDaEquipe({ id: ID.gestor, papel: 'gestor' });
  const ana = r.pessoas.find(p => p.nome === 'Ana');
  const { id, avatar_cor, cargo, ...resto } = ana;
  assert.deepEqual(resto, { nome: 'Ana', papel: 'atendente', recebe_leads: true,
    abertas: 2, atrasadas: 1, vencem_hoje: 1, urgentes: 1, sem_prazo: 0, conversas_abertas: 1, aguardando_consultor: 1,
    perfil_id: ID.ana, tarefas_abertas: 2, tarefas_atrasadas: 1, tarefas_hoje: 1 });
  assert.equal(r.equipe, r.pessoas, 'a tela lê "equipe"');
  assert.equal(r.pessoas[0].nome, 'Ana', 'quem tem atrasada vem primeiro');
  assert.equal(r.pessoas.find(p => p.nome === 'Bia').sem_prazo, 1);
  assert.deepEqual(r.total, { abertas: 3, atrasadas: 1, vencem_hoje: 1, sem_responsavel: 1 });
  assert.ok(!r.pessoas.some(p => p.nome === 'Ex'), 'desativado fora');
});

test('daPessoa: atendente só as dele; gestor de qualquer um; atrasada marcada', async () => {
  const { t } = montarTarefas();
  assert.equal((await t.daPessoa({ id: ID.bia, papel: 'atendente' }, ID.ana)).status, 403);
  const r = await t.daPessoa({ id: ID.gestor, papel: 'gestor' }, ID.ana);
  assert.equal(r.tarefas.length, 2);
  assert.equal(r.tarefas.find(x => x.id === 't1').atrasada, true);
  assert.equal(r.tarefas.find(x => x.id === 't2').atrasada, false);
  assert.equal((await t.daPessoa({ id: ID.ana, papel: 'atendente' }, ID.ana, { status: 'xx' })).status, 400);
});

/* ---------------- auditoria ---------------- */
function montarAud() {
  const linhas = [];
  for (let i = 1; i <= 7; i++) linhas.push({ id: i, perfil_id: i % 2 ? ID.ana : null, app: 'atendimento', acao: i <= 4 ? 'equipe.editar' : 'conversa.excluir',
    tabela: i <= 4 ? 'perfis' : 'conversas', registro_id: `r${i}`, detalhes: { motivo: 'x', senha: 'nunca' }, created_at: `2026-10-${String(5 + i).padStart(2, '0')}T15:00:00Z` });
  const rpcs = [];
  const sb = criarSbFalso({ auditoria: linhas, perfis: [{ id: ID.ana, nome: 'Ana' }] }, { rpc: {
    registrar_auditoria: args => { rpcs.push(args); return { data: 99, error: null }; } } });
  return { aud: AUD.criarAuditoria({ sb, log: () => {} }), rpcs };
}

test('filtros: pessoa (UUID), tabela, ação por prefixo, período (dias de SP) e paginação; inválidos → erro', async () => {
  const { aud } = montarAud();
  assert.match(aud.lerFiltros({ pessoa: 'x' }).erro, /Pessoa/);
  assert.match(aud.lerFiltros({ tabela: 'perfis; drop' }).erro, /Tabela/);
  assert.match(aud.lerFiltros({ de: '2026-13-01' }).erro, /inicial/);
  const f = aud.lerFiltros(new URLSearchParams('acao=equipe&pagina=2&por_pagina=3')).filtros;
  const r = await aud.consultar(f);
  assert.equal(r.total, 4); assert.equal(r.paginas, 2); assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].id, 1, 'mais novo primeiro → página 2 tem o mais antigo');
  const p = await aud.consultar(aud.lerFiltros({ pessoa: ID.ana }).filtros);
  assert.equal(p.total, 4); assert.equal(p.itens[0].pessoa, 'Ana');
  const d = await aud.consultar(aud.lerFiltros({ de: '2026-10-11', ate: '2026-10-08' }).filtros);   // invertido: troca
  assert.deepEqual(d.itens.map(i => i.id).sort(), [3, 4, 5, 6]);
  const s = await aud.consultar(aud.lerFiltros({ tabela: 'conversas' }).filtros);
  assert.equal(s.itens.find(i => !i.perfil_id).pessoa, 'sistema');
  assert.equal(s.itens[0].detalhes.senha, '•••', 'segredo nunca sai');
  assert.equal(aud.lerFiltros({ por_pagina: '5000' }).filtros.por_pagina, AUD.POR_PAGINA_MAX);
});

test('CSV: ; e BOM, data de SP, aspas, quebra de linha e fórmula (=,+,-,@) neutralizadas', () => {
  const csv = AUD.csv([{ created_at: '2026-10-13T17:05:00Z', pessoa: '=HYPERLINK("x")', app: 'atendimento', acao: 'a;b', tabela: 'perfis',
    registro_id: '-1', campos: ['papel', 'apps'], detalhes: { motivo: 'linha1\nlinha2' } }]);
  assert.ok(csv.startsWith('﻿quando;pessoa;app;acao;tabela;registro;campos;detalhes\r\n'));
  const linha = csv.split('\r\n')[1];
  assert.match(linha, /^13\/10\/2026 14:05;/);
  assert.match(linha, /;"'=HYPERLINK\(""x""\)";/);
  assert.match(linha, /;"a;b";/);
  assert.match(linha, /;'-1;/);
  assert.match(linha, /;papel, apps;/);
  assert.equal(AUD.celula(null), '');
});

test('registrar: rpc registrar_auditoria com app, sem segredos; falha do banco não lança', async () => {
  const { aud, rpcs } = montarAud();
  const r = await aud.registrar({ perfil: ID.ana, acao: 'config.ia', tabela: 'ia_config', registro: 1, detalhes: { api_key: 'sk-x', campos: ['autonomia'] } });
  assert.deepEqual(r, { ok: true, id: 99 });
  assert.deepEqual(rpcs[0], { p_perfil: ID.ana, p_app: 'atendimento', p_acao: 'config.ia', p_tabela: 'ia_config', p_registro: '1', p_detalhes: { api_key: '•••', campos: ['autonomia'] } });
  const ruim = AUD.criarAuditoria({ sb: { rpc: async () => { throw new Error('rede'); } }, log: () => {} });
  assert.deepEqual(await ruim.registrar({ acao: 'x' }), { ok: false });
  assert.deepEqual(await ruim.registrar({}), { ok: false });
});
