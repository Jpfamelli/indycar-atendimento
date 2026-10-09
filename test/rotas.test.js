'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const IA = require('../lib/ia-copiloto.js');
const CTX = require('../lib/contexto.js');
const RD = require('../lib/resumo-dia.js');
const { criarRotasIA, variantesComNove } = require('../lib/rotas-ia.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');
const { ID, AGORA, tabelas, criarIAFalsa, usa, fim } = require('./apoio/dados.js');

/* Sobe as rotas do copiloto numa porta livre, com banco e IA de mentira.
   "Authorization: Bearer <papel>" faz o login falso. */
async function subir({ roteiro = [usa(['classificar', { intencao: 'agendar', temperatura: 'quente' }], ['responder', { texto: 'Opa! Quinta 14h ou sexta 10h?' }], ['mover_etapa', { etapa: 'Agendado' }]), fim], semBanco = false, ajustar } = {}) {
  const t = tabelas();
  if (ajustar) ajustar(t);
  const sb = criarSbFalso(t, { relogio: () => AGORA });
  const ia = criarIAFalsa(roteiro);
  const contexto = CTX.criarContexto({ sb, agora: () => AGORA });
  const copiloto = IA.criarCopiloto({ sb, contexto, criarIA: async () => ia, agora: () => AGORA });
  const resumoDoDia = RD.criarResumoDoDia({ sb, criarIA: async () => ia, copiloto, agora: () => AGORA });
  const usos = new Map();
  const tratar = criarRotasIA({
    getSb: () => (semBanco ? null : sb),
    usuarioLogado: async req => {
      const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
      return m ? { id: m[1] === 'admin' ? ID.admin : ID.perfil, papel: m[1] } : null;
    },
    dentroDoLimite: (chave, teto) => { const n = (usos.get(chave) || 0) + 1; usos.set(chave, n); return n <= teto; },
    readBody: req => new Promise(r => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => { try { r(d ? JSON.parse(d) : {}); } catch { r({}); } }); }),
    copiloto, resumoDoDia, contexto,
  });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!(await tratar(req, res, u.pathname, u.searchParams))) { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const chamar = async (metodo, caminho, { papel = 'atendente', corpo, cab = {} } = {}) => {
    const r = await fetch(base + caminho, { method: metodo, body: corpo ? JSON.stringify(corpo) : undefined,
      headers: { ...(papel ? { Authorization: `Bearer ${papel}` } : {}), 'Content-Type': 'application/json', ...cab } });
    let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
    return { status: r.status, j, h: r.headers };
  };
  return { sb, ia, chamar, fechar: () => new Promise(r => server.close(r)) };
}

test('todas as rotas exigem login (401 em JSON)', async () => {
  const s = await subir();
  try {
    for (const [m, c] of [['GET', `/api/ia/contexto/${ID.conversa}`], ['POST', '/api/ia/copiloto'], ['GET', '/api/ia/acoes?conversaId=x'],
      ['POST', `/api/ia/acoes/${ID.lead}/executar`], ['GET', '/api/ia/config'], ['PUT', '/api/ia/config'], ['GET', '/api/ia/uso'],
      ['POST', '/api/ia/resumo-do-dia'], ['GET', '/api/conversa-por-telefone?t=12988887777'], ['GET', '/api/ia/horarios']]) {
      const r = await s.chamar(m, c, { papel: null });
      assert.equal(r.status, 401, `${m} ${c}`);
      assert.equal(r.j.ok, false);
      assert.match(r.j.erro, /login/i);
    }
  } finally { await s.fechar(); }
});

test('GET /api/ia/contexto: ficha da tela com valores e sem as mensagens; 400 id ruim; 404 inexistente', async () => {
  const s = await subir();
  try {
    const r = await s.chamar('GET', `/api/ia/contexto/${ID.conversa}`);
    assert.equal(r.status, 200);
    assert.equal(r.j.ficha.cliente.nome, 'Camila Souza');
    assert.equal(r.j.ficha.orcamentos[0].total, 1234.56);
    assert.equal(r.j.ficha.mensagens, undefined);
    assert.equal(r.j.ficha.horariosSugeridos.length, 2);
    assert.equal(r.h.get('cache-control'), 'no-store');
    assert.equal((await s.chamar('GET', '/api/ia/contexto/abc')).status, 400);
    assert.equal((await s.chamar('GET', '/api/ia/contexto/11111111-1111-4111-8111-000000000000')).status, 404);
  } finally { await s.fechar(); }
});

test('POST /api/ia/copiloto → formato combinado com a tela; executar, recusar, desfazer e histórico', async () => {
  const s = await subir();
  try {
    assert.equal((await s.chamar('POST', '/api/ia/copiloto', { corpo: {} })).status, 400);
    const r = await s.chamar('POST', '/api/ia/copiloto', { corpo: { conversaId: ID.conversa, pedido: 'o que faço?' } });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    for (const k of ['resposta_sugerida', 'acoes', 'resumo', 'intencao', 'temperatura', 'horarios_sugeridos', 'autonomia', 'uso']) assert.ok(k in r.j, k);
    assert.equal(r.j.temperatura, 'quente');
    const a = r.j.acoes[0];
    for (const k of ['id', 'tipo', 'resumo', 'parametros', 'status', 'precisa_clique', 'reversivel']) assert.ok(k in a, k);
    const ex = await s.chamar('POST', `/api/ia/acoes/${a.id}/executar`);
    assert.equal(ex.status, 200, JSON.stringify(ex.j));
    assert.equal(s.sb.db.conversas[0].etapa_id, ID.e4);
    assert.equal((await s.chamar('POST', `/api/ia/acoes/${a.id}/executar`)).status, 409);
    const d = await s.chamar('POST', `/api/ia/acoes/${a.id}/desfazer`);
    assert.equal(d.status, 200);
    assert.equal(s.sb.db.conversas[0].etapa_id, ID.e2);
    const rec = await s.chamar('POST', `/api/ia/acoes/${r.j.resposta_acao_id}/recusar`, { corpo: { motivo: 'prefiro escrever' } });
    assert.equal(rec.status, 200);
    const h = await s.chamar('GET', `/api/ia/acoes?conversaId=${ID.conversa}`);
    assert.equal(h.status, 200);
    assert.deepEqual(h.j.acoes.map(x => x.status).sort(), ['desfeita', 'executada', 'executada', 'recusada'].sort());
    assert.equal((await s.chamar('GET', '/api/ia/acoes?conversaId=nao')).status, 400);
    assert.equal((await s.chamar('POST', '/api/ia/acoes/nao-uuid/executar')).status, 400);
  } finally { await s.fechar(); }
});

test('copiloto: limite por usuário por minuto (20) devolve 429 claro', async () => {
  const s = await subir({ roteiro: [fim] });
  try {
    let ultimo;
    for (let i = 0; i < 21; i++) ultimo = await s.chamar('POST', '/api/ia/copiloto', { corpo: { conversaId: ID.conversa } });
    assert.equal(ultimo.status, 429);
    assert.match(ultimo.j.erro, /Espere um minuto/);
  } finally { await s.fechar(); }
});

test('config: todos leem; só admin muda (403 para atendente); validação 400', async () => {
  const s = await subir();
  try {
    const g = await s.chamar('GET', '/api/ia/config');
    assert.equal(g.status, 200);
    assert.equal(g.j.config.autonomia, 'confirmar');
    assert.equal(g.j.podeEditar, false);
    assert.ok(g.j.modelosPermitidos.includes('claude-sonnet-5-5'));
    assert.equal((await s.chamar('PUT', '/api/ia/config', { corpo: { autonomia: 'sugerir' } })).status, 403);
    assert.equal((await s.chamar('PUT', '/api/ia/config', { papel: 'admin', corpo: { autonomia: 'xyz' } })).status, 400);
    const p = await s.chamar('PUT', '/api/ia/config', { papel: 'admin', corpo: { autonomia: 'sugerir', limite_chamadas_dia: 500 } });
    assert.equal(p.status, 200);
    assert.equal(p.j.config.autonomia, 'sugerir');
    assert.equal(s.sb.db.ia_acoes.find(a => a.tipo === 'config').origem, 'sistema');
  } finally { await s.fechar(); }
});

test('uso do dia conta chamadas, tokens e as minhas', async () => {
  const s = await subir();
  try {
    await s.chamar('POST', '/api/ia/copiloto', { corpo: { conversaId: ID.conversa } });
    const u = await s.chamar('GET', '/api/ia/uso');
    assert.equal(u.status, 200);
    assert.equal(u.j.chamadas, 1);
    assert.equal(u.j.minhas, 1);
    assert.equal(u.j.limite, 2000);
    assert.equal(u.j.restante, 1999);
    assert.ok(u.j.tokensEntrada > 0);
  } finally { await s.fechar(); }
});

test('horários livres: lista e duas sugestões; dias limitados a 30', async () => {
  const s = await subir();
  try {
    const r = await s.chamar('GET', '/api/ia/horarios?servico=troca%20de%20oleo&dias=99');
    assert.equal(r.status, 200);
    assert.ok(r.j.livres.every(h => h.hora <= '11:00'));
    assert.equal(r.j.sugeridos.length, 2);
  } finally { await s.fechar(); }
});

test('resumo do dia: só gestor/admin; lista quem está esperando sem IA e o que a IA separou (ids conferidos)', async () => {
  const s = await subir({ roteiro: [{ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'relatorio_do_dia', input: {
    pediram_orcamento: [{ conversa_id: ID.conversaSemCliente, motivo: 'freio' }, { conversa_id: 'inventada', motivo: 'x' }],
    querem_agendar: [{ conversa_id: ID.conversa, motivo: 'quinta 14h' }], reclamacoes: [], resumo_geral: 'Dia calmo.' } }] }] });
  try {
    assert.equal((await s.chamar('POST', '/api/ia/resumo-do-dia')).status, 403);
    const r = await s.chamar('POST', '/api/ia/resumo-do-dia', { papel: 'gestor' });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.conversas, 2);
    assert.equal(r.j.esperando.length, 2, 'as duas terminam com mensagem do cliente');
    assert.equal(r.j.esperando[0].conversa_id, ID.conversaSemCliente, 'quem espera há mais tempo primeiro');
    assert.equal(r.j.pediram_orcamento.length, 1, 'id inventado pela IA cai fora');
    assert.equal(r.j.querem_agendar[0].nome, 'Camila');
    assert.equal(r.j.resumo_geral, 'Dia calmo.');
    assert.equal(r.j.ia, true);
    const p = s.ia.chamadas[0].params;
    assert.equal(p.tool_choice.type, 'auto'); // os modelos 5.5 recusam ferramenta forçada
    assert.ok(p.tools.some(t => t.name === 'relatorio_do_dia'));
    assert.ok(!p.messages[0].content.includes('R$ 450'), 'sem valores');
    assert.ok(s.sb.db.ia_acoes.some(a => a.tipo === 'resumo_do_dia'));
    const r2 = await s.chamar('POST', '/api/ia/resumo-do-dia', { papel: 'admin' });
    assert.equal(r2.j.doCache, true, 'segundo pedido em 3 min sai do cache');
  } finally { await s.fechar(); }
});

test('resumo do dia com IA fora do ar ainda mostra quem está esperando', async () => {
  const s = await subir({ roteiro: [new Error('timeout')] });
  try {
    const r = await s.chamar('POST', '/api/ia/resumo-do-dia', { papel: 'admin' });
    assert.equal(r.status, 200);
    assert.equal(r.j.esperando.length, 2);
    assert.match(r.j.aviso, /não respondeu/);
  } finally { await s.fechar(); }
});

test('conversa-por-telefone: acha com/sem 55, com máscara e sem o 9; 400 inválido; 404 sem conversa', async () => {
  const s = await subir();
  try {
    for (const t of ['12988887777', '+55 (12) 98888-7777', '5512988887777', '1288887777']) {
      const r = await s.chamar('GET', `/api/conversa-por-telefone?t=${encodeURIComponent(t)}`);
      assert.equal(r.status, 200, t);
      assert.equal(r.j.conversaId, ID.conversa);
      assert.equal(r.j.link, `/?conversa=${ID.conversa}`);
    }
    assert.equal((await s.chamar('GET', '/api/conversa-por-telefone?t=123')).status, 400);
    const n = await s.chamar('GET', '/api/conversa-por-telefone?t=11911112222');
    assert.equal(n.status, 404);
    assert.equal(n.j.conversaId, null);
  } finally { await s.fechar(); }
});

test('CORS só para os apps do ecossistema; pré-voo OPTIONS', async () => {
  const s = await subir();
  try {
    const ok = await s.chamar('GET', '/api/conversa-por-telefone?t=12988887777', { cab: { Origin: 'https://indycar-crm.onrender.com' } });
    assert.equal(ok.h.get('access-control-allow-origin'), 'https://indycar-crm.onrender.com');
    const nao = await s.chamar('GET', '/api/conversa-por-telefone?t=12988887777', { cab: { Origin: 'https://site-estranho.com' } });
    assert.equal(nao.h.get('access-control-allow-origin'), null);
    const pre = await s.chamar('OPTIONS', '/api/conversa-por-telefone', { papel: null, cab: { Origin: 'https://indycar-agendamentos.onrender.com' } });
    assert.equal(pre.status, 204);
    assert.match(pre.h.get('access-control-allow-headers'), /Authorization/);
    assert.equal((await s.chamar('OPTIONS', '/api/ia/copiloto', { papel: null, cab: { Origin: 'https://mal.com' } })).status, 403);
  } finally { await s.fechar(); }
});

test('sem a chave de serviço: 503 com mensagem clara (não 500)', async () => {
  const s = await subir({ semBanco: true });
  try {
    const r = await s.chamar('POST', '/api/ia/copiloto', { corpo: { conversaId: ID.conversa } });
    assert.equal(r.status, 503);
    assert.match(r.j.erro, /SUPABASE_SERVICE_ROLE_KEY/);
  } finally { await s.fechar(); }
});

test('rota fora do copiloto não é tratada aqui (devolve false)', async () => {
  const s = await subir();
  try { assert.equal((await s.chamar('GET', '/api/ia/sugerir')).status, 404); }
  finally { await s.fechar(); }
});

test('variantesComNove cobre o 9º dígito', () => {
  const v = variantesComNove('1288887777');
  assert.ok(v.includes('12988887777') && v.includes('5512988887777') && v.includes('1288887777'));
  assert.ok(variantesComNove('12988887777').includes('1288887777'));
  assert.deepEqual(variantesComNove(''), []);
});
