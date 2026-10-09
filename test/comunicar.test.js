'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../lib/comunicar.js');

test('normalizarTelefone tira máscara e o DDI 55', () => {
  assert.equal(c.normalizarTelefone('+55 (12) 99683-0272'), '12996830272');
  assert.equal(c.normalizarTelefone('5512996830272'), '12996830272');
  assert.equal(c.normalizarTelefone('12996830272'), '12996830272');
  // 55 que faz parte do número (fixo de 10 dígitos começando com 55) não é DDI
  assert.equal(c.normalizarTelefone('5533334444'), '5533334444');
  assert.equal(c.normalizarTelefone(null), '');
});

test('variantesDoTelefone cobre com e sem 55', () => {
  assert.deepEqual(c.variantesDoTelefone('(12) 99683-0272'),
    ['12996830272', '5512996830272', '+5512996830272']);
  assert.deepEqual(c.variantesDoTelefone(''), []);
});

test('somarMeses segura o dia no fim do mês', () => {
  assert.equal(c.somarMeses('2026-01-31T12:00:00.000Z', 1), '2026-02-28T12:00:00.000Z');
  assert.equal(c.somarMeses('2026-03-15T12:00:00.000Z', 6), '2026-09-15T12:00:00.000Z');
  assert.equal(c.somarMeses('data ruim', 6), null);
});

const REGRAS = [
  { id: 'r1', rotulo: 'Troca de óleo do motor', palavras: ['óleo', 'oleo', 'lubrifica'], meses: 6, ativo: true },
  { id: 'r2', rotulo: 'Freios', palavras: ['freio', 'pastilha', 'disco'], meses: 12, ativo: true },
  { id: 'r3', rotulo: 'Correia dentada', palavras: ['correia', 'tensor'], meses: 24, ativo: true },
  { id: 'r4', rotulo: 'Desligada', palavras: ['pneu'], meses: 3, ativo: false },
];

test('proximaRevisao casa a regra sem ligar para acento e caixa', () => {
  const r = c.proximaRevisao({ servico: 'TROCA DE OLEO + filtro', concluidoEm: '2026-04-10T13:00:00.000Z', regras: REGRAS });
  assert.equal(r.rotulo, 'Troca de óleo do motor');
  assert.equal(r.meses, 6);
  assert.equal(r.prevista, '2026-10-10T13:00:00.000Z');
  assert.equal(r.padrao, false);
});

test('proximaRevisao usa 6 meses quando nenhuma regra bate', () => {
  const r = c.proximaRevisao({ servico: 'Polimento', concluidoEm: '2026-01-05T13:00:00.000Z', regras: REGRAS });
  assert.equal(r.meses, 6);
  assert.equal(r.padrao, true);
  assert.equal(r.rotulo, 'Revisão geral');
  assert.equal(r.prevista, '2026-07-05T13:00:00.000Z');
});

test('proximaRevisao ignora regra inativa e devolve null sem data', () => {
  const r = c.proximaRevisao({ servico: 'Troca de pneu', concluidoEm: '2026-01-05T13:00:00.000Z', regras: REGRAS });
  assert.equal(r.padrao, true);
  assert.equal(c.proximaRevisao({ servico: 'x', concluidoEm: null, regras: REGRAS }), null);
});

test('mascararChave só mostra os 4 últimos', () => {
  assert.equal(c.mascararChave('cwk-abcdefghijklmnopqrstuvwxyz943a'), '••••••••943a');
  assert.equal(c.mascararChave(''), '');
  assert.equal(c.mascararChave(null), '');
});

test('chaveParece recusa lixo e máscara', () => {
  assert.equal(c.chaveParece('cwk-abcdefghijklmnopqrstuvwxyz0123456789'), true);
  assert.equal(c.chaveParece('curta'), false);
  assert.equal(c.chaveParece('cwk-abc defghijklmnopqrstuvwxyz'), false);
  assert.equal(c.chaveParece('••••••••943a-ainda-mascarada-xxxxxxxxxxx'), false);
});

test('classificarTesteChave distingue ok, recusada e outro', () => {
  assert.equal(c.classificarTesteChave(401, '{"detail":"Invalid API key"}').resultado, 'recusada');
  assert.equal(c.classificarTesteChave(403, '').resultado, 'recusada');
  const ok = c.classificarTesteChave(200, '[{"phone_id":"a"},{"phone_id":"b"}]');
  assert.equal(ok.resultado, 'ok');
  assert.match(ok.mensagem, /2 conexões/);
  assert.equal(c.classificarTesteChave(200, 'texto sem json').resultado, 'ok');
  assert.equal(c.classificarTesteChave(500, 'erro').resultado, 'outro');
  assert.equal(c.classificarTesteChave(0, '').resultado, 'outro');
});

test('textoErroEnvio diz exatamente que a chave foi recusada no 401', () => {
  const r = c.textoErroEnvio(401, '{"detail":"Invalid API key"}');
  assert.equal(r.codigo, 'codewords-401');
  assert.equal(r.erro, 'WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações');
  assert.equal(c.textoErroEnvio(500, 'INVALID_WA_CLI').codigo, 'whatsapp-desconectado');
  assert.equal(c.textoErroEnvio(429, 'rate limit exceeded').codigo, 'cota');
  assert.equal(c.textoErroEnvio(404, '').codigo, 'fluxo-404');
  assert.equal(c.textoErroEnvio(502, '').erro, 'CodeWords respondeu 502');
});

test('textoDaSaude traduz o problema do vigia', () => {
  assert.equal(c.textoDaSaude('codewords-fora'), c.ERRO_CHAVE_RECUSADA);
  assert.equal(c.textoDaSaude(null), '');
  assert.equal(c.textoDaSaude('coisa-nova', 'resumo do vigia'), 'Atenção: resumo do vigia');
});

test('resumoComunicar conta a fila certo', () => {
  const r = c.resumoComunicar([
    { status: 'enviado', tipo: 'aniversario', respondido_em: '2026-10-01', resposta_tipo: 'positiva' },
    { status: 'enviado', tipo: 'posvenda', resposta_tipo: 'parar', respondido_em: '2026-10-02' },
    { status: 'enviado', tipo: 'retorno', agendou_depois_id: 'ag1' },
    { status: 'falhou', tipo: 'retorno' },
    { status: 'pendente', tipo: 'campanha' },
    { status: 'pulado', tipo: 'campanha' },
    null,
  ]);
  assert.equal(r.total, 6);
  assert.equal(r.enviadas, 3);
  assert.equal(r.respondidas, 2);
  assert.equal(r.pararam, 1);
  assert.equal(r.positivas, 1);
  assert.equal(r.falharam, 1);
  assert.equal(r.pendentes, 1);
  assert.equal(r.puladas, 1);
  assert.equal(r.agendaram, 1);
  assert.deepEqual(r.porTipo, { aniversario: 1, posvenda: 1, retorno: 2, campanha: 2 });
});

test('ehUuid', () => {
  assert.equal(c.ehUuid('5f6c1a2e-1234-4abc-9def-0123456789ab'), true);
  assert.equal(c.ehUuid('nao'), false);
});
