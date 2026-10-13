'use strict';
/* Ferramenta nova do copiloto: criar_tarefa (responsável, prazo, prioridade). */
const test = require('node:test');
const assert = require('node:assert/strict');
const IA = require('../lib/ia-copiloto.js');
const CTX = require('../lib/contexto.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');
const { ID, AGORA, tabelas, criarIAFalsa, usa, fim } = require('./apoio/dados.js');

const BIA = '88888888-8888-4888-8888-88888888888b';
const PERFIL = { id: ID.perfil, papel: 'atendente' };
const basico = [['classificar', { intencao: 'orcamento', temperatura: 'morno' }], ['resumir', { resumo: 'Camila quer saber da suspensão.' }]];

function montar(roteiro, { autonomia, ajustar } = {}) {
  const t = tabelas();
  t.perfis = [
    { id: ID.perfil, nome: 'Ana Souza', papel: 'atendente', ativo: true, apps: ['atendimento'] },
    { id: BIA, nome: 'Bia Lima', papel: 'atendente', ativo: true, apps: ['atendimento'] },
    { id: ID.admin, nome: 'Dono', papel: 'admin', ativo: true, apps: [] },
    { id: '88888888-8888-4888-8888-88888888888c', nome: 'Franklin', papel: 'agenda', ativo: true, apps: ['agenda'] },
  ];
  t.tarefas = [];
  t.conversas[0].atribuida_a = ID.perfil;
  if (autonomia) t.ia_config[0].autonomia = autonomia;
  if (ajustar) ajustar(t);
  const sb = criarSbFalso(t, { relogio: () => AGORA });
  const ia = criarIAFalsa(roteiro);
  const contexto = CTX.criarContexto({ sb, agora: () => AGORA });
  const cop = IA.criarCopiloto({ sb, contexto, criarIA: async () => ia, agora: () => AGORA });
  return { sb, db: sb.db, ia, cop };
}

test('criar_tarefa está nas ferramentas, no papel do copiloto, e a EQUIPE vai no prompt só com nomes (agenda fora)', async () => {
  assert.ok(IA.FERRAMENTAS.some(f => f.name === 'criar_tarefa'));
  assert.match(IA.PAPEL_COPILOTO, /criar_tarefa/);
  assert.ok(IA.REVERSIVEIS.has('criar_tarefa'));
  const { cop, ia } = montar([usa(...basico), fim]);
  await cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  const msg = ia.chamadas[0].params.messages[0].content;
  assert.match(msg, /EQUIPE \(para criar_tarefa/);
  assert.match(msg, /Ana Souza, Bia Lima, Dono|Bia Lima/);
  assert.match(msg, /Com a conversa agora: Ana Souza/);
  const bloco = msg.slice(msg.indexOf('EQUIPE (para criar_tarefa'));
  assert.doesNotMatch(bloco, /Franklin/, 'papel agenda não entra na lista');
  assert.doesNotMatch(bloco, /@/, 'nada de e-mail no prompt');
});

test('proposta: responsável pelo nome (até só o primeiro nome), prazo do dia vira 17:30, prioridade; executar cria (origem ia) e desfazer cancela', async () => {
  const { cop, db } = montar([usa(...basico, ['criar_tarefa', { titulo: 'Ligar para confirmar a peça', responsavel: 'bia', prazo: '2026-10-15', prioridade: 1 }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  const a = r.acoes.find(x => x.tipo === 'criar_tarefa');
  assert.ok(a, JSON.stringify(r.acoes));
  assert.equal(a.parametros.responsavel_id, BIA);
  assert.equal(a.parametros.vence_em, '2026-10-15T20:30:00.000Z');
  assert.equal(a.parametros.prioridade, 1);
  assert.equal(a.precisa_clique, true, 'tarefa para OUTRA pessoa pede clique');
  assert.match(a.resumo, /Tarefa: Ligar para confirmar a peça → Bia Lima · até qui, 15\/10 às 17h30/);
  const ex = await cop.executarAcao(a.id, PERFIL);
  assert.equal(ex.ok, true, ex.erro);
  const t = db.tarefas[0];
  assert.equal(t.origem, 'ia'); assert.equal(t.responsavel_id, BIA); assert.equal(t.criado_por, ID.perfil);
  assert.equal(t.conversa_id, ID.conversa); assert.equal(t.cliente_id, ID.cliente); assert.equal(t.lead_id, ID.lead); assert.equal(t.status, 'aberta');
  const d = await cop.desfazerAcao(a.id, PERFIL);
  assert.equal(d.ok, true);
  assert.equal(t.status, 'cancelada');
});

test('validação: nome fora da equipe, prazo passado/longe, título curto e tarefa repetida voltam como erro para a IA', async () => {
  const { cop, ia } = montar([usa(...basico,
    ['criar_tarefa', { titulo: 'Ligar', responsavel: 'Zé Ninguém' }],
    ['criar_tarefa', { titulo: 'Conferir peça', prazo: '2026-10-01' }],
    ['criar_tarefa', { titulo: 'Conferir peça', prazo: '2027-06-01' }],
    ['criar_tarefa', { titulo: 'ok' }]), fim], { ajustar: t => t.tarefas.push({ id: 'tx', conversa_id: ID.conversa, status: 'aberta', titulo: 'Cobrar o consultor' }) });
  const r = await cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  assert.equal(r.acoes.filter(x => x.tipo === 'criar_tarefa').length, 0);
  const volta = ia.chamadas[1].params.messages.at(-1).content.filter(b => b.is_error).map(b => b.content).join(' | ');
  assert.match(volta, /não está na EQUIPE/);
  assert.match(volta, /prazo já passou/i);
  assert.match(volta, /longe demais/);
  assert.match(volta, /Diga o que fazer/);
  assert.match(ia.chamadas[0].params.messages[0].content, /JÁ abertas nesta conversa \(não repita\): Cobrar o consultor/);
  const dup = montar([usa(...basico, ['criar_tarefa', { titulo: 'cobrar o CONSULTOR' }]), fim], { ajustar: t => t.tarefas.push({ id: 'tx', conversa_id: ID.conversa, status: 'aberta', titulo: 'Cobrar o consultor' }) });
  const r2 = await dup.cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  assert.equal(r2.acoes.length, 0);
});

test('autonomia: "automatico" cria sozinho a tarefa do dono da conversa (sem prazo = hoje 17:30); "sugerir" não executa', async () => {
  const auto = montar([usa(...basico, ['criar_tarefa', { titulo: 'Mandar foto do orçamento' }]), fim], { autonomia: 'automatico' });
  const r = await auto.cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  const a = r.acoes.find(x => x.tipo === 'criar_tarefa');
  assert.equal(a.status, 'executada'); assert.equal(a.automatica, true);
  assert.equal(auto.db.tarefas[0].responsavel_id, ID.perfil);
  assert.equal(auto.db.tarefas[0].vence_em, '2026-10-14T20:30:00.000Z');
  const outra = montar([usa(...basico, ['criar_tarefa', { titulo: 'Bia liga amanhã', responsavel: 'Bia Lima' }]), fim], { autonomia: 'automatico' });
  const r2 = await outra.cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  assert.equal(r2.acoes[0].status, 'proposta', 'para outra pessoa nem o automático cria sozinho');
  const sug = montar([usa(...basico, ['criar_tarefa', { titulo: 'Conferir peça' }]), fim], { autonomia: 'sugerir' });
  const r3 = await sug.cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  assert.equal((await sug.cop.executarAcao(r3.acoes[0].id, PERFIL)).status, 403);
  assert.equal(sug.db.tarefas.length, 0);
});

test('executar recusa responsável que foi desativado depois da proposta', async () => {
  const { cop, db } = montar([usa(...basico, ['criar_tarefa', { titulo: 'Ligar para a Camila', responsavel: 'Bia Lima' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  db.perfis.find(p => p.id === BIA).ativo = false;
  const ex = await cop.executarAcao(r.acoes[0].id, PERFIL);
  assert.equal(ex.ok, false); assert.equal(ex.status, 409);
  assert.equal(db.tarefas.length, 0);
});
