'use strict';
/* Sobe o server.js de verdade numa porta livre (sem sincronia, sem rede):
   confere que as rotas novas estão plugadas, exigem login e que o painel
   do copiloto é servido. Nenhuma chamada sai para o Supabase ou a IA. */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SO_FUNCOES = '1';
const app = require('../server.js');

test('server.js: rotas do copiloto plugadas, todas com login; painel servido; 404 em JSON', async () => {
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    for (const [m, c] of [['POST', '/api/ia/copiloto'], ['GET', '/api/ia/contexto/11111111-1111-4111-8111-111111111111'],
      ['GET', '/api/ia/uso'], ['GET', '/api/ia/config'], ['PUT', '/api/ia/config'], ['POST', '/api/ia/resumo-do-dia'],
      ['GET', '/api/conversa-por-telefone?t=12988887777'], ['POST', '/api/ia/sugerir'], ['POST', '/api/ia/classificar'],
      ['GET', '/api/ia/horarios']]) {
      const r = await fetch(base + c, { method: m, body: m === 'GET' ? undefined : '{}' });
      assert.equal(r.status, 401, `${m} ${c}`);
      assert.match(r.headers.get('content-type'), /json/);
    }
    const js = await fetch(base + '/copiloto.js');
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.match(await js.text(), /indycar:conversa/);
    const css = await fetch(base + '/copiloto.css');
    assert.match(css.headers.get('content-type'), /css/);
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /<link rel="stylesheet" href="copiloto.css"/);
    assert.match(html, /<script src="copiloto.js" defer><\/script>/);
    const n = await fetch(base + '/api/ia/nao-existe');
    assert.equal(n.status, 404);
    assert.deepEqual(await n.json(), { erro: 'rota não encontrada' });
    const env = await fetch(base + '/api/enviar', { method: 'POST', body: '{}' });
    assert.equal(env.status, 401);
  } finally { await new Promise(r => app.server.close(r)); }
});

test('server.js exporta o que os scripts de conferência usam', () => {
  for (const k of ['copiloto', 'criarClienteIA', 'sugerirResposta', 'montarRelatorio', 'PERSONA', 'fichaDoCliente', 'lerSaude']) assert.ok(app[k], k);
  assert.match(app.PERSONA, /Quem conhece, Indyca!/);
});

/* ---------------- rodada 3: segurança do servidor de verdade ---------------- */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

async function comServidor(fn) {
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try { await fn(base); } finally { app.LIMITE.zerar(); app.ACESSO.limparCache(); await new Promise(r => app.server.close(r)); }
}
const jwtVencido = () => `x.${Buffer.from(JSON.stringify({ sub: '11111111-1111-4111-8111-111111111111', exp: 1000 })).toString('base64url')}.y`;

test('server.js: cabeçalhos de segurança, CSP com o hash do <script> embutido e cache certo', async () => {
  await comServidor(async base => {
    const r = await fetch(base + '/');
    assert.equal(r.status, 200);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /frame-ancestors 'none'/);
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const inline = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (inline) assert.ok(csp.includes(`'sha256-${crypto.createHash('sha256').update(inline[1]).digest('base64')}'`), 'hash do script do tema');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('referrer-policy'), /strict-origin/);
    assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
    assert.equal(r.headers.get('strict-transport-security'), null, 'HSTS só na nuvem (https)');
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    const js = await fetch(base + '/app.js');
    assert.match(js.headers.get('cache-control'), /max-age=3600/);
    const api = await fetch(base + '/api/status');
    assert.equal(api.status, 200);
    assert.equal((await api.json()).app, 'atendimento');
    assert.equal(api.headers.get('x-frame-options'), 'DENY');
  });
});

test('server.js: nada fora de public/, nada escondido, só GET/HEAD nos arquivos', async () => {
  await comServidor(async base => {
    for (const c of ['/.env', '/..%2f.env', '/%2e%2e/package.json', '/..%5cserver.js', '/.git/config', '/%00index.html']) {
      const r = await fetch(base + c);
      assert.equal(r.status, 404, c);
      assert.doesNotMatch(await r.text(), /SUPABASE|require\(/);
    }
    assert.equal((await fetch(base + '/index.html', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/index.html', { method: 'HEAD' })).status, 200);
  });
});

test('server.js: CORS só para o ecossistema (pré-voo e resposta)', async () => {
  await comServidor(async base => {
    const ok = await fetch(base + '/api/equipe', { method: 'OPTIONS', headers: { Origin: 'https://indycar-crm.onrender.com', 'Access-Control-Request-Method': 'PATCH' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://indycar-crm.onrender.com');
    assert.match(ok.headers.get('access-control-allow-methods'), /PATCH/);
    const ruim = await fetch(base + '/api/equipe', { method: 'OPTIONS', headers: { Origin: 'https://golpe.com' } });
    assert.equal(ruim.status, 403);
    assert.equal(ruim.headers.get('access-control-allow-origin'), null);
    const r = await fetch(base + '/api/status', { headers: { Origin: 'https://indycar-posvenda.onrender.com' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://indycar-posvenda.onrender.com');
    const r2 = await fetch(base + '/api/status', { headers: { Origin: 'https://golpe.com' } });
    assert.equal(r2.headers.get('access-control-allow-origin'), null);
  });
});

test('server.js: porteiro em TODA rota — sem token 401, token vencido 401 sessao_expirada (sem ir à rede), rotas novas plugadas', async () => {
  await comServidor(async base => {
    for (const [m, c] of [['GET', '/api/eu'], ['GET', '/api/equipe'], ['POST', '/api/equipe'], ['GET', '/api/equipe/nomes'],
      ['POST', '/api/equipe/papel'], ['POST', '/api/equipe/ativo'], ['POST', '/api/equipe/rodizio'], ['GET', '/api/auditoria'],
      ['GET', '/api/tarefas/equipe'], ['POST', '/api/tarefas'], ['GET', '/api/conversas/sem-dono'], ['GET', '/api/rodizio'],
      ['POST', '/api/conversas/11111111-1111-4111-8111-111111111111/transferir'], ['POST', '/api/conversas/excluir'], ['GET', '/api/relatorios']]) {
      const r = await fetch(base + c, { method: m, body: m === 'GET' ? undefined : '{}' });
      assert.equal(r.status, 401, `${m} ${c}`);
      const v = await fetch(base + c, { method: m, body: m === 'GET' ? undefined : '{}', headers: { Authorization: `Bearer ${jwtVencido()}` } });
      assert.equal(v.status, 401, `vencido ${m} ${c}`);
      assert.equal((await v.json()).codigo, 'sessao_expirada');
    }
  });
});

test('server.js: token inválido repetido do mesmo IP leva 429 (freio contra adivinhação)', async () => {
  await comServidor(async base => {
    let ultimo;
    for (let i = 0; i < 31; i++) ultimo = await fetch(base + '/api/eu', { headers: { Authorization: `Bearer ${jwtVencido()}` } });
    assert.equal(ultimo.status, 429);
    assert.ok(Number(ultimo.headers.get('retry-after')) > 0);
    assert.equal((await ultimo.json()).codigo, 'muitas_tentativas');
  });
});

test('server.js exporta a central (para scripts de conferência)', () => {
  for (const k of ['ACESSO', 'LIMITE', 'AUDITORIA', 'EQUIPE', 'RODIZIO', 'TAREFAS', 'AUTOMACOES']) assert.ok(app[k], k);
});
