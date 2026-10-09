/* Dublê do supabase-js (só o que o copiloto usa), com tabelas em memória.
   Não é teste: é apoio dos testes (o node --test roda e não acha nada). */
'use strict';
const crypto = require('node:crypto');

function criarSbFalso(tabelas = {}, { falhas = {}, rpc = {}, relogio = null } = {}) {
  const db = {};
  for (const [k, v] of Object.entries(tabelas)) db[k] = v.map(x => ({ ...x }));
  const log = [];

  function consulta(tabela) {
    const st = { op: 'select', filtros: [], ordem: [], limite: null, dados: null, retorna: false, unico: null };
    const linhas = () => (db[tabela] = db[tabela] || []);
    const passa = r => st.filtros.every(f => f(r));
    const q = {
      select() { if (st.op !== 'select') st.retorna = true; return q; },
      insert(d) { st.op = 'insert'; st.dados = d; return q; },
      update(d) { st.op = 'update'; st.dados = d; return q; },
      upsert(d) { st.op = 'upsert'; st.dados = d; return q; },
      delete() { st.op = 'delete'; return q; },
      eq(c, v) { st.filtros.push(r => r[c] === v); return q; },
      neq(c, v) { st.filtros.push(r => r[c] !== v); return q; },
      in(c, vs) { st.filtros.push(r => vs.includes(r[c])); return q; },
      gte(c, v) { st.filtros.push(r => r[c] != null && String(r[c]) >= String(v)); return q; },
      gt(c, v) { st.filtros.push(r => r[c] != null && String(r[c]) > String(v)); return q; },
      lte(c, v) { st.filtros.push(r => r[c] != null && String(r[c]) <= String(v)); return q; },
      lt(c, v) { st.filtros.push(r => r[c] != null && String(r[c]) < String(v)); return q; },
      is(c, v) { st.filtros.push(r => (r[c] ?? null) === v); return q; },
      not(c, op, v) { const l = String(v).replace(/[()"]/g, '').split(','); st.filtros.push(r => !l.includes(String(r[c]))); return q; },
      order(c, o = {}) { st.ordem.push([c, o.ascending !== false]); return q; },
      limit(n) { st.limite = n; return q; },
      maybeSingle() { st.unico = 'maybe'; return q; },
      single() { st.unico = 'one'; return q; },
      then(ok, ko) { return Promise.resolve().then(executar).then(ok, ko); },
    };
    function executar() {
      log.push({ tabela, op: st.op, dados: st.dados });
      if (falhas[tabela] && (falhas[tabela].op || 'select') === st.op) return { data: null, error: { message: falhas[tabela].msg || 'falha' } };
      let out;
      if (st.op === 'select') out = linhas().filter(passa);
      else if (st.op === 'insert') {
        const novos = (Array.isArray(st.dados) ? st.dados : [st.dados]).map(d => ({ id: crypto.randomUUID(), created_at: (relogio ? relogio() : new Date()).toISOString(), ...d }));
        if (tabela === 'leads') for (const n of novos) if (!n.cliente_id) n.cliente_id = 'c0000000-0000-4000-8000-00000000000a';
        linhas().push(...novos); out = novos;
      } else if (st.op === 'update') {
        out = linhas().filter(passa);
        for (const r of out) Object.assign(r, Object.fromEntries(Object.entries(st.dados).filter(([, v]) => v !== undefined)));
      } else if (st.op === 'upsert') {
        const d = st.dados; const r = linhas().find(x => x.id === d.id);
        if (r) Object.assign(r, d); else linhas().push({ ...d }); out = [r || d];
      } else if (st.op === 'delete') {
        out = linhas().filter(passa); db[tabela] = linhas().filter(r => !out.includes(r));
      }
      if (st.op === 'select') {
        for (const [c, asc] of [...st.ordem].reverse()) out = out.slice().sort((a, b) => (String(a[c] ?? '') < String(b[c] ?? '') ? -1 : String(a[c] ?? '') > String(b[c] ?? '') ? 1 : 0) * (asc ? 1 : -1));
        if (st.limite != null) out = out.slice(0, st.limite);
      }
      out = out.map(x => ({ ...x }));
      if (st.unico) {
        if (st.unico === 'one' && out.length !== 1) return { data: null, error: { message: 'não achou exatamente uma linha' } };
        return { data: out[0] || null, error: null };
      }
      return { data: (st.op === 'select' || st.retorna) ? out : null, error: null };
    }
    return q;
  }
  return {
    db, log,
    from: t => consulta(t),
    rpc: async (nome, args) => (rpc[nome] ? rpc[nome](args, db) : { data: null, error: { message: 'rpc inexistente' } }),
  };
}

module.exports = { criarSbFalso };
