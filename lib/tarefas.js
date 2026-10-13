/* ============================================================
   TAREFAS pelo servidor (o que precisa da chave de serviço)
   - carga da equipe para o gestor: abertas, atrasadas, vencem hoje,
     urgentes e conversas abertas de cada pessoa
   - criar tarefa (também a partir da IA), com validação
   A tela lê/conclui as próprias tarefas direto no banco (RLS).
   ============================================================ */
'use strict';

const S = require('./seguranca.js');
const { relogioLocal } = require('./rodizio.js');

const ORIGENS = ['manual', 'atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ia', 'automacao'];
const ORIGENS_PELA_ROTA = ['atendimento', 'manual', 'ia'];

/** Fim do expediente (17:30 em São Paulo) de hoje, ou do próximo dia útil se já passou. */
function prazoPadrao(agora = new Date()) {
  const r = relogioLocal(agora);
  let dia = r.data, semana = r.dia;
  if (semana === 0 || r.minutos >= 17 * 60) {
    do {
      dia = new Date(Date.parse(`${dia}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      semana = (semana + 1) % 7;
    } while (semana === 0);
  }
  return new Date(`${dia}T17:30:00-03:00`).toISOString();
}

/** Corpo → { dados } ou { erro, campo }. Pura. */
function validarTarefa(b = {}, { agora = new Date(), origem = 'atendimento' } = {}) {
  const titulo = S.texto(b.titulo, 200);
  if (!titulo) return { erro: 'Diga o que precisa ser feito (título).', campo: 'titulo' };
  const dados = { titulo, descricao: S.texto(b.descricao, 2000) || null };
  if (b.responsavel_id !== undefined && b.responsavel_id !== null && b.responsavel_id !== '') {
    if (!S.ehUuid(b.responsavel_id)) return { erro: 'Responsável inválido.', campo: 'responsavel_id' };
    dados.responsavel_id = b.responsavel_id;
  }
  for (const k of ['cliente_id', 'lead_id', 'conversa_id', 'agendamento_id']) {
    if (b[k] === undefined || b[k] === null || b[k] === '') continue;
    if (!S.ehUuid(b[k])) return { erro: `${k} inválido.`, campo: k };
    dados[k] = b[k];
  }
  if (b.prioridade !== undefined) {
    const p = S.inteiro(b.prioridade, { padrao: null });
    if (p === null || p < 1 || p > 3) return { erro: 'Prioridade é 1 (alta), 2 (normal) ou 3 (baixa).', campo: 'prioridade' };
    dados.prioridade = p;
  }
  if (b.vence_em !== undefined && b.vence_em !== null && b.vence_em !== '') {
    let d = S.instante(String(b.vence_em));
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(String(b.vence_em))) d = new Date(`${b.vence_em}T17:30:00-03:00`);   // só o dia = fim do expediente
    if (!d) return { erro: 'Prazo inválido (AAAA-MM-DD ou AAAA-MM-DDTHH:MM).', campo: 'vence_em' };
    if (d.getTime() < agora.getTime() - 86_400_000) return { erro: 'O prazo já passou.', campo: 'vence_em' };
    if (d.getTime() > agora.getTime() + 366 * 86_400_000) return { erro: 'Prazo longe demais (no máximo 1 ano).', campo: 'vence_em' };
    dados.vence_em = d.toISOString();
  }
  dados.origem = ORIGENS.includes(origem) ? origem : 'atendimento';
  return { dados };
}

function criarTarefas({ sb, auditar = async () => ({ ok: true }), agora = () => new Date() } = {}) {
  const falha = (status, codigo, erro, extra = {}) => ({ ok: false, status, codigo, erro, ...extra });

  /** Responsável precisa ser da equipe e ativo. */
  async function responsavelValido(id) {
    const { data, error } = await sb.from('perfis').select('id,nome,ativo,papel').eq('id', id).maybeSingle();
    if (error) return { erro: falha(503, 'banco_fora', 'Não consegui conferir o responsável agora.') };
    if (!data || !data.ativo || !['admin', 'gestor', 'atendente', 'agenda'].includes(data.papel)) {
      return { erro: falha(409, 'responsavel_invalido', 'Essa pessoa não está ativa na equipe.') };
    }
    return { perfil: data };
  }

  async function criar(quem, corpo, { origem } = {}) {
    const o = origem || (ORIGENS_PELA_ROTA.includes(corpo?.origem) ? corpo.origem : 'atendimento');
    const v = validarTarefa(corpo, { agora: agora(), origem: o });
    if (v.erro) return falha(400, 'invalido', v.erro, { campo: v.campo });
    const d = { ...v.dados, criado_por: quem?.id || null, status: 'aberta' };
    if (!d.responsavel_id) d.responsavel_id = quem?.id || null;
    if (d.responsavel_id) { const r = await responsavelValido(d.responsavel_id); if (r.erro) return r.erro; }
    // atendente cria para si; para outra pessoa só gestor/admin — ou a IA, a pedido do atendente (fica auditado)
    if (d.responsavel_id !== quem?.id && !['admin', 'gestor'].includes(quem?.papel) && o !== 'ia') {
      return falha(403, 'so_gestor', 'Só o gestor cria tarefa para outra pessoa. Crie para você ou peça ao gestor.');
    }
    const { data, error } = await sb.from('tarefas').insert(d).select('id,titulo,responsavel_id,vence_em,prioridade,origem,status,conversa_id,cliente_id,lead_id').single();
    if (error) return falha(503, 'banco_fora', 'Não consegui criar a tarefa agora.');
    await auditar({ perfil: quem?.id || null, acao: 'tarefa.criar', tabela: 'tarefas', registro: data.id,
      detalhes: { origem: d.origem, responsavel_id: d.responsavel_id, conversa_id: d.conversa_id || null, vence_em: d.vence_em || null } });
    return { ok: true, status: 201, tarefa: data };
  }

  /** Carga de cada pessoa da equipe (gestor/admin). */
  async function cargaDaEquipe(quem) {
    if (!['admin', 'gestor'].includes(quem?.papel)) return falha(403, 'so_gestor', 'A carga da equipe é do gestor ou do administrador.');
    const [ps, ts, cs] = await Promise.all([
      sb.from('perfis').select('id,nome,papel,ativo,apps,recebe_leads,avatar_cor,cargo').eq('ativo', true).order('nome'),
      sb.from('tarefas').select('id,responsavel_id,vence_em,prioridade').eq('status', 'aberta').limit(10000),
      sb.from('conversas').select('atribuida_a,aguardando_consultor,status').neq('status', 'resolvida').limit(10000),
    ]);
    if (ps.error || ts.error) return falha(503, 'banco_fora', 'Não consegui ler a carga da equipe agora.');
    const t = agora();
    const hoje = relogioLocal(t).data;
    const fimHoje = new Date(Date.parse(`${hoje}T00:00:00-03:00`) + 86_400_000).toISOString();
    const iso = t.toISOString();
    const vazio = () => ({ abertas: 0, atrasadas: 0, vencem_hoje: 0, urgentes: 0, sem_prazo: 0, conversas_abertas: 0, aguardando_consultor: 0 });
    const por = {};
    const de = id => (por[id] = por[id] || vazio());
    let semResponsavel = 0;
    for (const x of ts.data || []) {
      if (!x.responsavel_id) { semResponsavel++; continue; }
      const c = de(x.responsavel_id);
      c.abertas++;
      if (!x.vence_em) c.sem_prazo++;
      else if (x.vence_em < iso) c.atrasadas++;
      else if (x.vence_em < fimHoje) c.vencem_hoje++;
      if (x.prioridade === 1) c.urgentes++;
    }
    for (const c of cs.data || []) {
      if (!c.atribuida_a) continue;
      const k = de(c.atribuida_a);
      k.conversas_abertas++;
      if (c.aguardando_consultor) k.aguardando_consultor++;
    }
    const pessoas = (ps.data || []).filter(p => p.papel !== 'agenda' || por[p.id])
      .map(p => ({ id: p.id, nome: p.nome, papel: p.papel, cargo: p.cargo || null, avatar_cor: p.avatar_cor || null,
        recebe_leads: p.recebe_leads !== false, ...(por[p.id] || vazio()) }))
      // nomes que a tela também lê (perfil_id, tarefas_*)
      .map(p => ({ ...p, perfil_id: p.id, tarefas_abertas: p.abertas, tarefas_atrasadas: p.atrasadas, tarefas_hoje: p.vencem_hoje }))
      .sort((a, b) => (b.atrasadas - a.atrasadas) || (b.abertas - a.abertas) || String(a.nome).localeCompare(String(b.nome)));
    const total = pessoas.reduce((s, p) => ({ abertas: s.abertas + p.abertas, atrasadas: s.atrasadas + p.atrasadas, vencem_hoje: s.vencem_hoje + p.vencem_hoje }),
      { abertas: 0, atrasadas: 0, vencem_hoje: 0 });
    return { ok: true, status: 200, pessoas, equipe: pessoas, total: { ...total, sem_responsavel: semResponsavel }, gerado_em: iso };
  }

  /** Tarefas abertas de uma pessoa (gestor vê de qualquer um; atendente só as dele). */
  async function daPessoa(quem, pessoaId, { status = 'aberta', limite = 100 } = {}) {
    if (!S.ehUuid(pessoaId)) return falha(400, 'id_invalido', 'Pessoa inválida.');
    if (pessoaId !== quem.id && !['admin', 'gestor'].includes(quem.papel)) return falha(403, 'so_gestor', 'Você só vê as suas tarefas.');
    if (!['aberta', 'feita', 'cancelada'].includes(status)) return falha(400, 'status', 'Status inválido.');
    const { data, error } = await sb.from('tarefas')
      .select('id,titulo,descricao,responsavel_id,criado_por,cliente_id,lead_id,conversa_id,agendamento_id,origem,prioridade,vence_em,status,created_at,concluida_em')
      .eq('responsavel_id', pessoaId).eq('status', status).order('vence_em', { ascending: true }).limit(Math.min(200, limite));
    if (error) return falha(503, 'banco_fora', 'Não consegui ler as tarefas agora.');
    const iso = agora().toISOString();
    return { ok: true, status: 200, tarefas: (data || []).map(x => ({ ...x, atrasada: !!(x.vence_em && x.vence_em < iso && x.status === 'aberta') })) };
  }

  return { criar, cargaDaEquipe, daPessoa };
}

module.exports = { criarTarefas, validarTarefa, prazoPadrao, ORIGENS };
