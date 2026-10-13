/* ============================================================
   RODÍZIO, TRANSFERÊNCIA e CONVERSAS SEM DONO
   Quem pode receber cliente: ativo, recebe_leads, papel de equipe e
   com o Atendimento nos apps (admin sempre), fora de férias
   (preferencias.ausente_ate) — e, de preferência, dentro do horário
   dele (preferencias.expediente {dias:[1..6], inicio, fim}; sem isso,
   o da oficina: seg–sáb 8h–17h30). Entre os que podem, ganha quem
   tem MENOS conversas abertas; empate → quem recebeu há mais tempo.
   Ninguém no horário? Vale o mesmo critério entre todos os que podem
   (cliente nunca fica sem dono por causa do relógio).

   Lead acompanha o dono: quando a conversa muda de mão, os leads em
   aberto do cliente passam para o novo dono — só os que estavam sem
   responsável ou com o dono antigo (lead de outra pessoa não é tocado).
   ============================================================ */
'use strict';

const S = require('./seguranca.js');

const FUSO = 'America/Sao_Paulo';
const EXPEDIENTE_OFICINA = { dias: [1, 2, 3, 4, 5, 6], inicio: '08:00', fim: '17:30' };
const STATUS_LEAD_FECHADO = ['concluido', 'perdido'];

/** Dia da semana (0=dom) e minutos do dia em São Paulo. */
function relogioLocal(agora = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(agora).reduce((o, x) => (o[x.type] = x.value, o), {});
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dia: dias[p.weekday], minutos: (Number(p.hour) % 24) * 60 + Number(p.minute), data: `${p.year}-${p.month}-${p.day}` };
}

const emMinutos = h => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** O expediente da pessoa (ou o da oficina), validado. */
function expedienteDe(p) {
  const e = p?.preferencias?.expediente;
  if (!e || typeof e !== 'object') return EXPEDIENTE_OFICINA;
  const dias = Array.isArray(e.dias) ? e.dias.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : EXPEDIENTE_OFICINA.dias;
  const ini = emMinutos(e.inicio), fim = emMinutos(e.fim);
  if (!dias.length || ini === null || fim === null || fim <= ini) return EXPEDIENTE_OFICINA;
  return { dias, inicio: e.inicio, fim: e.fim };
}

function noExpediente(p, agora = new Date()) {
  const e = expedienteDe(p);
  const r = relogioLocal(agora);
  return e.dias.includes(r.dia) && r.minutos >= emMinutos(e.inicio) && r.minutos < emMinutos(e.fim);
}

/** Pode receber cliente agora (sem olhar o horário)? */
function podeReceber(p, agora = new Date()) {
  if (!p || !p.ativo || p.recebe_leads === false) return false;
  if (!['admin', 'gestor', 'atendente'].includes(p.papel)) return false;
  if (p.papel !== 'admin' && !(p.apps || []).includes('atendimento')) return false;
  const ausente = p.preferencias?.ausente_ate;
  if (ausente && S.dataISO(String(ausente).slice(0, 10)) && String(ausente).slice(0, 10) >= relogioLocal(agora).data) return false;
  return true;
}

/** Pode SER DESTINO de transferência (não precisa estar no rodízio). */
function podeAtender(p) {
  if (!p || !p.ativo) return false;
  if (!['admin', 'gestor', 'atendente'].includes(p.papel)) return false;
  return p.papel === 'admin' || (p.apps || []).includes('atendimento');
}

/**
 * Escolhe quem recebe. `cargas` = { perfilId: conversas abertas }.
 * @returns {{ id, motivo, candidatos }|null}
 */
function escolher(perfis = [], cargas = {}, agora = new Date(), { excluir = [] } = {}) {
  const podem = perfis.filter(p => podeReceber(p, agora) && !excluir.includes(p.id));
  if (!podem.length) return null;
  const noHorario = podem.filter(p => noExpediente(p, agora));
  const base = noHorario.length ? noHorario : podem;
  const ordenado = base.slice().sort((a, b) =>
    (cargas[a.id] || 0) - (cargas[b.id] || 0)
    || String(a.ultimo_lead_em || '').localeCompare(String(b.ultimo_lead_em || ''))   // nunca recebeu ('') vem primeiro
    || String(a.id).localeCompare(String(b.id)));
  const eleito = ordenado[0];
  return { id: eleito.id, nome: eleito.nome || null, carga: cargas[eleito.id] || 0,
    motivo: noHorario.length ? 'menor carga no horário' : 'menor carga (ninguém no horário agora)',
    candidatos: ordenado.map(p => ({ id: p.id, nome: p.nome || null, carga: cargas[p.id] || 0, noHorario: noExpediente(p, agora) })) };
}

const COLS_PERFIL = 'id,nome,papel,ativo,apps,recebe_leads,ultimo_lead_em,preferencias';

function criarRodizio({ sb, auditar = async () => ({ ok: true }), agora = () => new Date(), log = console.error } = {}) {
  const falha = (status, codigo, erro, extra = {}) => ({ ok: false, status, codigo, erro, ...extra });

  async function cargas() {
    const { data, error } = await sb.from('conversas').select('atribuida_a,status').neq('status', 'resolvida').limit(10000);
    if (error) return null;
    const c = {};
    for (const r of data || []) if (r.atribuida_a) c[r.atribuida_a] = (c[r.atribuida_a] || 0) + 1;
    return c;
  }

  async function perfis() {
    const { data, error } = await sb.from('perfis').select(COLS_PERFIL);
    return error ? null : (data || []);
  }

  /** Prévia: quem receberia o próximo cliente e a fila inteira. */
  async function previa() {
    const [ps, cs] = await Promise.all([perfis(), cargas()]);
    if (!ps || !cs) return falha(503, 'banco_fora', 'Não consegui ler a equipe agora.');
    const e = escolher(ps, cs, agora());
    return { ok: true, status: 200, proximo: e ? { id: e.id, nome: e.nome, carga: e.carga, motivo: e.motivo } : null,
      fila: e ? e.candidatos : [], fora: ps.filter(p => !podeReceber(p, agora()) && p.ativo && p.papel !== 'agenda')
        .map(p => ({ id: p.id, nome: p.nome, motivo: p.recebe_leads === false ? 'fora do rodízio'
          : (p.papel !== 'admin' && !(p.apps || []).includes('atendimento')) ? 'sem acesso ao Atendimento' : 'ausente' })) };
  }

  /** Leads em aberto do cliente seguem o novo dono (só sem responsável ou do dono antigo). */
  async function leadAcompanha({ clienteId, de, para }) {
    if (!clienteId || !para) return { movidos: 0 };
    const { data, error } = await sb.from('leads').select('id,responsavel_id,status').eq('cliente_id', clienteId);
    if (error) { log('lead acompanha:', error.message); return { movidos: 0, erro: true }; }
    const alvo = (data || []).filter(l => !STATUS_LEAD_FECHADO.includes(l.status)
      && (l.responsavel_id == null || (de && l.responsavel_id === de)) && l.responsavel_id !== para);
    let movidos = 0;
    for (const l of alvo) {
      let q = sb.from('leads').update({ responsavel_id: para }).eq('id', l.id);
      q = l.responsavel_id == null ? q.is('responsavel_id', null) : q.eq('responsavel_id', l.responsavel_id);   // não atropela quem mudou no meio
      const { data: ok, error: e2 } = await q.select('id');
      if (!e2 && ok?.length) movidos++;
    }
    return { movidos, ids: alvo.map(l => l.id) };
  }

  async function lerConversa(id) {
    if (!S.ehUuid(id)) return { r: falha(400, 'id_invalido', 'Conversa inválida.') };
    const { data, error } = await sb.from('conversas').select('id,nome,telefone,cliente_id,atribuida_a,status,tipo,ultima_mensagem_em,created_at').eq('id', id).maybeSingle();
    if (error) return { r: falha(503, 'banco_fora', 'Não consegui ler a conversa agora.') };
    if (!data) return { r: falha(404, 'nao_encontrada', 'Conversa não encontrada.') };
    return { conversa: data };
  }

  /** Dá dono a uma conversa sem dono pelo rodízio (compara-e-grava: não rouba de quem pegou no meio). */
  async function distribuir(conversaId, quem = null, { motivo = 'rodízio', donoAnterior = null } = {}) {
    const { conversa, r } = await lerConversa(conversaId); if (r) return r;
    if (conversa.atribuida_a) return falha(409, 'ja_tem_dono', 'Esta conversa já tem responsável. Use "transferir".', { atribuida_a: conversa.atribuida_a });
    const [ps, cs] = await Promise.all([perfis(), cargas()]);
    if (!ps || !cs) return falha(503, 'banco_fora', 'Não consegui ler a equipe agora.');
    const e = escolher(ps, cs, agora());
    if (!e) return falha(409, 'ninguem_no_rodizio', 'Ninguém está recebendo clientes agora. Coloque alguém no rodízio em Equipe.');
    const { data, error } = await sb.from('conversas').update({ atribuida_a: e.id }).eq('id', conversaId).is('atribuida_a', null).select('id');
    if (error) return falha(503, 'banco_fora', 'Não consegui gravar o responsável agora.');
    if (!data?.length) return falha(409, 'ja_tem_dono', 'Alguém pegou esta conversa agora mesmo.');
    await sb.from('perfis').update({ ultimo_lead_em: agora().toISOString() }).eq('id', e.id);
    // donoAnterior: quem tinha a conversa antes de ela voltar à fila (ex.: desativado) — o lead dele acompanha
    const lead = await leadAcompanha({ clienteId: conversa.cliente_id, de: donoAnterior, para: e.id });
    await auditar({ perfil: quem?.id || null, acao: 'conversa.distribuir', tabela: 'conversas', registro: conversaId,
      detalhes: { para: e.id, motivo, criterio: e.motivo, carga: e.carga, leads_movidos: lead.movidos } });
    return { ok: true, status: 200, para: { id: e.id, nome: e.nome }, criterio: e.motivo, leads_movidos: lead.movidos };
  }

  /** Transferência com motivo. Atendente só passa a conversa dele (ou sem dono); gestor/admin, qualquer uma. */
  async function transferir(quem, conversaId, { para, motivo } = {}) {
    const m = S.texto(motivo, 200);
    if (m.length < 3) return falha(400, 'motivo', 'Diga o motivo da transferência (pelo menos 3 letras).', { campo: 'motivo' });
    if (!S.ehUuid(para)) return falha(400, 'para', 'Escolha para quem passar.', { campo: 'para' });
    const { conversa, r } = await lerConversa(conversaId); if (r) return r;
    const gestor = ['admin', 'gestor'].includes(quem.papel);
    if (!gestor && conversa.atribuida_a && conversa.atribuida_a !== quem.id) {
      return falha(403, 'nao_e_sua', 'Só quem está com a conversa (ou o gestor) pode passar para outra pessoa.');
    }
    if (conversa.atribuida_a === para) return falha(409, 'mesmo_dono', 'A conversa já está com essa pessoa.');
    const { data: dest, error: e1 } = await sb.from('perfis').select(COLS_PERFIL).eq('id', para).maybeSingle();
    if (e1) return falha(503, 'banco_fora', 'Não consegui ler a equipe agora.');
    if (!podeAtender(dest)) return falha(409, 'destino_invalido', 'Essa pessoa não pode atender (desativada ou sem acesso ao Atendimento).');
    let q = sb.from('conversas').update({ atribuida_a: para }).eq('id', conversaId);
    q = conversa.atribuida_a ? q.eq('atribuida_a', conversa.atribuida_a) : q.is('atribuida_a', null);
    const { data, error } = await q.select('id');
    if (error) return falha(503, 'banco_fora', 'Não consegui transferir agora.');
    if (!data?.length) return falha(409, 'mudou_no_meio', 'Alguém mexeu no responsável desta conversa agora mesmo. Atualize e tente de novo.');
    try { await sb.from('conversa_eventos').insert({ conversa_id: conversaId, tipo: 'transferida' }); } catch { /* evento é extra */ }
    const lead = await leadAcompanha({ clienteId: conversa.cliente_id, de: conversa.atribuida_a, para });
    await auditar({ perfil: quem.id, acao: 'conversa.transferir', tabela: 'conversas', registro: conversaId,
      detalhes: { de: conversa.atribuida_a || null, para, motivo: m, leads_movidos: lead.movidos } });
    return { ok: true, status: 200, de: conversa.atribuida_a || null, para: { id: dest.id, nome: dest.nome || null }, leads_movidos: lead.movidos };
  }

  /** Conversas de atendimento abertas sem dono há mais de X minutos (pela última mensagem),
      dentro dos últimos `dias` (o acúmulo antigo da importação não afoga o que é de hoje). */
  async function semDono({ minutos = 15, limite = 100, dias = 30 } = {}) {
    const corte = new Date(agora().getTime() - minutos * 60_000).toISOString();
    const desde = new Date(agora().getTime() - dias * 86_400_000).toISOString();
    const { data, error } = await sb.from('conversas')
      .select('id,nome,telefone,cliente_id,status,tipo,ultima_mensagem_em,ultima_previa,created_at,aguardando_consultor')
      .is('atribuida_a', null).neq('status', 'resolvida').eq('tipo', 'atendimento')
      .gte('ultima_mensagem_em', desde).lte('ultima_mensagem_em', corte)
      .order('ultima_mensagem_em', { ascending: false }).limit(500);
    if (error) return falha(503, 'banco_fora', 'Não consegui ler as conversas agora.');
    const t = agora().getTime();
    const itens = (data || [])
      .filter(c => (c.tipo || 'atendimento') === 'atendimento')
      .map(c => ({ ...c, desde: c.ultima_mensagem_em || c.created_at }))
      .filter(c => c.desde && c.desde <= corte)
      .map(c => ({ id: c.id, nome: c.nome, telefone: c.telefone, cliente_id: c.cliente_id, status: c.status,
        previa: c.ultima_previa ? String(c.ultima_previa).slice(0, 140) : null, aguardando_consultor: !!c.aguardando_consultor,
        desde: c.desde, espera_min: Math.round((t - Date.parse(c.desde)) / 60000), link: `/?conversa=${c.id}` }))
      .sort((a, b) => b.espera_min - a.espera_min)
      .slice(0, limite);
    return { ok: true, status: 200, minutos, dias, total: itens.length, conversas: itens };
  }

  return { previa, distribuir, transferir, semDono, leadAcompanha, cargas, perfis };
}

module.exports = { criarRodizio, escolher, podeReceber, podeAtender, noExpediente, expedienteDe, relogioLocal, EXPEDIENTE_OFICINA };
