/* ============================================================
   AUTOMAÇÕES DO SERVIDOR (rodam a cada 5 min, só na nuvem ou com
   AUTOMACOES=1 — nunca sozinhas numa máquina de teste)
   1) Cliente esperando > 30 min (última mensagem é DELE) no horário
      da oficina → notificação para gestores/admin e para o dono da
      conversa. Uma por mensagem esperando (chave única no banco).
   2) Resumo do fim do dia (seg–sáb, depois das 17:40) → notificação
      para gestores/admin. Uma por dia.
   3) Dono inválido: conversa nova que caiu com alguém que não pode
      atender (papel agenda, sem o app, desativado) volta ao rodízio.
   4) Limpeza diária (depois das 3h): notificações lidas há 60+ dias,
      eventos do CodeWords com 120+ dias (as cópias de segurança de
      exclusão NUNCA saem) e rascunhos da IA nunca usados há 30+ dias.
   Ninguém recebe WhatsApp por aqui. Respeita as preferências de
   notificação (preferencias.notificacoes.espera / .resumo_dia).
   ============================================================ */
'use strict';

const R = require('./rodizio.js');
const TAR = require('./tarefas.js');

const ESPERA_MIN = 30;
/* follow-up (rodada 5): a loja respondeu e o cliente sumiu entre 24 h e 72 h; até 30 tarefas por ciclo */
const FOLLOWUP = { depoisDeH: 24, ateH: 72, porCiclo: 30 };
const JANELA_ESPERA_H = 8;
const HORA_RESUMO_MIN = 17 * 60 + 40;
const HORA_LIMPEZA_MIN = 3 * 60;
const DIAS = { notificacoesLidas: 60, eventosCodewords: 120, rascunhosIA: 30 };

function criarAutomacoes({ sb, rodizio = null, auditar = async () => ({ ok: true }), agora = () => new Date(), log = console.error,
  esperaMin = ESPERA_MIN } = {}) {
  const feito = { resumo: null, limpeza: null };       // dia (AAAA-MM-DD) em que já rodou
  let rodando = false;

  const iso = ms => new Date(ms).toISOString();
  const inicioDoDiaLocal = dia => `${dia}T00:00:00-03:00`;

  async function gestores(chavePref) {
    const { data, error } = await sb.from('perfis').select('id,nome,papel,ativo,apps,preferencias').eq('ativo', true);
    if (error) return [];
    return (data || []).filter(p => ['admin', 'gestor'].includes(p.papel)
      && (p.papel === 'admin' || (p.apps || []).includes('atendimento'))
      && p.preferencias?.notificacoes?.[chavePref] !== false);
  }

  async function notificar(perfil, tipo, titulo, corpo, link, chave) {
    const { data, error } = await sb.rpc('notificar', { p_perfil: perfil, p_tipo: tipo, p_titulo: titulo,
      p_corpo: corpo || null, p_link: link || null, p_app: 'atendimento', p_chave: chave });
    if (error) { log('notificar:', error.message); return false; }
    return !!data;                                  // null = já existia (chave repetida) ou pessoa inativa
  }

  /* ---------- 1) cliente esperando ---------- */
  async function alertarEspera() {
    const t = agora();
    if (!R.noExpediente(null, t)) return { pulou: 'fora do expediente' };
    const corte = iso(t.getTime() - esperaMin * 60_000);
    const desde = iso(t.getTime() - JANELA_ESPERA_H * 3600_000);
    const { data: convs, error } = await sb.from('conversas')
      .select('id,nome,telefone,atribuida_a,status,tipo,ultima_mensagem_em,ultima_previa')
      .neq('status', 'resolvida').gte('ultima_mensagem_em', desde).lte('ultima_mensagem_em', corte)
      .order('ultima_mensagem_em', { ascending: true }).limit(80);
    if (error) return { erro: 'conversas' };
    const alvo = (convs || []).filter(c => (c.tipo || 'atendimento') === 'atendimento');
    if (!alvo.length) return { esperando: 0, avisos: 0 };
    const { data: msgs, error: e2 } = await sb.from('whatsapp_mensagens').select('conversa_id,direcao,corpo,created_at')
      .in('conversa_id', alvo.map(c => c.id)).gte('created_at', desde).order('created_at', { ascending: false }).limit(3000);
    if (e2) return { erro: 'mensagens' };
    const ultima = {};
    for (const m of msgs || []) {
      if (/^\s*\[sistema\]/i.test(String(m.corpo || ''))) continue;
      if (!ultima[m.conversa_id]) ultima[m.conversa_id] = m;
    }
    const esperando = alvo.filter(c => ultima[c.id]?.direcao === 'entrada' && ultima[c.id].created_at <= corte);
    if (!esperando.length) return { esperando: 0, avisos: 0 };
    const gs = await gestores('espera');
    let avisos = 0;
    for (const c of esperando) {
      const m = ultima[c.id];
      const min = Math.round((t.getTime() - Date.parse(m.created_at)) / 60000);
      const nome = (c.nome && String(c.nome).trim()) || c.telefone || 'Cliente';
      const titulo = `${nome} espera resposta há ${min} min`;
      const corpo = String(m.corpo || c.ultima_previa || '').slice(0, 140) || null;
      const chave = `espera:${c.id}:${m.created_at}`;
      const destinos = new Set(gs.map(g => g.id));
      if (c.atribuida_a) destinos.add(c.atribuida_a);
      for (const id of destinos) if (await notificar(id, 'espera', titulo, corpo, `/?conversa=${c.id}`, chave)) avisos++;
    }
    return { esperando: esperando.length, avisos };
  }

  /* ---------- 2) resumo do fim do dia ---------- */
  async function contar(tabela, ajustar) {
    const { count, error } = await ajustar(sb.from(tabela).select('id', { count: 'exact', head: true }));
    return error ? null : (count ?? 0);
  }

  async function numerosDoDia(dia) {
    const ini = inicioDoDiaLocal(dia);
    const agoraIso = agora().toISOString();
    const trintaDias = iso(agora().getTime() - 30 * 86_400_000);
    const [novas, entradas, saidas, semDono, aguardando, atrasadas, feitas, agendados] = await Promise.all([
      contar('conversas', q => q.gte('created_at', ini)),
      contar('whatsapp_mensagens', q => q.eq('direcao', 'entrada').gte('created_at', ini)),
      contar('whatsapp_mensagens', q => q.eq('direcao', 'saida').gte('created_at', ini)),
      // pendências contam só atendimento dos últimos 30 dias (o acúmulo antigo da importação não é pendência de hoje)
      contar('conversas', q => q.is('atribuida_a', null).neq('status', 'resolvida').eq('tipo', 'atendimento').gte('ultima_mensagem_em', trintaDias)),
      contar('conversas', q => q.eq('aguardando_consultor', true).neq('status', 'resolvida').gte('ultima_mensagem_em', trintaDias)),
      contar('tarefas', q => q.eq('status', 'aberta').lt('vence_em', agoraIso)),
      contar('tarefas', q => q.eq('status', 'feita').gte('concluida_em', ini)),
      contar('agendamentos', q => q.gte('created_at', ini)),
    ]);
    return { novas, entradas, saidas, semDono, aguardando, atrasadas, feitas, agendados };
  }

  function textoDoResumo(n) {
    const partes = [];
    const p = (v, um, varios) => (v === null ? null : `${v} ${v === 1 ? um : varios}`);
    partes.push(p(n.novas, 'conversa nova', 'conversas novas'));
    partes.push(p(n.entradas, 'mensagem de cliente', 'mensagens de clientes'));
    partes.push(p(n.saidas, 'resposta enviada', 'respostas enviadas'));
    partes.push(p(n.agendados, 'agendamento criado', 'agendamentos criados'));
    partes.push(p(n.feitas, 'tarefa feita', 'tarefas feitas'));
    const pend = [];
    if (n.semDono) pend.push(p(n.semDono, 'conversa sem dono', 'conversas sem dono'));
    if (n.aguardando) pend.push(p(n.aguardando, 'esperando consultor', 'esperando consultor'));
    if (n.atrasadas) pend.push(p(n.atrasadas, 'tarefa atrasada', 'tarefas atrasadas'));
    return partes.filter(Boolean).join(' · ') + (pend.length ? `\nPendências: ${pend.join(' · ')}` : '\nSem pendências. 🏁');
  }

  async function resumoDoDia({ forcar = false } = {}) {
    const r = R.relogioLocal(agora());
    if (!forcar) {
      if (r.dia === 0) return { pulou: 'domingo' };
      if (r.minutos < HORA_RESUMO_MIN) return { pulou: 'antes das 17:40' };
      if (feito.resumo === r.data) return { pulou: 'já enviado hoje' };
    }
    const n = await numerosDoDia(r.data);
    const corpo = textoDoResumo(n).slice(0, 400);
    const gs = await gestores('resumo_dia');
    let avisos = 0;
    const [ano, mes, dia] = r.data.split('-');
    for (const g of gs) {
      if (await notificar(g.id, 'resumo', `Resumo do dia — ${dia}/${mes}`, corpo, '/?aba=relatorios', `resumo-dia:${ano}${mes}${dia}`)) avisos++;
    }
    feito.resumo = r.data;
    return { avisos, numeros: n };
  }

  /* ---------- 3) dono inválido ---------- */
  async function corrigirDonos() {
    if (!rodizio) return { pulou: 'sem rodízio' };
    const desde = iso(agora().getTime() - 60 * 60_000);
    const { data: convs, error } = await sb.from('conversas').select('id,atribuida_a,cliente_id,status,created_at')
      .gte('created_at', desde).neq('status', 'resolvida').limit(200);
    if (error) return { erro: 'conversas' };
    const comDono = (convs || []).filter(c => c.atribuida_a);
    if (!comDono.length) return { corrigidas: 0 };
    const ps = await rodizio.perfis();
    if (!ps) return { erro: 'perfis' };
    const porId = Object.fromEntries(ps.map(p => [p.id, p]));
    let corrigidas = 0;
    for (const c of comDono) {
      const dono = porId[c.atribuida_a];
      if (R.podeAtender(dono)) continue;
      const cs = await rodizio.cargas();
      const e = R.escolher(ps, cs || {}, agora(), { excluir: [c.atribuida_a] });
      if (!e) continue;
      const { data, error: e2 } = await sb.from('conversas').update({ atribuida_a: e.id }).eq('id', c.id).eq('atribuida_a', c.atribuida_a).select('id');
      if (e2 || !data?.length) continue;
      await rodizio.leadAcompanha({ clienteId: c.cliente_id, de: c.atribuida_a, para: e.id });
      await auditar({ perfil: null, acao: 'conversa.redistribuir', tabela: 'conversas', registro: c.id,
        detalhes: { de: c.atribuida_a, para: e.id, motivo: 'dono sem acesso ao Atendimento', criterio: e.motivo } });
      corrigidas++;
    }
    return { corrigidas };
  }

  /* ---------- 4) limpeza ---------- */
  async function apagar(tabela, ajustar) {
    const { data, error } = await ajustar(sb.from(tabela).delete()).select('id');
    if (error) { log(`limpeza ${tabela}:`, error.message); return null; }
    return (data || []).length;
  }

  async function limpar({ forcar = false } = {}) {
    const r = R.relogioLocal(agora());
    if (!forcar) {
      if (r.minutos < HORA_LIMPEZA_MIN) return { pulou: 'antes das 3h' };
      if (feito.limpeza === r.data) return { pulou: 'já limpou hoje' };
    }
    const t = agora().getTime();
    const antes = d => iso(t - d * 86_400_000);
    const notificacoes = await apagar('notificacoes', q => q.not('lida_em', 'is', null).lt('lida_em', antes(DIAS.notificacoesLidas)));
    // cópias de segurança de exclusão ("conversa excluída por…", "… apagada(s) por…") ficam para sempre
    const eventos = await apagar('codewords_eventos', q => q.lt('created_at', antes(DIAS.eventosCodewords))
      .not('resumo', 'ilike', '%excluída por%').not('resumo', 'ilike', '%apagada(s) por%'));
    const rascunhos = await apagar('ia_acoes', q => q.eq('tipo', 'responder').eq('status', 'proposta').lt('created_at', antes(DIAS.rascunhosIA)));
    feito.limpeza = r.data;
    const res = { notificacoes, eventos, rascunhos };
    if ([notificacoes, eventos, rascunhos].some(n => n)) {
      await auditar({ perfil: null, acao: 'automacao.limpeza', tabela: null, registro: r.data, detalhes: { ...res, dias: DIAS } });
    }
    return res;
  }

  /* ---------- 5) follow-up: o cliente sumiu (rodada 5) ----------
     A loja respondeu e o cliente não voltou em 24 h (até 3 dias): tarefa "Dar um retorno
     para <nome>" para o dono da conversa (ou sem dono, para quem pegar), origem automacao,
     vence no fim do expediente. Uma por conversa por semana; quem já tem horário marcado,
     fechou ou está resolvido não entra. */
  async function followUp24h() {
    const t = agora();
    const de = iso(t.getTime() - FOLLOWUP.ateH * 3600_000), ate = iso(t.getTime() - FOLLOWUP.depoisDeH * 3600_000);
    const { data: convs, error } = await sb.from('conversas')
      .select('id,nome,telefone,atribuida_a,cliente_id,status,tipo,desfecho,ultima_mensagem_em,ultima_previa')
      .neq('status', 'resolvida').gte('ultima_mensagem_em', de).lte('ultima_mensagem_em', ate)
      .order('ultima_mensagem_em', { ascending: true }).limit(100);
    if (error) return { erro: 'conversas' };
    const alvo = (convs || []).filter(c => (c.tipo || 'atendimento') === 'atendimento' && !c.desfecho);
    if (!alvo.length) return { candidatas: 0, tarefas: 0 };
    const { data: msgs, error: e2 } = await sb.from('whatsapp_mensagens').select('conversa_id,direcao,corpo,created_at')
      .in('conversa_id', alvo.map(c => c.id)).gte('created_at', de).order('created_at', { ascending: false }).limit(3000);
    if (e2) return { erro: 'mensagens' };
    const ultima = {};
    for (const m of msgs || []) {
      if (/^\s*\[sistema\]/i.test(String(m.corpo || ''))) continue;
      if (!ultima[m.conversa_id]) ultima[m.conversa_id] = m;
    }
    const sumiram = alvo.filter(c => ultima[c.id]?.direcao === 'saida');
    if (!sumiram.length) return { candidatas: alvo.length, tarefas: 0 };
    const hoje = R.relogioLocal(t).data;
    const [{ data: tarefasAbertas }, { data: ags }] = await Promise.all([
      sb.from('tarefas').select('conversa_id,status,created_at,origem').in('conversa_id', sumiram.map(c => c.id))
        .gte('created_at', iso(t.getTime() - 7 * 86_400_000)).limit(500),
      sb.from('agendamentos').select('cliente_id,status,data').in('cliente_id', sumiram.map(c => c.cliente_id).filter(Boolean))
        .gte('data', hoje).limit(500),
    ]);
    const jaTem = new Set((tarefasAbertas || []).filter(x => x.origem === 'automacao' || x.status === 'aberta').map(x => x.conversa_id));
    const comHorario = new Set((ags || []).filter(a => ['aguardando', 'confirmado', 'compareceu', 'em_atendimento'].includes(a.status)).map(a => a.cliente_id));
    let criadas = 0;
    for (const c of sumiram.slice(0, FOLLOWUP.porCiclo)) {
      if (jaTem.has(c.id) || (c.cliente_id && comHorario.has(c.cliente_id))) continue;
      const nome = (c.nome && String(c.nome).trim()) || c.telefone || 'Cliente';
      const horas = Math.round((t.getTime() - Date.parse(ultima[c.id].created_at)) / 3600_000);
      const { error: e3 } = await sb.from('tarefas').insert({
        titulo: `Dar um retorno para ${nome}`.slice(0, 200),
        descricao: `Respondemos há ${horas} h e o cliente não voltou. Última mensagem nossa: “${String(ultima[c.id].corpo || c.ultima_previa || '').slice(0, 160)}”`,
        responsavel_id: c.atribuida_a || null, conversa_id: c.id, cliente_id: c.cliente_id || null,
        origem: 'automacao', prioridade: 2, vence_em: TAR.prazoPadrao(t), status: 'aberta',
      });
      if (!e3) criadas++;
    }
    return { candidatas: sumiram.length, tarefas: criadas };
  }

  /* ---------- o ciclo ---------- */
  async function ciclo() {
    if (rodando) return { pulou: 'já rodando' };
    rodando = true;
    const out = {};
    try {
      for (const [nome, fn] of [['espera', alertarEspera], ['donos', corrigirDonos], ['followup', followUp24h], ['resumo', resumoDoDia], ['limpeza', limpar]]) {
        try { out[nome] = await fn(); }
        catch (e) { out[nome] = { erro: 'falhou' }; log(`automação ${nome}:`, e.message); }
      }
    } finally { rodando = false; }
    return out;
  }

  let relogio = null;
  function ligar({ intervaloMs = 5 * 60_000, atrasoMs = 60_000 } = {}) {
    if (relogio) return false;
    const rodar = () => ciclo().catch(e => log('automações:', e.message));
    const primeiro = setTimeout(rodar, atrasoMs);
    relogio = setInterval(rodar, intervaloMs);
    primeiro.unref?.(); relogio.unref?.();
    return true;
  }
  function desligar() { if (relogio) clearInterval(relogio); relogio = null; }

  return { ciclo, alertarEspera, resumoDoDia, corrigirDonos, followUp24h, limpar, numerosDoDia, textoDoResumo, ligar, desligar, _feito: feito };
}

module.exports = { criarAutomacoes, ESPERA_MIN, DIAS, FOLLOWUP };
