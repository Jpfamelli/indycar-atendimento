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
