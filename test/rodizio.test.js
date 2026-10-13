'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/rodizio.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');

const ID = { ana: 'cccccccc-0000-4000-8000-000000000001', bia: 'cccccccc-0000-4000-8000-000000000002',
  caio: 'cccccccc-0000-4000-8000-000000000003', franklin: 'cccccccc-0000-4000-8000-000000000004',
  gestor: 'cccccccc-0000-4000-8000-000000000005', dani: 'cccccccc-0000-4000-8000-000000000006',
  c1: 'dddddddd-0000-4000-8000-000000000001', c2: 'dddddddd-0000-4000-8000-000000000002', c3: 'dddddddd-0000-4000-8000-000000000003',
  cli: 'eeeeeeee-0000-4000-8000-000000000001' };
const TODOS = ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador'];
// quarta 14/10/2026 10:00 em São Paulo
const QUARTA_10H = new Date('2026-10-14T13:00:00Z');
const DOMINGO = new Date('2026-10-18T13:00:00Z');

const pessoas = () => [
  { id: ID.ana, nome: 'Ana', papel: 'atendente', ativo: true, apps: TODOS, recebe_leads: true, ultimo_lead_em: '2026-10-14T12:00:00Z' },
  { id: ID.bia, nome: 'Bia', papel: 'atendente', ativo: true, apps: TODOS, recebe_leads: true, ultimo_lead_em: '2026-10-14T11:00:00Z' },
  { id: ID.caio, nome: 'Caio', papel: 'atendente', ativo: true, apps: ['crm'], recebe_leads: true },                       // sem o app
  { id: ID.franklin, nome: 'Franklin', papel: 'agenda', ativo: true, apps: ['agenda'], recebe_leads: true },               // papel agenda
  { id: ID.gestor, nome: 'Gê', papel: 'gestor', ativo: true, apps: TODOS, recebe_leads: false },
  { id: ID.dani, nome: 'Dani', papel: 'atendente', ativo: false, apps: TODOS, recebe_leads: true },                        // desativada
];

test('podeReceber: ativo + rodízio + papel de equipe + app Atendimento (admin sempre) + fora de férias', () => {
  const p = Object.fromEntries(pessoas().map(x => [x.nome, x]));
  assert.equal(R.podeReceber(p.Ana, QUARTA_10H), true);
  assert.equal(R.podeReceber(p.Caio, QUARTA_10H), false);
  assert.equal(R.podeReceber(p.Franklin, QUARTA_10H), false);
  assert.equal(R.podeReceber(p['Gê'], QUARTA_10H), false);
  assert.equal(R.podeReceber(p.Dani, QUARTA_10H), false);
  assert.equal(R.podeReceber({ ...p.Ana, papel: 'admin', apps: [] }, QUARTA_10H), true);
  assert.equal(R.podeReceber({ ...p.Ana, preferencias: { ausente_ate: '2026-10-20' } }, QUARTA_10H), false);
  assert.equal(R.podeReceber({ ...p.Ana, preferencias: { ausente_ate: '2026-10-13' } }, QUARTA_10H), true, 'férias acabaram ontem');
});

test('escolher: menor carga de conversas abertas; empate → quem recebeu há mais tempo; nunca recebeu vem antes', () => {
  const ps = pessoas();
  assert.equal(R.escolher(ps, { [ID.ana]: 1, [ID.bia]: 3 }, QUARTA_10H).id, ID.ana);
  assert.equal(R.escolher(ps, { [ID.ana]: 2, [ID.bia]: 2 }, QUARTA_10H).id, ID.bia, 'Bia recebeu antes');
  const nova = [...ps, { id: 'cccccccc-0000-4000-8000-000000000009', nome: 'Nova', papel: 'atendente', ativo: true, apps: TODOS, recebe_leads: true }];
  assert.equal(R.escolher(nova, { [ID.ana]: 0, [ID.bia]: 0 }, QUARTA_10H).nome, 'Nova');
  const e = R.escolher(ps, {}, QUARTA_10H);
  assert.deepEqual(e.candidatos.map(c => c.nome), ['Bia', 'Ana'], 'só quem pode entra na fila');
  assert.equal(R.escolher(ps, {}, QUARTA_10H, { excluir: [ID.ana, ID.bia] }), null);
});

test('escolher: prefere quem está no horário dele; ninguém no horário → todos que podem (cliente nunca fica sem dono)', () => {
  const ps = pessoas();
  ps.find(p => p.id === ID.ana).preferencias = { expediente: { dias: [1, 2, 3, 4, 5], inicio: '13:00', fim: '18:00' } };
  const e = R.escolher(ps, { [ID.bia]: 5, [ID.ana]: 0 }, QUARTA_10H);
  assert.equal(e.id, ID.bia, 'Ana entra só à tarde');
  assert.equal(e.motivo, 'menor carga no horário');
  const dom = R.escolher(ps, { [ID.bia]: 5, [ID.ana]: 0 }, DOMINGO);
  assert.equal(dom.id, ID.ana);
  assert.match(dom.motivo, /ninguém no horário/);
  assert.equal(R.noExpediente(null, QUARTA_10H), true);
  assert.equal(R.noExpediente(null, new Date('2026-10-14T21:00:00Z')), false, '18h já fechou');
  assert.deepEqual(R.expedienteDe({ preferencias: { expediente: { dias: [1], inicio: '18:00', fim: '08:00' } } }), R.EXPEDIENTE_OFICINA, 'expediente inválido → o da oficina');
});

function montar(ajustar) {
  const t = {
    perfis: pessoas(),
    conversas: [
      { id: ID.c1, nome: 'Camila', telefone: '5512988887777', cliente_id: ID.cli, atribuida_a: ID.ana, status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: '2026-10-14T12:00:00Z' },
      { id: ID.c2, nome: null, telefone: '5512977776666', cliente_id: null, atribuida_a: null, status: 'aberta', tipo: 'atendimento', ultima_mensagem_em: '2026-10-14T12:20:00Z', ultima_previa: 'Oi, quero orçamento' },
      { id: ID.c3, nome: 'Disparo', telefone: '5512966665555', atribuida_a: null, status: 'aberta', tipo: 'disparo', ultima_mensagem_em: '2026-10-14T10:00:00Z' },
      { id: 'x1', atribuida_a: ID.ana, status: 'aberta' }, { id: 'x2', atribuida_a: ID.bia, status: 'resolvida' },
    ],
    leads: [
      { id: 'l1', cliente_id: ID.cli, status: 'contato', responsavel_id: ID.ana },
      { id: 'l2', cliente_id: ID.cli, status: 'orcamento', responsavel_id: null },
      { id: 'l3', cliente_id: ID.cli, status: 'novo', responsavel_id: ID.gestor },          // de outra pessoa: não mexe
      { id: 'l4', cliente_id: ID.cli, status: 'concluido', responsavel_id: ID.ana },         // fechado: não mexe
    ],
    conversa_eventos: [],
  };
  if (ajustar) ajustar(t);
  const auds = [];
  const sb = criarSbFalso(t);
  const rod = R.criarRodizio({ sb, auditar: async a => { auds.push(a); return { ok: true }; }, agora: () => QUARTA_10H, log: () => {} });
  return { sb, db: sb.db, rod, auds };
}

test('transferir: exige motivo; atendente só passa a conversa dela; gestor passa qualquer uma; destino precisa poder atender', async () => {
  const { rod, db } = montar();
  const BIA = { id: ID.bia, papel: 'atendente' }, ANA = { id: ID.ana, papel: 'atendente' };
  assert.equal((await rod.transferir(ANA, ID.c1, { para: ID.bia, motivo: '' })).campo, 'motivo');
  assert.equal((await rod.transferir(ANA, ID.c1, { para: 'x', motivo: 'férias' })).campo, 'para');
  assert.equal((await rod.transferir(BIA, ID.c1, { para: ID.bia, motivo: 'quero' })).codigo, 'nao_e_sua');
  assert.equal((await rod.transferir(ANA, ID.c1, { para: ID.franklin, motivo: 'agenda' })).codigo, 'destino_invalido');
  assert.equal((await rod.transferir(ANA, ID.c1, { para: ID.dani, motivo: 'saiu' })).codigo, 'destino_invalido');
  assert.equal((await rod.transferir(ANA, ID.c1, { para: ID.ana, motivo: 'mesma' })).codigo, 'mesmo_dono');
  assert.equal((await rod.transferir(ANA, 'nao-uuid', { para: ID.bia, motivo: 'xx x' })).status, 400);
  const r = await rod.transferir({ id: ID.gestor, papel: 'gestor' }, ID.c1, { para: ID.bia, motivo: 'Bia entende de câmbio' });
  assert.equal(r.ok, true); assert.equal(r.de, ID.ana); assert.equal(r.para.nome, 'Bia');
  assert.equal(db.conversas.find(c => c.id === ID.c1).atribuida_a, ID.bia);
  assert.equal(db.conversa_eventos[0].tipo, 'transferida');
});

test('lead acompanha o dono: só o aberto sem responsável ou do dono antigo; transferência auditada com motivo', async () => {
  const { rod, db, auds } = montar();
  const r = await rod.transferir({ id: ID.ana, papel: 'atendente' }, ID.c1, { para: ID.bia, motivo: 'troca de turno' });
  assert.equal(r.leads_movidos, 2);
  const l = Object.fromEntries(db.leads.map(x => [x.id, x.responsavel_id]));
  assert.equal(l.l1, ID.bia); assert.equal(l.l2, ID.bia);
  assert.equal(l.l3, ID.gestor, 'lead de outra pessoa fica');
  assert.equal(l.l4, ID.ana, 'lead fechado fica');
  const a = auds.find(x => x.acao === 'conversa.transferir');
  assert.deepEqual(a.detalhes, { de: ID.ana, para: ID.bia, motivo: 'troca de turno', leads_movidos: 2 });
  assert.equal(a.perfil, ID.ana);
});

test('distribuir: dá dono pela carga (compara-e-grava), atualiza ultimo_lead_em; já tem dono → 409; ninguém no rodízio → 409', async () => {
  const { rod, db, auds } = montar();
  const r = await rod.distribuir(ID.c2, { id: ID.gestor });
  assert.equal(r.ok, true);
  assert.equal(r.para.id, ID.bia, 'Ana tem 2 abertas, Bia 0');
  assert.equal(db.conversas.find(c => c.id === ID.c2).atribuida_a, ID.bia);
  assert.equal(db.perfis.find(p => p.id === ID.bia).ultimo_lead_em, QUARTA_10H.toISOString());
  assert.ok(auds.some(a => a.acao === 'conversa.distribuir'));
  assert.equal((await rod.distribuir(ID.c2)).codigo, 'ja_tem_dono');
  const v = montar(t => { for (const p of t.perfis) p.recebe_leads = false; });
  assert.equal((await v.rod.distribuir(ID.c2)).codigo, 'ninguem_no_rodizio');
});

test('semDono: só atendimento aberto sem dono há mais de X min, mais antigo primeiro, com link', async () => {
  const { rod } = montar();
  const r = await rod.semDono({ minutos: 30 });
  assert.equal(r.total, 1);
  assert.equal(r.conversas[0].id, ID.c2);
  assert.equal(r.conversas[0].espera_min, 40);
  assert.equal(r.conversas[0].link, `/?conversa=${ID.c2}`);
  assert.equal(r.conversas[0].previa, 'Oi, quero orçamento');
  assert.equal((await rod.semDono({ minutos: 60 })).total, 0);
});

test('previa: próximo da fila e quem está fora (com o motivo)', async () => {
  const { rod } = montar();
  const r = await rod.previa();
  assert.equal(r.proximo.nome, 'Bia');
  const fora = Object.fromEntries(r.fora.map(f => [f.nome, f.motivo]));
  assert.equal(fora.Caio, 'sem acesso ao Atendimento');
  assert.equal(fora['Gê'], 'fora do rodízio');
  assert.equal(fora.Franklin, undefined, 'papel agenda nem aparece');
});
