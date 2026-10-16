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

test('ciclo: roda as cinco, uma falha não derruba as outras, e não roda duas vezes ao mesmo tempo', async () => {
  const m = montar();
  m.sb.rpc = async () => { throw new Error('rpc fora'); };
  const [a, b] = await Promise.all([m.aut.ciclo(), m.aut.ciclo()]);
  assert.equal(b.pulou, 'já rodando');
  assert.deepEqual(Object.keys(a), ['espera', 'donos', 'followup', 'resumo', 'limpeza']);
  assert.equal(a.espera.erro, 'falhou');
  assert.equal(a.donos.corrigidas, 1);
});

/* ---------------- rodada 5: follow-up quando o cliente some ---------------- */
test('follow-up 24 h: loja respondeu e o cliente sumiu → tarefa para o dono; com horário marcado, resolvida ou já com tarefa não cria; uma por semana', async () => {
  const m = montar({ ajustar: t => {
    const h = n => new Date(QUARTA_10H.getTime() - n * 3600_000).toISOString();
    t.conversas.push(
      // c4: respondemos há 30 h e nada → tarefa
      { id: 'c4000000-0000-4000-8000-000000000004', nome: 'Sumido', telefone: '5512900000004', atribuida_a: ID.ana, cliente_id: 'cl4', status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: h(30), created_at: h(40) },
      // c5: respondemos há 30 h, mas tem horário marcado → não
      { id: 'c5000000-0000-4000-8000-000000000005', nome: 'Marcado', telefone: '5512900000005', atribuida_a: ID.ana, cliente_id: 'cl5', status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: h(30), created_at: h(40) },
      // c6: a última é do CLIENTE (ele quem espera) → é caso da espera, não do follow-up
      { id: 'c6000000-0000-4000-8000-000000000006', nome: 'Esperando', telefone: '5512900000006', atribuida_a: null, cliente_id: null, status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: h(30), created_at: h(40) },
      // c7: respondemos há 6 h → cedo demais
      { id: 'c7000000-0000-4000-8000-000000000007', nome: 'Cedo', telefone: '5512900000007', atribuida_a: ID.ana, cliente_id: null, status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: h(6), created_at: h(10) },
      // c8: já tem tarefa automática desta semana → não repete
      { id: 'c8000000-0000-4000-8000-000000000008', nome: 'Repetido', telefone: '5512900000008', atribuida_a: null, cliente_id: null, status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: h(30), created_at: h(40) },
      // c9: fechou → não
      { id: 'c9000000-0000-4000-8000-000000000009', nome: 'Fechou', telefone: '5512900000009', atribuida_a: ID.ana, cliente_id: null, status: 'aberta', tipo: 'atendimento', desfecho: 'fechou', ultima_mensagem_em: h(30), created_at: h(40) },
    );
    t.whatsapp_mensagens.push(
      { conversa_id: 'c4000000-0000-4000-8000-000000000004', direcao: 'saida', corpo: 'Posso te ajudar com mais algo?', created_at: h(30) },
      { conversa_id: 'c5000000-0000-4000-8000-000000000005', direcao: 'saida', corpo: 'Até quinta!', created_at: h(30) },
      { conversa_id: 'c6000000-0000-4000-8000-000000000006', direcao: 'entrada', corpo: 'Oi?', created_at: h(30) },
      { conversa_id: 'c7000000-0000-4000-8000-000000000007', direcao: 'saida', corpo: 'Já te respondo', created_at: h(6) },
      { conversa_id: 'c8000000-0000-4000-8000-000000000008', direcao: 'saida', corpo: 'Qualquer coisa me chama', created_at: h(30) },
      { conversa_id: 'c9000000-0000-4000-8000-000000000009', direcao: 'saida', corpo: 'Obrigado!', created_at: h(30) },
    );
    t.tarefas.push({ id: 't8', conversa_id: 'c8000000-0000-4000-8000-000000000008', status: 'feita', origem: 'automacao', created_at: h(50) });
    t.agendamentos.push({ id: 'a5', cliente_id: 'cl5', status: 'confirmado', data: '2026-10-20', created_at: h(30) });
  } });
  const r = await m.aut.followUp24h();
  assert.equal(r.tarefas, 1, JSON.stringify(r));
  const t = m.db.tarefas.filter(x => x.origem === 'automacao' && x.status === 'aberta');
  assert.equal(t.length, 1);
  assert.equal(t[0].titulo, 'Dar um retorno para Sumido');
  assert.equal(t[0].responsavel_id, ID.ana);
  assert.equal(t[0].conversa_id, 'c4000000-0000-4000-8000-000000000004');
  assert.match(t[0].descricao, /há 30 h/);
  assert.ok(t[0].vence_em, 'vence no fim do expediente');
  // rodar de novo não duplica
  const r2 = await m.aut.followUp24h();
  assert.equal(r2.tarefas, 0);
  const c = await m.aut.ciclo();
  assert.ok('followup' in c, 'entrou no ciclo');
});
