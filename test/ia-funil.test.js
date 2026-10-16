'use strict';
/* IA do funil (rodada 5): banco e IA de mentira — nada sai para a rede. */
const test = require('node:test');
const assert = require('node:assert/strict');
const IA = require('../lib/ia-copiloto.js');
const CTX = require('../lib/contexto.js');
const FUN = require('../lib/ia-funil.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');
const { ID, AGORA, tabelas, criarIAFalsa, usa, fim } = require('./apoio/dados.js');

const basico = (intencao = 'agendar', temperatura = 'morno') => [
  ['classificar', { intencao, temperatura, motivo: 'teste' }],
  ['resumir', { resumo: 'Cliente quer trazer o carro.', pendencias: [] }],
];

function montar(roteiro, { autonomia = 'automatico', funil_autonomia = {}, ajustar, rpc = {} } = {}) {
  const t = tabelas();
  t.ia_config[0].autonomia = autonomia;
  t.ia_config[0].funil_autonomia = funil_autonomia;
  t.ia_config[0].funil_ativo = true;
  t.at_ia_fila = [];
  if (ajustar) ajustar(t);
  const notificacoes = [];
  const sb = criarSbFalso(t, { relogio: () => AGORA, rpc: {
    notificar: (args) => { notificacoes.push(args); return { data: 'n-' + notificacoes.length, error: null }; },
    obter_ou_criar_cliente: (args, db) => { const id = '22222222-2222-4222-8222-2222222222ff'; db.clientes.push({ id, nome: args.p_nome, telefone: args.p_telefone }); return { data: id, error: null }; },
    ...rpc,
  } });
  const ia = criarIAFalsa(roteiro);
  const enviadas = [];
  const enviarMensagem = async ({ conversa, texto, cliente_id }) => {
    const id = 'msg-ia-' + (enviadas.length + 1);
    enviadas.push({ conversa_id: conversa.id, texto, cliente_id });
    sb.db.whatsapp_mensagens.push({ id, conversa_id: conversa.id, direcao: 'saida', corpo: texto, gerada_por_ia: true, created_at: AGORA.toISOString() });
    return { ok: true, mensagem_id: id };
  };
  const contexto = CTX.criarContexto({ sb, agora: () => AGORA });
  const cop = IA.criarCopiloto({ sb, contexto, criarIA: async () => ia, persona: 'PERSONA', agora: () => AGORA, enviarMensagem });
  const funil = FUN.criarFunil({ sb, copiloto: cop, contexto, agora: () => AGORA, log: () => {} });
  return { sb, db: sb.db, ia, cop, funil, enviadas, notificacoes };
}

/* ---------------- regras puras ---------------- */
test('precisaHumano: preço, urgência, pedido de pessoa e reclamação; dúvida comum não', () => {
  assert.equal(FUN.precisaHumano(['Quanto custa a troca de óleo?']), 'preco');
  assert.equal(FUN.precisaHumano(['tem desconto à vista?']), 'preco');
  assert.equal(FUN.precisaHumano(['Socorro, meu carro parou no meio da rua']), 'urgencia');
  assert.equal(FUN.precisaHumano(['Preciso falar com alguém AGORA']), 'urgencia');
  assert.equal(FUN.precisaHumano(['quero falar com uma pessoa, não com robô']), 'pediu_pessoa');
  assert.equal(FUN.precisaHumano(['Isso é um absurdo, voltou o barulho e ninguém resolveu']), 'reclamacao');
  assert.equal(FUN.precisaHumano(['Oi, vocês fazem alinhamento no sábado?']), null);
  assert.equal(FUN.precisaHumano(['tem garantia?']), null, 'garantia é dúvida comum (12 meses), não reclamação');
  assert.equal(FUN.precisaHumano([]), null);
});

test('textosSemResposta pega só o que o cliente mandou depois da última resposta da loja', () => {
  const ms = [{ direcao: 'entrada', corpo: 'a' }, { direcao: 'saida', corpo: 'b' }, { direcao: 'entrada', corpo: 'c' }, { direcao: 'entrada', corpo: 'd' }];
  assert.deepEqual(FUN.textosSemResposta(ms), ['c', 'd']);
  assert.deepEqual(FUN.textosSemResposta([{ direcao: 'saida', corpo: 'x' }]), []);
});

test('humanoEscreveuRecentemente: atendente nos últimos 30 min sim; IA ou [sistema] não; antigo não', () => {
  const agora = new Date('2026-10-14T13:00:00Z');
  const h = (min, extra = {}) => ({ direcao: 'saida', corpo: 'oi', created_at: new Date(agora - min * 60_000).toISOString(), ...extra });
  assert.equal(FUN.humanoEscreveuRecentemente([h(10)], agora), true);
  assert.equal(FUN.humanoEscreveuRecentemente([h(10, { gerada_por_ia: true })], agora), false);
  assert.equal(FUN.humanoEscreveuRecentemente([h(10, { corpo: '[sistema] passou para fulano' })], agora), false);
  assert.equal(FUN.humanoEscreveuRecentemente([h(45)], agora), false);
  assert.equal(FUN.humanoEscreveuRecentemente([{ direcao: 'entrada', created_at: agora.toISOString() }], agora), false);
});

test('etapaAgendadoPendente: horário futuro + conversa na 1ª etapa (ou sem etapa) → "Agendado"; já avançada não mexe', () => {
  const etapas = [{ id: 'e1', nome: 'Primeiro contato', ordem: 1 }, { id: 'e2', nome: 'Em atendimento', ordem: 2 }, { id: 'e4', nome: 'Agendado', ordem: 5 }];
  const fut = [{ id: 'a', data: '2026-10-20' }];
  assert.equal(FUN.etapaAgendadoPendente({ agendamentos: { futuros: fut }, funil: { etapas, etapaAtual: { id: 'e1' } } })?.id, 'e4');
  assert.equal(FUN.etapaAgendadoPendente({ agendamentos: { futuros: fut }, funil: { etapas, etapaAtual: null } })?.id, 'e4');
  assert.equal(FUN.etapaAgendadoPendente({ agendamentos: { futuros: fut }, funil: { etapas, etapaAtual: { id: 'e2' } } }), null);
  assert.equal(FUN.etapaAgendadoPendente({ agendamentos: { futuros: fut }, funil: { etapas, etapaAtual: { id: 'e4' } } }), null);
  assert.equal(FUN.etapaAgendadoPendente({ agendamentos: { futuros: [] }, funil: { etapas, etapaAtual: { id: 'e1' } } }), null);
});

test('niveisDoFunil e decisaoDoFunil: herdar o geral, etapa manda, sensível/cancelar sempre pedem clique', () => {
  const n = IA.niveisDoFunil({ autonomia: 'automatico', funil_autonomia: { agendar: 'confirmar', humano: 'sugerir' } });
  assert.deepEqual(n, { responder: 'automatico', agendar: 'confirmar', crm: 'automatico', humano: 'sugerir' });
  assert.equal(IA.decisaoDoFunil('responder', {}, n), 'executar');
  assert.equal(IA.decisaoDoFunil('agendar', {}, n), 'confirmar');
  assert.equal(IA.decisaoDoFunil('remarcar', {}, n), 'confirmar', 'remarcar é da etapa agendar');
  assert.equal(IA.decisaoDoFunil('atualizar_ficha', {}, n), 'executar');
  assert.equal(IA.decisaoDoFunil('atualizar_ficha', { sensivel: true }, n), 'confirmar', 'opt-out sempre pede clique');
  assert.equal(IA.decisaoDoFunil('mover_etapa', { sensivel: true }, n), 'confirmar', 'ganho/perda sempre pede clique');
  assert.equal(IA.decisaoDoFunil('cancelar_agendamento', {}, { ...n, agendar: 'automatico' }), 'confirmar', 'cancelar nunca sozinho');
  assert.equal(IA.decisaoDoFunil('marcar_aguardando_consultor', {}, n), 'sugerir');
  assert.equal(IA.decisaoDoFunil('classificar', {}, n), 'executar', 'informativas sempre');
  assert.equal(IA.niveisDoFunil({}).responder, 'confirmar', 'sem nada: confirmar');
});

test('textoHorarioOcupado oferece as duas opções livres, sem preço, com uma pergunta', () => {
  const t = IA.textoHorarioOcupado([{ rotulo: 'quinta, 15/10 às 14h' }, { rotulo: 'sexta, 16/10 às 9h' }], 'Camila Souza');
  assert.match(t, /^Camila, /);
  assert.match(t, /quinta, 15\/10 às 14h ou sexta, 16\/10 às 9h/);
  assert.equal((t.match(/\?/g) || []).length, 1);
  assert.equal(IA.revisarTexto(t).temPreco, false);
  assert.match(IA.textoHorarioOcupado([], ''), /consultor/);
});

test('proximaAcao: uma frase certa para cada situação', () => {
  const ficha = { agendamentos: { futuros: [] }, conversa: {} };
  assert.equal(IA.proximaAcao({ intencao: 'agendar', ficha, situacao: { semResposta: true } }).tipo, 'horarios');
  assert.equal(IA.proximaAcao({ intencao: 'orcamento', ficha }).tipo, 'orcamento');
  assert.equal(IA.proximaAcao({ intencao: 'reclamacao', ficha }).tipo, 'ligar');
  assert.equal(IA.proximaAcao({ ficha, acoes: [{ tipo: 'agendar', status: 'proposta' }] }).tipo, 'aprovar');
  assert.equal(IA.proximaAcao({ ficha, acoes: [{ tipo: 'agendar', status: 'executada' }] }).tipo, 'confirmar');
  assert.equal(IA.proximaAcao({ ficha: { ...ficha, conversa: { aguardando_consultor: true } } }).tipo, 'ligar');
  assert.equal(IA.proximaAcao({ ficha, situacao: { semResposta: true } }).tipo, 'responder');
  assert.equal(IA.proximaAcao({ ficha, situacao: { semResposta: false } }).tipo, 'acompanhar');
});

test('escolherConsultor: livre na meia hora e com menos carga no dia; ninguém livre → null', () => {
  const cons = [{ id: 'c1', nome: 'Franklin' }, { id: 'c2', nome: 'Ana' }];
  const ag = [{ data: '2026-10-15', hora: '14:00:00', status: 'confirmado', consultor_id: 'c1' }, { data: '2026-10-15', hora: '09:00:00', status: 'confirmado', consultor_id: 'c2' }];
  assert.equal(IA.escolherConsultor(cons, ag, '2026-10-15', '14:00'), 'c2', 'Franklin ocupado às 14h');
  assert.equal(IA.escolherConsultor(cons, ag, '2026-10-15', '10:00'), 'c2', 'empate de carga: ordem por nome (Ana antes de Franklin)');
  assert.equal(IA.escolherConsultor(cons, [...ag, { data: '2026-10-15', hora: '14:00:00', status: 'confirmado', consultor_id: 'c2' }], '2026-10-15', '14:00'), null);
  assert.equal(IA.escolherConsultor([cons[0]], [{ data: '2026-10-15', hora: '14:00:00', status: 'cancelado', consultor_id: 'c1' }], '2026-10-15', '14:00'), 'c1', 'cancelado não ocupa');
  assert.equal(IA.escolherConsultor([], ag, '2026-10-15', '14:00'), null);
});

/* ---------------- a IA conduz ---------------- */
test('automatico: a IA responde ao cliente SOZINHA (mensagem na fila de saída, gerada_por_ia) e completa a ficha; tudo em ia_acoes sem pessoa', async () => {
  const { funil, db, enviadas, ia } = montar([
    usa(...basico('orcamento'), ['responder', { texto: 'Opa! Pra freio a gente faz o diagnóstico digital gratuito. Qual é o carro?' }]),
    fim,
  ]);
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.status, 'feita', JSON.stringify(r));
  assert.equal(r.enviadas, 1);
  assert.equal(enviadas.length, 1);
  assert.match(enviadas[0].texto, /diagnóstico digital gratuito/);
  assert.equal(r.podeResponder, true);
  assert.equal(r.humano, null, '"quero orçamento de freio" sem pedir valor não é caso de humano');
  const resp = db.ia_acoes.find(a => a.tipo === 'responder');
  assert.equal(resp.status, 'executada');
  assert.equal(resp.perfil_id, null, 'foi a IA sozinha');
  assert.equal(resp.saida.enviada, true);
  assert.equal(resp.saida.mensagem_id, 'msg-ia-1');
  assert.equal(resp.entrada.enviar, true);
  const run = db.ia_acoes.find(a => a.tipo === 'copiloto');
  assert.equal(run.perfil_id, null);
  assert.equal(run.entrada.funil.podeResponder, true);
  assert.deepEqual(run.saida.enviadas, ['msg-ia-1']);
  // o prompt da IA é o do FUNIL (conduz), não o do copiloto
  assert.match(ia.chamadas[0].params.system[0].text, /CONDUZINDO esta conversa/);
  assert.match(ia.chamadas[0].params.messages[0].content, /VOCÊ ESTÁ CONDUZINDO/);
});

test('automatico: cliente aceitou o horário → agendamento criado (lead + consultor livre) e a mensagem confirma', async () => {
  const { funil, db, enviadas } = montar([
    usa(...basico('agendar', 'quente'), ['agendar', { data: '2026-10-15', hora: '14:00', servico: 'Diagnóstico', veiculo: 'Gol 2015' }],
      ['responder', { texto: 'Fechado! Quinta, 15/10 às 14h a gente te espera com o Gol. 📍 Av. Bandeirantes, 875' }]),
    fim,
  ]);
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.status, 'feita', JSON.stringify(r));
  assert.ok(r.executadas.includes('agendar'), r.executadas.join(','));
  const ag = db.agendamentos.find(a => a.data === '2026-10-15' && String(a.hora).startsWith('14:00'));
  assert.ok(ag, 'agendamento criado');
  assert.equal(ag.status, 'confirmado');
  assert.equal(ag.origem, 'whatsapp');
  assert.equal(ag.consultor_id, ID.consultor, 'consultor livre no horário');
  assert.ok(ag.lead_id, 'amarrado ao lead');
  const lead = db.leads.find(l => l.id === ag.lead_id);
  assert.equal(lead.status, 'agendado');
  assert.match(lead.observacoes, /IA do atendimento/);
  assert.equal(enviadas.length, 1);
  assert.match(enviadas[0].texto, /15\/10 às 14h/);
  const acaoAg = db.ia_acoes.find(a => a.tipo === 'agendar');
  assert.equal(acaoAg.status, 'executada');
  assert.equal(acaoAg.saida.automatica, true);
});

test('automatico: horário aceito já estava ocupado → não agenda e a mensagem oferece outras duas opções (nunca confirma)', async () => {
  const { funil, db, enviadas } = montar([
    usa(...basico('agendar', 'quente'), ['agendar', { data: '2026-10-15', hora: '08:00', servico: 'Diagnóstico' }],
      ['responder', { texto: 'Fechado, quinta às 8h então!' }]),
    fim,
  ], { ajustar: t => { t.consultores = []; } });   // sem consultor cadastrado: capacidade 1 → 08:00 do dia 15 (agOutro) está lotado
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.status, 'feita');
  assert.ok(!db.agendamentos.some(a => a.cliente_nome === 'Zé do Gol'), 'nada marcado');
  assert.equal(enviadas.length, 1);
  assert.match(enviadas[0].texto, /acabou de ser preenchido/);
  assert.doesNotMatch(enviadas[0].texto, /Fechado/);
  const resp = db.ia_acoes.find(a => a.tipo === 'responder');
  assert.equal(resp.entrada.texto_original, 'Fechado, quinta às 8h então!');
});

test('confirmar: nada é executado; propostas ficam e o dono da conversa recebe UM aviso (rpc notificar) com link', async () => {
  const { funil, db, enviadas, notificacoes } = montar([
    usa(...basico('agendar', 'quente'), ['agendar', { data: '2026-10-15', hora: '14:00', servico: 'Diagnóstico' }], ['responder', { texto: 'Quinta 14h fica bom?' }]),
    fim,
  ], { autonomia: 'confirmar', ajustar: t => { t.conversas[1].atribuida_a = ID.perfil; } });
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.status, 'feita');
  assert.equal(enviadas.length, 0, 'nenhuma mensagem sai sem clique');
  assert.equal(r.para_confirmar, 2);
  assert.equal(r.avisos, 1);
  assert.equal(notificacoes.length, 1);
  assert.equal(notificacoes[0].p_perfil, ID.perfil);
  assert.equal(notificacoes[0].p_tipo, 'ia');
  assert.match(notificacoes[0].p_titulo, /IA propôs para Zé do Gol/);
  assert.equal(notificacoes[0].p_link, `/?conversa=${ID.conversaSemCliente}`);
  assert.ok(notificacoes[0].p_chave.startsWith('ia-proposta:'));
  assert.ok(db.ia_acoes.filter(a => a.status === 'proposta').length >= 2);
  assert.ok(!db.agendamentos.some(a => a.data === '2026-10-15' && String(a.hora).startsWith('14:00')));
  // o clique de alguém da equipe executa a resposta: a mensagem SAI
  const resp = db.ia_acoes.find(a => a.tipo === 'responder');
  assert.equal(resp.entrada.enviar, true, 'a proposta já sabe que é para ENVIAR quando aprovada');
});

test('confirmar sem dono: gestores e quem recebe leads são avisados', async () => {
  const { funil, notificacoes } = montar([usa(...basico(), ['responder', { texto: 'Qual é o carro?' }]), fim],
    { autonomia: 'confirmar', ajustar: t => { t.perfis = [
      { id: ID.admin, nome: 'Dono', papel: 'admin', ativo: true, apps: [], recebe_leads: false },
      { id: ID.perfil, nome: 'Ana', papel: 'atendente', ativo: true, apps: ['atendimento'], recebe_leads: true },
      { id: '88888888-8888-4888-8888-888888888880', nome: 'Fora', papel: 'atendente', ativo: true, apps: ['crm'], recebe_leads: true },
    ]; } });
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.avisos, 2);
  assert.deepEqual(notificacoes.map(n => n.p_perfil).sort(), [ID.admin, ID.perfil].sort());
});

test('sugerir: só propõe — sem mensagem, sem aviso, sem mexer no banco', async () => {
  const { funil, db, enviadas, notificacoes } = montar([usa(...basico(), ['responder', { texto: 'Qual é o carro?' }], ['atualizar_ficha', { carro_modelo: 'Gol' }]), fim], { autonomia: 'sugerir' });
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.status, 'feita');
  assert.equal(enviadas.length, 0);
  assert.equal(notificacoes.length, 0);
  assert.equal(db.ia_acoes.find(a => a.tipo === 'responder').status, 'proposta');
  assert.equal(db.ia_acoes.filter(a => a.status === 'executada' && !['classificar', 'resumir', 'copiloto'].includes(a.tipo)).length, 0, 'nada executado');
  assert.equal(db.clientes.length, 1, 'ficha não foi tocada');
});

test('autonomia por etapa: responder automático e agendar "confirmar" → a mensagem sai mas o horário espera o clique (e o dono é avisado)', async () => {
  const { funil, db, enviadas, notificacoes } = montar([
    usa(...basico('agendar', 'quente'), ['agendar', { data: '2026-10-15', hora: '14:00', servico: 'Diagnóstico' }], ['responder', { texto: 'Pode ser quinta às 14h?' }]),
    fim,
  ], { autonomia: 'automatico', funil_autonomia: { agendar: 'confirmar' }, ajustar: t => { t.conversas[1].atribuida_a = ID.perfil; } });
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(enviadas.length, 1);
  assert.equal(db.ia_acoes.find(a => a.tipo === 'agendar').status, 'proposta');
  assert.equal(r.para_confirmar, 1);
  assert.equal(notificacoes.length, 1);
  assert.match(notificacoes[0].p_titulo, /Agendar Diagnóstico/);
});

test('preço → o sistema manda passar para humano: aguardando consultor marcado DEPOIS da mensagem (a saída não limpa a espera)', async () => {
  const { funil, db, sb, enviadas, ia } = montar([
    usa(...basico('orcamento'), ['marcar_aguardando_consultor', { motivo: 'pediu valor' }],
      ['responder', { texto: 'Valor certinho quem passa é o consultor — já estou chamando. Enquanto isso, o diagnóstico digital é gratuito, quer?' }]),
    fim,
  ], { ajustar: t => { t.whatsapp_mensagens.push({ id: 'm9', conversa_id: ID.conversaSemCliente, direcao: 'entrada', corpo: 'Quanto custa a pastilha?', created_at: '2026-10-14T12:40:00Z' }); } });
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.humano, 'preco');
  assert.match(ia.chamadas[0].params.messages[0].content, /PASSE PARA HUMANO AGORA \(motivo detectado pelo sistema: preco\)/);
  assert.equal(enviadas.length, 1);
  assert.equal(IA.revisarTexto(enviadas[0].texto).temPreco, false);
  const conv = db.conversas.find(c => c.id === ID.conversaSemCliente);
  assert.equal(conv.aguardando_consultor, true);
  const ordem = db.ia_acoes.filter(a => ['responder', 'marcar_aguardando_consultor'].includes(a.tipo)).map(a => a.tipo);
  assert.ok(ordem.length === 2);
  const idxResp = sb.log.findIndex(l => l.tabela === 'whatsapp_mensagens' && l.op === 'insert');
  const idxEsp = sb.log.findIndex(l => l.tabela === 'conversas' && l.op === 'update' && l.dados?.aguardando_consultor === true);
  assert.ok(idxResp < idxEsp, 'mensagem antes da marca de espera');
});

test('atendente humano escreveu há pouco → a IA não manda sozinha: a resposta vira proposta para ele (mesmo em automatico)', async () => {
  const { funil, db, enviadas } = montar([usa(...basico(), ['responder', { texto: 'Qual é o carro?' }]), fim],
    { ajustar: t => { t.whatsapp_mensagens.push({ id: 'm10', conversa_id: ID.conversaSemCliente, direcao: 'saida', corpo: 'Oi, já te respondo', created_at: '2026-10-14T12:45:00Z' },
      { id: 'm11', conversa_id: ID.conversaSemCliente, direcao: 'entrada', corpo: 'ok', created_at: '2026-10-14T12:50:00Z' }); t.conversas[1].atribuida_a = ID.perfil; } });
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.status, 'feita');
  assert.equal(r.podeResponder, false);
  assert.equal(enviadas.length, 0);
  assert.equal(db.ia_acoes.find(a => a.tipo === 'responder').status, 'proposta');
  assert.equal(r.para_confirmar, 1, 'o atendente recebe "Aprovar e enviar"');
});

test('última mensagem é da loja → pulada "já respondida" (não gasta IA)', async () => {
  const { funil, ia } = montar([fim], { ajustar: t => { t.whatsapp_mensagens.push({ id: 'm12', conversa_id: ID.conversaSemCliente, direcao: 'saida', corpo: 'Respondido', created_at: '2026-10-14T12:55:00Z' }); } });
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.status, 'pulada');
  assert.equal(r.motivo, 'já respondida');
  assert.equal(ia.chamadas.length, 0);
});

test('IA desligada ou funil desligado → pulada; conversa de disparo → pulada', async () => {
  const a = montar([fim], { ajustar: t => { t.ia_config[0].ativo = false; } });
  assert.equal((await a.funil.conduzir(ID.conversaSemCliente)).motivo, 'IA desligada');
  const b = montar([fim], { ajustar: t => { t.ia_config[0].funil_ativo = false; } });
  assert.equal((await b.funil.conduzir(ID.conversaSemCliente)).motivo, 'IA do funil desligada');
  const c = montar([fim], { ajustar: t => { t.conversas[1].tipo = 'disparo'; } });
  assert.equal((await c.funil.conduzir(ID.conversaSemCliente)).motivo, 'conversa de disparo');
});

test('cliente com horário marcado cuja conversa nasceu em "Primeiro contato" → vai para "Agendado" (registrado em ia_acoes)', async () => {
  const { funil, db } = montar([usa(...basico(), ['responder', { texto: 'Oi Camila! Tudo certo para sexta às 9h com o Corolla?' }]), fim],
    { ajustar: t => { t.conversas[0].etapa_id = ID.e1; } });
  const r = await funil.conduzir(ID.conversa);
  assert.equal(r.status, 'feita');
  assert.deepEqual(r.feitas.map(f => f.tipo), ['mover_etapa']);
  assert.equal(db.conversas[0].etapa_id, ID.e4, 'Agendado');
  assert.equal(db.conversas[0].etapa_por_ia, true);
  const mov = db.ia_acoes.find(a => a.tipo === 'mover_etapa');
  assert.equal(mov.status, 'executada');
  assert.equal(mov.perfil_id, null);
  assert.match(mov.resumo, /já tem horário marcado/);
  assert.equal(mov.saida.antes.etapa, 'Primeiro contato');
});

test('conversa já em "Em atendimento" com horário marcado NÃO volta/avança de etapa', async () => {
  const { funil, db } = montar([usa(...basico(), ['responder', { texto: 'Oi Camila!' }]), fim]);
  const r = await funil.conduzir(ID.conversa);
  assert.deepEqual(r.feitas, []);
  assert.equal(db.conversas[0].etapa_id, ID.e2);
});

test('conversa sem cliente_id com cadastro pelo telefone (rpc cliente_360) → religa e marca "cliente da casa" para a IA', async () => {
  const { funil, db, ia } = montar([usa(...basico(), ['responder', { texto: 'Oi Zé! O Gol de novo?' }]), fim], {
    ajustar: t => {
      t.clientes.push({ id: ID.outroCliente, nome: 'Zé Carlos', telefone: '5512977776666', carro_modelo: 'Gol', aceita_mensagens: true, created_at: '2025-03-01T12:00:00Z' });
      t.v_cliente_360.push({ id: ID.outroCliente, total_gasto: 400, servicos_feitos: 1, faltas: 0, total_leads: 1 });
    },
    rpc: { cliente_360: (args) => ({ data: { cliente: args.p_telefone === '12977776666' ? { id: ID.outroCliente } : null }, error: null }) },
  });
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.status, 'feita');
  assert.ok(r.feitas.some(f => f.tipo === 'vincular_cliente'));
  assert.equal(db.conversas[1].cliente_id, ID.outroCliente);
  const v = db.ia_acoes.find(a => a.tipo === 'vincular_cliente');
  assert.equal(v.status, 'executada');
  assert.match(ia.chamadas[0].params.messages[0].content, /CLIENTE DA CASA/);
});

/* ---------------- a fila ---------------- */
test('processarFila: agrupa por conversa, pula quem ainda digita, marca feita/pulada com o resultado', async () => {
  const { funil, db } = montar([usa(...basico(), ['responder', { texto: 'Qual é o carro?' }]), fim], {
    ajustar: t => {
      const antes = new Date(AGORA - 20_000).toISOString(), depois = new Date(AGORA.getTime() + 6_000).toISOString();
      t.at_ia_fila.push(
        { id: 'f1', conversa_id: ID.conversaSemCliente, status: 'pendente', agendado_para: antes, created_at: antes },
        { id: 'f2', conversa_id: ID.conversaSemCliente, status: 'pendente', agendado_para: antes, created_at: antes },
        { id: 'f3', conversa_id: ID.conversa, status: 'pendente', agendado_para: depois, created_at: antes },    // Camila ainda digitando
        { id: 'f4', conversa_id: ID.conversa, status: 'feita', agendado_para: antes, created_at: antes });
    },
  });
  const r = await funil.processarFila();
  assert.deepEqual(r, { conversas: 1, feitas: 1, puladas: 0, erros: 0 });
  assert.equal(db.at_ia_fila.find(f => f.id === 'f1').status, 'feita');
  assert.equal(db.at_ia_fila.find(f => f.id === 'f2').status, 'feita', 'as duas linhas da mesma conversa fecham juntas');
  assert.equal(db.at_ia_fila.find(f => f.id === 'f1').resultado.enviadas, 1);
  assert.equal(db.at_ia_fila.find(f => f.id === 'f3').status, 'pendente', 'espera o cliente terminar de digitar');
  assert.ok((await funil.pendentes()).length === 1);
});

test('processarFila: conversa que a IA pula fica "pulada" com o motivo; erro de IA vira "erro"', async () => {
  const antes = new Date(AGORA - 20_000).toISOString();
  const a = montar([fim], { ajustar: t => {
    t.whatsapp_mensagens.push({ id: 'm12', conversa_id: ID.conversaSemCliente, direcao: 'saida', corpo: 'Respondido', created_at: '2026-10-14T12:55:00Z' });
    t.at_ia_fila.push({ id: 'f1', conversa_id: ID.conversaSemCliente, status: 'pendente', agendado_para: antes, created_at: antes });
  } });
  assert.deepEqual(await a.funil.processarFila(), { conversas: 1, feitas: 0, puladas: 1, erros: 0 });
  assert.equal(a.db.at_ia_fila[0].motivo, 'já respondida');
  const b = montar([new Error('IA caiu')], { ajustar: t => { t.at_ia_fila.push({ id: 'f1', conversa_id: ID.conversaSemCliente, status: 'pendente', agendado_para: antes, created_at: antes }); } });
  assert.deepEqual(await b.funil.processarFila(), { conversas: 1, feitas: 0, puladas: 0, erros: 1 });
  assert.equal(b.db.at_ia_fila[0].status, 'erro');
});

test('hoje(): o que a IA fez hoje, por conversa, com totais e a fila', async () => {
  const { funil, db } = montar([usa(...basico('agendar', 'quente'), ['agendar', { data: '2026-10-15', hora: '14:00', servico: 'Diagnóstico' }], ['responder', { texto: 'Fechado, quinta 14h!' }]), fim]);
  await funil.conduzir(ID.conversaSemCliente);
  db.at_ia_fila.push({ id: 'f9', conversa_id: ID.conversaSemCliente, status: 'processando', created_at: AGORA.toISOString() });
  const h = await funil.hoje();
  assert.equal(h.ok, true);
  assert.equal(h.conversas.length, 1);
  assert.equal(h.conversas[0].nome, 'Zé do Gol');
  const tipos = h.conversas[0].acoes.map(a => a.tipo).sort();
  assert.ok(tipos.includes('agendar') && tipos.includes('responder'));
  assert.ok(!tipos.includes('classificar'), 'informativas ficam de fora');
  assert.equal(h.totais.agendamentos, 1);
  assert.equal(h.totais.enviadas, 1);
  assert.equal(h.conversas[0].acoes.find(a => a.tipo === 'agendar').reversivel, true);
  assert.equal(h.conversas[0].acoes.find(a => a.tipo === 'responder').texto, 'Fechado, quinta 14h!');
  assert.deepEqual(h.processando, [ID.conversaSemCliente]);
});

test('ligar/desligar: o relógio drena a fila sozinho e acordar() não empilha pedidos', async () => {
  const antes = new Date(AGORA - 20_000).toISOString();
  const { funil, db } = montar([usa(...basico(), ['responder', { texto: 'Qual é o carro?' }]), fim],
    { ajustar: t => { t.at_ia_fila.push({ id: 'f1', conversa_id: ID.conversaSemCliente, status: 'pendente', agendado_para: antes, created_at: antes }); } });
  assert.equal(funil.acordar({ atrasoMs: 5 }), true);
  assert.equal(funil.acordar({ atrasoMs: 5 }), false, 'já há um pedido na fila');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(db.at_ia_fila[0].status, 'feita');
  assert.equal(funil.ligar({ intervaloMs: 10_000, atrasoMs: 5 }), true);
  assert.equal(funil.ligar(), false);
  funil.desligar();
});

/* ---------------- contratos do coordenador (rodada 5): Site e Agenda ---------------- */
test('origemDoSite: lê serviço, código e campanha da mensagem do botão do site; mensagem comum não é do site', () => {
  assert.deepEqual(FUN.origemDoSite(['Olá! Vim pelo site e quero orçar: Troca de óleo. (site/troca-de-oleo)']), { site: true, servico: 'Troca de óleo', codigo: 'troca-de-oleo', campanha: null });
  assert.deepEqual(FUN.origemDoSite(['Olá! Vim pelo site e quero orçar: Câmbio automático. (site/cambio--meta)']), { site: true, servico: 'Câmbio automático', codigo: 'cambio', campanha: 'meta' });
  assert.deepEqual(FUN.origemDoSite(['Olá! Vim pelo site']), { site: true, servico: null, codigo: null, campanha: null });
  assert.equal(FUN.origemDoSite(['Oi, quero orçar freio']), null);
  assert.equal(FUN.precisaHumano(['Olá! Vim pelo site e quero orçar: Freios. (site/freios)']), null, '"quero orçar" do site não é pedido de valor');
});

test('cliente do site: a IA recebe a instrução (serviço e campanha) e não pergunta o serviço', async () => {
  const { funil, ia } = montar([usa(...basico('orcamento'), ['registrar_interesse', { servico: 'Pastilhas de freio' }], ['responder', { texto: 'Oi! Vi que você quer orçar os freios. Qual é o carro?' }]), fim],
    { ajustar: t => { t.whatsapp_mensagens.push({ id: 'm13', conversa_id: ID.conversaSemCliente, direcao: 'entrada', corpo: 'Olá! Vim pelo site e quero orçar: Pastilhas de freio. (site/freios--meta)', created_at: '2026-10-14T12:45:00Z' }); } });
  const r = await funil.conduzir(ID.conversaSemCliente);
  assert.equal(r.status, 'feita');
  assert.deepEqual(r.site, { site: true, servico: 'Pastilhas de freio', codigo: 'freios', campanha: 'meta' });
  assert.equal(r.humano, null);
  const prompt = ia.chamadas[0].params.messages[0].content;
  assert.match(prompt, /VEIO PELO SITE \(campanha meta\) pedindo orçamento de "Pastilhas de freio"/);
  assert.ok(r.executadas.includes('registrar_interesse'));
});

test('agendar consulta a Agenda (rpc agenda_horarios_livres): lotado lá → não marca e a mensagem oferece outras opções; sem a função, vale a nossa regra', async () => {
  const roteiro = () => [usa(...basico('agendar', 'quente'), ['agendar', { data: '2026-10-15', hora: '14:00', servico: 'Diagnóstico' }], ['responder', { texto: 'Fechado, quinta às 14h!' }]), fim];
  const lotado = montar(roteiro(), { rpc: { agenda_horarios_livres: (a) => ({ data: { data: a.p_dia, aberto: true, horarios: [{ hora: '14:00', fim: '15:00', livres: 0, consultores_livres: [] }, { hora: '15:00', livres: 1 }] }, error: null }) } });
  const r1 = await lotado.funil.conduzir(ID.conversaSemCliente);
  assert.equal(r1.status, 'feita');
  assert.ok(!lotado.db.agendamentos.some(a => a.cliente_nome === 'Zé do Gol'), 'a Agenda disse que está lotado');
  assert.match(lotado.enviadas[0].texto, /acabou de ser preenchido/);
  const fechado = montar(roteiro(), { rpc: { agenda_horarios_livres: () => ({ data: { aberto: false, motivo: 'feriado', horarios: [] }, error: null }) } });
  await fechado.funil.conduzir(ID.conversaSemCliente);
  assert.ok(!fechado.db.agendamentos.some(a => a.cliente_nome === 'Zé do Gol'));
  const livre = montar(roteiro(), { rpc: { agenda_horarios_livres: () => ({ data: { aberto: true, horarios: [{ hora: '14:00:00', livres: 2, consultores_livres: [ID.consultor] }] }, error: null }) } });
  await livre.funil.conduzir(ID.conversaSemCliente);
  assert.ok(livre.db.agendamentos.some(a => a.cliente_nome === 'Zé do Gol' && String(a.hora).startsWith('14:00')), 'livre na Agenda → marca');
  const semFuncao = montar(roteiro());   // rpc inexistente no dublê → só a nossa validação
  await semFuncao.funil.conduzir(ID.conversaSemCliente);
  assert.ok(semFuncao.db.agendamentos.some(a => a.cliente_nome === 'Zé do Gol'));
});
