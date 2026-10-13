/* ============================================================
   AUDITORIA — registrar ações do servidor, consultar e exportar
   - registrar(): rpc registrar_auditoria (só service role), sem
     nenhum segredo nos detalhes (semSegredos).
   - consultar(): filtros (pessoa, tabela, ação, app, período) e
     paginação; devolve também o nome de quem fez.
   - csv(): ; como separador (Excel em pt-BR), BOM, proteção contra
     fórmula ("=", "+", "-", "@" no começo viram texto).
   ============================================================ */
'use strict';

const S = require('./seguranca.js');

const APP = 'atendimento';
const POR_PAGINA_PADRAO = 50;
const POR_PAGINA_MAX = 200;
const MAX_EXPORTAR = 5000;

function criarAuditoria({ sb, log = console.error } = {}) {
  /** Grava uma linha. Nunca lança; devolve { ok, id }. */
  async function registrar({ perfil = null, acao, tabela = null, registro = null, detalhes = null, app = APP } = {}) {
    if (!sb || !acao) return { ok: false };
    try {
      const { data, error } = await sb.rpc('registrar_auditoria', {
        p_perfil: perfil || null, p_app: app, p_acao: String(acao).slice(0, 80),
        p_tabela: tabela, p_registro: registro == null ? null : String(registro).slice(0, 80),
        p_detalhes: detalhes ? S.semSegredos(detalhes) : null,
      });
      if (error) { log('auditoria:', error.message); return { ok: false }; }
      return { ok: true, id: data };
    } catch (e) { log('auditoria:', e.message); return { ok: false }; }
  }

  /** Normaliza os filtros vindos da URL. Devolve { filtros } ou { erro }. */
  function lerFiltros(p) {
    const get = k => (p && typeof p.get === 'function' ? p.get(k) : p?.[k]) ?? '';
    const f = {};
    const pessoa = get('pessoa') || get('perfil');
    if (pessoa) { if (!S.ehUuid(pessoa)) return { erro: 'Pessoa inválida.' }; f.pessoa = pessoa; }
    const tabela = S.texto(get('tabela'), 60);
    if (tabela) { if (!/^[a-z_][a-z0-9_]*$/.test(tabela)) return { erro: 'Tabela inválida.' }; f.tabela = tabela; }
    const acao = S.texto(get('acao'), 80);
    if (acao) { if (!/^[a-z0-9_.:-]+$/i.test(acao)) return { erro: 'Ação inválida.' }; f.acao = acao.toLowerCase(); }
    const app = S.texto(get('app'), 30);
    if (app) { if (!/^[a-z_]+$/.test(app)) return { erro: 'App inválido.' }; f.app = app; }
    const de = get('de'), ate = get('ate');
    if (de) { if (!S.dataISO(de)) return { erro: 'Data inicial inválida (AAAA-MM-DD).' }; f.de = de; }
    if (ate) { if (!S.dataISO(ate)) return { erro: 'Data final inválida (AAAA-MM-DD).' }; f.ate = ate; }
    if (f.de && f.ate && f.de > f.ate) [f.de, f.ate] = [f.ate, f.de];
    f.pagina = S.inteiro(get('pagina'), { min: 1, max: 100000, padrao: 1 });
    f.por_pagina = S.inteiro(get('por_pagina'), { min: 1, max: POR_PAGINA_MAX, padrao: POR_PAGINA_PADRAO });
    return { filtros: f };
  }

  /* Meia-noite em São Paulo (sem horário de verão: -03:00). */
  const inicioDoDia = d => `${d}T00:00:00-03:00`;
  const fimDoDia = d => new Date(Date.parse(`${d}T00:00:00-03:00`) + 86_400_000).toISOString();

  function montar(q, f) {
    if (f.pessoa) q = q.eq('perfil_id', f.pessoa);
    if (f.tabela) q = q.eq('tabela', f.tabela);
    if (f.app) q = q.eq('app', f.app);
    // ação: exata ou prefixo ("equipe" acha equipe.convidar, equipe.desativar…)
    if (f.acao) q = q.ilike('acao', `${f.acao.replace(/[%_]/g, '\\$&')}%`);
    if (f.de) q = q.gte('created_at', inicioDoDia(f.de));
    if (f.ate) q = q.lt('created_at', fimDoDia(f.ate));
    return q;
  }

  async function nomes(ids) {
    const unicos = [...new Set(ids.filter(Boolean))];
    if (!unicos.length) return {};
    const { data } = await sb.from('perfis').select('id,nome,email').in('id', unicos);
    return Object.fromEntries((data || []).map(p => [p.id, p.nome || p.email || 'sem nome']));
  }

  async function consultar(filtros) {
    const f = filtros;
    const ini = (f.pagina - 1) * f.por_pagina;
    const q = montar(sb.from('auditoria')
      .select('id,perfil_id,app,acao,tabela,registro_id,campos,antes,depois,detalhes,created_at', { count: 'exact' }), f)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(ini, ini + f.por_pagina - 1);
    const { data, error, count } = await q;
    if (error) return { ok: false, status: 503, erro: 'Não consegui ler a auditoria agora.' };
    const mapa = await nomes((data || []).map(r => r.perfil_id));
    const total = Number.isFinite(count) ? count : (data || []).length;
    return {
      ok: true, pagina: f.pagina, por_pagina: f.por_pagina, total, paginas: Math.max(1, Math.ceil(total / f.por_pagina)),
      itens: (data || []).map(r => ({ ...r, antes: S.semSegredos(r.antes), depois: S.semSegredos(r.depois),
        detalhes: S.semSegredos(r.detalhes), pessoa: r.perfil_id ? (mapa[r.perfil_id] || 'pessoa removida') : 'sistema',
        perfil_nome: r.perfil_id ? (mapa[r.perfil_id] || null) : null })),
    };
  }

  async function paraExportar(filtros) {
    const { data, error } = await montar(sb.from('auditoria')
      .select('id,perfil_id,app,acao,tabela,registro_id,campos,detalhes,created_at'), filtros)
      .order('created_at', { ascending: false }).limit(MAX_EXPORTAR);
    if (error) return { ok: false, status: 503, erro: 'Não consegui ler a auditoria agora.' };
    const mapa = await nomes((data || []).map(r => r.perfil_id));
    return { ok: true, itens: (data || []).map(r => ({ ...r, detalhes: S.semSegredos(r.detalhes),
      pessoa: r.perfil_id ? (mapa[r.perfil_id] || 'pessoa removida') : 'sistema' })), limite: MAX_EXPORTAR };
  }

  return { registrar, lerFiltros, consultar, paraExportar };
}

/** Uma célula de CSV segura. */
function celula(v) {
  let s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;                    // CSV injection: vira texto no Excel
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Data/hora de São Paulo legível: 13/10/2026 14:05. */
function quando(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function csv(itens = []) {
  const cab = ['quando', 'pessoa', 'app', 'acao', 'tabela', 'registro', 'campos', 'detalhes'];
  const linhas = itens.map(r => [quando(r.created_at), r.pessoa, r.app, r.acao, r.tabela, r.registro_id,
    Array.isArray(r.campos) ? r.campos.join(', ') : r.campos, r.detalhes].map(celula).join(';'));
  return '﻿' + [cab.join(';'), ...linhas].join('\r\n') + '\r\n';
}

module.exports = { criarAuditoria, csv, celula, quando, MAX_EXPORTAR, POR_PAGINA_MAX };
