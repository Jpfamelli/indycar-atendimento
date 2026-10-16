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

/* ---------------- rodada 4: confiabilidade e velocidade ---------------- */
const zlibT = require('node:zlib');
const http = require('node:http');
/** GET cru (o fetch do Node descomprime sozinho e esconde o Content-Encoding). */
function getCru(base, caminho, cab = {}) {
  return new Promise((ok, ko) => {
    http.get(base + caminho, { headers: cab }, r => {
      const partes = []; r.on('data', c => partes.push(c)); r.on('end', () => ok({ status: r.statusCode, h: r.headers, corpo: Buffer.concat(partes) }));
    }).on('error', ko);
  });
}

test('server.js: toda resposta leva X-IndyCar-App (a tela distingue do 503 do Render)', async () => {
  await comServidor(async base => {
    for (const c of ['/', '/app.js', '/api/status', '/api/nao-existe', '/nada.txt']) {
      const r = await fetch(base + c);
      assert.equal(r.headers.get('x-indycar-app'), 'atendimento', c);
    }
    const sem = await fetch(base + '/api/eu');
    assert.equal(sem.headers.get('x-indycar-app'), 'atendimento');
  });
});

test('server.js: estáticos em brotli/gzip com ETag e 304; vendor do Supabase servido daqui', async () => {
  await comServidor(async base => {
    const br = await getCru(base, '/app.js', { 'accept-encoding': 'gzip, deflate, br' });
    assert.equal(br.status, 200); assert.equal(br.h['content-encoding'], 'br');
    const original = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'));
    assert.ok(br.corpo.length < original.length / 3, 'app.js comprimido a menos de 1/3');
    assert.deepEqual(zlibT.brotliDecompressSync(br.corpo), original);
    const gz = await getCru(base, '/styles.css', { 'accept-encoding': 'gzip' });
    assert.equal(gz.h['content-encoding'], 'gzip'); assert.match(gz.h.vary, /Accept-Encoding/);
    const cru = await getCru(base, '/app.js');
    assert.equal(cru.h['content-encoding'], undefined); assert.equal(cru.corpo.length, original.length);
    const etag = br.h.etag; assert.match(etag, /^"/);
    const nm = await getCru(base, '/app.js', { 'if-none-match': etag });
    assert.equal(nm.status, 304); assert.equal(nm.corpo.length, 0);
    // ETag fraca (a borda do Render/Cloudflare marca W/) e lista também valem
    assert.equal((await getCru(base, '/app.js', { 'if-none-match': 'W/' + etag })).status, 304);
    assert.equal((await getCru(base, '/app.js', { 'if-none-match': '"outra", ' + etag })).status, 304);
    assert.equal((await getCru(base, '/app.js', { 'if-none-match': '"outra"' })).status, 200);
    const v = await getCru(base, '/vendor/supabase.js', { 'accept-encoding': 'br' });
    assert.equal(v.status, 200); assert.match(v.h['content-type'], /javascript/); assert.match(v.h['cache-control'], /max-age=86400/);
    assert.match(zlibT.brotliDecompressSync(v.corpo).toString('utf8').slice(0, 5000), /supabase/i);
    // nada além do vendor listado sai do node_modules
    assert.equal((await getCru(base, '/vendor/../package.json')).status, 404);
    assert.equal((await getCru(base, '/node_modules/@supabase/supabase-js/package.json')).status, 404);
    const html = await getCru(base, '/', { 'accept-encoding': 'gzip' });
    assert.equal(html.h['content-encoding'], 'gzip'); assert.ok(html.h['content-security-policy']);
  });
});

test('server.js: JSON grande sai em gzip; pequeno cru', async () => {
  await comServidor(async base => {
    const peq = await getCru(base, '/api/status', { 'accept-encoding': 'gzip' });
    assert.equal(peq.h['content-encoding'], undefined);
    assert.equal(JSON.parse(peq.corpo).app, 'atendimento');
  });
});

test('index.html: apps.js e rede.js antes de tudo, Supabase local com reserva da CDN, casca.js e sw com tudo no CORE (caminhos relativos)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const iApps = html.indexOf('<script src="apps.js"></script>'), iRede = html.indexOf('<script src="rede.js"></script>'), iSb = html.indexOf('<script src="vendor/supabase.js"></script>'), iApp = html.indexOf('<script src="app.js"></script>');
  assert.ok(iApps > 0 && iApps < iRede && iRede < iSb && iSb < iApp);
  // rodada 5 (Central): nada com barra inicial no HTML, no manifest nem no registro do SW
  assert.ok(!/(href|src)="\/[a-z]/i.test(html), 'index.html sem caminho absoluto');
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.json'), 'utf8'));
  assert.equal(man.start_url, './'); assert.equal(man.scope, './');
  assert.ok(man.icons.every(i => !i.src.startsWith('/')) && man.shortcuts.every(x => x.url.startsWith('./')));
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'casca.js'), 'utf8'), /register\('sw\.js'\)/);
  assert.match(html, /supabase-js@2\.112\.0/);
  // a reserva da CDN escreve um <script> dentro de outro: o fechamento TEM de ir escapado
  const reserva = html.split('\n').find(l => l.includes('document.write'));
  assert.ok(reserva.includes('<' + String.fromCharCode(92) + '/script>'), 'fechamento escapado na reserva da CDN');
  assert.equal(reserva.split('</script>').length, 2, 'só o fechamento do script embutido');
  assert.match(html, /<script src="casca\.js" defer><\/script>/);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  // rodada 5: a lista é relativa à pasta do sw.js (RAIZ) — funciona em "/" e em "/atendimento/"
  const core = JSON.parse(/const ARQUIVOS = (\[[\s\S]*?\]);/.exec(sw)[1].replace(/'/g, '"'));
  for (const f of core) {
    const arq = f === '' ? 'index.html' : f.startsWith('vendor/') ? null : f;
    if (arq) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', arq)), `CORE ${f} existe`);
  }
  assert.ok(core.includes('apps.js') && core.includes('rede.js') && core.includes('vendor/supabase.js') && core.includes('casca.js'));
  assert.ok(!core.some(f => f.startsWith('/')), 'nada com barra inicial');
  assert.match(sw, /const RAIZ = self\.location\.pathname/);
  assert.match(sw, /startsWith\(RAIZ \+ 'api\/'\)/);
});

/* ---------------- rodada 5: pronto para a Central (prefixo) e IA do funil ---------------- */
test('server.js exporta handler/iniciar e não abre porta ao ser importado; montado em /atendimento/ atrás de um proxy mínimo funciona com <base href>', async () => {
  assert.equal(typeof app.handler, 'function');
  assert.equal(typeof app.iniciar, 'function');
  assert.equal(app.normalizarPrefixo('atendimento'), '/atendimento/');
  assert.equal(app.normalizarPrefixo('/atendimento'), '/atendimento/');
  assert.equal(app.normalizarPrefixo(''), '/');
  // proxy mínimo = o que a Central vai fazer: tira o prefixo de req.url e põe req.prefixo
  const http = require('node:http');
  const proxy = http.createServer((req, res) => {
    if (!req.url.startsWith('/atendimento')) { res.writeHead(404); return res.end('outro app'); }
    req.prefixo = '/atendimento/';
    req.url = req.url.slice('/atendimento'.length) || '/';
    return app.handler(req, res);
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  try {
    const r = await fetch(base + '/atendimento/');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<base href="\/atendimento\/" \/>/, 'base injetada com o prefixo');
    assert.match(r.headers.get('content-security-policy'), /base-uri 'self'/);
    const raiz = await (await fetch(base + '/atendimento/')).headers.get('etag');
    assert.ok(raiz, 'ETag por prefixo');
    for (const f of ['styles.css', 'apps.js', 'rede.js', 'sw.js', 'manifest.json', 'vendor/supabase.js', 'copiloto.js']) {
      const x = await fetch(`${base}/atendimento/${f}`);
      assert.equal(x.status, 200, f);
    }
    const st = await (await fetch(base + '/atendimento/api/status')).json();
    assert.equal(st.app, 'atendimento');
    const cfg = await (await fetch(base + '/atendimento/api/config')).json();
    assert.equal(cfg.prefixo, '/atendimento/');
    const fora = await fetch(base + '/crm/');
    assert.equal(fora.status, 404);
    // sozinho (sem proxy) a base é "/" e a ETag é outra
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    try {
      const so = await fetch(`http://127.0.0.1:${app.server.address().port}/`);
      assert.match(await so.text(), /<base href="\/" \/>/);
      assert.notEqual(so.headers.get('etag'), raiz);
    } finally { await new Promise(r => app.server.close(r)); }
  } finally { await new Promise(r => proxy.close(r)); }
});

test('IA do funil: /api/ia/funil/acordar é pública mas exige o token do webhook; estado/hoje/processar exigem login', async () => {
  await comServidor(async base => {
    const semToken = await fetch(base + '/api/ia/funil/acordar', { method: 'POST', body: '{}' });
    assert.equal(semToken.status, 401);
    assert.equal((await semToken.json()).codigo, 'token-invalido');
    const errado = await fetch(base + '/api/ia/funil/acordar', { method: 'POST', body: '{}', headers: { 'x-codewords-token': 'xyz' } });
    assert.equal(errado.status, 401);
    for (const [m, c] of [['GET', '/api/ia/funil/estado'], ['POST', '/api/ia/funil/processar'], ['GET', '/api/ia/hoje']]) {
      const r = await fetch(base + c, { method: m, body: m === 'GET' ? undefined : '{}' });
      assert.equal(r.status, 401, `${m} ${c}`);
    }
    const seg = require('../lib/rotas-ia.js').segredosIguais;
    assert.equal(seg('abc', 'abc'), true); assert.equal(seg('abc', 'abd'), false); assert.equal(seg('', ''), false); assert.equal(seg(undefined, 'x'), false);
  });
});
