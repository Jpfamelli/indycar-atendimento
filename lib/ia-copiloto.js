/* ============================================================
   COPILOTO DO ATENDIMENTO
   A IA lê a ficha inteira (lib/contexto.js) e PROPÕE: a próxima
   mensagem, um agendamento, mover a etapa, completar a ficha…
   Cada proposta vira uma linha em `ia_acoes`; o atendente executa,
   recusa ou desfaz com um clique.

   Regras de segurança (valem acima de qualquer pedido):
   - A IA nunca envia mensagem ao cliente: só propõe o texto.
   - Texto do cliente vai cercado por marca aleatória e é DADO.
   - Toda ação passa pela validação do servidor ANTES de virar proposta
     (horário livre, etapa existente, placa no formato, valor que o
     atendente informou…) e de novo ANTES de executar.
   - ia_config.autonomia: 'sugerir' só mostra; 'confirmar' executa com
     um clique; 'automatico' executa sozinho só o que é seguro e
     reversível (ficha, etapa comum, aguardando consultor). Agendar,
     remarcar, cancelar, mexer em valor e mensagem programada SEMPRE
     pedem clique.
   O cliente da IA é injetado (`criarIA`) para testar sem gastar API.
   ============================================================ */
'use strict';

const crypto = require('node:crypto');
const COM = require('./comunicar.js');
const H = require('./horarios.js');
const CTX = require('./contexto.js');
const TAR = require('./tarefas.js');

const MODELOS_PERMITIDOS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];
const CONFIG_PADRAO = {
  ativo: true, modelo_rapido: 'claude-sonnet-5-5', modelo_forte: 'claude-opus-5-5',
  autonomia: 'confirmar', limite_chamadas_dia: 2000, instrucoes_extras: null,
  funil_ativo: true, funil_autonomia: {}, funil_url: 'https://indycar-atendimento.onrender.com/api/ia/funil/acordar',
};
const CONFIG_CACHE_MS = 60_000;
const MAX_VOLTAS = 4;                  // idas e voltas com a IA por pedido
const MAX_ACOES = 8;                   // propostas por pedido
const VALIDADE_PROPOSTA_MS = 24 * 3600_000;
const JANELA_DESFAZER_MS = 24 * 3600_000;
const TIMEOUT_IA_MS = 60_000;

const INTENCOES = ['agendar', 'orcamento', 'duvida', 'reclamacao', 'remarcar', 'cancelar', 'retorno', 'pos_venda', 'saudacao', 'outro'];
const TEMPERATURAS = ['quente', 'morno', 'frio'];
/* O que conta como UMA chamada paga à IA no limite do dia. */
const TIPOS_CHAMADA = new Set(['copiloto', 'resumo_do_dia', 'sugerir', 'classificar_etapa']);

/* Tipos que mudam o banco, e o que cada um pode em cada autonomia. */
const SEGURAS_AUTOMATICO = new Set(['atualizar_ficha', 'mover_etapa', 'marcar_aguardando_consultor', 'criar_tarefa']);
const INFORMATIVAS = new Set(['responder', 'resumir', 'classificar']);
const REVERSIVEIS = new Set(['agendar', 'remarcar', 'cancelar_agendamento', 'mover_etapa', 'atualizar_ficha',
  'registrar_interesse', 'marcar_aguardando_consultor', 'agendar_retorno', 'criar_tarefa']);

const PALAVRAS_PROIBIDAS = [
  [/\bprezad[oa]s?\b/gi, ''], [/\befetuar\b/gi, 'fazer'], [/\befetuad[oa]\b/gi, 'feito'],
  [/\bcomparecer\b/gi, 'vir'], [/\bcompareça\b/gi, 'venha'], [/\bveículos\b/gi, 'carros'], [/\bveículo\b/gi, 'carro'],
  [/\bveiculos\b/gi, 'carros'], [/\bveiculo\b/gi, 'carro'],
];
const TEM_PRECO = /R\$\s*\d|\b\d+(?:[.,]\d+)?\s*(?:reais|real|conto|pila)\b|\bpor\s+\d{2,}\s*(?:,|\.|$)/i;

/* ------------------------------------------------------------
   Ferramentas que a IA pode chamar (JSON Schema)
   ------------------------------------------------------------ */
const FERRAMENTAS = [
  { name: 'responder',
    description: 'Propõe a PRÓXIMA mensagem para o atendente revisar e enviar (a IA nunca envia). Tom da casa, curta (até 3 blocos), uma pergunta só, sem preço nem prazo. Se o cliente quer agendar, ofereça exatamente DUAS opções da lista de horários livres. Ofereça o diagnóstico digital gratuito quando fizer sentido.',
    input_schema: { type: 'object', properties: { texto: { type: 'string', description: 'Mensagem pronta para o WhatsApp.' } }, required: ['texto'] } },
  { name: 'agendar',
    description: 'Propõe criar o horário na Agenda + lead no CRM, amarrados (igual ao botão Agendar). Só quando o cliente ACEITOU um dia e hora. O horário precisa estar na lista de livres.',
    input_schema: { type: 'object', properties: {
      data: { type: 'string', description: 'AAAA-MM-DD' }, hora: { type: 'string', description: 'HH:MM (passos de 30 min)' },
      servico: { type: 'string', description: 'Nome do serviço (do cadastro de serviços se possível; senão "Diagnóstico").' },
      veiculo: { type: 'string' }, placa: { type: 'string' }, observacoes: { type: 'string' } },
      required: ['data', 'hora', 'servico'] } },
  { name: 'remarcar',
    description: 'Propõe mudar um horário JÁ marcado deste cliente para outro horário livre.',
    input_schema: { type: 'object', properties: { agendamento_id: { type: 'string' }, data: { type: 'string' }, hora: { type: 'string' }, motivo: { type: 'string' } },
      required: ['agendamento_id', 'data', 'hora'] } },
  { name: 'cancelar_agendamento',
    description: 'Propõe cancelar um horário marcado deste cliente (só se ele pediu).',
    input_schema: { type: 'object', properties: { agendamento_id: { type: 'string' }, motivo: { type: 'string' } }, required: ['agendamento_id', 'motivo'] } },
  { name: 'mover_etapa',
    description: 'Propõe mudar a etapa do funil da conversa. Use o NOME EXATO de uma etapa válida.',
    input_schema: { type: 'object', properties: { etapa: { type: 'string' }, motivo: { type: 'string' } }, required: ['etapa'] } },
  { name: 'atualizar_ficha',
    description: 'Propõe completar a ficha com o que o CLIENTE DISSE na conversa (nunca invente). Mande só os campos que mudaram.',
    input_schema: { type: 'object', properties: {
      nome: { type: 'string' }, carro_modelo: { type: 'string' }, carro_ano: { type: 'string' }, placa: { type: 'string' },
      email: { type: 'string' }, nascimento: { type: 'string', description: 'AAAA-MM-DD, ou DD/MM se o cliente não disse o ano' },
      aceita_mensagens: { type: 'boolean', description: 'false só se o cliente pediu para parar de receber mensagens' } } } },
  { name: 'registrar_interesse',
    description: 'Propõe registrar no CRM que o cliente quer orçamento de um serviço (lead vai para "orçamento"). Valor só se o ATENDENTE informou um valor na conversa ou no pedido.',
    input_schema: { type: 'object', properties: { servico: { type: 'string' }, valor: { type: 'number' }, observacoes: { type: 'string' } }, required: ['servico'] } },
  { name: 'marcar_aguardando_consultor',
    description: 'Propõe marcar que o cliente espera resposta de um consultor (pergunta técnica, valor, prazo).',
    input_schema: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] } },
  { name: 'agendar_retorno',
    description: 'Propõe deixar uma mensagem programada (fila do Comunicar) para chamar o cliente de novo numa data. O texto só sai depois do clique do atendente. Não use se o cliente não aceita mensagens.',
    input_schema: { type: 'object', properties: { data: { type: 'string', description: 'AAAA-MM-DD' }, hora: { type: 'string', description: 'HH:MM (opcional, padrão 9:00)' },
      texto: { type: 'string' }, motivo: { type: 'string' } }, required: ['data', 'texto'] } },
  { name: 'criar_tarefa',
    description: 'Propõe uma TAREFA interna para a equipe (não fala com o cliente): ligar de volta, conferir peça, montar orçamento, cobrar retorno do consultor. Responsável pelo NOME da lista EQUIPE (vazio = quem está com a conversa). Prazo AAAA-MM-DD ou AAAA-MM-DDTHH:MM.',
    input_schema: { type: 'object', properties: {
      titulo: { type: 'string', description: 'O que fazer, curto (ex.: "Ligar para confirmar a peça do Corolla").' },
      descricao: { type: 'string' }, responsavel: { type: 'string', description: 'Nome de alguém da EQUIPE; vazio = dono da conversa.' },
      prazo: { type: 'string', description: 'AAAA-MM-DD (vence às 17:30) ou AAAA-MM-DDTHH:MM' },
      prioridade: { type: 'integer', enum: [1, 2, 3], description: '1 = urgente, 2 = normal, 3 = quando der' } },
      required: ['titulo'] } },
  { name: 'resumir',
    description: 'Resumo da conversa em até 3 linhas + pendências (o que falta fazer).',
    input_schema: { type: 'object', properties: { resumo: { type: 'string' }, pendencias: { type: 'array', items: { type: 'string' } } }, required: ['resumo'] } },
  { name: 'classificar',
    description: 'Intenção principal do cliente agora e temperatura (quente = quer fechar já; morno = interessado; frio = só pesquisando ou sumiu).',
    input_schema: { type: 'object', properties: { intencao: { type: 'string', enum: INTENCOES }, temperatura: { type: 'string', enum: TEMPERATURAS }, motivo: { type: 'string' } },
      required: ['intencao', 'temperatura'] } },
];

const PAPEL_COPILOTO = `Você é o COPILOTO do atendente da IndyCar no painel de WhatsApp.
Quem fala com o cliente é o atendente humano: você lê a ficha e a conversa e PROPÕE,
usando as ferramentas, o que ele deve fazer agora. Nada que você propõe acontece sem
o atendente ver.

Em TODA resposta:
1. Chame "classificar" e "resumir".
2. Chame "responder" com a próxima mensagem — exceto se a última mensagem é do
   atendente e não há nada a acrescentar.
3. Proponha outras ações só quando a conversa pedir:
   - cliente aceitou dia e hora → "agendar" (horário da lista de livres);
   - quer mudar/cancelar um horário marcado → "remarcar"/"cancelar_agendamento" (use o id da ficha);
   - pediu orçamento de um serviço → "registrar_interesse";
   - disse nome, carro, placa, ano, e-mail ou aniversário que a ficha não tem → "atualizar_ficha";
   - a etapa do funil ficou para trás → "mover_etapa";
   - pergunta técnica, valor ou prazo que só o consultor sabe → "marcar_aguardando_consultor";
   - pediu para chamar depois ("me chama mês que vem") → "agendar_retorno";
   - ficou algo para a EQUIPE fazer depois (ligar, conferir peça, mandar orçamento,
     cobrar o consultor) → "criar_tarefa" (responsável da lista EQUIPE, prazo realista).
Na mensagem do "responder" (rodada 4 — aprendido com conversas reais):
   - UMA pergunta só (um único "?"). Se vai cravar horário, a pergunta é a do horário.
   - Siga a SITUAÇÃO DA CONVERSA da ficha: não se apresente de novo se a loja já falou;
     reconheça a demora só quando o cliente esperou de verdade.
   - Se o cliente já disse quando prefere (manhã, 8h, sábado…), as duas opções
     respeitam isso.
   - Nunca prometa o que só a equipe garante: peça reservada, estoque, nota fiscal,
     desconto, prazo de entrega. Diga que confirma e proponha
     "marcar_aguardando_consultor" ou "criar_tarefa".
   - Serviço já feito / pós-venda: pergunte como ficou, sem empurrar outro horário.
   - Carro na oficina (bloco CARRO NA OFICINA da ficha): "está pronto?" se responde com a
     ETAPA REAL de lá. Prazo só o da previsão registrada pela equipe; sem previsão, não
     prometa dia nem hora ("te aviso assim que ficar pronto"). Não cite valor de extra.
"mover_etapa" só quando a etapa atual claramente ficou para trás — não tire do
pós-venda nem de "Agendado" uma conversa que continua lá.
Nunca proponha a mesma ação duas vezes. Nunca invente id, horário, serviço ou valor.
Se uma ferramenta voltar com erro, corrija com os dados da ficha ou desista dela.
Depois de usar as ferramentas, termine sem texto extra.`;

/* Rodada 5 — a IA CONDUZ o funil (lib/ia-funil.js chama rodar() com `funil`). Aqui ela não é
   mais só copiloto: o "responder" vira a mensagem que SAI para o cliente quando a autonomia
   da etapa permitir. As regras de segurança são as mesmas (o servidor valida tudo). */
const PAPEL_FUNIL = `Você é a IA do atendimento da IndyCar e está CONDUZINDO esta conversa de WhatsApp
(nenhum atendente humano está escrevendo agora). O que você propõe em "responder" PODE SER ENVIADO ao
cliente sem revisão, então escreva como a casa escreve: curto, gente boa, uma pergunta só, sem preço.

Em TODA resposta:
1. Chame "classificar" e "resumir".
2. Chame "responder" com a próxima mensagem ao cliente — sempre que a última mensagem é dele.
3. Conduza o funil:
   - não sabe o carro ou o serviço → pergunte UMA coisa por vez (carro primeiro, depois o que ele precisa);
   - soube carro/placa/nome → "atualizar_ficha"; soube o serviço → "registrar_interesse";
   - serviço claro e cliente quer vir → ofereça EXATAMENTE DUAS opções da lista HORÁRIOS LIVRES
     (respeitando o período que ele pediu) e termine com a pergunta do horário;
   - cliente ACEITOU um dia e hora → chame "agendar" (horário da lista) e a mensagem confirma
     dia, hora e endereço (sem perguntar de novo);
   - quer mudar/cancelar horário marcado → "remarcar"/"cancelar_agendamento" (id da ficha);
   - PREÇO/valor/"quanto fica", URGÊNCIA (carro parou, não liga, está na estrada), pedido para falar
     com uma PESSOA, ou RECLAMAÇÃO → chame "marcar_aguardando_consultor" e responda curto: um
     consultor assume em instantes (no caso de preço, ofereça o diagnóstico digital gratuito e diga
     que o consultor confirma o valor). Não ofereça horário nessas situações.
   - a etapa do funil ficou para trás → "mover_etapa".
Regras da mensagem: UMA pergunta (um "?"); cliente da casa é cumprimentado pelo nome e pelo carro,
sem apresentação de desconhecido; não prometa peça, estoque, desconto, prazo nem guincho; nunca
invente id, horário, serviço ou valor. Se uma ferramenta voltar com erro, corrija ou desista dela.
Depois de usar as ferramentas, termine sem texto extra.`;

/* Etapas da autonomia do funil (meio-termo: 4 etapas × 3 níveis, e "herdar" o geral). */
const ETAPAS_FUNIL = ['responder', 'agendar', 'crm', 'humano'];
const ETAPA_DA_ACAO = {
  responder: 'responder',
  agendar: 'agendar', remarcar: 'agendar', cancelar_agendamento: 'agendar',
  atualizar_ficha: 'crm', mover_etapa: 'crm', registrar_interesse: 'crm',
  marcar_aguardando_consultor: 'humano', criar_tarefa: 'humano', agendar_retorno: 'humano',
};
/* Mesmo em "automatico" estas SEMPRE pedem clique: cancelar horário, mensagem programada,
   opt-out, etapa de ganho/perda, valor, tarefa para outra pessoa (as três últimas via `sensivel`). */
const SEMPRE_CLIQUE_NO_FUNIL = new Set(['cancelar_agendamento', 'agendar_retorno']);
const NIVEIS = ['sugerir', 'confirmar', 'automatico'];

/** Nível de cada etapa do funil: o da etapa, ou o geral quando "herdar"/ausente. */
function niveisDoFunil(cfg = {}) {
  const geral = NIVEIS.includes(cfg.autonomia) ? cfg.autonomia : 'confirmar';
  const por = cfg.funil_autonomia && typeof cfg.funil_autonomia === 'object' ? cfg.funil_autonomia : {};
  const out = {};
  for (const e of ETAPAS_FUNIL) out[e] = NIVEIS.includes(por[e]) ? por[e] : geral;
  return out;
}
/** O que o funil faz com uma proposta: 'executar' | 'confirmar' (propõe e avisa o dono) | 'sugerir'. */
function decisaoDoFunil(tipo, parametros, niveis) {
  if (INFORMATIVAS.has(tipo) && tipo !== 'responder') return 'executar';
  const etapa = ETAPA_DA_ACAO[tipo] || 'crm';
  const nivel = niveis[etapa] || 'confirmar';
  if (nivel === 'sugerir') return 'sugerir';
  if (nivel === 'confirmar') return 'confirmar';
  if (SEMPRE_CLIQUE_NO_FUNIL.has(tipo) || parametros?.sensivel) return 'confirmar';
  return 'executar';
}

/** Mensagem de reserva quando o horário que o cliente aceitou acabou de ser ocupado. */
function textoHorarioOcupado(sugeridos = [], nome = '') {
  const oi = nome ? `${String(nome).split(' ')[0]}, ` : '';
  if (!sugeridos.length) return `${oi}esse horário acabou de ser preenchido aqui 😕 Vou pedir para um consultor te passar outras opções. Pode ser?`;
  if (sugeridos.length === 1) return `${oi}esse horário acabou de ser preenchido aqui 😕 Tenho ${sugeridos[0].rotulo}. Fica bom pra você?`;
  return `${oi}esse horário acabou de ser preenchido aqui 😕 Tenho ${sugeridos[0].rotulo} ou ${sugeridos[1].rotulo}. Qual fica melhor?`;
}

/**
 * Próxima melhor ação para o atendente (rodada 5): uma frase calculada pelo sistema a partir
 * da classificação da IA e do estado real (agenda, lead, espera). Sem IA, sem preço.
 */
function proximaAcao({ intencao = null, temperatura = null, ficha = {}, acoes = [], situacao = {} } = {}) {
  const futuros = ficha.agendamentos?.futuros || [];
  const prop = t => acoes.find(a => a.tipo === t && a.status === 'proposta');
  const feita = t => acoes.find(a => a.tipo === t && a.status === 'executada');
  if (ficha.conversa?.aguardando_consultor) return { tipo: 'ligar', texto: 'Cliente esperando um consultor: responda você (ou ligue) agora.' };
  if (prop('agendar')) return { tipo: 'aprovar', texto: 'Aprove o agendamento proposto pela IA — o horário já foi conferido como livre.' };
  if (feita('agendar')) return { tipo: 'confirmar', texto: 'Horário marcado. Confirme com o cliente o endereço e peça para avisar se não puder vir.' };
  if (intencao === 'reclamacao') return { tipo: 'ligar', texto: 'Reclamação: assuma a conversa e ligue para o cliente ainda hoje.' };
  if (intencao === 'orcamento') return { tipo: 'orcamento', texto: 'Pediu valor: monte o orçamento no Orçador e mande hoje — a IA não passa preço.' };
  if (intencao === 'remarcar' && futuros.length) return { tipo: 'remarcar', texto: `Quer remarcar o horário de ${futuros[0].data} — ofereça dois horários livres.` };
  if (intencao === 'cancelar' && futuros.length) return { tipo: 'cancelar', texto: 'Quer cancelar: entenda o motivo antes e ofereça remarcar.' };
  if (intencao === 'agendar' && !futuros.length) return { tipo: 'horarios', texto: 'Quer vir: ofereça duas opções de horário e feche o dia e a hora.' };
  if (futuros.length && situacao.diasParada >= 1) return { tipo: 'lembrar', texto: `Tem horário em ${futuros[0].data}: um lembrete na véspera evita falta.` };
  if (temperatura === 'frio' && situacao.diasParada >= 2) return { tipo: 'retomar', texto: 'Conversa fria há dias: retome com uma pergunta leve ou programe um retorno.' };
  if (situacao.semResposta) return { tipo: 'responder', texto: 'Cliente esperando resposta: use a sugestão da IA ou responda agora.' };
  return { tipo: 'acompanhar', texto: 'Nada urgente: acompanhe e registre o que o cliente pedir no CRM.' };
}

/* ------------------------------------------------------------
   Regras puras de validação (testadas sem banco)
   ------------------------------------------------------------ */

/** Troca o vocabulário proibido; diz se há preço no texto. */
function revisarTexto(texto) {
  let t = String(texto ?? '').replace(/\r/g, '').trim();
  for (const [re, troca] of PALAVRAS_PROIBIDAS) t = t.replace(re, troca);
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/^\s*,\s*/, '').trim();
  return { texto: t, temPreco: TEM_PRECO.test(t) };
}

/* ---- Rodada 4: qualidade da resposta sugerida (avaliação com 10 conversas reais) ---- */
/** Quantas perguntas a mensagem faz ("?" contados; "??" conta uma). */
function contarPerguntas(texto) {
  return (String(texto || '').match(/\?+/g) || []).length;
}
/**
 * Tira a apresentação repetida ("Aqui é o atendimento da IndyCar.") quando a loja
 * já falou com o cliente nesta conversa. Mantém o resto da frase arrumado.
 */
function tirarApresentacaoRepetida(texto, lojaJaFalou) {
  let t = String(texto || '');
  if (!lojaJaFalou) return t;
  t = t.replace(/\s*Aqui (?:é|e) (?:o |a )?(?:atendimento|equipe) da Indy ?Car(?: Centro Automotivo)?\s*[.!,]?\s*/gi, m => (/\n/.test(m) ? '\n' : ' '));
  return t.replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').replace(/\n /g, '\n').trim();
}

/** Números que aparecem num texto ("R$ 1.200,50", "890", "1200") → [1200.5, 890, 1200]. */
function numerosDoTexto(t) {
  const out = [];
  for (const m of String(t ?? '').matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/g)) {
    let s = m[0];
    if (/\.\d{3}/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    const n = Number(s);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** O atendente informou este valor (no pedido ou numa mensagem dele, não da IA)? */
function valorFoiInformado(valor, { pedido = '', mensagens = [] } = {}) {
  const v = Number(valor);
  if (!Number.isFinite(v) || v <= 0) return false;
  const textos = [pedido, ...mensagens.filter(m => m.direcao === 'saida' && !m.gerada_por_ia).map(m => m.corpo)];
  return textos.some(t => numerosDoTexto(t).some(n => Math.abs(n - v) < 0.01));
}

const normPlaca = p => String(p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const placaValida = p => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(normPlaca(p));

/** "1990-05-12" | "12/05/1990" | "12/05" (sem ano → 1904) → AAAA-MM-DD ou null. */
function normalizarNascimento(v, hoje = new Date()) {
  const s = String(v ?? '').trim();
  let a, m, d;
  let r;
  if ((r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) [, a, m, d] = r;
  else if ((r = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s))) { [, d, m, a] = r; a = a || '1904'; if (a.length === 2) a = (Number(a) > 30 ? '19' : '20') + a; }
  else return null;
  const iso = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!H.dataValida(iso)) return null;
  const ano = Number(a), atual = hoje.getUTCFullYear();
  if (ano !== 1904 && (ano < 1920 || ano > atual - 16)) return null;
  return iso;
}

/** Texto aparece (sem acento/caixa/pontuação) no que o cliente escreveu ou no pedido? */
function clienteDisse(valor, { mensagens = [], pedido = '' } = {}) {
  const alvo = H.semAcento(valor).replace(/[^a-z0-9@.]+/g, ' ').trim();
  if (!alvo) return false;
  const fontes = [pedido, ...mensagens.filter(m => m.direcao === 'entrada').map(m => m.corpo)]
    .map(t => H.semAcento(t).replace(/[^a-z0-9@.]+/g, ' '));
  const compacto = s => s.replace(/\s+/g, '');
  return fontes.some(f => f.includes(alvo) || compacto(f).includes(compacto(alvo))
    || alvo.split(' ').filter(p => p.length >= 3).some(p => f.split(' ').includes(p)));
}

const PEDIU_PARA_PARAR = /\b(parar?|pare|sair|descadastr|remove|n[aã]o\s+(quero|mande|envie)|chega de mensag|stop)\b/i;

/** Achar o serviço no cadastro pelo nome (exato, depois contém). */
function acharServico(nome, servicos = []) {
  const a = H.semAcento(nome);
  if (!a) return null;
  return servicos.find(s => H.semAcento(s.nome) === a)
      || servicos.find(s => H.semAcento(s.nome).includes(a) || a.includes(H.semAcento(s.nome)))
      || null;
}

/** O serviço pedido está no catálogo como "não fazemos"? */
function naoFazemos(nome, catalogo = []) {
  const a = H.semAcento(nome);
  if (!a) return null;
  const item = catalogo.find(c => H.semAcento(c.servico) === a)
            || catalogo.find(c => a.length >= 6 && H.semAcento(c.servico).includes(a));
  return item && item.fazemos === false ? item : null;
}

const limpar = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');

/* ------------------------------------------------------------
   O copiloto
   ------------------------------------------------------------ */
function criarCopiloto({ sb, contexto, criarIA, persona = '', agora = () => new Date(), origem = 'atendimento', enviarMensagem = null } = {}) {
  if (!sb) throw new Error('copiloto sem banco');
  const ctxApi = contexto || CTX.criarContexto({ sb, agora });
  let cfgCache = { em: 0, cfg: null };

  /** Equipe ativa (para a IA escolher o responsável de uma tarefa). Só nome e id. */
  async function lerEquipe() {
    try {
      const { data, error } = await sb.from('perfis').select('id,nome,papel,ativo,apps').eq('ativo', true);
      if (error) return [];
      return (data || []).filter(p => ['admin', 'gestor', 'atendente'].includes(p.papel) && p.nome)
        .map(p => ({ id: p.id, nome: p.nome, papel: p.papel }));
    } catch { return []; }
  }
  async function lerTarefasAbertas(conversaId) {
    try {
      const { data, error } = await sb.from('tarefas').select('id,titulo,responsavel_id,vence_em').eq('conversa_id', conversaId).eq('status', 'aberta').limit(20);
      return error ? [] : (data || []);
    } catch { return []; }
  }

  async function lerConfig({ forcar = false } = {}) {
    if (!forcar && cfgCache.cfg && Date.now() - cfgCache.em < CONFIG_CACHE_MS) return cfgCache.cfg;
    try {
      const { data, error } = await sb.from('ia_config').select('*').eq('id', true).maybeSingle();
      const cfg = { ...CONFIG_PADRAO, ...(error ? {} : (data || {})) };
      if (!['sugerir', 'confirmar', 'automatico'].includes(cfg.autonomia)) cfg.autonomia = 'confirmar';
      if (!cfg.funil_autonomia || typeof cfg.funil_autonomia !== 'object') cfg.funil_autonomia = {};
      cfg.funil_niveis = niveisDoFunil(cfg);
      cfgCache = { em: Date.now(), cfg };
      return cfg;
    } catch { return { ...CONFIG_PADRAO }; }
  }

  async function salvarConfig(novo, perfil) {
    const atual = await lerConfig({ forcar: true });
    const muda = {};
    if (novo.ativo !== undefined) muda.ativo = novo.ativo === true;
    if (novo.autonomia !== undefined) {
      if (!['sugerir', 'confirmar', 'automatico'].includes(novo.autonomia)) return { ok: false, status: 400, erro: 'Autonomia deve ser sugerir, confirmar ou automatico.' };
      muda.autonomia = novo.autonomia;
    }
    for (const k of ['modelo_rapido', 'modelo_forte']) {
      if (novo[k] !== undefined) {
        if (!MODELOS_PERMITIDOS.includes(novo[k]) && novo[k] !== atual[k]) return { ok: false, status: 400, erro: `Modelo não permitido em ${k}. Use: ${MODELOS_PERMITIDOS.join(', ')}.` };
        muda[k] = novo[k];
      }
    }
    if (novo.limite_chamadas_dia !== undefined) {
      const n = Math.round(Number(novo.limite_chamadas_dia));
      if (!Number.isFinite(n) || n < 10 || n > 100000) return { ok: false, status: 400, erro: 'Limite diário entre 10 e 100000.' };
      muda.limite_chamadas_dia = n;
    }
    if (novo.instrucoes_extras !== undefined) {
      muda.instrucoes_extras = novo.instrucoes_extras === null ? null : limpar(String(novo.instrucoes_extras), 2000) || null;
    }
    // rodada 5: a IA do funil
    if (novo.funil_ativo !== undefined) muda.funil_ativo = novo.funil_ativo === true;
    if (novo.funil_autonomia !== undefined) {
      const fa = novo.funil_autonomia && typeof novo.funil_autonomia === 'object' ? novo.funil_autonomia : {};
      const limpo = {};
      for (const e of ETAPAS_FUNIL) {
        if (fa[e] === undefined || fa[e] === null || fa[e] === 'herdar' || fa[e] === '') continue;
        if (!NIVEIS.includes(fa[e])) return { ok: false, status: 400, erro: `Autonomia da etapa "${e}" deve ser herdar, sugerir, confirmar ou automatico.` };
        limpo[e] = fa[e];
      }
      muda.funil_autonomia = limpo;
    }
    if (novo.funil_url !== undefined) {
      const u = limpar(String(novo.funil_url || ''), 300);
      if (u && !/^https?:\/\/[^\s]+\/api\/ia\/funil\/acordar$/.test(u)) return { ok: false, status: 400, erro: 'Endereço do despertador inválido: precisa terminar em /api/ia/funil/acordar.' };
      muda.funil_url = u || CONFIG_PADRAO.funil_url;
    }
    if (!Object.keys(muda).length) return { ok: false, status: 400, erro: 'Nada para mudar.' };
    const { error } = await sb.from('ia_config').upsert({ id: true, ...muda, updated_at: agora().toISOString() });
    if (error) return { ok: false, status: 503, erro: 'Não consegui gravar a configuração: ' + error.message };
    await registrar({ tipo: 'config', status: 'executada', perfil_id: perfil?.id || null, origem: 'sistema',
      resumo: `Configuração da IA alterada: ${Object.keys(muda).join(', ')}`, entrada: { antes: pick(atual, Object.keys(muda)), depois: muda },
      executada_em: agora().toISOString() });
    cfgCache = { em: 0, cfg: null };
    return { ok: true, config: await lerConfig({ forcar: true }) };
  }

  const inicioDoDia = () => {
    const p = H.partesLocais(agora());
    // meia-noite local → instante UTC (Brasil sem horário de verão: -03:00)
    const off = deslocamento(agora());
    return new Date(Date.parse(`${p.dia}T00:00:00Z`) - off).toISOString();
  };

  /* Cache de 10 s: sugerir/classificar consultam o uso a cada chamada. */
  let usoCache = { em: 0, desde: null, dados: null };
  async function usoDoDia({ forcar = false } = {}) {
    const desde = inicioDoDia();
    if (!forcar && usoCache.dados && usoCache.desde === desde && Date.now() - usoCache.em < 10_000) return usoCache.dados;
    const { data, error } = await sb.from('ia_acoes').select('tipo,perfil_id,tokens_entrada,tokens_saida,status')
      .eq('origem', origem).gte('created_at', desde).limit(10000);
    if (error) return { chamadas: 0, tokensEntrada: 0, tokensSaida: 0, porTipo: {}, porPerfil: {}, erro: error.message };
    const u = { chamadas: 0, tokensEntrada: 0, tokensSaida: 0, porTipo: {}, porPerfil: {}, executadas: 0, recusadas: 0, desde };
    for (const a of data || []) {
      u.porTipo[a.tipo] = (u.porTipo[a.tipo] || 0) + 1;
      if (TIPOS_CHAMADA.has(a.tipo)) {
        u.chamadas++;
        if (a.perfil_id) u.porPerfil[a.perfil_id] = (u.porPerfil[a.perfil_id] || 0) + 1;
      }
      u.tokensEntrada += Number(a.tokens_entrada) || 0;
      u.tokensSaida += Number(a.tokens_saida) || 0;
      if (a.status === 'executada' && !INFORMATIVAS.has(a.tipo)) u.executadas++;
      if (a.status === 'recusada') u.recusadas++;
    }
    usoCache = { em: Date.now(), desde, dados: u };
    return u;
  }

  async function registrar(linha) {
    const { data, error } = await sb.from('ia_acoes').insert({ origem, ...linha }).select('id,created_at').single();
    if (error) throw new Error('Não consegui registrar a ação da IA: ' + error.message);
    if (usoCache.dados) {
      usoCache.dados.tokensEntrada += Number(linha.tokens_entrada) || 0;
      usoCache.dados.tokensSaida += Number(linha.tokens_saida) || 0;
    }
    if (usoCache.dados && TIPOS_CHAMADA.has(linha.tipo)) {
      usoCache.dados.chamadas++;
      if (linha.perfil_id) usoCache.dados.porPerfil[linha.perfil_id] = (usoCache.dados.porPerfil[linha.perfil_id] || 0) + 1;
    }
    return data;
  }

  /* ---------------- validação de cada ferramenta ---------------- */
  async function validar(tipo, p, ficha, extra) {
    const conv = ficha.conversa;
    const P = p && typeof p === 'object' ? p : {};
    switch (tipo) {
      case 'responder': {
        const r = revisarTexto(limpar(P.texto, 1500));
        if (!r.texto) return { erro: 'Texto vazio.' };
        if (r.temPreco) return { erro: 'A mensagem cita preço/valor. A IA não passa preço: reescreva oferecendo o diagnóstico gratuito ou dizendo que o consultor confirma o valor.' };
        if (r.texto.length > 900) return { erro: 'Mensagem longa demais para WhatsApp (máx. 900 caracteres). Encurte.' };
        // rodada 4: a loja já falou nesta conversa? sem "Aqui é o atendimento da IndyCar" de novo
        const lojaJaFalou = (ficha.mensagens || []).some(m => m.direcao === 'saida' && String(m.corpo || '').trim());
        const texto = tirarApresentacaoRepetida(r.texto, lojaJaFalou);
        const perguntas = contarPerguntas(texto);
        const enviar = !!extra.funil?.podeResponder;
        if (perguntas > 1) {
          /* Regra 5 da casa: UMA pergunta por mensagem. Devolve para a IA reescrever;
             se ela não acertar até o fim, o texto vai mesmo assim com aviso (melhor
             que nenhuma sugestão) — ver "reserva" em rodar(). No funil, texto com aviso
             NÃO sai sozinho: vira proposta para o atendente. */
          return { erro: `A mensagem faz ${perguntas} perguntas. Regra da casa: UMA pergunta por mensagem. Reescreva deixando só a mais importante (quando der, a de dia e hora).`,
                   reserva: { parametros: { texto, aviso: 'mais de uma pergunta — revise antes de enviar', enviar, sensivel: enviar }, resumo: 'Mensagem sugerida (revise: mais de uma pergunta)' } };
        }
        // cliente da casa não recebe apresentação de desconhecido (achado do simulador, rodada 5)
        const textoFinal = ficha.clienteDaCasa ? tirarApresentacaoRepetida(texto, true) : texto;
        return { parametros: { texto: textoFinal, enviar }, resumo: enviar ? 'Mensagem ao cliente' : 'Mensagem sugerida' };
      }
      case 'classificar': {
        const intencao = INTENCOES.includes(P.intencao) ? P.intencao : 'outro';
        const temperatura = TEMPERATURAS.includes(P.temperatura) ? P.temperatura : 'morno';
        return { parametros: { intencao, temperatura, motivo: limpar(P.motivo, 200) }, resumo: `${intencao} · ${temperatura}` };
      }
      case 'resumir': {
        const resumo = limpar(P.resumo, 600).split('\n').slice(0, 3).join('\n');
        if (!resumo) return { erro: 'Resumo vazio.' };
        const pendencias = (Array.isArray(P.pendencias) ? P.pendencias : []).map(x => limpar(String(x), 160)).filter(Boolean).slice(0, 6);
        return { parametros: { resumo, pendencias }, resumo: 'Resumo da conversa' };
      }
      case 'agendar': {
        const servicoTxt = limpar(P.servico, 120) || 'Diagnóstico';
        const nf = naoFazemos(servicoTxt, extra.fixos.catalogo);
        if (nf) return { erro: `"${nf.servico}" está no catálogo como NÃO fazemos. Não agende; diga que vai confirmar com a equipe.` };
        const serv = acharServico(servicoTxt, extra.fixos.servicos);
        const duracao = Number(serv?.duracao_min) || H.DURACAO_PADRAO_MIN;
        const agenda = await ctxApi.agendaDosProximosDias();
        const v = H.validarHorario({ data: limpar(P.data, 10), hora: limpar(P.hora, 8), agora: agora(),
          agendamentos: comDuracao(agenda, extra.fixos.servicos), capacidade: Math.max(1, extra.fixos.consultores.length), duracaoMin: duracao });
        if (!v.ok) return { erro: `${v.motivo} Escolha um horário da lista de livres.` };
        if (ficha.agendamentos.futuros.some(a => a.data === v.data && a.hora === v.hora)) return { erro: 'Este cliente já está marcado nesse horário.' };
        const placa = P.placa ? normPlaca(P.placa) : (ficha.cliente?.placa || null);
        if (P.placa && !placaValida(placa)) return { erro: 'Placa em formato inválido (ex.: ABC1D23 ou ABC1234).' };
        const parametros = { data: v.data, hora: v.hora, servico: serv?.nome || servicoTxt, servico_id: serv?.id || null,
          veiculo: limpar(P.veiculo, 80) || ficha.cliente?.carro_modelo || null, placa: placa || null,
          observacoes: limpar(P.observacoes, 300) || null };
        return { parametros, resumo: `Agendar ${parametros.servico} — ${H.rotuloHorario(v.data, v.hora)}`, };
      }
      case 'remarcar': case 'cancelar_agendamento': {
        const ag = ficha.agendamentos.futuros.find(a => a.id === P.agendamento_id);
        if (!ag) return { erro: 'Esse agendamento não é um horário futuro deste cliente. Use o id que está na ficha.' };
        if (tipo === 'cancelar_agendamento') {
          return { parametros: { agendamento_id: ag.id, motivo: limpar(P.motivo, 200) || 'pedido do cliente', antes: { status: ag.status } },
                   resumo: `Cancelar ${ag.servico || 'horário'} de ${H.rotuloHorario(ag.data, ag.hora || '08:00')}` };
        }
        const agenda = await ctxApi.agendaDosProximosDias();
        const v = H.validarHorario({ data: limpar(P.data, 10), hora: limpar(P.hora, 8), agora: agora(), ignorarId: ag.id,
          agendamentos: comDuracao(agenda, extra.fixos.servicos), capacidade: Math.max(1, extra.fixos.consultores.length),
          duracaoMin: Number(extra.fixos.servicos.find(s => s.id === ag.servico_id)?.duracao_min) || H.DURACAO_PADRAO_MIN });
        if (!v.ok) return { erro: `${v.motivo} Escolha um horário da lista de livres.` };
        if (v.data === ag.data && v.hora === ag.hora) return { erro: 'É o mesmo horário que já está marcado.' };
        return { parametros: { agendamento_id: ag.id, data: v.data, hora: v.hora, motivo: limpar(P.motivo, 200) || null,
                                antes: { data: ag.data, hora: ag.hora } },
                 resumo: `Remarcar ${ag.servico || 'horário'}: ${H.rotuloHorario(ag.data, ag.hora || '08:00', { curto: true })} → ${H.rotuloHorario(v.data, v.hora, { curto: true })}` };
      }
      case 'mover_etapa': {
        const nome = limpar(P.etapa, 80);
        const etapa = ficha.funil.etapas.find(e => H.semAcento(e.nome) === H.semAcento(nome));
        if (!etapa) return { erro: `Etapa "${nome}" não existe. Válidas: ${ficha.funil.etapas.map(e => e.nome).join(', ')}.` };
        if (etapa.id === ficha.funil.etapaAtual?.id) return { erro: 'A conversa já está nessa etapa.' };
        return { parametros: { etapa_id: etapa.id, etapa: etapa.nome, motivo: limpar(P.motivo, 200) || null,
                                antes: { etapa_id: ficha.funil.etapaAtual?.id || null, etapa: ficha.funil.etapaAtual?.nome || null },
                                sensivel: etapa.ganho || etapa.perda },
                 resumo: `Mover para "${etapa.nome}"` };
      }
      case 'atualizar_ficha': {
        const fontes = { mensagens: ficha.mensagens, pedido: extra.pedido };
        const c = ficha.cliente || {};
        const muda = {}, problemas = [];
        if (P.nome !== undefined) { const v = limpar(P.nome, 80); if (v && v !== c.nome) { if (clienteDisse(v, fontes)) muda.nome = v; else problemas.push('nome não aparece na conversa'); } }
        if (P.carro_modelo !== undefined) { const v = limpar(P.carro_modelo, 80); if (v && v !== c.carro_modelo) { if (clienteDisse(v, fontes)) muda.carro_modelo = v; else problemas.push('carro não aparece na conversa'); } }
        if (P.carro_ano !== undefined) {
          const v = limpar(String(P.carro_ano), 4); const n = Number(v);
          if (!/^\d{4}$/.test(v) || n < 1950 || n > agora().getUTCFullYear() + 1) problemas.push('ano do carro inválido');
          else if (v !== c.carro_ano) { if (clienteDisse(v, fontes)) muda.carro_ano = v; else problemas.push('ano não aparece na conversa'); }
        }
        if (P.placa !== undefined) {
          const v = normPlaca(P.placa);
          if (!placaValida(v)) problemas.push('placa em formato inválido');
          else if (v !== normPlaca(c.placa)) { if (clienteDisse(v, fontes)) muda.placa = v; else problemas.push('placa não aparece na conversa'); }
        }
        if (P.email !== undefined) {
          const v = limpar(P.email, 120).toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) problemas.push('e-mail inválido');
          else if (v !== String(c.email || '').toLowerCase()) { if (clienteDisse(v, fontes)) muda.email = v; else problemas.push('e-mail não aparece na conversa'); }
        }
        if (P.nascimento !== undefined) {
          const v = normalizarNascimento(P.nascimento, agora());
          if (!v) problemas.push('data de nascimento inválida');
          else if (v !== c.nascimento) muda.nascimento = v;
        }
        if (P.aceita_mensagens !== undefined && typeof P.aceita_mensagens === 'boolean' && P.aceita_mensagens !== (c.aceita_mensagens !== false)) {
          if (P.aceita_mensagens === false) {
            const pediu = ficha.mensagens.some(m => m.direcao === 'entrada' && PEDIU_PARA_PARAR.test(String(m.corpo || '')));
            if (pediu || PEDIU_PARA_PARAR.test(extra.pedido)) muda.aceita_mensagens = false; else problemas.push('cliente não pediu para parar');
          } else if (/aceita|volt|religa|pode mandar/i.test(extra.pedido)) muda.aceita_mensagens = true;
          else problemas.push('voltar a mandar mensagens só com pedido do atendente');
        }
        if (!Object.keys(muda).length) return { erro: problemas.length ? `Nada para atualizar: ${problemas.join('; ')}.` : 'Nada mudou na ficha.' };
        const antes = pick(c, Object.keys(muda));
        const rot = { nome: 'nome', carro_modelo: 'carro', carro_ano: 'ano', placa: 'placa', email: 'e-mail', nascimento: 'aniversário', aceita_mensagens: 'aceita mensagens' };
        return { parametros: { campos: muda, antes, sensivel: 'aceita_mensagens' in muda, avisos: problemas },
                 resumo: `Ficha: ${Object.entries(muda).map(([k, v]) => `${rot[k]} → ${v === false ? 'não' : v === true ? 'sim' : v}`).join(', ')}` };
      }
      case 'registrar_interesse': {
        const servicoTxt = limpar(P.servico, 120);
        if (!servicoTxt) return { erro: 'Diga qual serviço.' };
        const nf = naoFazemos(servicoTxt, extra.fixos.catalogo);
        if (nf) return { erro: `"${nf.servico}" está no catálogo como NÃO fazemos. Não registre; diga que vai confirmar com a equipe.` };
        const serv = acharServico(servicoTxt, extra.fixos.servicos);
        let valor = null, aviso = null;
        if (P.valor !== undefined && P.valor !== null) {
          if (valorFoiInformado(P.valor, { pedido: extra.pedido, mensagens: ficha.mensagens })) valor = Number(P.valor);
          else aviso = 'valor ignorado: o atendente não informou esse valor';
        }
        return { parametros: { servico: serv?.nome || servicoTxt, servico_id: serv?.id || null, valor, observacoes: limpar(P.observacoes, 300) || null,
                                lead_id: ficha.leadAberto?.id || null, aviso },
                 resumo: `Interesse em ${serv?.nome || servicoTxt}${valor ? ` (valor informado ${valor})` : ''}${ficha.leadAberto ? ' — no lead aberto' : ' — lead novo'}` };
      }
      case 'marcar_aguardando_consultor': {
        if (conv.aguardando_consultor) return { erro: 'A conversa já está aguardando consultor.' };
        return { parametros: { motivo: limpar(P.motivo, 200) || null, antes: { aguardando_consultor: !!conv.aguardando_consultor, aguardando_desde: conv.aguardando_desde || null } },
                 resumo: `Aguardando consultor: ${limpar(P.motivo, 80) || 'pergunta para a equipe'}` };
      }
      case 'agendar_retorno': {
        if (ficha.cliente && ficha.cliente.aceita_mensagens === false) return { erro: 'O cliente pediu para não receber mensagens automáticas. Não agende retorno.' };
        const dia = limpar(P.data, 10);
        if (!H.dataValida(dia)) return { erro: 'Data inválida (AAAA-MM-DD).' };
        const minutos = P.hora ? H.horaEmMinutos(P.hora) : 9 * 60;
        if (minutos === null || minutos < H.ABRE_MIN || minutos > H.FECHA_MIN || H.diaDaSemana(dia) === 0) return { erro: 'Retorno só em dia e hora de expediente (seg–sáb, 8h–17h30).' };
        const hoje = H.partesLocais(agora()).dia;
        if (dia <= hoje) return { erro: 'O retorno tem que ser a partir de amanhã.' };
        if (dia > H.somarDias(hoje, 180)) return { erro: 'No máximo 6 meses à frente.' };
        const r = revisarTexto(limpar(P.texto, 1000));
        if (!r.texto) return { erro: 'Texto vazio.' };
        if (r.temPreco) return { erro: 'O texto cita preço. Reescreva sem valor.' };
        const enviarEm = new Date(Date.parse(`${dia}T${H.minutosEmHora(minutos)}:00Z`) - deslocamento(agora())).toISOString();
        return { parametros: { data: dia, hora: H.minutosEmHora(minutos), enviar_em: enviarEm, texto: r.texto, motivo: limpar(P.motivo, 200) || null },
                 resumo: `Chamar de novo em ${H.rotuloHorario(dia, minutos)}` };
      }
      case 'criar_tarefa': {
        const titulo = limpar(P.titulo, 200);
        if (titulo.length < 3) return { erro: 'Diga o que fazer (título).' };
        const equipe = extra.equipe || [];
        const nome = limpar(P.responsavel, 80);
        let resp = null;
        if (nome) {
          const primeiro = s => H.semAcento(s).split(/\s+/)[0];
          resp = equipe.find(e => H.semAcento(e.nome) === H.semAcento(nome)) || null;
          if (!resp) { const l = equipe.filter(e => primeiro(e.nome) === primeiro(nome)); resp = l.length === 1 ? l[0] : null; }
          if (!resp) return { erro: `"${nome}" não está na EQUIPE. Use um destes nomes: ${equipe.map(e => e.nome).join(', ') || 'ninguém'} — ou deixe vazio.` };
        } else {
          const donoId = conv.atribuida_a || extra.perfil?.id || null;
          resp = equipe.find(e => e.id === donoId) || null;
        }
        let venceEm;
        if (P.prazo) {
          const v = TAR.validarTarefa({ titulo, vence_em: limpar(String(P.prazo), 25) }, { agora: agora() });
          if (v.erro) return { erro: v.erro };
          venceEm = v.dados.vence_em;
          if (Date.parse(venceEm) < agora().getTime()) return { erro: 'O prazo já passou. Escolha de agora em diante.' };
          if (Date.parse(venceEm) > agora().getTime() + 90 * 86_400_000) return { erro: 'Prazo longe demais (no máximo 90 dias).' };
        } else venceEm = TAR.prazoPadrao(agora());
        const prioridade = [1, 2, 3].includes(Number(P.prioridade)) ? Number(P.prioridade) : 2;
        if ((extra.tarefasAbertas || []).some(t => H.semAcento(t.titulo) === H.semAcento(titulo))) return { erro: 'Já existe essa tarefa aberta nesta conversa.' };
        const donoOuEu = [conv.atribuida_a, extra.perfil?.id].filter(Boolean);
        return { parametros: { titulo, descricao: limpar(P.descricao, 600) || null, responsavel_id: resp?.id || null, responsavel: resp?.nome || null,
                                vence_em: venceEm, prioridade, sensivel: !!(resp && !donoOuEu.includes(resp.id)) },
                 resumo: `Tarefa: ${titulo}${resp ? ` → ${resp.nome}` : ''} · até ${H.rotuloHorario(...prazoLocal(venceEm), { curto: true })}` };
      }
      default: return { erro: `Ferramenta desconhecida: ${tipo}` };
    }
  }

  /* ---------------- quem pode o quê ---------------- */
  function precisaClique(tipo, parametros) {
    if (INFORMATIVAS.has(tipo)) return false;
    if (!SEGURAS_AUTOMATICO.has(tipo)) return true;
    return !!parametros?.sensivel;                 // etapa de ganho/perda ou opt-out
  }

  /* ---------------- pedido ao copiloto ---------------- */
  /**
   * `funil` (rodada 5, só o servidor passa): { podeResponder, humano: motivo|null, instrucao }.
   * Com ele a IA conduz a conversa e as propostas são executadas conforme a autonomia de cada
   * etapa (ia_config.funil_autonomia); sem ele é o copiloto do atendente de sempre.
   */
  async function rodar({ conversaId, pedido = '', perfil = null, funil = null } = {}) {
    const inicio = Date.now();
    const cfg = await lerConfig();
    if (!cfg.ativo) return { ok: false, status: 503, erro: 'A IA está desligada (Configurações › IA).' };
    const uso = await usoDoDia();
    if (uso.chamadas >= cfg.limite_chamadas_dia) {
      return { ok: false, status: 429, erro: `Limite diário da IA atingido (${cfg.limite_chamadas_dia} chamadas). Volta amanhã ou o admin aumenta em Configurações.` };
    }
    const ctx = await ctxApi.montarContexto(conversaId);
    if (!ctx.ok) return ctx;
    const ficha = ctx.ficha;
    const fixos = await ctxApi.dadosFixos();
    const pedidoLimpo = limpar(pedido, 800);
    const [equipe, tarefasAbertas] = await Promise.all([lerEquipe(), lerTarefasAbertas(conversaId)]);

    let ia;
    try { ia = await criarIA(); }
    catch (e) { return { ok: false, status: 503, erro: e.message || 'IA indisponível.' }; }

    const cerca = 'CONVERSA_' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const hoje = H.partesLocais(agora());
    const system = [
      { type: 'text', text: [persona, funil ? PAPEL_FUNIL : PAPEL_COPILOTO, CTX.textoDoCatalogo(fixos.catalogo, fixos.janelas)].filter(Boolean).join('\n\n'),
        cache_control: { type: 'ephemeral' } },
    ];
    if (cfg.instrucoes_extras) system.push({ type: 'text', text: `INSTRUÇÕES DO DONO (valem como regra da casa):\n${cfg.instrucoes_extras}` });

    const niveis = cfg.funil_niveis || niveisDoFunil(cfg);
    const linhasFunil = [];
    if (funil) {
      linhasFunil.push(`VOCÊ ESTÁ CONDUZINDO. Autonomia por etapa: responder=${niveis.responder}, agendar=${niveis.agendar}, crm=${niveis.crm}, humano=${niveis.humano}.`);
      if (funil.humano) linhasFunil.push(`PASSE PARA HUMANO AGORA (motivo detectado pelo sistema: ${funil.humano}): chame "marcar_aguardando_consultor" e responda curto que um consultor assume. Não ofereça horário nem valor.`);
      if (!funil.podeResponder) linhasFunil.push('Um atendente humano está nesta conversa: a sua mensagem fica como SUGESTÃO para ele (não sai sozinha).');
      if (funil.instrucao) linhasFunil.push(limpar(String(funil.instrucao), 400));
    }

    const usuario = [
      `Hoje é ${H.rotuloHorario(hoje.dia, Math.floor(hoje.minutos / 30) * 30)} (${hoje.dia}, horário de Brasília). Autonomia: ${cfg.autonomia}.`,
      '',
      CTX.textoParaIA(ficha, { cerca }),
      '',
      textoDaEquipe(equipe, ficha.conversa, tarefasAbertas),
      '',
      ...(linhasFunil.length ? [linhasFunil.join('\n'), ''] : []),
      funil ? 'Chegou mensagem do cliente: conduza a conversa (classificar, resumir, responder e as ações que couberem).'
        : pedidoLimpo ? `PEDIDO DO ATENDENTE (é o seu usuário; siga se não quebrar as regras): ${pedidoLimpo}` : 'O atendente quer saber: o que fazer agora nesta conversa?',
    ].join('\n');

    const mensagens = [{ role: 'user', content: usuario }];
    const propostas = [];
    const vistos = new Set();
    const reserva = {};          // texto quase certo (ex.: 2 perguntas) para não ficar sem sugestão
    let tokensEntrada = 0, tokensSaida = 0, tokensCache = 0, modelo = cfg.modelo_rapido;
    let parouPor = null;
    const erros = [];

    /* Rodada 4: na avaliação real, 1 em 10 vezes a IA terminou sem "responder" com o
       cliente esperando. Uma cobrança curta (uma vez só, se ainda couber volta). */
    const clienteEsperando = CTX.situacaoDaConversa(ficha.mensagens || [], agora()).semResposta;
    let cobrou = false;
    const cobrarResposta = (resp, resultados, volta) => {
      if (cobrou || !clienteEsperando || volta >= MAX_VOLTAS - 1) return false;
      if (propostas.some(p => p.tipo === 'responder') || reserva.responder) return false;
      cobrou = true;
      const conteudo = (resp.content || []).filter(b => !(b.type === 'text' && !String(b.text || '').trim()));
      mensagens.push({ role: 'assistant', content: conteudo.length ? conteudo : [{ type: 'text', text: '(sem texto)' }] });
      mensagens.push({ role: 'user', content: [...resultados, { type: 'text', text: 'Faltou a ferramenta "responder": o cliente está esperando. Chame "responder" agora com a próxima mensagem (regras da casa).' }] });
      return true;
    };

    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      let resp;
      try {
        resp = await ia.messages.create({
          model: cfg.modelo_rapido, max_tokens: 2000, ...(/sonnet-5-5/.test(String(cfg.modelo_rapido)) ? { thinking: { type: 'between_tools' } } : {}), system, tools: FERRAMENTAS,
          tool_choice: { type: 'auto' }, messages: mensagens,
        }, { timeout: TIMEOUT_IA_MS });
      } catch (e) {
        await registrar({ tipo: 'copiloto', status: 'erro', conversa_id: conversaId, cliente_id: ficha.cliente?.id || null,
          perfil_id: perfil?.id || null, resumo: 'Falha ao falar com a IA', erro: String(e.message || e).slice(0, 300),
          modelo, tokens_entrada: tokensEntrada, tokens_saida: tokensSaida, duracao_ms: Date.now() - inicio, entrada: { pedido: pedidoLimpo } }).catch(() => {});
        return { ok: false, status: 502, erro: 'A IA não respondeu agora. Tente de novo em instantes.' };
      }
      modelo = resp.model || modelo;
      tokensEntrada += Number(resp.usage?.input_tokens) || 0;
      tokensSaida += Number(resp.usage?.output_tokens) || 0;
      tokensCache += Number(resp.usage?.cache_read_input_tokens) || 0;
      parouPor = resp.stop_reason;
      if (resp.stop_reason === 'refusal') break;
      const usos = (resp.content || []).filter(b => b.type === 'tool_use');
      if (!usos.length) { if (cobrarResposta(resp, [], volta)) continue; break; }

      const resultados = [];
      for (const u of usos) {
        let conteudo, ehErro = false;
        if (propostas.length >= MAX_ACOES) { conteudo = 'Limite de ações deste pedido atingido.'; ehErro = true; }
        else if (!FERRAMENTAS.some(f => f.name === u.name)) { conteudo = 'Ferramenta inexistente.'; ehErro = true; }
        else {
          const chaveDup = `${u.name}:${['responder', 'resumir', 'classificar'].includes(u.name) ? '' : JSON.stringify(u.input || {})}`;
          if (vistos.has(chaveDup) && !['responder', 'resumir', 'classificar'].includes(u.name)) { conteudo = 'Ação repetida — ignorada.'; ehErro = true; }
          else {
            let v;
            try { v = await validar(u.name, u.input, ficha, { pedido: pedidoLimpo, fixos, equipe, tarefasAbertas, perfil, funil }); }
            catch (e) { v = { erro: 'Falha ao validar: ' + e.message }; }
            if (v.erro) {
              conteudo = `Recusado: ${v.erro}`; ehErro = true; erros.push({ tipo: u.name, erro: v.erro });
              if (v.reserva) reserva[u.name] = { tipo: u.name, ...v.reserva };
            }
            else {
              vistos.add(chaveDup);
              // responder/resumir/classificar: a última vale
              if (['responder', 'resumir', 'classificar'].includes(u.name)) {
                const i = propostas.findIndex(p => p.tipo === u.name);
                if (i >= 0) propostas.splice(i, 1);
              }
              propostas.push({ tipo: u.name, parametros: v.parametros, resumo: v.resumo });
              if (u.name === 'criar_tarefa') tarefasAbertas.push({ titulo: v.parametros.titulo });
              conteudo = `Ok, registrado para o atendente: ${v.resumo}.`;
            }
          }
        }
        resultados.push({ type: 'tool_result', tool_use_id: u.id, content: conteudo, ...(ehErro ? { is_error: true } : {}) });
      }
      if (resp.stop_reason !== 'tool_use') { if (cobrarResposta(resp, resultados, volta)) continue; break; }
      mensagens.push({ role: 'assistant', content: resp.content });
      mensagens.push({ role: 'user', content: resultados });
    }

    // a IA não acertou a regra até o fim: usa o último texto quase certo, com aviso
    if (reserva.responder && !propostas.some(p => p.tipo === 'responder')) propostas.push(reserva.responder);

    const duracao = Date.now() - inicio;
    const ref = { conversa_id: conversaId, cliente_id: ficha.cliente?.id || ficha.conversa.cliente_id || null,
                  lead_id: ficha.leadAberto?.id || null, perfil_id: perfil?.id || null };

    // grava cada proposta
    const acoes = [];
    for (const p of propostas) {
      const informativa = INFORMATIVAS.has(p.tipo) && p.tipo !== 'responder';
      const linha = await registrar({ ...ref, tipo: p.tipo, status: informativa ? 'executada' : 'proposta',
        resumo: p.resumo, entrada: p.parametros, modelo, executada_em: informativa ? agora().toISOString() : null,
        agendamento_id: p.parametros?.agendamento_id || null });
      acoes.push({ id: linha.id, tipo: p.tipo, resumo: p.resumo, parametros: publico(p.parametros), status: informativa ? 'executada' : 'proposta',
                   precisa_clique: precisaClique(p.tipo, p.parametros), reversivel: REVERSIVEIS.has(p.tipo) });
    }

    const sugeridos = ficha.horariosSugeridos || [];
    const enviadas = [];        // mensagens que saíram para o cliente (funil)
    const paraConfirmar = [];   // propostas que o dono precisa aprovar (funil, nível "confirmar")
    const executarSozinho = async (a) => {
      const r = await executarAcao(a.id, { id: perfil?.id || null, papel: 'sistema' }, { automatico: true, funil: !!funil });
      a.status = r.ok ? 'executada' : 'erro';
      a.automatica = r.ok;
      if (!r.ok) a.erro = r.erro;
      return r;
    };

    if (funil) {
      /* A IA CONDUZ: executa pela autonomia da etapa. Ordem: agenda → CRM → mensagem → humano.
         A mensagem vem depois da agenda para refletir o que de fato aconteceu (horário marcado
         ou não) e ANTES de "aguardando consultor": a mensagem de saída limpa a espera no banco
         (gatilho marcar_espera_do_consultor), então a marca vai por último. */
      const executarLote = async (tipos) => {
        for (const tipo of tipos) {
          for (const a of acoes.filter(x => x.tipo === tipo && x.status === 'proposta')) {
            const d = decisaoDoFunil(a.tipo, propostas.find(p => p.tipo === a.tipo && p.resumo === a.resumo)?.parametros, niveis);
            a.decisao = d;
            if (d === 'executar') {
              const r = await executarSozinho(a);
              if (a.tipo === 'agendar') { if (r.ok) agendou = r; else agendarFalhou = r.erro || 'horário indisponível'; }
            } else if (d === 'confirmar') paraConfirmar.push(a);
          }
        }
      };
      let agendou = null, agendarFalhou = null;
      await executarLote(['agendar', 'remarcar', 'cancelar_agendamento', 'atualizar_ficha', 'registrar_interesse', 'mover_etapa']);
      /* A IA tentou marcar e a validação recusou (horário ocupado, fora do expediente…) sem
         conseguir outro: a mensagem não pode dizer "fechado". */
      if (!agendou && !acoes.some(a => a.tipo === 'agendar')) {
        const rec = erros.find(e => e.tipo === 'agendar');
        if (rec) agendarFalhou = rec.erro;
      }
      const resp = acoes.find(a => a.tipo === 'responder' && a.status === 'proposta');
      if (resp) {
        const pr = propostas.find(p => p.tipo === 'responder');
        const d = decisaoDoFunil('responder', pr?.parametros, niveis);
        resp.decisao = d;
        if (funil.podeResponder && d === 'executar' && pr && !pr.parametros.aviso) {
          let texto = pr.parametros.texto;
          // o cliente aceitou um horário mas ele acabou de ser ocupado: a mensagem não pode confirmar
          if (agendarFalhou) texto = textoHorarioOcupado(sugeridos, ficha.cliente?.nome || ficha.conversa?.nome || '');
          // marcou de verdade e a mensagem não cita o horário: usa a confirmação do sistema
          else if (agendou && agendou.texto_confirmacao && !/\d{1,2}\s*h|\d{1,2}:\d{2}/.test(texto)) texto = agendou.texto_confirmacao;
          if (texto !== pr.parametros.texto) {
            await sb.from('ia_acoes').update({ entrada: { ...pr.parametros, texto, texto_original: pr.parametros.texto } }).eq('id', resp.id);
            resp.parametros = publico({ ...pr.parametros, texto });
          }
          const r = await executarSozinho(resp);
          if (r.ok) enviadas.push({ acao_id: resp.id, mensagem_id: r.saida?.mensagem_id || null, texto });
        } else if (d !== 'sugerir') paraConfirmar.push(resp);   // vira "Aprovar e enviar" para a equipe
      }
      await executarLote(['marcar_aguardando_consultor', 'criar_tarefa', 'agendar_retorno']);
    } else if (cfg.autonomia === 'automatico') {
      // copiloto do atendente: executa sozinho só o seguro
      for (const a of acoes) {
        if (a.status === 'proposta' && SEGURAS_AUTOMATICO.has(a.tipo) && !a.precisa_clique) await executarSozinho(a);
      }
    }

    const pega = t => propostas.find(p => p.tipo === t)?.parametros || null;
    const resposta = pega('responder'), resumo = pega('resumir'), classe = pega('classificar');
    const situacao = CTX.situacaoDaConversa(ficha.mensagens || [], agora());
    const proxima = proximaAcao({ intencao: classe?.intencao || null, temperatura: classe?.temperatura || null, ficha, acoes, situacao });
    const run = await registrar({ ...ref, tipo: 'copiloto', status: 'executada', resumo: resumo?.resumo?.slice(0, 200) || (funil ? 'IA do funil conduziu' : 'Copiloto consultado'),
      entrada: { pedido: pedidoLimpo || null, funil: funil ? { humano: funil.humano || null, podeResponder: !!funil.podeResponder, niveis } : undefined },
      saida: { acoes: acoes.map(a => a.id), intencao: classe?.intencao || null,
        temperatura: classe?.temperatura || null, parou: parouPor, recusadas_na_validacao: erros, tokens_cache: tokensCache,
        enviadas: enviadas.length ? enviadas.map(e => e.mensagem_id) : undefined, para_confirmar: paraConfirmar.length ? paraConfirmar.map(a => a.id) : undefined,
        proxima_acao: proxima.texto },
      modelo, tokens_entrada: tokensEntrada, tokens_saida: tokensSaida, duracao_ms: duracao, executada_em: agora().toISOString() });

    return {
      ok: true,
      id: run.id,
      resposta_sugerida: resposta?.texto || null,
      resposta_aviso: resposta?.aviso || null,
      resposta_acao_id: acoes.find(a => a.tipo === 'responder')?.id || null,
      acoes: acoes.filter(a => !INFORMATIVAS.has(a.tipo) || (funil && a.tipo === 'responder')),
      resumo: resumo?.resumo || null,
      pendencias: resumo?.pendencias || [],
      intencao: classe?.intencao || null,
      temperatura: classe?.temperatura || null,
      motivo_classificacao: classe?.motivo || null,
      proxima_acao: proxima,
      enviadas,
      para_confirmar: paraConfirmar.map(a => ({ id: a.id, tipo: a.tipo, resumo: a.resumo })),
      horarios_sugeridos: sugeridos.map(h => ({ data: h.data, hora: h.hora, rotulo: h.rotulo })),
      autonomia: cfg.autonomia,
      niveis,
      modelo, tokens: { entrada: tokensEntrada, saida: tokensSaida, cache: tokensCache }, duracao_ms: duracao,
      recusou: parouPor === 'refusal',
      // rodada 4: o que a validação devolveu para a IA (tipo + motivo) — ajuda a entender sugestão que não veio
      recusadas_na_validacao: erros.map(e => ({ tipo: e.tipo, erro: String(e.erro).slice(0, 200) })),
      parou_por: parouPor,
      uso: { chamadas: (await usoDoDia()).chamadas, limite: cfg.limite_chamadas_dia },
    };
  }

  /* ---------------- executar / recusar / desfazer ---------------- */
  async function lerAcao(id) {
    if (!COM.ehUuid(id)) return { erro: 'id de ação inválido', status: 400 };
    const { data, error } = await sb.from('ia_acoes').select('*').eq('id', id).maybeSingle();
    if (error) return { erro: error.message, status: 503 };
    if (!data) return { erro: 'Ação não encontrada.', status: 404 };
    if (data.origem !== origem) return { erro: 'Esta ação é de outro app.', status: 403 };
    return { acao: data };
  }

  async function executarAcao(id, perfil, { automatico = false, funil = false } = {}) {
    const cfg = await lerConfig();
    const { acao, erro, status } = await lerAcao(id);
    if (erro) return { ok: false, status, erro };
    if (acao.status !== 'proposta') return { ok: false, status: 409, erro: `Esta ação já está "${acao.status}".` };
    if (agora().getTime() - Date.parse(acao.created_at) > VALIDADE_PROPOSTA_MS) return { ok: false, status: 409, erro: 'Proposta velha (mais de 24 h). Peça uma nova ao copiloto.' };
    if (!automatico && cfg.autonomia === 'sugerir' && acao.tipo !== 'responder' && !(acao.entrada || {}).enviar) {
      return { ok: false, status: 403, erro: 'A IA está no modo "só sugerir": faça a ação pela tela, ou o admin muda a autonomia.' };
    }
    if (automatico && !funil && (!SEGURAS_AUTOMATICO.has(acao.tipo) || precisaClique(acao.tipo, acao.entrada))) {
      return { ok: false, status: 403, erro: 'Esta ação sempre pede clique.' };
    }
    if (automatico && funil && decisaoDoFunil(acao.tipo, acao.entrada, (cfg.funil_niveis || niveisDoFunil(cfg))) !== 'executar') {
      return { ok: false, status: 403, erro: 'Esta ação pede o clique de alguém da equipe.' };
    }
    // trava: só um clique executa (dois atendentes ao mesmo tempo, ou clique duplo)
    const { data: pego } = await sb.from('ia_acoes').update({ status: 'executada', executada_em: agora().toISOString(),
      perfil_id: perfil?.id || acao.perfil_id || null }).eq('id', id).eq('status', 'proposta').select('id');
    if (!pego || !pego.length) return { ok: false, status: 409, erro: 'Outra pessoa já tratou esta ação.' };

    let r;
    try { r = await efeito(acao, perfil); }
    catch (e) { r = { ok: false, erro: e.message || 'falha ao executar' }; }
    if (!r.ok) {
      await sb.from('ia_acoes').update({ status: 'erro', erro: String(r.erro).slice(0, 300) }).eq('id', id);
      return { ok: false, status: r.status || 422, erro: r.erro };
    }
    await sb.from('ia_acoes').update({ saida: { ...(r.saida || {}), automatica: automatico || undefined },
      lead_id: r.lead_id || acao.lead_id || null, agendamento_id: r.agendamento_id || acao.agendamento_id || null,
      cliente_id: r.cliente_id || acao.cliente_id || null }).eq('id', id);
    ctxApi.invalidar(acao.conversa_id);
    return { ok: true, id, tipo: acao.tipo, saida: r.saida || {}, mensagem: r.mensagem || 'Feito.', texto_confirmacao: r.texto_confirmacao || null };
  }

  async function recusarAcao(id, perfil, motivo = '') {
    const { acao, erro, status } = await lerAcao(id);
    if (erro) return { ok: false, status, erro };
    if (acao.status !== 'proposta') return { ok: false, status: 409, erro: `Esta ação já está "${acao.status}".` };
    const { data } = await sb.from('ia_acoes').update({ status: 'recusada', perfil_id: perfil?.id || acao.perfil_id || null,
      saida: { motivo_recusa: limpar(motivo, 200) || null } }).eq('id', id).eq('status', 'proposta').select('id');
    if (!data || !data.length) return { ok: false, status: 409, erro: 'Outra pessoa já tratou esta ação.' };
    return { ok: true, id, status: 'recusada' };
  }

  async function desfazerAcao(id, perfil) {
    const { acao, erro, status } = await lerAcao(id);
    if (erro) return { ok: false, status, erro };
    if (acao.status !== 'executada') return { ok: false, status: 409, erro: 'Só dá para desfazer uma ação executada.' };
    if (!REVERSIVEIS.has(acao.tipo)) return { ok: false, status: 409, erro: 'Esta ação não tem como desfazer.' };
    if (agora().getTime() - Date.parse(acao.executada_em || acao.created_at) > JANELA_DESFAZER_MS) return { ok: false, status: 409, erro: 'Passou de 24 h: desfaça pela tela.' };
    const { data: pego } = await sb.from('ia_acoes').update({ status: 'desfeita' }).eq('id', id).eq('status', 'executada').select('id');
    if (!pego || !pego.length) return { ok: false, status: 409, erro: 'Outra pessoa já mexeu nesta ação.' };
    let r;
    try { r = await reverter(acao); }
    catch (e) { r = { ok: false, erro: e.message }; }
    if (!r.ok) {
      await sb.from('ia_acoes').update({ status: 'executada', erro: `desfazer falhou: ${String(r.erro).slice(0, 200)}` }).eq('id', id);
      return { ok: false, status: 422, erro: r.erro };
    }
    await sb.from('ia_acoes').update({ saida: { ...(acao.saida || {}), desfeita_por: perfil?.id || null, desfeita_em: agora().toISOString() } }).eq('id', id);
    ctxApi.invalidar(acao.conversa_id);
    return { ok: true, id, status: 'desfeita', mensagem: r.mensagem || 'Desfeito.' };
  }

  async function listarAcoes(conversaId, { limite = 40 } = {}) {
    if (!COM.ehUuid(conversaId)) return { ok: false, status: 400, erro: 'id de conversa inválido' };
    const { data, error } = await sb.from('ia_acoes')
      .select('id,tipo,status,resumo,entrada,saida,erro,modelo,tokens_entrada,tokens_saida,duracao_ms,created_at,executada_em,perfil_id')
      .eq('conversa_id', conversaId).eq('origem', origem).order('created_at', { ascending: false }).limit(Math.min(100, limite));
    if (error) return { ok: false, status: 503, erro: error.message };
    return { ok: true, acoes: (data || []).map(a => ({ ...a, entrada: publico(a.entrada), reversivel: REVERSIVEIS.has(a.tipo) && a.status === 'executada' })) };
  }

  /* ---------------- efeitos no banco ---------------- */
  async function efeito(acao, perfil) {
    const p = acao.entrada || {};
    const conversaId = acao.conversa_id;
    const ctx = await ctxApi.montarContexto(conversaId, { forcar: true });
    if (!ctx.ok) return { ok: false, erro: ctx.erro };
    const ficha = ctx.ficha;
    const conv = ficha.conversa;
    const fixos = await ctxApi.dadosFixos();

    switch (acao.tipo) {
      case 'responder': {
        /* Rodada 5: a mensagem do funil SAI para o cliente (fila `whatsapp_mensagens` de saída,
           como a tela faz, e o entregador manda pelo CodeWords sem duplicar). Sem `enviar`
           é o copiloto de sempre: o texto só vai para o campo do atendente. */
        if (!p.enviar) return { ok: true, saida: { usado: true }, mensagem: 'Texto no campo — revise e envie.' };
        if (typeof enviarMensagem !== 'function') return { ok: false, status: 503, erro: 'Este servidor não envia mensagens pela IA.' };
        const r = await enviarMensagem({ conversa: conv, cliente_id: ficha.cliente?.id || conv.cliente_id || null, texto: p.texto, acao_id: acao.id });
        if (!r || !r.mensagem_id) return { ok: false, status: r?.status || 502, erro: r?.erro || 'Não consegui registrar a mensagem.' };
        return { ok: true, saida: { enviada: true, mensagem_id: r.mensagem_id, entregue: !!r.ok, erro_entrega: r.ok ? null : (r.erro || null) },
          mensagem: r.ok ? '✉️ Mensagem enviada ao cliente.' : `Mensagem registrada; o WhatsApp não confirmou: ${r.erro || 'sem detalhe'}` };
      }

      case 'agendar': {
        ctxApi.invalidar();                                     // agenda fresca para revalidar
        const agenda = await ctxApi.agendaDosProximosDias();
        const dur = Number(fixos.servicos.find(s => s.id === p.servico_id)?.duracao_min) || H.DURACAO_PADRAO_MIN;
        const v = H.validarHorario({ data: p.data, hora: p.hora, agora: agora(), agendamentos: comDuracao(agenda, fixos.servicos),
          capacidade: Math.max(1, fixos.consultores.length), duracaoMin: dur });
        if (!v.ok) return { ok: false, status: 409, erro: `Não deu para agendar: ${v.motivo}` };
        /* Rodada 5: dupla checagem com a regra da PRÓPRIA Agenda (função SQL
           agenda_horarios_livres, não depende do Render acordado). Sem a função
           no banco (ou erro), vale só a nossa validação. */
        const agendaDiz = await horarioLivreNaAgenda(sb, v.data, v.hora, p.servico);
        if (agendaDiz && !agendaDiz.livre) return { ok: false, status: 409, erro: `Não deu para agendar: a Agenda diz que ${agendaDiz.motivo || 'esse horário não está livre'}.` };
        const nome = ficha.cliente?.nome || conv.nome || conv.telefone;
        const telefone = conv.telefone;
        // rodada 5: consultor livre no horário (mesma regra da Agenda: um carro por consultor por meia hora)
        const consultorId = escolherConsultor(fixos.consultores, agenda, v.data, v.hora);
        const pelaIA = perfil?.papel === 'sistema';
        let lead = ficha.leadAberto;
        let leadCriado = false, leadAntes = null;
        if (lead) {
          leadAntes = { status: lead.status, servico: lead.servico };
          const { error } = await sb.from('leads').update({ servico: p.servico, servico_id: p.servico_id || undefined }).eq('id', lead.id);
          if (error) return { ok: false, erro: 'Lead: ' + error.message };
        } else {
          const { data, error } = await sb.from('leads').insert({
            nome, telefone, carro_modelo: p.veiculo || null, placa: p.placa || null, servico: p.servico,
            servico_id: p.servico_id || null, valor_orcado: 0, origem: 'whatsapp', status: 'agendado',
            responsavel_id: conv.atribuida_a || null,
            observacoes: p.observacoes || (pelaIA ? 'Agendado pela IA do atendimento (WhatsApp).' : 'Agendado pelo copiloto do atendimento.'),
          }).select('id,cliente_id').single();
          if (error) return { ok: false, erro: 'Lead: ' + error.message };
          lead = data; leadCriado = true;
        }
        const clienteId = lead.cliente_id || ficha.cliente?.id || conv.cliente_id || null;
        const { data: ag, error: e2 } = await sb.from('agendamentos').insert({
          lead_id: lead.id, cliente_id: clienteId, cliente_nome: nome, telefone,
          veiculo: p.veiculo || null, placa: p.placa || null, servico: p.servico, servico_id: p.servico_id || null,
          data: v.data, hora: v.hora, origem: 'whatsapp', valor: 0, status: 'confirmado',
          consultor_id: consultorId, observacoes: p.observacoes || (pelaIA ? 'Marcado pela IA do atendimento (WhatsApp).' : null),
        }).select('id,cliente_id,consultor_id').single();
        if (e2) {
          if (leadCriado) await sb.from('leads').delete().eq('id', lead.id);   // não deixa lead órfão
          return { ok: false, erro: 'Agenda: ' + e2.message };
        }
        if (!conv.cliente_id && (ag.cliente_id || clienteId)) {
          await sb.from('conversas').update({ cliente_id: ag.cliente_id || clienteId }).eq('id', conversaId);
        }
        return { ok: true, agendamento_id: ag.id, lead_id: lead.id, cliente_id: ag.cliente_id || clienteId,
          saida: { agendamento_id: ag.id, lead_id: lead.id, lead_criado: leadCriado, lead_antes: leadAntes, ligou_cliente: !conv.cliente_id },
          mensagem: `📅 Agendado: ${H.rotuloHorario(v.data, v.hora)} — lead no CRM e horário na Agenda.`,
          texto_confirmacao: `Fechado! 📅 ${H.rotuloHorario(v.data, v.hora)}\n📍 ${fixos.empresa?.endereco || 'Av. Bandeirantes, 875 - Parque Paduan, Taubaté'}\nDeixei reservado no seu nome — qualquer imprevisto me avisa que a gente remarca numa boa 👍` };
      }

      case 'remarcar': {
        const ag = ficha.agendamentos.futuros.find(a => a.id === p.agendamento_id);
        if (!ag) return { ok: false, status: 409, erro: 'Esse horário não está mais ativo.' };
        ctxApi.invalidar();
        const agenda = await ctxApi.agendaDosProximosDias();
        const v = H.validarHorario({ data: p.data, hora: p.hora, agora: agora(), ignorarId: ag.id,
          agendamentos: comDuracao(agenda, fixos.servicos), capacidade: Math.max(1, fixos.consultores.length) });
        if (!v.ok) return { ok: false, status: 409, erro: `Não deu para remarcar: ${v.motivo}` };
        const { error } = await sb.from('agendamentos').update({ data: v.data, hora: v.hora }).eq('id', ag.id);
        if (error) return { ok: false, erro: error.message };
        return { ok: true, agendamento_id: ag.id, saida: { antes: { data: ag.data, hora: ag.hora }, depois: { data: v.data, hora: v.hora } },
          mensagem: `Remarcado para ${H.rotuloHorario(v.data, v.hora)}.` };
      }

      case 'cancelar_agendamento': {
        const ag = ficha.agendamentos.futuros.find(a => a.id === p.agendamento_id);
        if (!ag) return { ok: false, status: 409, erro: 'Esse horário não está mais ativo.' };
        const obs = [ag.observacoes, `Cancelado pelo atendimento (copiloto): ${p.motivo || 'pedido do cliente'}`].filter(Boolean).join(' · ').slice(0, 1000);
        const { error } = await sb.from('agendamentos').update({ status: 'cancelado', observacoes: obs }).eq('id', ag.id);
        if (error) return { ok: false, erro: error.message };
        return { ok: true, agendamento_id: ag.id, saida: { antes: { status: ag.status, observacoes: ag.observacoes || null } }, mensagem: 'Horário cancelado.' };
      }

      case 'mover_etapa': {
        const atual = ficha.funil.etapaAtual?.id || null;
        if ((p.antes?.etapa_id || null) !== atual) return { ok: false, status: 409, erro: 'Alguém mudou a etapa depois da proposta. Peça de novo.' };
        let q = sb.from('conversas').update({ etapa_id: p.etapa_id, etapa_por_ia: true }).eq('id', conversaId);
        q = atual ? q.eq('etapa_id', atual) : q.is('etapa_id', null);
        const { data, error } = await q.select('id');
        if (error) return { ok: false, erro: error.message };
        if (!data?.length) return { ok: false, status: 409, erro: 'Alguém mudou a etapa agora mesmo.' };
        return { ok: true, saida: { antes: p.antes, depois: { etapa_id: p.etapa_id, etapa: p.etapa } }, mensagem: `Etapa: ${p.etapa}.` };
      }

      case 'atualizar_ficha': {
        let clienteId = ficha.cliente?.id || conv.cliente_id;
        let criado = false;
        if (!clienteId) {
          const { data, error } = await sb.rpc('obter_ou_criar_cliente', { p_nome: p.campos.nome || conv.nome || conv.telefone,
            p_telefone: conv.telefone, p_carro: p.campos.carro_modelo || null, p_placa: p.campos.placa || null, p_origem: 'whatsapp' });
          if (error || !data) return { ok: false, erro: 'Não consegui criar o cadastro: ' + (error?.message || 'sem id') };
          clienteId = data; criado = true;
          await sb.from('conversas').update({ cliente_id: clienteId }).eq('id', conversaId);
        }
        const campos = { ...p.campos };
        if ('aceita_mensagens' in campos) {
          campos.aceita_mensagens_em = agora().toISOString();
          campos.aceita_mensagens_motivo = campos.aceita_mensagens ? 'Religado pelo atendente (copiloto)' : 'Pediu no WhatsApp para parar (copiloto)';
        }
        const antesReal = pick(ficha.cliente || {}, Object.keys(campos));
        const { error } = await sb.from('clientes').update(campos).eq('id', clienteId);
        if (error) return { ok: false, erro: error.message };
        return { ok: true, cliente_id: clienteId, saida: { cliente_id: clienteId, antes: antesReal, depois: campos, cliente_criado: criado }, mensagem: 'Ficha atualizada.' };
      }

      case 'registrar_interesse': {
        const lead = ficha.leadAberto;
        if (lead) {
          const muda = { servico: p.servico };
          if (p.servico_id) muda.servico_id = p.servico_id;
          if (['novo', 'contato'].includes(lead.status)) muda.status = 'orcamento';
          if (p.valor) muda.valor_orcado = p.valor;
          const antes = pick(lead, Object.keys(muda));
          const { error } = await sb.from('leads').update(muda).eq('id', lead.id);
          if (error) return { ok: false, erro: error.message };
          return { ok: true, lead_id: lead.id, saida: { lead_id: lead.id, antes, depois: muda, criado: false }, mensagem: 'Interesse registrado no lead aberto.' };
        }
        const { data, error } = await sb.from('leads').insert({
          nome: ficha.cliente?.nome || conv.nome || conv.telefone, telefone: conv.telefone,
          carro_modelo: ficha.cliente?.carro_modelo || null, placa: ficha.cliente?.placa || null,
          servico: p.servico, servico_id: p.servico_id || null, valor_orcado: p.valor || 0,
          origem: 'whatsapp', status: 'orcamento', observacoes: p.observacoes || 'Interesse registrado pelo copiloto do atendimento.',
        }).select('id,cliente_id').single();
        if (error) return { ok: false, erro: error.message };
        if (!conv.cliente_id && data.cliente_id) await sb.from('conversas').update({ cliente_id: data.cliente_id }).eq('id', conversaId);
        return { ok: true, lead_id: data.id, cliente_id: data.cliente_id, saida: { lead_id: data.id, criado: true }, mensagem: 'Lead criado no CRM (orçamento).' };
      }

      case 'marcar_aguardando_consultor': {
        const { error } = await sb.from('conversas').update({ aguardando_consultor: true, aguardando_desde: agora().toISOString() }).eq('id', conversaId);
        if (error) return { ok: false, erro: error.message };
        return { ok: true, saida: { antes: { aguardando_consultor: !!conv.aguardando_consultor, aguardando_desde: conv.aguardando_desde || null } }, mensagem: 'Marcado: aguardando consultor.' };
      }

      case 'agendar_retorno': {
        if (ficha.cliente && ficha.cliente.aceita_mensagens === false) return { ok: false, status: 409, erro: 'O cliente não aceita mensagens automáticas.' };
        const { data, error } = await sb.from('posvenda_envios').insert({
          cliente_id: ficha.cliente?.id || conv.cliente_id || null, telefone: conv.telefone, nome: ficha.cliente?.nome || conv.nome || null,
          tipo: 'avulsa', corpo: p.texto, enviar_em: p.enviar_em, status: 'pendente', criado_por: 'copiloto',
          chave_unica: `copiloto:${acao.id}`, conversa_id: conversaId, lead_id: ficha.leadAberto?.id || null,
        }).select('id').single();
        if (error) return { ok: false, erro: error.message };
        return { ok: true, saida: { envio_id: data.id }, mensagem: `Retorno programado para ${H.rotuloHorario(p.data, p.hora)}.` };
      }
      case 'criar_tarefa': {
        if (p.responsavel_id) {
          const { data: r } = await sb.from('perfis').select('id,ativo').eq('id', p.responsavel_id).maybeSingle();
          if (!r?.ativo) return { ok: false, status: 409, erro: 'O responsável não está mais ativo na equipe.' };
        }
        const { data, error } = await sb.from('tarefas').insert({
          titulo: p.titulo, descricao: p.descricao || null, responsavel_id: p.responsavel_id || null,
          criado_por: (perfil?.papel !== 'sistema' && perfil?.id) || acao.perfil_id || null, conversa_id: conversaId,
          cliente_id: ficha.cliente?.id || conv.cliente_id || null, lead_id: ficha.leadAberto?.id || null,
          origem: 'ia', prioridade: p.prioridade || 2, vence_em: p.vence_em || null, status: 'aberta',
        }).select('id').single();
        if (error) return { ok: false, erro: 'Não consegui criar a tarefa agora.' };
        return { ok: true, saida: { tarefa_id: data.id }, mensagem: `Tarefa criada${p.responsavel ? ` para ${p.responsavel}` : ''}.` };
      }
      default: return { ok: false, erro: 'Esta ação não executa nada.' };
    }
  }

  async function reverter(acao) {
    const s = acao.saida || {};
    const conversaId = acao.conversa_id;
    switch (acao.tipo) {
      case 'agendar': {
        const { error } = await sb.from('agendamentos').update({ status: 'cancelado', observacoes: 'Desfeito no copiloto do atendimento.' }).eq('id', s.agendamento_id);
        if (error) return { ok: false, erro: error.message };
        if (s.lead_criado) {
          // lead nasceu desta ação e nada mais o usa: sai do CRM em vez de virar "perdido" falso
          const { data: outros } = await sb.from('agendamentos').select('id').eq('lead_id', s.lead_id).neq('id', s.agendamento_id).limit(1);
          // (as chaves que apontam para o lead são ON DELETE SET NULL)
          if (!outros?.length) await sb.from('leads').delete().eq('id', s.lead_id);
        } else if (s.lead_antes) {
          await sb.from('leads').update({ status: s.lead_antes.status, servico: s.lead_antes.servico }).eq('id', s.lead_id);
        }
        return { ok: true, mensagem: 'Agendamento desfeito (horário cancelado).' };
      }
      case 'remarcar': {
        const { error } = await sb.from('agendamentos').update({ data: s.antes.data, hora: s.antes.hora }).eq('id', acao.agendamento_id || acao.entrada.agendamento_id);
        return error ? { ok: false, erro: error.message } : { ok: true, mensagem: 'Voltou para o horário anterior.' };
      }
      case 'cancelar_agendamento': {
        const { error } = await sb.from('agendamentos').update({ status: s.antes.status, observacoes: s.antes.observacoes }).eq('id', acao.agendamento_id || acao.entrada.agendamento_id);
        return error ? { ok: false, erro: error.message } : { ok: true, mensagem: 'Horário reativado.' };
      }
      case 'mover_etapa': {
        const { error } = await sb.from('conversas').update({ etapa_id: s.antes?.etapa_id || null, etapa_por_ia: false }).eq('id', conversaId);
        return error ? { ok: false, erro: error.message } : { ok: true, mensagem: `Etapa voltou para ${s.antes?.etapa || 'sem etapa'}.` };
      }
      case 'atualizar_ficha': {
        const volta = { ...(s.antes || {}) };
        for (const k of Object.keys(s.depois || {})) if (!(k in volta)) volta[k] = null;
        if ('aceita_mensagens' in volta && volta.aceita_mensagens === null) volta.aceita_mensagens = true;
        const { error } = await sb.from('clientes').update(volta).eq('id', s.cliente_id);
        return error ? { ok: false, erro: error.message } : { ok: true, mensagem: 'Ficha voltou como estava.' };
      }
      case 'registrar_interesse': {
        if (s.criado) {
          const { data: ags } = await sb.from('agendamentos').select('id').eq('lead_id', s.lead_id).limit(1);
          if (ags?.length) return { ok: false, erro: 'O lead já tem horário marcado — desfaça pela Agenda/CRM.' };
          const { error } = await sb.from('leads').delete().eq('id', s.lead_id);
          return error ? { ok: false, erro: error.message } : { ok: true, mensagem: 'Lead removido do CRM.' };
        }
        const { error } = await sb.from('leads').update(s.antes || {}).eq('id', s.lead_id);
        return error ? { ok: false, erro: error.message } : { ok: true, mensagem: 'Lead voltou como estava.' };
      }
      case 'marcar_aguardando_consultor': {
        const { error } = await sb.from('conversas').update(s.antes || { aguardando_consultor: false, aguardando_desde: null }).eq('id', conversaId);
        return error ? { ok: false, erro: error.message } : { ok: true, mensagem: 'Saiu de "aguardando consultor".' };
      }
      case 'agendar_retorno': {
        const { data, error } = await sb.from('posvenda_envios').update({ status: 'cancelado', motivo_pulado: 'desfeito no copiloto' })
          .eq('id', s.envio_id).eq('status', 'pendente').select('id');
        if (error) return { ok: false, erro: error.message };
        if (!data?.length) return { ok: false, erro: 'A mensagem já saiu (ou não está mais na fila).' };
        return { ok: true, mensagem: 'Retorno tirado da fila.' };
      }
      case 'criar_tarefa': {
        const { data, error } = await sb.from('tarefas').update({ status: 'cancelada' }).eq('id', s.tarefa_id).eq('status', 'aberta').select('id');
        if (error) return { ok: false, erro: 'Não consegui cancelar a tarefa agora.' };
        if (!data?.length) return { ok: false, erro: 'A tarefa já foi concluída ou cancelada.' };
        return { ok: true, mensagem: 'Tarefa cancelada.' };
      }
      default: return { ok: false, erro: 'Sem como desfazer.' };
    }
  }

  return { rodar, executarAcao, recusarAcao, desfazerAcao, listarAcoes, lerConfig, salvarConfig, usoDoDia, registrar,
           validar, contexto: ctxApi, inicioDoDia };
}

/* ---------- utilidades ---------- */
function pick(o, chaves) { const r = {}; for (const k of chaves) r[k] = o?.[k] ?? null; return r; }
/**
 * Pergunta à Agenda (rpc `agenda_horarios_livres(p_dia, p_servico, p_consultor)`) se o horário está livre.
 * Devolve { livre, motivo, consultores_livres } — ou null quando a função não existe/falhou (aí vale só a nossa regra).
 */
async function horarioLivreNaAgenda(sb, data, hora, servico) {
  try {
    const { data: r, error } = await sb.rpc('agenda_horarios_livres', { p_dia: data, p_servico: servico || null, p_consultor: null });
    if (error || !r || typeof r !== 'object') return null;
    if (r.aberto === false) return { livre: false, motivo: r.motivo || 'a oficina não abre nesse dia' };
    const hh = H.minutosEmHora(H.horaEmMinutos(hora));
    const slot = (r.horarios || []).find(x => String(x.hora || '').slice(0, 5) === hh);
    if (!slot) return { livre: false, motivo: `${hh} não está entre os horários livres` };
    if (Number(slot.livres) <= 0) return { livre: false, motivo: `${hh} já está lotado` };
    return { livre: true, consultores_livres: slot.consultores_livres || [] };
  } catch { return null; }
}
/**
 * Consultor para um horário (rodada 5): quem está livre naquela meia hora (a Agenda recusa dois
 * carros do mesmo consultor no mesmo slot) e, entre os livres, quem tem MENOS horários no dia.
 * Sem consultor cadastrado → null (a recepção escolhe depois).
 */
function escolherConsultor(consultores = [], agenda = [], data, hora) {
  const ativos = (consultores || []).filter(c => c && c.id);
  if (!ativos.length) return null;
  const min = H.horaEmMinutos(hora);
  const slot = min === null ? null : Math.floor(min / 30) * 30;
  const doDia = (agenda || []).filter(a => a && a.data === data && !['cancelado', 'nao_veio'].includes(String(a.status || '')));
  const ocupados = new Set(doDia.filter(a => a.consultor_id && slot !== null && Math.floor((H.horaEmMinutos(a.hora) ?? -999) / 30) * 30 === slot).map(a => a.consultor_id));
  const livres = ativos.filter(c => !ocupados.has(c.id));
  if (!livres.length) return null;
  const carga = id => doDia.filter(a => a.consultor_id === id).length;
  return livres.sort((a, b) => carga(a.id) - carga(b.id) || String(a.nome || '').localeCompare(String(b.nome || '')))[0].id;
}
function comDuracao(agenda, servicos) {
  return (agenda || []).map(a => ({ ...a, duracao_min: Number(servicos.find(s => s.id === a.servico_id)?.duracao_min) || H.DURACAO_PADRAO_MIN }));
}
/** Desvio do fuso da oficina em ms (São Paulo: -3 h → -10800000). */
function deslocamento(instante) {
  const p = H.partesLocais(instante);
  const local = Date.parse(`${p.dia}T${H.minutosEmHora(p.minutos)}:00Z`);
  const utc = Math.floor(instante.getTime() / 60000) * 60000;
  return local - utc;
}
/** Instante ISO → [dia, minutos] no horário de São Paulo (para o rótulo). */
function prazoLocal(iso) {
  const p = H.partesLocais(new Date(iso));
  return [p.dia, p.minutos];
}
/** Bloco EQUIPE do prompt: só nomes (sem e-mail/telefone) e as tarefas já abertas na conversa. */
function textoDaEquipe(equipe = [], conversa = {}, tarefas = []) {
  const dono = equipe.find(e => e.id === conversa?.atribuida_a);
  const L = ['EQUIPE (para criar_tarefa — use o nome exato)'];
  L.push(equipe.length ? `- ${equipe.map(e => e.nome).join(', ')}` : '- (sem lista; deixe o responsável vazio)');
  L.push(`- Com a conversa agora: ${dono ? dono.nome : 'ninguém'}`);
  if (tarefas.length) L.push(`- Tarefas JÁ abertas nesta conversa (não repita): ${tarefas.map(t => t.titulo).join(' · ')}`);
  return L.join('\n');
}
/** O que a tela vê dos parâmetros (sem os bastidores do desfazer). */
function publico(p) {
  if (!p || typeof p !== 'object') return p;
  const { antes, sensivel, ...resto } = p;
  return resto;
}

module.exports = {
  criarCopiloto, FERRAMENTAS, PAPEL_COPILOTO, PAPEL_FUNIL, CONFIG_PADRAO, MODELOS_PERMITIDOS, INTENCOES, TEMPERATURAS,
  SEGURAS_AUTOMATICO, INFORMATIVAS, REVERSIVEIS, ETAPAS_FUNIL, ETAPA_DA_ACAO, NIVEIS,
  revisarTexto, numerosDoTexto, valorFoiInformado, normPlaca, placaValida, normalizarNascimento, clienteDisse,
  acharServico, naoFazemos, deslocamento, textoDaEquipe, contarPerguntas, tirarApresentacaoRepetida,
  niveisDoFunil, decisaoDoFunil, textoHorarioOcupado, proximaAcao, escolherConsultor,
};

/** Números do copiloto para /api/relatorios (só contagens, nada de texto). */
function resumoCopiloto(acoes = []) {
  const r = { chamadas: 0, propostas: 0, executadas: 0, recusadas: 0, desfeitas: 0, erros: 0, automaticas: 0,
              tokensEntrada: 0, tokensSaida: 0, duracaoMediaMs: null, aceite: null, porTipo: {}, chamadasPorTipo: {} };
  const duracoes = [];
  for (const a of acoes) {
    if (!a) continue;
    r.tokensEntrada += Number(a.tokens_entrada) || 0;
    r.tokensSaida += Number(a.tokens_saida) || 0;
    if (TIPOS_CHAMADA.has(a.tipo)) {
      r.chamadas++;
      r.chamadasPorTipo[a.tipo] = (r.chamadasPorTipo[a.tipo] || 0) + 1;
      if (a.tipo === 'copiloto' && Number(a.duracao_ms) > 0) duracoes.push(Number(a.duracao_ms));
      if (a.status === 'erro') r.erros++;
      continue;
    }
    if (INFORMATIVAS.has(a.tipo) && a.tipo !== 'responder') continue;
    if (a.tipo === 'config') continue;
    r.propostas++;
    const t = r.porTipo[a.tipo] || (r.porTipo[a.tipo] = { propostas: 0, executadas: 0, recusadas: 0 });
    t.propostas++;
    if (a.status === 'executada' || a.status === 'desfeita') { r.executadas++; t.executadas++; }
    if (a.status === 'recusada') { r.recusadas++; t.recusadas++; }
    if (a.status === 'desfeita') r.desfeitas++;
    if (a.status === 'erro') r.erros++;
    if (a.saida && a.saida.automatica) r.automaticas++;
  }
  if (duracoes.length) r.duracaoMediaMs = Math.round(duracoes.reduce((s, n) => s + n, 0) / duracoes.length);
  const decididas = r.executadas + r.recusadas;
  if (decididas) r.aceite = Math.round((r.executadas / decididas) * 1000) / 10;
  return r;
}
module.exports.resumoCopiloto = resumoCopiloto;
module.exports.TIPOS_CHAMADA = TIPOS_CHAMADA;
