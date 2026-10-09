/* ============================================================
   Regras puras (sem banco, sem rede) usadas pelo servidor para a
   ficha do cliente, a chave do CodeWords e o resumo do Comunicar.
   Ficam separadas para dar para testar com `node --test`.
   ============================================================ */
'use strict';

/** Só dígitos, sem o DDI 55 quando ele é DDI mesmo (10 ou 11 dígitos depois). */
function normalizarTelefone(v) {
  return String(v ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
}

/** Variantes do mesmo número como ele costuma estar gravado: com e sem 55, com +. */
function variantesDoTelefone(v) {
  const d = normalizarTelefone(v);
  if (!d) return [];
  return [...new Set([d, `55${d}`, `+55${d}`])];
}

/** Tira acento e caixa: "Óleo do Motor" e "oleo do motor" viram iguais. */
const semAcento = t => String(t ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const PADRAO_REVISAO_MESES = 6;

/** Soma meses a uma data mantendo o dia quando dá (31/01 + 1 mês = 28/02). */
function somarMeses(iso, meses) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(meses || 0));
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d.toISOString();
}

/**
 * Próxima revisão prevista a partir do último serviço concluído.
 * Casa as palavras das regras do Comunicar com o nome do serviço; a primeira
 * regra ativa que bater (na ordem recebida) manda. Sem regra: 6 meses.
 * @returns {null | {prevista:string, meses:number, rotulo:string, regraId:string|null, padrao:boolean}}
 */
function proximaRevisao({ servico, concluidoEm, regras = [], padraoMeses = PADRAO_REVISAO_MESES }) {
  if (!concluidoEm) return null;
  const texto = semAcento(servico);
  let regra = null;
  if (texto) {
    for (const r of regras) {
      if (r && r.ativo === false) continue;
      const palavras = Array.isArray(r?.palavras) ? r.palavras : [];
      if (palavras.some(p => p && texto.includes(semAcento(p)))) { regra = r; break; }
    }
  }
  const meses = Number(regra?.meses) > 0 ? Number(regra.meses) : padraoMeses;
  const prevista = somarMeses(concluidoEm, meses);
  if (!prevista) return null;
  return {
    prevista, meses,
    rotulo: regra?.rotulo || 'Revisão geral',
    regraId: regra?.id ?? null,
    padrao: !regra,
  };
}

/** Só o fim da chave aparece: "••••••••943a". Vazio quando não há chave. */
function mascararChave(chave) {
  const k = String(chave ?? '').trim();
  if (!k) return '';
  return '••••••••' + k.slice(-4);
}

/** Uma chave do CodeWords plausível: texto curto-médio, sem espaço, sem máscara. */
function chaveParece(chave) {
  const k = String(chave ?? '').trim();
  if (k.length < 20 || k.length > 200) return false;
  if (/\s/.test(k)) return false;
  if (k.includes('•')) return false;
  return true;
}

/**
 * Traduz o retorno do GET .../connections do CodeWords.
 * @returns {{resultado:'ok'|'recusada'|'outro', mensagem:string}}
 */
function classificarTesteChave(status, texto = '') {
  const s = Number(status);
  if (s === 401 || s === 403) {
    return { resultado: 'recusada', mensagem: `Chave recusada pelo CodeWords (${s}). Ela foi revogada ou está errada.` };
  }
  if (s >= 200 && s < 300) {
    let n = null;
    try {
      const j = JSON.parse(texto);
      const lista = Array.isArray(j) ? j : (Array.isArray(j?.connections) ? j.connections
                   : Array.isArray(j?.data) ? j.data : null);
      if (lista) n = lista.length;
    } catch { /* resposta sem JSON: a chave foi aceita mesmo assim */ }
    const det = n === null ? '' : n === 1 ? ' — 1 conexão de WhatsApp' : ` — ${n} conexões de WhatsApp`;
    return { resultado: 'ok', mensagem: `Chave aceita pelo CodeWords${det}.` };
  }
  if (s === 429) return { resultado: 'outro', mensagem: 'O CodeWords respondeu 429 (limite de uso). A chave pode estar certa; tente de novo em um minuto.' };
  if (!s) return { resultado: 'outro', mensagem: 'O CodeWords não respondeu. Pode ser rede ou o serviço fora do ar.' };
  return { resultado: 'outro', mensagem: `O CodeWords respondeu ${s}. Não dá para afirmar se a chave está certa.` };
}

/** Texto exato que o atendente vê quando o envio falha — por código HTTP e corpo. */
const ERRO_CHAVE_RECUSADA =
  'WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações';

function textoErroEnvio(status, txt = '') {
  if (/INVALID_WA_CLI|whatsapp cli is invalid|not_connected|logged_out/i.test(txt)) {
    return { codigo: 'whatsapp-desconectado',
      erro: 'O WhatsApp da oficina está desconectado — nenhuma mensagem sai enquanto isso. '
          + 'Reconecte em Configurações › Conexão do WhatsApp (leva 30 segundos no celular).' };
  }
  if (status === 429 && /limit/i.test(txt)) {
    return { codigo: 'cota', erro: 'A cota mensal do CodeWords acabou — a mensagem ficou registrada aqui, '
          + 'mas não saiu no WhatsApp. Renove o plano ou aguarde virar o mês.' };
  }
  if (status === 401 || status === 403) {
    return { codigo: 'codewords-401', erro: ERRO_CHAVE_RECUSADA };
  }
  if (status === 404) {
    return { codigo: 'fluxo-404', erro: 'O CodeWords não achou esse fluxo — confira o Service ID em Configurações.' };
  }
  return { codigo: `http-${status}`, erro: `CodeWords respondeu ${status}` };
}

/** Texto da faixa de saúde por código de problema do vigia. */
const TEXTO_SAUDE = {
  'codewords-fora': ERRO_CHAVE_RECUSADA,
  'whatsapp-fora': 'WhatsApp parado: o celular da oficina está desconectado. Reconecte em Configurações › Conexão do WhatsApp',
  'fila-parada': 'Mensagens automáticas paradas: a fila do Comunicar não anda. Abra o Comunicar para ver o motivo',
  'banco-fora': 'O banco de dados não respondeu ao vigia. Se a tela travar, avise o responsável',
};
function textoDaSaude(problema, resumo = '') {
  if (!problema) return '';
  return TEXTO_SAUDE[problema] || `Atenção: ${resumo || problema}`;
}

/** Conta a fila do Comunicar para o relatório. Só números, nada de texto. */
function resumoComunicar(envios = []) {
  const r = { total: 0, enviadas: 0, respondidas: 0, pararam: 0, falharam: 0, pendentes: 0,
              canceladas: 0, puladas: 0, agendaram: 0, positivas: 0, porTipo: {} };
  for (const e of envios) {
    if (!e) continue;
    r.total++;
    const st = String(e.status || '');
    if (st === 'enviado') r.enviadas++;
    else if (st === 'falhou') r.falharam++;
    else if (st === 'pendente') r.pendentes++;
    else if (st === 'cancelado') r.canceladas++;
    else if (st === 'pulado') r.puladas++;
    if (e.respondido_em || e.resposta_tipo) r.respondidas++;
    if (e.resposta_tipo === 'parar') r.pararam++;
    if (e.resposta_tipo === 'positiva') r.positivas++;
    if (e.agendou_depois_id) r.agendaram++;
    const t = String(e.tipo || 'outro');
    r.porTipo[t] = (r.porTipo[t] || 0) + 1;
  }
  return r;
}

/** Nome legível de cada tipo da fila do Comunicar. */
const ROTULO_TIPO = {
  aniversario: 'Aniversário', posvenda: 'Pós-venda', retorno: 'Retorno de revisão',
  campanha: 'Campanha', avulsa: 'Avulsa', lembrete: 'Lembrete de horário',
  orcamento: 'Orçamento', nao_fechou: 'Não fechou', reativacao: 'Reativação', avaliacao: 'Avaliação',
};

const ehUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

module.exports = {
  normalizarTelefone, variantesDoTelefone, semAcento, somarMeses, proximaRevisao,
  PADRAO_REVISAO_MESES, mascararChave, chaveParece, classificarTesteChave,
  textoErroEnvio, ERRO_CHAVE_RECUSADA, textoDaSaude, TEXTO_SAUDE,
  resumoComunicar, ROTULO_TIPO, ehUuid,
};
