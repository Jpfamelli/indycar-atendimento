/* ============================================================
   Horários LIVRES da oficina — regras puras (sem banco, sem rede).
   Expediente: segunda a sábado, 8h às 17h30, passos de 30 min.
   Um horário está ocupado quando já há tantos agendamentos ativos
   sobrepostos quanto consultores ativos (mínimo 1). Cancelado e
   "não veio" não ocupam. Quando o serviço casa com uma janela de
   `janelas_agendamento`, só valem os horários dentro da janela.
   ============================================================ */
'use strict';

const FUSO = process.env.FUSO_HORARIO || 'America/Sao_Paulo';
const ABRE_MIN = 8 * 60;          // 08:00
const FECHA_MIN = 17 * 60 + 30;   // 17:30 — último início é 17:00
const PASSO_MIN = 30;
const DURACAO_PADRAO_MIN = 60;    // quanto um agendamento ocupa quando não sabemos
const ANTECEDENCIA_MIN = 60;      // hoje: só a partir de daqui a 1 h
const STATUS_QUE_NAO_OCUPAM = new Set(['cancelado', 'nao_veio']);

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DIAS_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Data/hora locais (no fuso da oficina) de um instante. */
function partesLocais(instante, fuso = FUSO) {
  const d = instante instanceof Date ? instante : new Date(instante);
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d);
  const p = Object.fromEntries(f.map(x => [x.type, x.value]));
  const semana = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { dia: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute), semana };
}

/** Dia da semana de uma data AAAA-MM-DD (0 = domingo), sem depender de fuso. */
function diaDaSemana(dia) {
  const [a, m, d] = String(dia).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Soma dias a uma data AAAA-MM-DD. */
function somarDias(dia, n) {
  const [a, m, d] = String(dia).split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

/** "08:30" | "8:30:00" | "8h30" | "8h" → minutos; inválido → null. */
function horaEmMinutos(h) {
  const m = /^\s*(\d{1,2})\s*(?::|h)\s*(\d{2})?(?::\d{2})?\s*$/i.exec(String(h ?? ''))
         || /^\s*(\d{1,2})\s*h?\s*$/i.exec(String(h ?? ''));
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2] || 0);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

const minutosEmHora = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** Data AAAA-MM-DD válida de verdade (30/02 não passa). */
function dataValida(dia) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || ''))) return false;
  const [a, m, d] = dia.split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}

/** "quinta, 10/10 às 9h" / "às 14h30" — como se fala com o cliente. */
function rotuloHorario(dia, hora, { curto = false } = {}) {
  const min = typeof hora === 'number' ? hora : horaEmMinutos(hora);
  const [, m, d] = String(dia).split('-');
  const sem = diaDaSemana(dia);
  const nome = curto ? DIAS_CURTO[sem] : DIAS_SEMANA[sem];
  const h = Math.floor(min / 60), mm = min % 60;
  return `${nome}, ${d}/${m} às ${h}h${mm ? String(mm).padStart(2, '0') : ''}`;
}

/* ---------- janelas por tipo de serviço ---------- */
const PALAVRAS_GENERICAS = new Set(['troca', 'de', 'do', 'da', 'dos', 'das', 'e', 'sistema', 'servico',
  'servicos', 'manutencao', 'carro', 'motor', 'barulhos', 'com', 'para', 'geral', 'revisao']);

function palavrasFortes(t) {
  return semAcento(t).split(/[^a-z0-9]+/).filter(p => p.length >= 4 && !PALAVRAS_GENERICAS.has(p));
}

/** Qual tipo de janela casa com o serviço pedido (ou null = expediente inteiro). */
function tipoDeJanela(servico, janelas = []) {
  const alvo = new Set(palavrasFortes(servico));
  if (!alvo.size) return null;
  let melhor = null, nota = 0;
  const tipos = [...new Set(janelas.map(j => j.tipo_servico).filter(Boolean))];
  for (const tipo of tipos) {
    const ps = palavrasFortes(tipo);
    // "pneu" casa "pneus", "alinhamento" casa "alinhar": mesma raiz de 4+ letras
    const raiz = p => p.slice(0, Math.min(5, p.length - (p.length > 4 ? 1 : 0)));
    const acertos = ps.filter(p => alvo.has(p) || [...alvo].some(a => raiz(a) === raiz(p))).length;
    if (acertos > nota) { melhor = tipo; nota = acertos; }
  }
  return melhor;
}

/** O início (minutos) cabe numa das janelas do tipo, nesse dia da semana? */
function dentroDaJanela(tipo, semana, minutos, janelas = []) {
  const doTipo = janelas.filter(j => j.tipo_servico === tipo);
  if (!doTipo.length) return true;
  const chave = semana === 6 ? 'sabado' : 'seg-sex';
  return doTipo.some(j => {
    if (j.dias !== chave) return false;
    const ini = horaEmMinutos(j.inicio), fim = horaEmMinutos(j.fim);
    return ini !== null && fim !== null && minutos >= ini && minutos <= fim;
  });
}

/* ---------- ocupação ---------- */
function agendamentosAtivos(agendamentos = []) {
  return agendamentos.filter(a => a && a.data && a.hora && !STATUS_QUE_NAO_OCUPAM.has(String(a.status || '')));
}

/** Quantos agendamentos ativos se sobrepõem a [ini, ini+dur) no dia. */
function sobrepostos(lista, dia, ini, dur, { consultorId = null, ignorarId = null } = {}) {
  let total = 0, doConsultor = 0;
  for (const a of lista) {
    if (a.data !== dia || (ignorarId && a.id === ignorarId)) continue;
    const ai = horaEmMinutos(a.hora);
    if (ai === null) continue;
    const af = ai + (Number(a.duracao_min) > 0 ? Number(a.duracao_min) : DURACAO_PADRAO_MIN);
    if (ai < ini + dur && ini < af) {
      total++;
      if (consultorId && a.consultor_id === consultorId) doConsultor++;
    }
  }
  return { total, doConsultor };
}

/**
 * Horários livres dos próximos `dias` dias corridos (domingo pula).
 * @returns {Array<{data:string, hora:string, rotulo:string, periodo:'manhã'|'tarde'}>}
 */
function horariosLivres({
  agora = new Date(), dias = 7, agendamentos = [], capacidade = 1, consultorId = null,
  servico = '', janelas = [], duracaoMin = DURACAO_PADRAO_MIN, limite = 200, fuso = FUSO,
} = {}) {
  const hoje = partesLocais(agora, fuso);
  const ativos = agendamentosAtivos(agendamentos);
  const cap = Math.max(1, Number(capacidade) || 1);
  const tipo = servico ? tipoDeJanela(servico, janelas) : null;
  const dur = Math.max(PASSO_MIN, Number(duracaoMin) || DURACAO_PADRAO_MIN);
  const livres = [];
  for (let i = 0; i < dias && livres.length < limite; i++) {
    const dia = somarDias(hoje.dia, i);
    const semana = diaDaSemana(dia);
    if (semana === 0) continue;                       // domingo fechado
    for (let t = ABRE_MIN; t + PASSO_MIN <= FECHA_MIN; t += PASSO_MIN) {
      if (i === 0 && t < hoje.minutos + ANTECEDENCIA_MIN) continue;
      if (tipo && !dentroDaJanela(tipo, semana, t, janelas)) continue;
      const o = sobrepostos(ativos, dia, t, Math.min(dur, FECHA_MIN - t), { consultorId });
      if (o.total >= cap || o.doConsultor > 0) continue;
      livres.push({ data: dia, hora: minutosEmHora(t), rotulo: rotuloHorario(dia, t),
                    periodo: t < 12 * 60 ? 'manhã' : 'tarde' });
      if (livres.length >= limite) break;
    }
  }
  return livres;
}

/** Duas opções concretas (regra 7): a primeira livre e outra em outro dia — ou outro período. */
function sugerirDois(livres = []) {
  if (!livres.length) return [];
  const a = livres[0];
  const b = livres.find(x => x.data !== a.data && x.periodo !== a.periodo)
         || livres.find(x => x.data !== a.data)
         || livres.find(x => x.periodo !== a.periodo)
         || livres[1];
  return b ? [a, b] : [a];
}

/**
 * Confere um horário pedido: formato, domingo, expediente, passado e ocupação.
 * @returns {{ok:true, data:string, hora:string} | {ok:false, motivo:string}}
 */
function validarHorario({ data, hora, agora = new Date(), agendamentos = [], capacidade = 1,
                          consultorId = null, ignorarId = null, duracaoMin = DURACAO_PADRAO_MIN,
                          diasMax = 60, fuso = FUSO } = {}) {
  if (!dataValida(data)) return { ok: false, motivo: 'Data inválida (use AAAA-MM-DD).' };
  const t = horaEmMinutos(hora);
  if (t === null) return { ok: false, motivo: 'Hora inválida (use HH:MM).' };
  if (t % PASSO_MIN !== 0) return { ok: false, motivo: 'A agenda anda de 30 em 30 minutos (ex.: 9:00, 9:30).' };
  const semana = diaDaSemana(data);
  if (semana === 0) return { ok: false, motivo: 'Domingo a oficina não abre.' };
  if (t < ABRE_MIN || t + PASSO_MIN > FECHA_MIN) {
    return { ok: false, motivo: 'Fora do expediente (segunda a sábado, 8h às 17h30; último início 17h).' };
  }
  const hoje = partesLocais(agora, fuso);
  if (data < hoje.dia || (data === hoje.dia && t <= hoje.minutos)) {
    return { ok: false, motivo: 'Esse horário já passou.' };
  }
  if (data > somarDias(hoje.dia, diasMax)) {
    return { ok: false, motivo: `Longe demais: a agenda aceita até ${diasMax} dias à frente.` };
  }
  const o = sobrepostos(agendamentosAtivos(agendamentos), data, t,
    Math.min(Math.max(PASSO_MIN, Number(duracaoMin) || DURACAO_PADRAO_MIN), FECHA_MIN - t),
    { consultorId, ignorarId });
  const cap = Math.max(1, Number(capacidade) || 1);
  if (o.doConsultor > 0) return { ok: false, motivo: 'Esse consultor já tem cliente nesse horário.' };
  if (o.total >= cap) return { ok: false, motivo: 'Horário ocupado na agenda.' };
  return { ok: true, data, hora: minutosEmHora(t) };
}

module.exports = {
  FUSO, ABRE_MIN, FECHA_MIN, PASSO_MIN, DURACAO_PADRAO_MIN, ANTECEDENCIA_MIN,
  partesLocais, diaDaSemana, somarDias, horaEmMinutos, minutosEmHora, dataValida, rotuloHorario,
  tipoDeJanela, dentroDaJanela, horariosLivres, sugerirDois, validarHorario, semAcento,
};
