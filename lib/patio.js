/* ============================================================
   PÁTIO (16/10/2026) — o carro DENTRO da oficina, visto do Atendimento.

   O IndyCar Pátio (https://indycar-patio.netlify.app) guarda uma ordem
   por passagem do carro (patio_os) com a etapa, os extras que o cliente
   aprova pelo celular (patio_extras) e o link de acompanhamento
   (token_publico). Aqui só LEMOS, com a chave de serviço:
     · lerPatio(sb, …)       → a ordem em andamento (ou entregue há pouco)
     · textoPatioParaIA(…)   → o trecho do prompt do copiloto: etapa REAL,
                               previsão só se a equipe registrou, extras
                               sem valor e sem link/token
     · linkArea(…)           → o link da Área do Cliente ("Minha IndyCar")

   O banco é injetado (sb) para testar com dublê.
   ============================================================ */
'use strict';

const PATIO_URL = 'https://indycar-patio.netlify.app';

const ETAPAS = {
  recebido: 'Recebido na oficina',
  diagnostico: 'Em diagnóstico',
  aguardando_aprovacao: 'Aguardando aprovação do cliente',
  aguardando_peca: 'Aguardando peça',
  em_execucao: 'Em execução',
  teste: 'Em teste final',
  pronto: 'Pronto para retirar',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};
const TOM = { pronto: 'ok', entregue: 'feito', aguardando_aprovacao: 'atencao', aguardando_peca: 'atencao', cancelado: 'feito' };
const URGENCIA = { seguranca: 'segurança', recomendado: 'recomendado', pode_esperar: 'pode esperar' };
const ABERTAS = ['recebido', 'diagnostico', 'aguardando_aprovacao', 'aguardando_peca', 'em_execucao', 'teste', 'pronto'];
const ENTREGUE_RECENTE_MS = 2 * 86_400_000;   // entregue há até 2 dias ainda aparece ("já retirou")

const TOKEN_RE = /^[0-9a-f]{16,128}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function baseLimpa(linkBase) {
  const b = String(linkBase || PATIO_URL).trim().replace(/\/+$/, '');
  return /^https:\/\//i.test(b) ? b : null;
}
/** Link do CLIENTE para acompanhar a ordem. Token/base estranhos → null. */
function linkAcompanhar(linkBase, token) {
  const b = baseLimpa(linkBase);
  return b && TOKEN_RE.test(String(token || '')) ? `${b}/acompanhar/?t=${encodeURIComponent(token)}` : null;
}
/** Link da Área do Cliente ("Minha IndyCar"). */
function linkArea(linkBase, token) {
  const b = baseLimpa(linkBase);
  return b && TOKEN_RE.test(String(token || '')) ? `${b}/minha/?c=${encodeURIComponent(token)}` : null;
}
/** Link da EQUIPE (o app do Pátio na ordem certa). */
const linkPatio = (osId) => (UUID_RE.test(String(osId || '')) ? `${PATIO_URL}/?os=${osId}` : PATIO_URL);

const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || 'tudo bem';
const oCarro = (v) => String(v || '').trim() || 'seu carro';

/** Texto pronto para colar no chat (pt-BR da casa: "carro", nada de "prezado"). */
function textoDoAcompanhamento({ nome, veiculo, link } = {}) {
  if (!link) return '';
  return `Oi ${primeiroNome(nome)}! Você acompanha o ${oCarro(veiculo)} aqui na IndyCar por este link, etapa por etapa (e aprova qualquer item extra por lá): ${link} 🏁`;
}
function textoDaArea({ nome, link } = {}) {
  if (!link) return '';
  return `Oi ${primeiroNome(nome)}! Esta é a sua Área do Cliente da IndyCar: histórico do carro, próximas revisões e pedido de horário, tudo num lugar só. Guarde o link, ele é só seu: ${link} 🏁`;
}

/** Minutos desde um instante (null se não der para ler). */
function minutosDesde(iso, agora) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.max(0, Math.round((Number(agora) - t) / 60_000)) : null;
}
/** "35 min", "3 h", "2 dias" — sempre aproximado. */
function tempoCurto(min) {
  if (min === null || min === undefined) return '';
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h`;
  const d = Math.round(min / (24 * 60));
  return `${d} dia${d > 1 ? 's' : ''}`;
}

/** Resumo de uma ordem para a tela (com valores) — a IA recebe outro texto, sem eles. */
function resumoDaOs(os, extras = [], linkBase = PATIO_URL, agora = new Date()) {
  if (!os || !os.id) return null;
  const doOs = (extras || []).filter(e => e && e.os_id === os.id);
  const pendentes = doOs.filter(e => e.status === 'pendente');
  const aprovados = doOs.filter(e => e.status === 'aprovado');
  const recusados = doOs.filter(e => e.status === 'recusado');
  const soma = (l) => Math.round(l.reduce((s, e) => s + Math.round((Number(e.valor) || 0) * 100), 0)) / 100;
  const min = minutosDesde(os.etapa_em, agora);
  return {
    id: os.id,
    numero: os.numero ?? null,
    etapa: os.etapa,
    etapa_rotulo: ETAPAS[os.etapa] || os.etapa || 'Pátio',
    tom: TOM[os.etapa] || 'andamento',
    aberta: ABERTAS.includes(os.etapa),
    etapa_em: os.etapa_em || null,
    minutos_na_etapa: min,
    tempo_na_etapa: tempoCurto(min),
    entrada_em: os.created_at || null,
    previsao_entrega: os.previsao_entrega || null,
    entregue_em: os.entregue_em || null,
    veiculo: os.veiculo || null,
    placa: os.placa || null,
    servico: os.servico || null,
    link_visto_em: os.link_visto_em || null,
    extras_pendentes: pendentes.map(e => ({ descricao: e.descricao, urgencia: e.urgencia || 'recomendado', valor: Number(e.valor) || null })),
    extras_aprovados: aprovados.length,
    extras_recusados: recusados.length,
    valor_aprovado: soma(aprovados),
    abrir: linkPatio(os.id),
    link_cliente: os.etapa === 'cancelado' ? null : linkAcompanhar(linkBase, os.token_publico),
  };
}

/**
 * Escolhe a ordem que importa: a aberta mais recente; sem aberta, a entregue
 * há até 2 dias ("o carro já foi retirado"). Canceladas nunca.
 */
function escolherOrdem(ordens = [], agora = new Date()) {
  const lista = (ordens || []).filter(o => o && o.etapa !== 'cancelado')
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const aberta = lista.find(o => ABERTAS.includes(o.etapa));
  if (aberta) return aberta;
  const ent = lista.find(o => o.etapa === 'entregue' && Number(agora) - Date.parse(o.entregue_em || o.etapa_em || 0) <= ENTREGUE_RECENTE_MS);
  return ent || null;
}

const SEL_OS = 'id,numero,etapa,etapa_em,cliente_id,telefone,veiculo,placa,servico,previsao_entrega,entregue_em,token_publico,link_visto_em,created_at';

function criarPatio({ sb, agora = () => new Date() } = {}) {
  const cfg = { em: 0, base: null };
  async function linkBase() {
    if (cfg.base && Date.now() - cfg.em < 60_000) return cfg.base;
    try {
      const { data } = await sb.from('patio_config').select('link_base').eq('id', true).maybeSingle();
      cfg.base = data?.link_base || PATIO_URL; cfg.em = Date.now();
    } catch { cfg.base = cfg.base || PATIO_URL; }
    return cfg.base;
  }

  /**
   * A ordem do pátio deste cliente: pelo cliente_id e, sem ele, pelo telefone.
   * Devolve { ordem: resumo|null, base } — erro vira aviso, nunca derruba a ficha.
   */
  async function lerPatio({ clienteId = null, telefones = [], avisos = [] } = {}) {
    try {
      let q = sb.from('patio_os').select(SEL_OS);
      if (clienteId) q = q.eq('cliente_id', clienteId);
      else if (telefones.length) q = q.in('telefone', telefones);
      else return { ordem: null };
      const { data: ordens, error } = await q.order('created_at', { ascending: false }).limit(5);
      if (error) { avisos.push('pátio: ' + error.message); return { ordem: null }; }
      const os = escolherOrdem(ordens || [], agora());
      if (!os) return { ordem: null };
      const [{ data: extras }, base] = await Promise.all([
        sb.from('patio_extras').select('os_id,descricao,urgencia,status,valor,created_at').eq('os_id', os.id).order('created_at', { ascending: true }).limit(30),
        linkBase(),
      ]);
      return { ordem: resumoDaOs(os, extras || [], base, agora()), base };
    } catch (e) { avisos.push('pátio: ' + e.message); return { ordem: null }; }
  }

  /** Link novo da Área do Cliente (a rpc devolve o token UMA vez e guarda só o hash). */
  async function gerarLinkDaArea(clienteId) {
    if (!UUID_RE.test(String(clienteId || ''))) return { ok: false, status: 400, erro: 'id de cliente inválido' };
    const { data, error } = await sb.rpc('cliente_gerar_acesso', { p_cliente: clienteId });
    if (error) {
      const naoAchou = /não encontrado|P0002/i.test(error.message || '');
      return { ok: false, status: naoAchou ? 404 : 503, erro: naoAchou ? 'Cliente não encontrado.' : 'Não consegui gerar o link agora.' };
    }
    const link = linkArea(await linkBase(), data);
    return link ? { ok: true, link } : { ok: false, status: 503, erro: 'Não consegui gerar o link agora.' };
  }

  return { lerPatio, gerarLinkDaArea, linkBase };
}

/**
 * O trecho do prompt do copiloto. Sem valor em R$, sem link, sem token.
 * Previsão: SÓ a que a equipe registrou; sem ela, a IA não promete prazo.
 */
function textoPatioParaIA(ordem, agora = new Date()) {
  if (!ordem) return '';
  const L = ['CARRO NA OFICINA (IndyCar Pátio — situação REAL agora)'];
  const carro = [ordem.veiculo, ordem.placa ? `placa ${ordem.placa}` : ''].filter(Boolean).join(' · ');
  if (ordem.etapa === 'entregue') {
    L.push(`- ${carro || 'O carro'} já foi ENTREGUE ao cliente${ordem.entregue_em ? ` (${String(ordem.entregue_em).slice(0, 10)})` : ''}.`);
    L.push('- Se ele perguntar se está pronto: já foi retirado. Se tiver queixa, acolha e passe para a equipe.');
    return L.join('\n');
  }
  L.push(`- ${carro || 'Carro'}${ordem.servico ? ` · serviço: ${ordem.servico}` : ''}`);
  L.push(`- Etapa atual: ${ordem.etapa_rotulo}${ordem.tempo_na_etapa ? ` (há ${ordem.tempo_na_etapa})` : ''}.`);
  if (ordem.etapa === 'pronto') L.push('- O carro ESTÁ PRONTO: pode dizer que já pode retirar (seg–sáb, 8h às 17h30).');
  else L.push('- O carro AINDA NÃO está pronto. Diga a etapa real com naturalidade.');
  const prev = Date.parse(ordem.previsao_entrega || '');
  if (ordem.etapa !== 'pronto') {
    if (Number.isFinite(prev)) {
      const quando = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(prev));
      L.push(prev < Number(agora)
        ? `- A previsão registrada pela equipe (${quando}) JÁ PASSOU: não repita esse prazo; diga que vai confirmar com a equipe.`
        : `- Previsão registrada pela equipe: ${quando}. Pode usar como "a previsão é…", sem garantir.`);
    } else {
      L.push('- NÃO há previsão de entrega registrada: NÃO prometa prazo nem horário. Diga que a equipe avisa assim que ficar pronto.');
    }
  }
  if (ordem.extras_pendentes?.length) {
    L.push(`- ${ordem.extras_pendentes.length} item(ns) extra(s) esperando a APROVAÇÃO do cliente: ${ordem.extras_pendentes.map(e => `${e.descricao} (${URGENCIA[e.urgencia] || e.urgencia})`).join('; ')}.`);
    L.push('- Ele aprova ou recusa pelo link de acompanhamento (o atendente cola o link). Não cite valores.');
  }
  if (ordem.extras_aprovados) L.push(`- Ele já aprovou ${ordem.extras_aprovados} extra(s).`);
  L.push('- Existe link de acompanhamento: pode oferecer "te mando o link para acompanhar" (o atendente cola o link com um clique).');
  return L.join('\n');
}

module.exports = {
  PATIO_URL, ETAPAS, ABERTAS, linkAcompanhar, linkArea, linkPatio, textoDoAcompanhamento, textoDaArea,
  resumoDaOs, escolherOrdem, criarPatio, textoPatioParaIA, tempoCurto, minutosDesde,
};
