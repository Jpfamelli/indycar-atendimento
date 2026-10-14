'use strict';
/* Rodada 4 — confiabilidade com o Render dormindo:
   regras do public/rede.js (quando tentar de novo, quanto esperar, que erro
   mostrar) e a entrega que não duplica (lib/entrega.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/rede.js');
const { criarEntregador } = require('../lib/entrega.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');

test('rede: espera crescente que soma 3 min e trava no teto', () => {
  assert.equal(R.proximaEspera(0), 2000);
  assert.equal(R.proximaEspera(1), 3000);
  assert.ok(R.proximaEspera(3) > R.proximaEspera(2));
  assert.equal(R.proximaEspera(99), 30000);
  assert.equal(R.proximaEspera(-3), 2000);
  assert.equal(R.ESPERAS.reduce((a, b) => a + b, 0) * 1000, R.TETO_MS);
});

test('rede: 503 do roteador (sem o cabeçalho do app) tenta de novo até em POST; 503 do app não', () => {
  assert.equal(R.classificar({ status: 503, doApp: false, metodo: 'GET' }), 'acordando');
  assert.equal(R.classificar({ status: 503, doApp: false, metodo: 'POST' }), 'acordando');
  assert.equal(R.classificar({ status: 503, doApp: true, metodo: 'GET' }), 'ok');     // ex.: IA desligada
  assert.equal(R.classificar({ status: 502, doApp: true, metodo: 'POST' }), 'ok');    // CodeWords recusou
});

test('rede: 502/504 sem o app só repete se for seguro (GET ou idempotente)', () => {
  assert.equal(R.classificar({ status: 502, metodo: 'GET' }), 'acordando');
  assert.equal(R.classificar({ status: 504, metodo: 'POST' }), 'falha');
  assert.equal(R.classificar({ status: 504, metodo: 'POST', idempotente: true }), 'acordando');
});

test('rede: falha de rede repete GET e idempotente; POST comum não', () => {
  assert.equal(R.classificar({ erroRede: true, metodo: 'GET' }), 'acordando');
  assert.equal(R.classificar({ erroRede: true, metodo: 'post' }), 'falha');
  assert.equal(R.classificar({ erroRede: true, metodo: 'POST', idempotente: true }), 'acordando');
  assert.equal(R.classificar({ status: 200, metodo: 'GET' }), 'ok');
  assert.equal(R.classificar({ status: 404, metodo: 'GET' }), 'ok');
});

test('rede: textos em português claro, sem erro cru', () => {
  assert.match(R.textoDaEspera(7600, 0), /tentando de novo em 8 s$/);
  assert.match(R.textoDaEspera(300, 2), /em 1 s \(3ª tentativa\)/);
  const a = R.erroAmigavel('acordando');
  assert.equal(a.codigo, 'servidor_acordando'); assert.equal(a.ok, false); assert.match(a.erro, /acordando/);
  assert.equal(R.erroAmigavel('rede').codigo, 'sem_conexao');
  assert.match(R.erroAmigavel('fora', 504).erro, /504/);
});

const ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const mkSb = (status = 'pendente', direcao = 'saida') => criarSbFalso({ whatsapp_mensagens: [{ id: ID, status, direcao, conversa_id: 'c1' }] });

test('entrega: manda uma vez e grava a situação na linha pelo servidor', async () => {
  const sb = mkSb();
  let n = 0;
  const E = criarEntregador({ banco: () => sb, enviar: async () => { n++; return { ok: true }; } });
  const r = await E.entregar({ telefone: '12999998888', corpo: 'oi' }, ID);
  assert.equal(r.ok, true); assert.equal(n, 1);
  const { data } = await sb.from('whatsapp_mensagens').select('*').eq('id', ID).maybeSingle();
  assert.equal(data.status, 'enviado');
  // a tela tentou de novo (servidor acordou depois): NÃO sai outra vez
  const r2 = await E.entregar({ telefone: '12999998888', corpo: 'oi' }, ID);
  assert.deepEqual(r2, { ok: true, jaEnviada: true }); assert.equal(n, 1);
});

test('entrega: duas tentativas ao mesmo tempo → a segunda recebe 409, sem mandar duas vezes', async () => {
  const sb = mkSb();
  let n = 0, soltar;
  const E = criarEntregador({ banco: () => sb, enviar: () => { n++; return new Promise(r => { soltar = () => r({ ok: true }); }); } });
  const p1 = E.entregar({ corpo: 'x' }, ID);
  await new Promise(r => setTimeout(r, 5));
  const r2 = await E.entregar({ corpo: 'x' }, ID);
  assert.equal(r2.status, 409); assert.equal(r2.codigo, 'ja_saindo');
  soltar(); await p1;
  assert.equal(n, 1);
  assert.equal(E.emAndamento.size, 0);
});

test('entrega: trava velha (aba fechou no meio há > 2 min) não prende para sempre', async () => {
  const sb = mkSb(); let t = 0;
  const E = criarEntregador({ banco: () => sb, enviar: async () => ({ ok: true }), agora: () => t });
  E.emAndamento.set(ID, 0); t = 130_000;
  assert.equal((await E.entregar({ corpo: 'x' }, ID)).ok, true);
});

test('entrega: falhou → linha "falhou" com o erro; id inválido e mensagem de entrada recusados; sem id = envio antigo', async () => {
  const sb = mkSb('falhou');
  const E = criarEntregador({ banco: () => sb, enviar: async () => ({ ok: false, erro: 'chave recusada' }) });
  await E.entregar({ corpo: 'x' }, ID);
  const { data } = await sb.from('whatsapp_mensagens').select('*').eq('id', ID).maybeSingle();
  assert.equal(data.status, 'falhou'); assert.equal(data.erro, 'chave recusada');
  assert.equal((await E.entregar({}, 'nao-e-uuid')).status, 400);
  const E2 = criarEntregador({ banco: () => mkSb('recebido', 'entrada'), enviar: async () => ({ ok: true }) });
  assert.equal((await E2.entregar({}, ID)).status, 400);
  const E3 = criarEntregador({ banco: () => null, enviar: async () => ({ ok: true, x: 1 }) });
  assert.deepEqual(await E3.entregar({}, null), { ok: true, x: 1, semId: true });
});

test('entrega: integração "desligada" não mexe na linha', async () => {
  const sb = mkSb();
  const E = criarEntregador({ banco: () => sb, enviar: async () => ({ ok: false, desligado: true }) });
  await E.entregar({}, ID);
  const { data } = await sb.from('whatsapp_mensagens').select('*').eq('id', ID).maybeSingle();
  assert.equal(data.status, 'pendente');
});
