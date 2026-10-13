'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const S = require('../lib/seguranca.js');

const corpo = (txt, cab = {}) => { const r = Readable.from(txt === null ? [] : [Buffer.from(txt)]); r.headers = cab; return r; };

test('CSP: hash de cada <script> embutido, frame-ancestors none, Supabase no connect/img (https e wss)', () => {
  const html = '<html><script>window.a=1</script><script src="x.js"></script><script type="module">b()</script></html>';
  const hashes = S.hashesDosScripts(html);
  assert.equal(hashes.length, 2);
  assert.equal(hashes[0], `'sha256-${crypto.createHash('sha256').update('window.a=1').digest('base64')}'`);
  const csp = S.politicaCSP({ supabaseUrl: 'https://abc.supabase.co', hashes });
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self' https:\/\/abc\.supabase\.co wss:\/\/abc\.supabase\.co/);
  assert.match(csp, /img-src [^;]*https:\/\/abc\.supabase\.co/);
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net 'sha256-/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(S.politicaCSP({ supabaseUrl: 'lixo' }), /undefined/);
});

test('cabeçalhos base: nosniff, referrer, permissions; HSTS só em https', () => {
  const a = S.cabecalhosBase();
  assert.equal(a['X-Content-Type-Options'], 'nosniff');
  assert.equal(a['X-Frame-Options'], 'DENY');
  assert.match(a['Permissions-Policy'], /camera=\(\)/);
  assert.match(a['Permissions-Policy'], /microphone=\(self\)/);
  assert.equal(a['Strict-Transport-Security'], undefined);
  assert.match(S.cabecalhosBase({ https: true })['Strict-Transport-Security'], /max-age=31536000/);
});

test('CORS só para o ecossistema; preflight com métodos e cabeçalhos', () => {
  assert.deepEqual(S.cabecalhosCors('https://malicioso.com'), {});
  assert.deepEqual(S.cabecalhosCors(undefined), {});
  const c = S.cabecalhosCors('https://indycar-crm.onrender.com', { preflight: true });
  assert.equal(c['Access-Control-Allow-Origin'], 'https://indycar-crm.onrender.com');
  assert.equal(c.Vary, 'Origin');
  assert.match(c['Access-Control-Allow-Methods'], /PATCH/);
  assert.match(c['Access-Control-Allow-Headers'], /Authorization/);
  assert.equal(S.cabecalhosCors('https://indycar-crm.onrender.com')['Access-Control-Allow-Methods'], undefined);
});

test('IP: X-Forwarded-For só vale atrás do proxy da nuvem; IPv4 mapeado limpo', () => {
  const req = { headers: { 'x-forwarded-for': '200.1.2.3, 10.0.0.1' }, socket: { remoteAddress: '::ffff:10.0.0.9' } };
  assert.equal(S.ipDoCliente(req), '10.0.0.9');
  assert.equal(S.ipDoCliente(req, { confiarProxy: true }), '200.1.2.3');
  assert.equal(S.ipDoCliente({ headers: { 'x-forwarded-for': '<script>' }, socket: { remoteAddress: '1.1.1.1' } }, { confiarProxy: true }), '1.1.1.1');
});

test('limitador: teto por janela, libera depois, espera em segundos, memória limitada sem zerar quem está no teto', () => {
  let t = 0;
  const L = S.criarLimitador({ maxChaves: 3, agora: () => t });
  assert.equal(L.permitir('a', 2, 1000), true);
  assert.equal(L.permitir('a', 2, 1000), true);
  assert.equal(L.permitir('a', 2, 1000), false);
  assert.equal(L.espera('a'), 1);
  t = 1001;
  assert.equal(L.permitir('a', 2, 1000), true);
  L.permitir('b', 1, 5000); L.permitir('c', 1, 5000);
  L.permitir('d', 1, 5000);                       // estoura: sai a mais antiga, não todas
  assert.ok(L.tamanho() <= 3);
  assert.equal(L.permitir('c', 1, 5000), false, 'c continua no teto');
  assert.equal(L.contar('f', 1000), 1);
  assert.equal(L.contar('f', 1000), 2);
  assert.equal(L.quantas('f'), 2);
});

test('lerCorpoJson: vazio = {}, inválido = 400, número solto = 400, grande = 413 (pelo cabeçalho e pelo fluxo), BOM ok', async () => {
  assert.deepEqual(await S.lerCorpoJson(corpo(null)), {});
  assert.deepEqual(await S.lerCorpoJson(corpo('﻿{"a":1}')), { a: 1 });
  await assert.rejects(S.lerCorpoJson(corpo('{a:1')), e => e.status === 400 && e.codigo === 'json_invalido');
  await assert.rejects(S.lerCorpoJson(corpo('42')), e => e.status === 400);
  await assert.rejects(S.lerCorpoJson(corpo('{}', { 'content-length': '5000' }), { limite: 100 }), e => e.status === 413);
  await assert.rejects(S.lerCorpoJson(corpo(JSON.stringify({ x: 'a'.repeat(500) })), { limite: 100 }), e => e.status === 413);
});

test('validações: UUID, e-mail, texto sem controle, inteiro, data, instante, lista, telefone', () => {
  assert.equal(S.ehUuid('11111111-1111-4111-8111-111111111111'), true);
  assert.equal(S.ehUuid("1' or 1=1"), false);
  assert.equal(S.ehUuid(123), false);
  assert.equal(S.ehEmail('ana@indycar.com.br'), true);
  assert.equal(S.ehEmail('ana@x'), false);
  assert.equal(S.ehEmail('a<b>@x.com'), false);
  assert.equal(S.texto('  oi\u0000\u0007 ', 10), 'oi');
  assert.equal(S.texto({ a: 1 }), '');
  assert.equal(S.texto('abcdef', 3), 'abc');
  assert.equal(S.inteiro('7', { min: 1, max: 5 }), 5);
  assert.equal(S.inteiro('7.5', { padrao: 2 }), 2);
  assert.equal(S.inteiro('', { padrao: 1 }), 1);
  assert.equal(S.dataISO('2026-02-30'), null);
  assert.equal(S.dataISO('2026-10-13'), '2026-10-13');
  assert.ok(S.instante('2026-10-13T10:00'));
  assert.equal(S.instante('amanhã'), null);
  assert.deepEqual(S.listaDe(['crm', 'x', 'crm', 'agenda'], ['crm', 'agenda']), ['crm', 'agenda']);
  assert.equal(S.listaDe('crm', ['crm']), null);
  assert.equal(S.telefone('(12) 99683-0272'), '12996830272');
  assert.equal(S.telefone('123'), null);
});

test('semSegredos troca senha/token/chave em qualquer nível; erroSeguro não vaza a mensagem', () => {
  const o = S.semSegredos({ email: 'a@b.com', senha: 'x', nested: { api_key: 'k', ok: 1, lista: [{ access_token: 't' }] }, password: 'p' });
  assert.deepEqual(o, { email: 'a@b.com', senha: '•••', nested: { api_key: '•••', ok: 1, lista: [{ access_token: '•••' }] }, password: '•••' });
  const logs = [];
  const r = S.erroSeguro(new Error('relation "perfis" violates xyz'), { log: (...a) => logs.push(a.join(' ')) });
  assert.doesNotMatch(r.erro, /perfis|violates/);
  assert.match(r.erro, new RegExp(r.ref));
  assert.equal(r.codigo, 'erro_interno');
  assert.match(logs[0], /violates/);
});

test('varredura de segredos: acha chave real, ignora a anon key, o fictício dos testes e o marcado', async () => {
  const { procurar, ficticio } = await import('../scripts/segredos.mjs');
  const jwt = carga => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(carga)).toString('base64url')}.assinaturaassinaturaassinatura`;
  const achados = procurar([
    { nome: 'a.js', texto: `const k = "sk-ant-api03-${'Q9w'.repeat(10)}";\nconst anon = "${jwt({ role: 'anon', iss: 'supabase' })}";` },
    { nome: 'b.js', texto: `x = "${jwt({ role: 'service_role', iss: 'supabase' })}"` },
    { nome: 'c.js', texto: "chave = 'cwk-chave-antiga-de-teste-0000000000943a'\nk='cwk-Zq8Lm3Np5Rt7Vx9Bc2Df4Gh6' // segredos:ignorar" },
    { nome: 'd.env', texto: 'ANTHROPIC_API_KEY=Zq8Lm3Np5Rt7Vx9Bc2Df4Gh6Jk8Lm0Np' },   // segredos:ignorar (exemplo do teste)
  ]);
  const tipos = achados.map(a => `${a.arquivo}:${a.tipo}`);
  assert.ok(tipos.includes('a.js:Anthropic'));
  assert.ok(tipos.includes('b.js:JWT service_role'));
  assert.ok(!tipos.some(t => t.startsWith('c.js')), 'fictício e marcado não contam');
  assert.ok(tipos.includes('d.env:Atribuição de segredo'));
  assert.ok(!achados.some(a => a.arquivo === 'a.js' && a.tipo === 'JWT service_role'), 'anon key é pública');
  assert.ok(achados.every(a => !/Q9wQ9wQ9w/.test(a.amostra)), 'nunca imprime o segredo inteiro');
  assert.equal(ficticio('cwk-abcdefghijklmnop'), true);
  assert.equal(ficticio('cwk-Zq8Lm3Np5Rt7Vx9B'), false);   // segredos:ignorar
});

test('varredura: senha escrita em documento é achada; identificador e template não', async () => {
  const { procurar } = await import('../scripts/segredos.mjs');
  const r = procurar([
    { nome: 'LEIA.md', texto: ['| **Senha** | `Ab', 'c@2026` |'].join('') },
    { nome: 'x.js', texto: "irPara({ senha: 'cartaoSenha' }); const t = `senha: '${'$'}{esc(s)}'`;" },
  ]);
  assert.deepEqual(r.map(a => `${a.arquivo}:${a.tipo}`), ['LEIA.md:Senha escrita']);
});
