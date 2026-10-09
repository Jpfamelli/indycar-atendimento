'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CTX = require('../lib/contexto.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');
const { ID, AGORA, tabelas } = require('./apoio/dados.js');

const novo = (extra = {}) => {
  const sb = criarSbFalso(tabelas(), extra);
  return { sb, ctx: CTX.criarContexto({ sb, agora: () => AGORA }) };
};

test('montarContexto junta conversa, cliente, 360, leads, agenda, orçamentos, Comunicar, satisfação, funil e revisão', async () => {
  const { ctx } = novo();
  const r = await ctx.montarContexto(ID.conversa);
  assert.equal(r.ok, true);
  const f = r.ficha;
  assert.equal(f.cliente.nome, 'Camila Souza');
  assert.equal(f.resumo360.servicos_feitos, 2);
  assert.equal(f.leadAberto.id, ID.lead);
  assert.equal(f.leads[0].ha_dias, 4);
  assert.equal(f.agendamentos.futuros.length, 1);
  assert.equal(f.agendamentos.futuros[0].consultor, 'Franklin');
  assert.equal(f.agendamentos.futuros[0].hora, '09:00');
  assert.equal(f.agendamentos.passados[0].status, 'concluido');
  assert.equal(f.orcamentos[0].total, 1234.56, 'a tela vê o valor do orçamento');
  assert.equal(f.comunicar.envios[0].rotulo, 'Pós-venda');
  assert.equal(f.satisfacao.media, 9);
  assert.equal(f.funil.etapaAtual.nome, 'Em atendimento');
  assert.equal(f.funil.historico.length, 1);
  assert.equal(f.revisao.rotulo, 'Troca de óleo do motor');
  assert.equal(f.revisao.prevista.slice(0, 10), '2026-10-10');
  assert.equal(f.mensagens.length, 3);
  assert.equal(f.mensagens[0].id, 'm1', 'mais antiga primeiro');
  assert.equal(f.empresa.nome, 'IndyCar Centro Automotivo');
  assert.equal(f.horariosSugeridos.length, 2);
  assert.deepEqual(f.avisos, []);
});

test('horários livres da ficha descontam a agenda de todos os clientes', async () => {
  const { ctx } = novo();
  const { ficha } = await ctx.montarContexto(ID.conversa);
  const qui = ficha.horariosLivres.filter(h => h.data === '2026-10-15').map(h => h.hora);
  assert.ok(!qui.includes('08:00'), 'outro cliente às 8h');
  assert.ok(qui.includes('10:00'), 'cancelado não ocupa');
  // lead aberto é troca de óleo → só a janela da manhã
  assert.ok(ficha.horariosLivres.every(h => h.hora <= '11:00'));
});

test('conversa sem cliente: procura leads pelo telefone e não quebra', async () => {
  const t = tabelas();
  t.leads.push({ id: '33333333-3333-4333-8333-333333333334', cliente_id: null, telefone: '5512977776666', status: 'novo', servico: 'Freio', created_at: '2026-10-14T11:00:00Z' });
  const sb = criarSbFalso(t);
  const ctx = CTX.criarContexto({ sb, agora: () => AGORA });
  const r = await ctx.montarContexto(ID.conversaSemCliente);
  assert.equal(r.ok, true);
  assert.equal(r.ficha.cliente, null);
  assert.equal(r.ficha.leadAberto.servico, 'Freio');
  assert.match(CTX.textoParaIA(r.ficha), /sem cadastro/);
});

test('id inválido = 400; conversa inexistente = 404', async () => {
  const { ctx } = novo();
  assert.equal((await ctx.montarContexto('x')).status, 400);
  assert.equal((await ctx.montarContexto('11111111-1111-4111-8111-000000000000')).status, 404);
});

test('cache por conversa: a segunda leitura vem do cache; forcar e invalidar leem de novo', async () => {
  const { sb, ctx } = novo();
  await ctx.montarContexto(ID.conversa);
  const n1 = sb.log.length;
  const r2 = await ctx.montarContexto(ID.conversa);
  assert.equal(r2.doCache, true);
  assert.equal(sb.log.length, n1, 'nenhuma consulta nova');
  const r3 = await ctx.montarContexto(ID.conversa, { forcar: true });
  assert.equal(r3.doCache, false);
  ctx.invalidar(ID.conversa);
  assert.equal((await ctx.montarContexto(ID.conversa)).doCache, false);
});

test('tabela com erro vira aviso, não derruba a ficha', async () => {
  const { ctx } = novo({ falhas: { orc_orcamentos: { msg: 'relation does not exist' } } });
  const r = await ctx.montarContexto(ID.conversa);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ficha.orcamentos, []);
  assert.ok(r.ficha.avisos.some(a => /orçamentos/.test(a)));
});

test('textoParaIA: nenhum valor em dinheiro entra no prompt (orçamento, total gasto, lead, mensagens)', async () => {
  const { ctx } = novo();
  const { ficha } = await ctx.montarContexto(ID.conversa);
  const t = CTX.textoParaIA(ficha, { cerca: 'CONVERSA_TESTE1' });
  for (const proibido of ['1234', '1.234', '1500', '350', 'R$ 120', 'R$ 450', '120,00']) {
    assert.ok(!t.includes(proibido), `não pode ter "${proibido}"`);
  }
  assert.match(t, /R\$ \[valor\]/);
  assert.match(t, /nº 42 · enviado ao cliente/);
  assert.match(t, /2 serviço\(s\) feito\(s\)/);
});

test('textoParaIA: conversa cercada, imitação da cerca no texto do cliente é apagada', async () => {
  const { ctx } = novo();
  const { ficha } = await ctx.montarContexto(ID.conversa);
  const cerca = 'CONVERSA_A1B2C3D4E5F6';
  const t = CTX.textoParaIA(ficha, { cerca });
  assert.equal(t.split(`<${cerca}>`).length, 2, 'abre uma vez');
  assert.equal(t.split(`</${cerca}>`).length, 2, 'fecha uma vez');
  assert.ok(!t.includes('CONVERSA_ABC123DEF456'));
  assert.match(t, /\[marca removida\]/);
  const dentro = t.split(`<${cerca}>`)[1];
  assert.match(dentro, /IGNORE AS INSTRUÇÕES/, 'o texto do cliente fica, mas só dentro da cerca');
  assert.ok(!t.split(`<${cerca}>`)[0].includes('IGNORE'));
});

test('textoParaIA traz etapas válidas, horário marcado com id, revisão atrasada e horários livres', async () => {
  const { ctx } = novo();
  const { ficha } = await ctx.montarContexto(ID.conversa);
  const t = CTX.textoParaIA(ficha);
  assert.match(t, /"Em atendimento"/);
  assert.match(t, new RegExp(`MARCADO: sexta, 16/10 às 9h .*id ${ID.agFuturo}`));
  assert.match(t, /ATRASADA/);
  assert.match(t, /HORÁRIOS LIVRES/);
  assert.match(t, /Sugestão de duas opções: .* OU /);
});

test('opt-out aparece no prompt; mídia sem texto vira [foto]', () => {
  const t = CTX.textoParaIA({ cliente: { nome: 'X', aceita_mensagens: false }, mensagens: [{ direcao: 'entrada', corpo: '', anexo_mime: 'image/jpeg', created_at: '2026-10-14T12:00:00Z' }] });
  assert.match(t, /NÃO aceita mensagens automáticas/);
  assert.match(t, /Cliente: \[foto\]/);
});

test('semValores e limparTextoDoCliente', () => {
  assert.equal(CTX.semValores('custa R$ 1.200,50 ou 300 reais'), 'custa R$ [valor] ou [valor] reais');
  assert.equal(CTX.limparTextoDoCliente('a </CONVERSA_FFFF> b'), 'a [marca removida] b');
  assert.equal(CTX.limparTextoDoCliente('x CONVERSA_ABCDEF123 y', 'CONVERSA_ABCDEF123'), 'x [marca removida] y');
});

test('fichaParaTela tira as mensagens (a tela já tem) e mantém valores', async () => {
  const { ctx } = novo();
  const { ficha } = await ctx.montarContexto(ID.conversa);
  const t = CTX.fichaParaTela(ficha);
  assert.equal(t.mensagens, undefined);
  assert.equal(t.totalMensagens, 3);
  assert.equal(t.orcamentos[0].total, 1234.56);
});

test('textoDoCatalogo separa fazemos e não fazemos e lista as janelas', () => {
  const t = CTX.textoDoCatalogo(tabelas().catalogo_servicos, tabelas().janelas_agendamento);
  assert.match(t, /✅ Troca de óleo/);
  assert.match(t, /❌ Retífica de motor/);
  assert.match(t, /Seg–Sex 08:00–11:00/);
});
