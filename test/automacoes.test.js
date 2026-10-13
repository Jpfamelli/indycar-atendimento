'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AUT = require('../lib/automacoes.js');
const R = require('../lib/rodizio.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');

const ID = { admin: 'a1000000-0000-4000-8000-000000000001', gestor: 'a1000000-0000-4000-8000-000000000002',
  ana: 'a1000000-0000-4000-8000-000000000003', franklin: 'a1000000-0000-4000-8000-000000000004',
  silencio: 'a1000000-0000-4000-8000-000000000005',
  c1: 'c1000000-0000-4000-8000-000000000001', c2: 'c1000000-0000-4000-8000-000000000002', c3: 'c1000000-0000-4000-8000-000000000003' };
const QUARTA_10H = new Date('2026-10-14T13:00:00Z');
const TODOS = ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador'];

function montar({ agora = QUARTA_10H, ajustar } = {}) {
  const t = {
    perfis: [
      { id: ID.admin, nome: 'Dono', papel: 'admin', ativo: true, apps: [], recebe_leads: false },
      { id: ID.gestor, nome: 'Gê', papel: 'gestor', ativo: true, apps: TODOS, recebe_leads: false },
      { id: ID.silencio, nome: 'Gestor quieto', papel: 'gestor', ativo: true, apps: TODOS, recebe_leads: false, preferencias: { notificacoes: { espera: false, resumo_dia: false } } },
      { id: ID.ana, nome: 'Ana', papel: 'atendente', ativo: true, apps: TODOS, recebe_leads: true },
      { id: ID.franklin, nome: 'Franklin', papel: 'agenda', ativo: true, apps: ['agenda'], recebe_leads: true },
    ],
    conversas: [
      // cliente escreveu há 40 min e ninguém respondeu → alerta
      { id: ID.c1, nome: 'Camila', telefone: '5512988887777', atribuida_a: ID.ana, status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: '2026-10-14T12:20:00Z', created_at: '2026-10-14T12:00:00Z' },
      // a última é do atendente → sem alerta
      { id: ID.c2, nome: 'José', atribuida_a: ID.ana, status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: '2026-10-14T12:10:00Z', created_at: '2026-09-01T12:00:00Z' },
      // conversa nova que caiu com o Franklin (papel agenda) → volta ao rodízio
      { id: ID.c3, nome: 'Novo', atribuida_a: ID.franklin, status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: '2026-10-14T12:55:00Z', created_at: '2026-10-14T12:50:00Z', cliente_id: null },
    ],
    whatsapp_mensagens: [
      { conversa_id: ID.c1, direcao: 'saida', corpo: 'Oi Camila!', created_at: '2026-10-14T12:05:00Z' },
      { conversa_id: ID.c1, direcao: 'entrada', corpo: 'Quanto fica o alinhamento?', created_at: '2026-10-14T12:20:00Z' },
      { conversa_id: ID.c2, direcao: 'entrada', corpo: 'Oi', created_at: '2026-10-14T12:00:00Z' },
      { conversa_id: ID.c2, direcao: 'saida', corpo: 'Já te respondo', created_at: '2026-10-14T12:10:00Z' },
    ],
    notificacoes: [
      { id: 'n1', perfil_id: ID.ana, lida_em: '2026-07-01T12:00:00Z' }, { id: 'n2', perfil_id: ID.ana, lida_em: null, created_at: '2026-07-01T12:00:00Z' },
      { id: 'n3', perfil_id: ID.ana, lida_em: '2026-10-10T12:00:00Z' },
    ],
    codewords_eventos: [
      { id: 'e1', resumo: 'mensagem recebida', created_at: '2026-05-01T12:00:00Z' },
      { id: 'e2', resumo: 'conversa excluída por dono@x.com (3 mensagens)', created_at: '2026-05-01T12:00:00Z' },
      { id: 'e3', resumo: '2 mensagem(ns) apagada(s) por dono@x.com', created_at: '2026-05-01T12:00:00Z' },
      { id: 'e4', resumo: 'mensagem recebida', created_at: '2026-10-01T12:00:00Z' },
    ],
    ia_acoes: [
      { id: 'i1', tipo: 'responder', status: 'proposta', created_at: '2026-08-01T12:00:00Z' },
      { id: 'i2', tipo: 'responder', status: 'executada', created_at: '2026-08-01T12:00:00Z' },
      { id: 'i3', tipo: 'agendar', status: 'proposta', created_at: '2026-08-01T12:00:00Z' },
      { id: 'i4', tipo: 'responder', status: 'proposta', created_at: '2026-10-13T12:00:00Z' },
    ],
    tarefas: [{ id: 't1', status: 'aberta', vence_em: '2026-10-13T12:00:00Z' }, { id: 't2', status: 'feita', concluida_em: '2026-10-14T12:00:00Z' }],
    agendamentos: [{ id: 'a1', created_at: '2026-10-14T12:30:00Z' }],
    leads: [],
  };
  if (ajustar) ajustar(t);
  const notifs = [];
  const sb = criarSbFalso(t, { rpc: {
    notificar: (a) => {
      if (notifs.some(n => n.p_perfil === a.p_perfil && n.p_chave === a.p_chave)) return { data: null, error: null };   // chave única
      notifs.push(a); return { data: `n${notifs.length}`, error: null };
    },
  } });
  const auds = [];
  const relogio = { t: agora };
  const auditar = async a => { auds.push(a); return { ok: true }; };
  const rodizio = R.criarRodizio({ sb, auditar, agora: () => relogio.t, log: () => {} });
  const aut = AUT.criarAutomacoes({ sb, rodizio, auditar, agora: () => relogio.t, log: () => {} });
  return { sb, db: sb.db, aut, notifs, auds, relogio };
}

test('espera > 30 min: avisa gestores/admin e o dono, uma vez por mensagem; respeita preferência; sem WhatsApp', async () => {
  const { aut, notifs, db } = montar();
  const r = await aut.alertarEspera();
  assert.equal(r.esperando, 1);
  const destinos = notifs.map(n => n.p_perfil).sort();
  assert.deepEqual(destinos, [ID.admin, ID.gestor, ID.ana].sort(), 'gestor quieto não recebe');
  assert.match(notifs[0].p_titulo, /Camila espera resposta há 40 min/);
  assert.equal(notifs[0].p_link, `/?conversa=${ID.c1}`);
  assert.equal(notifs[0].p_app, 'atendimento');
  assert.equal(notifs[0].p_tipo, 'espera');
  assert.equal((await aut.alertarEspera()).avisos, 0, 'mesma mensagem não avisa de novo');
  assert.equal(db.whatsapp_mensagens.length, 4, 'nada saiu pelo WhatsApp');
});

test('espera: fora do expediente não avisa; mensagem [sistema] não conta', async () => {
  const noite = montar({ agora: new Date('2026-10-14T23:00:00Z') });
  assert.equal((await noite.aut.alertarEspera()).pulou, 'fora do expediente');
  const sis = montar({ ajustar: t => t.whatsapp_mensagens.push({ conversa_id: ID.c2, direcao: 'entrada', corpo: '[sistema] etiqueta', created_at: '2026-10-14T12:15:00Z' }) });
  const r = await sis.aut.alertarEspera();
  assert.equal(r.esperando, 1, 'só a Camila');
});

test('resumo do dia: só depois das 17:40 e uma vez por dia; números certos; não sai domingo', async () => {
  const m = montar();
  assert.equal((await m.aut.resumoDoDia()).pulou, 'antes das 17:40');
  m.relogio.t = new Date('2026-10-14T20:45:00Z');      // 17:45
  const r = await m.aut.resumoDoDia();
  assert.equal(r.avisos, 2, 'admin e gestor (o quieto não quer)');
  assert.equal(r.numeros.novas, 2);
  assert.equal(r.numeros.atrasadas, 1);
  assert.equal(r.numeros.feitas, 1);
  assert.equal(r.numeros.agendados, 1);
  assert.match(m.notifs[0].p_titulo, /Resumo do dia — 14\/10/);
  assert.match(m.notifs[0].p_corpo, /2 conversas novas/);
  assert.match(m.notifs[0].p_corpo, /Pendências: 1 tarefa atrasada/);
  assert.equal(m.notifs[0].p_chave, 'resumo-dia:20261014');
  assert.equal((await m.aut.resumoDoDia()).pulou, 'já enviado hoje');
  const dom = montar({ agora: new Date('2026-10-18T21:00:00Z') });
  assert.equal((await dom.aut.resumoDoDia()).pulou, 'domingo');
  assert.match(m.aut.textoDoResumo({ novas: 1, entradas: 0, saidas: 0, agendados: 0, feitas: 0, semDono: 0, aguardando: 0, atrasadas: 0 }), /1 conversa nova.*Sem pendências/s);
});

test('dono inválido: conversa nova com o Franklin (agenda) volta ao rodízio, auditada', async () => {
  const { aut, db, auds } = montar();
  const r = await aut.corrigirDonos();
  assert.equal(r.corrigidas, 1);
  assert.equal(db.conversas.find(c => c.id === ID.c3).atribuida_a, ID.ana);
  assert.equal(db.conversas.find(c => c.id === ID.c1).atribuida_a, ID.ana, 'as boas não mudam');
  const a = auds.find(x => x.acao === 'conversa.redistribuir');
  assert.equal(a.detalhes.de, ID.franklin);
});

test('limpeza: lidas há 60+ dias, eventos 120+ dias (cópias de exclusão ficam), rascunhos da IA 30+ dias; uma vez por dia', async () => {
  const m = montar();
  m.relogio.t = new Date('2026-10-14T13:00:00Z');
  const r = await m.aut.limpar();
  assert.deepEqual(r, { notificacoes: 1, eventos: 1, rascunhos: 1 });
  assert.deepEqual(m.db.notificacoes.map(n => n.id), ['n2', 'n3'], 'não lida e recente ficam');
  assert.deepEqual(m.db.codewords_eventos.map(e => e.id), ['e2', 'e3', 'e4'], 'cópias de segurança ficam para sempre');
  assert.deepEqual(m.db.ia_acoes.map(a => a.id), ['i2', 'i3', 'i4'], 'só rascunho de resposta velho sai');
  assert.ok(m.auds.some(a => a.acao === 'automacao.limpeza'));
  assert.equal((await m.aut.limpar()).pulou, 'já limpou hoje');
  const cedo = montar({ agora: new Date('2026-10-14T04:00:00Z') });   // 1h em SP
  assert.equal((await cedo.aut.limpar()).pulou, 'antes das 3h');
});

test('ciclo: roda as quatro, uma falha não derruba as outras, e não roda duas vezes ao mesmo tempo', async () => {
  const m = montar();
  m.sb.rpc = async () => { throw new Error('rpc fora'); };
  const [a, b] = await Promise.all([m.aut.ciclo(), m.aut.ciclo()]);
  assert.equal(b.pulou, 'já rodando');
  assert.deepEqual(Object.keys(a), ['espera', 'donos', 'resumo', 'limpeza']);
  assert.equal(a.espera.erro, 'falhou');
  assert.equal(a.donos.corrigidas, 1);
});
