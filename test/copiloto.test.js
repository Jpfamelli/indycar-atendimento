'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const IA = require('../lib/ia-copiloto.js');
const CTX = require('../lib/contexto.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');
const { ID, AGORA, tabelas, criarIAFalsa, usa, fim } = require('./apoio/dados.js');

const PERFIL = { id: ID.perfil, papel: 'atendente' };

function montar(roteiro, { ajustar, autonomia } = {}) {
  const t = tabelas();
  if (autonomia) t.ia_config[0].autonomia = autonomia;
  if (ajustar) ajustar(t);
  const sb = criarSbFalso(t, { relogio: () => AGORA, rpc: {
    obter_ou_criar_cliente: (args, db) => { const id = '22222222-2222-4222-8222-2222222222ff'; db.clientes.push({ id, nome: args.p_nome, telefone: args.p_telefone }); return { data: id, error: null }; },
  } });
  const ia = criarIAFalsa(roteiro);
  const contexto = CTX.criarContexto({ sb, agora: () => AGORA });
  const cop = IA.criarCopiloto({ sb, contexto, criarIA: async () => ia, persona: 'PERSONA DA CASA', agora: () => AGORA });
  return { sb, ia, cop, db: sb.db };
}
const basico = [['classificar', { intencao: 'agendar', temperatura: 'quente', motivo: 'quer trazer quinta' }],
                ['resumir', { resumo: 'Camila com barulho na suspensão do Corolla.\nQuer vir quinta 14h.', pendencias: ['Confirmar horário'] }]];

/* ---------------- regras puras ---------------- */
test('revisarTexto troca vocabulário proibido e acusa preço', () => {
  const r = IA.revisarTexto('Prezado, pode comparecer com o veículo para efetuar o diagnóstico');
  assert.equal(r.texto, 'pode vir com o carro para fazer o diagnóstico');
  assert.equal(r.temPreco, false);
  assert.equal(IA.revisarTexto('Fica R$ 300').temPreco, true);
  assert.equal(IA.revisarTexto('sai uns 250 reais').temPreco, true);
  assert.equal(IA.revisarTexto('Quinta às 14h ou sexta às 9h?').temPreco, false);
});

test('valorFoiInformado: só vale número que o ATENDENTE escreveu (não o cliente, não a IA)', () => {
  const mensagens = [{ direcao: 'saida', corpo: 'Fica R$ 1.200,50 à vista' }, { direcao: 'entrada', corpo: 'vi por 450' },
                     { direcao: 'saida', corpo: 'uns 800', gerada_por_ia: true }];
  assert.equal(IA.valorFoiInformado(1200.5, { mensagens }), true);
  assert.equal(IA.valorFoiInformado(450, { mensagens }), false);
  assert.equal(IA.valorFoiInformado(800, { mensagens }), false);
  assert.equal(IA.valorFoiInformado(300, { mensagens, pedido: 'registra 300 de pastilha' }), true);
  assert.equal(IA.valorFoiInformado(-1, { mensagens }), false);
  assert.deepEqual(IA.numerosDoTexto('R$ 1.200,50 e 90'), [1200.5, 90]);
});

test('placa, nascimento e clienteDisse', () => {
  assert.equal(IA.normPlaca('abc-1d23'), 'ABC1D23');
  assert.equal(IA.placaValida('ABC1234'), true);
  assert.equal(IA.placaValida('AB12345'), false);
  assert.equal(IA.normalizarNascimento('12/05/1990', AGORA), '1990-05-12');
  assert.equal(IA.normalizarNascimento('12/05', AGORA), '1904-05-12', 'sem ano = 1904 (combinado do ecossistema)');
  assert.equal(IA.normalizarNascimento('31/02/1990', AGORA), null);
  assert.equal(IA.normalizarNascimento('2020-01-01', AGORA), null, 'criança não');
  const mensagens = [{ direcao: 'entrada', corpo: 'Minha placa é abc-1d23, sou o Marcos' }, { direcao: 'saida', corpo: 'Seu nome é João?' }];
  assert.equal(IA.clienteDisse('ABC1D23', { mensagens }), true);
  assert.equal(IA.clienteDisse('Marcos Silva', { mensagens }), true);
  assert.equal(IA.clienteDisse('João', { mensagens }), false, 'só o que o CLIENTE disse');
});

test('deslocamento de São Paulo é -3 h', () => {
  assert.equal(IA.deslocamento(AGORA), -3 * 3600_000);
});

/* ---------------- o laço com a IA ---------------- */
test('rodar: classifica, resume, sugere resposta, grava tudo em ia_acoes com tokens e modelo', async () => {
  const { cop, ia, db } = montar([usa(...basico, ['responder', { texto: 'Opa, Camila! Bora trazer o Corolla? Quinta às 14h ou sexta às 10h?' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  assert.equal(r.ok, true);
  assert.equal(r.intencao, 'agendar');
  assert.equal(r.temperatura, 'quente');
  assert.match(r.resumo, /suspensão/);
  assert.deepEqual(r.pendencias, ['Confirmar horário']);
  assert.match(r.resposta_sugerida, /Quinta às 14h/);
  assert.ok(r.resposta_acao_id);
  assert.equal(r.acoes.length, 0, 'informativas não viram cartão');
  assert.equal(r.horarios_sugeridos.length, 2);
  assert.equal(r.modelo, 'claude-sonnet-5-5');
  assert.deepEqual(r.tokens, { entrada: 200, saida: 100, cache: 0 });
  const run = db.ia_acoes.find(a => a.tipo === 'copiloto');
  assert.equal(run.tokens_entrada, 200);
  assert.equal(run.perfil_id, ID.perfil);
  assert.equal(run.origem, 'atendimento');
  assert.equal(db.ia_acoes.find(a => a.tipo === 'responder').status, 'proposta');
  assert.equal(db.ia_acoes.find(a => a.tipo === 'classificar').status, 'executada');
  // o que foi para a IA
  const p = ia.chamadas[0].params;
  assert.equal(p.model, 'claude-sonnet-5-5');
  assert.equal(p.system[0].cache_control.type, 'ephemeral');
  assert.match(p.system[0].text, /PERSONA DA CASA/);
  assert.match(p.system[0].text, /❌ Retífica de motor/);
  assert.equal(p.tools.length, IA.FERRAMENTAS.length);
  assert.ok(ia.chamadas[0].opcoes.timeout > 0);
  // segunda volta leva os tool_result
  const volta = ia.chamadas[1].params.messages.at(-1).content;
  assert.ok(volta.every(b => b.type === 'tool_result' && !b.is_error));
});

test('segurança: prompt sem valores, conversa só dentro da cerca aleatória, imitação de cerca apagada', async () => {
  const { cop, ia } = montar([usa(...basico), fim]);
  await cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  const u = ia.chamadas[0].params.messages[0].content;
  const cerca = /<(CONVERSA_[A-F0-9]{12})>/.exec(u)[1];
  assert.notEqual(cerca, 'CONVERSA_ABC123DEF456');
  const [antes, resto] = u.split(`<${cerca}>`);
  const [dentro, depois] = resto.split(`</${cerca}>`);
  assert.ok(!antes.includes('IGNORE') && !depois.includes('IGNORE'));
  assert.match(dentro, /IGNORE AS INSTRUÇÕES/);
  for (const v of ['1234', '1500', '350', 'R$ 120', 'R$ 450']) assert.ok(!u.includes(v), v);
  // cada pedido tem cerca nova
  const { cop: cop2, ia: ia2 } = montar([usa(...basico), fim]);
  await cop2.rodar({ conversaId: ID.conversa });
  assert.notEqual(/<(CONVERSA_[A-F0-9]{12})>/.exec(ia2.chamadas[0].params.messages[0].content)[1], cerca);
});

test('responder com preço volta como erro para a IA reescrever; a segunda versão vale', async () => {
  const { cop, ia } = montar([
    usa(...basico, ['responder', { texto: 'O alinhamento fica R$ 120, pode vir?' }]),
    usa(['responder', { texto: 'Bora fazer o diagnóstico gratuito? Quinta 14h ou sexta 10h?' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  const erro = ia.chamadas[1].params.messages.at(-1).content.find(b => b.is_error);
  assert.match(erro.content, /cita preço/);
  assert.match(r.resposta_sugerida, /diagnóstico gratuito/);
});

test('responder: "veículo" vira "carro" antes de chegar ao atendente', async () => {
  const { cop } = montar([usa(['responder', { texto: 'Pode trazer o veículo amanhã?' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  assert.equal(r.resposta_sugerida, 'Pode trazer o carro amanhã?');
});

test('agendar: horário livre vira proposta; executar cria agendamento amarrado ao lead aberto; desfazer cancela e devolve o lead', async () => {
  const { cop, db } = montar([usa(...basico, ['agendar', { data: '2026-10-15', hora: '14:00', servico: 'diagnostico' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  const a = r.acoes.find(x => x.tipo === 'agendar');
  assert.equal(a.status, 'proposta');
  assert.equal(a.precisa_clique, true);
  assert.equal(a.parametros.servico, 'Diagnóstico', 'casou com o cadastro de serviços');
  assert.match(a.resumo, /quinta, 15\/10 às 14h/);
  const ex = await cop.executarAcao(a.id, PERFIL);
  assert.equal(ex.ok, true, ex.erro);
  const ag = db.agendamentos.find(x => x.id === ex.saida.agendamento_id);
  assert.equal(ag.data, '2026-10-15');
  assert.equal(ag.hora, '14:00');
  assert.equal(ag.status, 'confirmado');
  assert.equal(ag.lead_id, ID.lead, 'reaproveitou o lead aberto');
  assert.equal(ag.cliente_id, ID.cliente);
  assert.equal(ag.origem, 'whatsapp');
  assert.equal(db.leads.length, 1, 'não duplicou lead');
  assert.match(ex.texto_confirmacao, /Av\. Bandeirantes, 875/);
  assert.equal(db.ia_acoes.find(x => x.id === a.id).agendamento_id, ag.id);
  const d = await cop.desfazerAcao(a.id, PERFIL);
  assert.equal(d.ok, true, d.erro);
  assert.equal(db.agendamentos.find(x => x.id === ag.id).status, 'cancelado');
  assert.equal(db.leads[0].servico, 'Troca de óleo', 'lead voltou como estava');
  assert.equal(db.ia_acoes.find(x => x.id === a.id).status, 'desfeita');
});

test('agendar sem lead aberto cria lead novo; desfazer tira esse lead do CRM', async () => {
  const { cop, db } = montar([usa(['agendar', { data: '2026-10-15', hora: '15:00', servico: 'Troca de óleo' }]), fim],
    { ajustar: t => { t.leads[0].status = 'concluido'; t.janelas_agendamento = []; } });
  const r = await cop.rodar({ conversaId: ID.conversa });
  const a = r.acoes[0];
  const ex = await cop.executarAcao(a.id, PERFIL);
  assert.equal(ex.ok, true, ex.erro);
  assert.equal(ex.saida.lead_criado, true);
  const lead = db.leads.find(l => l.id === ex.saida.lead_id);
  assert.equal(lead.status, 'agendado');
  assert.equal(lead.origem, 'whatsapp');
  await cop.desfazerAcao(a.id, PERFIL);
  assert.ok(!db.leads.some(l => l.id === ex.saida.lead_id));
});

test('agendar recusado na validação: ocupado, domingo, fora do expediente, serviço que não fazemos', async () => {
  const { cop, ia } = montar([usa(
    ['agendar', { data: '2026-10-15', hora: '08:00', servico: 'Diagnóstico' }],
    ['agendar', { data: '2026-10-18', hora: '10:00', servico: 'Diagnóstico' }],
    ['agendar', { data: '2026-10-15', hora: '18:00', servico: 'Diagnóstico' }],
    ['agendar', { data: '2026-10-15', hora: '15:00', servico: 'Retífica de motor' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  assert.equal(r.acoes.length, 0);
  const erros = ia.chamadas[1].params.messages.at(-1).content.map(b => b.content).join(' | ');
  assert.match(erros, /ocupado/);
  assert.match(erros, /Domingo/);
  assert.match(erros, /expediente/);
  assert.match(erros, /NÃO fazemos/);
});

test('agendar: horário que ficou ocupado entre a proposta e o clique não é gravado', async () => {
  const { cop, db } = montar([usa(['agendar', { data: '2026-10-15', hora: '15:00', servico: 'Diagnóstico' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  db.agendamentos.push({ id: 'novo', data: '2026-10-15', hora: '15:00:00', status: 'confirmado' });
  cop.contexto.invalidar();
  const ex = await cop.executarAcao(r.acoes[0].id, PERFIL);
  assert.equal(ex.ok, false);
  assert.match(ex.erro, /ocupado/);
  assert.equal(db.ia_acoes.find(x => x.id === r.acoes[0].id).status, 'erro');
});

test('remarcar e cancelar: só horário futuro do próprio cliente; executar e desfazer', async () => {
  const { cop, db, ia } = montar([usa(
    ['remarcar', { agendamento_id: ID.agOutro, data: '2026-10-15', hora: '15:00' }],
    ['remarcar', { agendamento_id: ID.agFuturo, data: '2026-10-16', hora: '15:00', motivo: 'cliente pediu tarde' }],
    ['cancelar_agendamento', { agendamento_id: ID.agFuturo, motivo: 'vai viajar' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  assert.match(ia.chamadas[1].params.messages.at(-1).content[0].content, /não é um horário futuro deste cliente/);
  const rem = r.acoes.find(a => a.tipo === 'remarcar');
  assert.match(rem.resumo, /sex, 16\/10 às 9h → sex, 16\/10 às 15h/);
  assert.equal(rem.parametros.antes, undefined, 'bastidor do desfazer não vai para a tela');
  const ag = () => db.agendamentos.find(a => a.id === ID.agFuturo);
  assert.equal((await cop.executarAcao(rem.id, PERFIL)).ok, true);
  assert.equal(ag().hora, '15:00');
  assert.equal((await cop.desfazerAcao(rem.id, PERFIL)).ok, true);
  assert.equal(ag().hora, '09:00');
  const can = r.acoes.find(a => a.tipo === 'cancelar_agendamento');
  assert.equal((await cop.executarAcao(can.id, PERFIL)).ok, true);
  assert.equal(ag().status, 'cancelado');
  assert.match(ag().observacoes, /vai viajar/);
  assert.equal((await cop.desfazerAcao(can.id, PERFIL)).ok, true);
  assert.equal(ag().status, 'confirmado');
});

test('mover_etapa: nome validado contra etapas_funil; executa com trava da etapa lida; desfaz', async () => {
  const { cop, db, ia } = montar([usa(['mover_etapa', { etapa: 'Etapa Inventada' }], ['mover_etapa', { etapa: 'aguardando orcamento' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  assert.match(ia.chamadas[1].params.messages.at(-1).content[0].content, /não existe/);
  const a = r.acoes[0];
  assert.equal(a.parametros.etapa, 'Aguardando orçamento');
  const ex = await cop.executarAcao(a.id, PERFIL);
  assert.equal(ex.ok, true, ex.erro);
  assert.equal(db.conversas[0].etapa_id, ID.e3);
  assert.equal(db.conversas[0].etapa_por_ia, true);
  assert.equal((await cop.desfazerAcao(a.id, PERFIL)).ok, true);
  assert.equal(db.conversas[0].etapa_id, ID.e2);
});

test('mover_etapa: se alguém mudou a etapa depois da proposta, não sobrescreve', async () => {
  const { cop, db } = montar([usa(['mover_etapa', { etapa: 'Agendado' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  db.conversas[0].etapa_id = ID.e3;
  cop.contexto.invalidar(ID.conversa);
  const ex = await cop.executarAcao(r.acoes[0].id, PERFIL);
  assert.equal(ex.ok, false);
  assert.match(ex.erro, /mudou a etapa/);
  assert.equal(db.conversas[0].etapa_id, ID.e3);
});

test('atualizar_ficha: só o que o cliente disse; placa normalizada; opt-out só se ele pediu; desfaz', async () => {
  const { cop, db } = montar([usa(['atualizar_ficha', { placa: 'abc-1d23', nome: 'Marcos Inventado', aceita_mensagens: false }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  const a = r.acoes[0];
  assert.deepEqual(a.parametros.campos, { placa: 'ABC1D23' });
  assert.ok(a.parametros.avisos.some(x => /nome não aparece/.test(x)));
  assert.ok(a.parametros.avisos.some(x => /não pediu para parar/.test(x)));
  assert.equal((await cop.executarAcao(a.id, PERFIL)).ok, true);
  assert.equal(db.clientes[0].placa, 'ABC1D23');
  assert.equal((await cop.desfazerAcao(a.id, PERFIL)).ok, true);
  assert.equal(db.clientes[0].placa, null);
});

test('atualizar_ficha: cliente pediu para parar → opt-out com data e motivo; sempre pede clique', async () => {
  const { cop, db } = montar([usa(['atualizar_ficha', { aceita_mensagens: false }]), fim], {
    autonomia: 'automatico',
    ajustar: t => t.whatsapp_mensagens.push({ id: 'm9', conversa_id: ID.conversa, direcao: 'entrada', corpo: 'Por favor não quero mais receber mensagens', created_at: '2026-10-14T12:55:00Z' }),
  });
  const r = await cop.rodar({ conversaId: ID.conversa });
  const a = r.acoes[0];
  assert.equal(a.precisa_clique, true);
  assert.equal(a.status, 'proposta', 'nem no automático');
  assert.equal((await cop.executarAcao(a.id, PERFIL)).ok, true);
  assert.equal(db.clientes[0].aceita_mensagens, false);
  assert.ok(db.clientes[0].aceita_mensagens_em);
  assert.match(db.clientes[0].aceita_mensagens_motivo, /parar/);
});

test('atualizar_ficha numa conversa sem cadastro cria o cliente e liga a conversa', async () => {
  const { cop, db } = montar([usa(['atualizar_ficha', { carro_modelo: 'Gol' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversaSemCliente });
  // "Gol" está no nome do WhatsApp, não na mensagem — vem pelo pedido
  assert.equal(r.acoes.length, 0);
  const { cop: c2, db: d2 } = montar([usa(['atualizar_ficha', { carro_modelo: 'Gol' }]), fim]);
  const r2 = await c2.rodar({ conversaId: ID.conversaSemCliente, pedido: 'o carro dele é um Gol' });
  const ex = await c2.executarAcao(r2.acoes[0].id, PERFIL);
  assert.equal(ex.ok, true, ex.erro);
  assert.equal(d2.conversas[1].cliente_id, '22222222-2222-4222-8222-2222222222ff');
  assert.equal(d2.clientes.at(-1).carro_modelo, 'Gol');
  assert.ok(db);
});

test('registrar_interesse: valor que o atendente não informou é descartado; o informado vale; desfaz', async () => {
  const { cop, db } = montar([usa(['registrar_interesse', { servico: 'Alinhamento', valor: 999 }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  assert.equal(r.acoes[0].parametros.valor, null);
  assert.match(r.acoes[0].parametros.aviso, /valor ignorado/);
  const { cop: c2, db: d2 } = montar([usa(['registrar_interesse', { servico: 'Alinhamento', valor: 120 }]), fim]);
  const r2 = await c2.rodar({ conversaId: ID.conversa });
  const a = r2.acoes[0];
  assert.equal(a.parametros.valor, 120, 'o atendente escreveu R$ 120,00');
  assert.equal((await c2.executarAcao(a.id, PERFIL)).ok, true);
  assert.equal(d2.leads[0].status, 'orcamento');
  assert.equal(d2.leads[0].valor_orcado, 120);
  assert.equal(d2.leads[0].servico_id, ID.sAlin);
  assert.equal((await c2.desfazerAcao(a.id, PERFIL)).ok, true);
  assert.equal(d2.leads[0].status, 'contato');
  assert.equal(d2.leads[0].valor_orcado, 350);
  assert.ok(db);
});

test('registrar_interesse sem lead aberto cria lead "orcamento"; desfazer apaga só esse lead', async () => {
  const { cop, db } = montar([usa(['registrar_interesse', { servico: 'Pastilhas de freio' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversaSemCliente });
  const ex = await cop.executarAcao(r.acoes[0].id, PERFIL);
  assert.equal(ex.ok, true, ex.erro);
  const lead = db.leads.find(l => l.id === ex.saida.lead_id);
  assert.equal(lead.status, 'orcamento');
  assert.equal(lead.telefone, '5512977776666');
  assert.ok(db.conversas[1].cliente_id, 'conversa ligada ao cadastro que o lead criou');
  await cop.desfazerAcao(r.acoes[0].id, PERFIL);
  assert.equal(db.leads.length, 1);
});

test('marcar_aguardando_consultor e agendar_retorno (fila do Comunicar, avulsa, com chave única); desfazer', async () => {
  const { cop, db } = montar([usa(['marcar_aguardando_consultor', { motivo: 'perguntou prazo da peça' }],
    ['agendar_retorno', { data: '2026-11-03', texto: 'Oi Camila! Passando pra lembrar do diagnóstico gratuito 😊' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  const ag = r.acoes.find(a => a.tipo === 'marcar_aguardando_consultor');
  assert.equal((await cop.executarAcao(ag.id, PERFIL)).ok, true);
  assert.equal(db.conversas[0].aguardando_consultor, true);
  assert.equal((await cop.desfazerAcao(ag.id, PERFIL)).ok, true);
  assert.equal(db.conversas[0].aguardando_consultor, false);
  const ret = r.acoes.find(a => a.tipo === 'agendar_retorno');
  assert.equal(ret.parametros.enviar_em, '2026-11-03T12:00:00.000Z', '9h de Brasília');
  assert.equal((await cop.executarAcao(ret.id, PERFIL)).ok, true);
  const env = db.posvenda_envios.find(e => e.criado_por === 'copiloto');
  assert.equal(env.tipo, 'avulsa');
  assert.equal(env.status, 'pendente');
  assert.equal(env.chave_unica, `copiloto:${ret.id}`);
  assert.equal(env.conversa_id, ID.conversa);
  assert.equal((await cop.desfazerAcao(ret.id, PERFIL)).ok, true);
  assert.equal(db.posvenda_envios.find(e => e.id === env.id).status, 'cancelado');
});

test('agendar_retorno recusado para quem não aceita mensagens, data passada, com preço ou domingo', async () => {
  const { cop, ia } = montar([usa(
    ['agendar_retorno', { data: '2026-10-13', texto: 'oi' }],
    ['agendar_retorno', { data: '2026-11-01', texto: 'oi' }],
    ['agendar_retorno', { data: '2026-11-03', texto: 'fica R$ 300' }]), fim]);
  await cop.rodar({ conversaId: ID.conversa });
  const e = ia.chamadas[1].params.messages.at(-1).content.map(b => b.content).join(' | ');
  assert.match(e, /a partir de amanhã/);
  assert.match(e, /expediente/);
  assert.match(e, /cita preço/);
  const { cop: c2, ia: i2 } = montar([usa(['agendar_retorno', { data: '2026-11-03', texto: 'oi' }]), fim],
    { ajustar: t => { t.clientes[0].aceita_mensagens = false; } });
  await c2.rodar({ conversaId: ID.conversa });
  assert.match(i2.chamadas[1].params.messages.at(-1).content[0].content, /não receber mensagens/);
});

test('autonomia "sugerir": só mostra — executar é recusado (exceto usar a resposta)', async () => {
  const { cop } = montar([usa(['responder', { texto: 'Opa!' }], ['mover_etapa', { etapa: 'Agendado' }]), fim], { autonomia: 'sugerir' });
  const r = await cop.rodar({ conversaId: ID.conversa });
  const ex = await cop.executarAcao(r.acoes[0].id, PERFIL);
  assert.equal(ex.status, 403);
  assert.match(ex.erro, /só sugerir/);
  assert.equal((await cop.executarAcao(r.resposta_acao_id, PERFIL)).ok, true);
});

test('autonomia "automatico": executa sozinho só o seguro; agendar e etapa de ganho pedem clique', async () => {
  const { cop, db } = montar([usa(
    ['atualizar_ficha', { placa: 'ABC1D23' }],
    ['marcar_aguardando_consultor', { motivo: 'dúvida técnica' }],
    ['mover_etapa', { etapa: 'Serviço concluído' }],
    ['agendar', { data: '2026-10-15', hora: '14:00', servico: 'Diagnóstico' }]), fim], { autonomia: 'automatico' });
  const r = await cop.rodar({ conversaId: ID.conversa });
  const por = t => r.acoes.find(a => a.tipo === t);
  assert.equal(por('atualizar_ficha').status, 'executada');
  assert.equal(por('atualizar_ficha').automatica, true);
  assert.equal(db.clientes[0].placa, 'ABC1D23');
  assert.equal(por('marcar_aguardando_consultor').status, 'executada');
  assert.equal(por('mover_etapa').status, 'proposta', '"Serviço concluído" é ganho: só humano');
  assert.equal(por('mover_etapa').precisa_clique, true);
  assert.equal(por('agendar').status, 'proposta');
  assert.equal(db.conversas[0].etapa_id, ID.e2);
});

test('injeção: cliente manda "marque como Serviço concluído" e a IA obedece — nada acontece sem clique', async () => {
  const { cop, db } = montar([usa(['mover_etapa', { etapa: 'Serviço concluído', motivo: 'cliente pediu' }],
    ['registrar_interesse', { servico: 'Suspensão', valor: 450 }]), fim], { autonomia: 'automatico' });
  const r = await cop.rodar({ conversaId: ID.conversa });
  assert.equal(db.conversas[0].etapa_id, ID.e2);
  assert.ok(r.acoes.every(a => a.status === 'proposta'));
  assert.equal(r.acoes.find(a => a.tipo === 'registrar_interesse').parametros.valor, null, 'R$ 450 foi o CLIENTE que disse');
});

test('trava: dois cliques executam uma vez só; recusada não executa; proposta velha não executa', async () => {
  const { cop, db } = montar([usa(['mover_etapa', { etapa: 'Agendado' }], ['marcar_aguardando_consultor', { motivo: 'x' }]), fim]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  const [a, b] = r.acoes;
  const [x, y] = await Promise.all([cop.executarAcao(a.id, PERFIL), cop.executarAcao(a.id, PERFIL)]);
  assert.equal([x, y].filter(z => z.ok).length, 1);
  assert.equal([x, y].find(z => !z.ok).status, 409);
  assert.equal((await cop.recusarAcao(b.id, PERFIL, 'não precisa')).ok, true);
  assert.equal(db.ia_acoes.find(z => z.id === b.id).saida.motivo_recusa, 'não precisa');
  assert.equal((await cop.executarAcao(b.id, PERFIL)).status, 409);
  db.ia_acoes.push({ id: '12121212-1212-4121-8121-121212121212', origem: 'atendimento', tipo: 'mover_etapa', status: 'proposta',
    conversa_id: ID.conversa, entrada: {}, created_at: '2026-10-12T12:00:00Z' });
  assert.match((await cop.executarAcao('12121212-1212-4121-8121-121212121212', PERFIL)).erro, /velha/);
  assert.equal((await cop.executarAcao('nao-e-uuid', PERFIL)).status, 400);
  assert.equal((await cop.desfazerAcao(b.id, PERFIL)).status, 409, 'recusada não desfaz');
});

test('limites: IA desligada = 503; limite do dia = 429; IA fora do ar = 502 com registro de erro', async () => {
  const { cop: c1 } = montar([fim], { ajustar: t => { t.ia_config[0].ativo = false; } });
  assert.equal((await c1.rodar({ conversaId: ID.conversa })).status, 503);
  const { cop: c2 } = montar([fim], { ajustar: t => {
    t.ia_config[0].limite_chamadas_dia = 10;
    for (let i = 0; i < 10; i++) t.ia_acoes.push({ id: `u${i}`, origem: 'atendimento', tipo: i % 2 ? 'copiloto' : 'sugerir', status: 'executada', created_at: '2026-10-14T11:00:00Z' });
    t.ia_acoes.push({ id: 'ontem', origem: 'atendimento', tipo: 'copiloto', created_at: '2026-10-14T02:00:00Z' });
  } });
  const r2 = await c2.rodar({ conversaId: ID.conversa });
  assert.equal(r2.status, 429);
  assert.match(r2.erro, /Limite diário/);
  const { cop: c3, db } = montar([new Error('overloaded')]);
  const r3 = await c3.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  assert.equal(r3.status, 502);
  assert.equal(db.ia_acoes.find(a => a.tipo === 'copiloto').status, 'erro');
  assert.equal((await c3.rodar({ conversaId: 'x' })).status, 400);
});

test('laço protegido: IA que não para de chamar ferramenta para em 4 voltas; repetida e inexistente são recusadas', async () => {
  const { cop, ia } = montar(() => usa(['marcar_aguardando_consultor', { motivo: 'x' }], ['apagar_tudo', {}]));
  const r = await cop.rodar({ conversaId: ID.conversa });
  assert.equal(ia.chamadas.length, 4);
  assert.equal(r.acoes.length, 1);
  const res = ia.chamadas[1].params.messages.at(-1).content;
  assert.match(res[1].content, /inexistente/);
  assert.match(ia.chamadas[2].params.messages.at(-1).content[0].content, /repetida/);
});

test('instruções extras do dono vão no system; pedido do atendente vai no fim', async () => {
  const { cop, ia } = montar([fim], { ajustar: t => { t.ia_config[0].instrucoes_extras = 'Sábado só até 12h.'; } });
  await cop.rodar({ conversaId: ID.conversa, pedido: 'oferece leva e traz' });
  const p = ia.chamadas[0].params;
  assert.match(p.system[1].text, /Sábado só até 12h/);
  assert.match(p.messages[0].content, /PEDIDO DO ATENDENTE.*leva e traz/);
});

test('recusa da IA (stop_reason refusal) não quebra', async () => {
  const { cop } = montar([{ stop_reason: 'refusal', content: [] }]);
  const r = await cop.rodar({ conversaId: ID.conversa });
  assert.equal(r.ok, true);
  assert.equal(r.recusou, true);
  assert.equal(r.resposta_sugerida, null);
});

test('listarAcoes, usoDoDia e salvarConfig', async () => {
  const { cop } = montar([usa(...basico, ['mover_etapa', { etapa: 'Agendado' }]), fim]);
  await cop.rodar({ conversaId: ID.conversa, perfil: PERFIL });
  const l = await cop.listarAcoes(ID.conversa);
  assert.equal(l.ok, true);
  assert.ok(l.acoes.some(a => a.tipo === 'copiloto'));
  assert.equal(l.acoes.find(a => a.tipo === 'mover_etapa').entrada.antes, undefined);
  const u = await cop.usoDoDia({ forcar: true });
  assert.equal(u.chamadas, 1);
  assert.equal(u.porPerfil[ID.perfil], 1);
  assert.equal(u.tokensEntrada, 200);
  assert.equal((await cop.salvarConfig({ autonomia: 'tudo' })).status, 400);
  assert.equal((await cop.salvarConfig({ modelo_rapido: 'gpt-4' })).status, 400);
  assert.equal((await cop.salvarConfig({ limite_chamadas_dia: 5 })).status, 400);
  assert.equal((await cop.salvarConfig({})).status, 400);
  const ok = await cop.salvarConfig({ autonomia: 'sugerir', instrucoes_extras: '  Fale de leva e traz.  ' }, { id: ID.admin });
  assert.equal(ok.ok, true);
  assert.equal(ok.config.autonomia, 'sugerir');
  assert.equal(ok.config.instrucoes_extras, 'Fale de leva e traz.');
  const log = (await cop.listarAcoes(ID.conversa)).acoes;
  assert.ok(log);
});

test('resumoCopiloto conta chamadas, aceite, desfeitas e automáticas', () => {
  const r = IA.resumoCopiloto([
    { tipo: 'copiloto', status: 'executada', tokens_entrada: 100, tokens_saida: 10, duracao_ms: 2000 },
    { tipo: 'sugerir', status: 'executada', tokens_entrada: 50, tokens_saida: 5 },
    { tipo: 'agendar', status: 'executada' }, { tipo: 'agendar', status: 'recusada' },
    { tipo: 'mover_etapa', status: 'desfeita' }, { tipo: 'atualizar_ficha', status: 'executada', saida: { automatica: true } },
    { tipo: 'classificar', status: 'executada' }, { tipo: 'responder', status: 'proposta' },
  ]);
  assert.equal(r.chamadas, 2);
  assert.equal(r.tokensEntrada, 150);
  assert.equal(r.propostas, 5);
  assert.equal(r.executadas, 3);
  assert.equal(r.recusadas, 1);
  assert.equal(r.desfeitas, 1);
  assert.equal(r.automaticas, 1);
  assert.equal(r.aceite, 75);
  assert.equal(r.duracaoMediaMs, 2000);
  assert.equal(r.porTipo.agendar.recusadas, 1);
});
