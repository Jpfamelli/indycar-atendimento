'use strict';
/* Rodada 4 — tour de boas-vindas por papel e ajuda curta (public/ajuda.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../public/ajuda.js');
const { validarPreferencias } = require('../lib/rotas-equipe.js');

test('tour: atendente vê o básico; gestor ganha o passo do gestor; admin ganha equipe e integrações', () => {
  const at = A.passosDoPapel('atendente').map(p => p.id);
  const ge = A.passosDoPapel('gestor').map(p => p.id);
  const ad = A.passosDoPapel('admin').map(p => p.id);
  assert.ok(at.includes('lista') && at.includes('ia') && !at.includes('gestor-dono') && !at.includes('admin-equipe'));
  assert.ok(ge.includes('gestor-dono') && !ge.includes('admin-equipe'));
  assert.ok(ad.includes('gestor-dono') && ad.includes('admin-equipe') && ad.includes('admin-integracoes'));
  assert.equal(at[0], 'boas-vindas'); assert.equal(at.at(-1), 'fim'); assert.equal(ad.at(-1), 'fim');
  assert.ok(at.length <= 8, 'tour curto para o atendente');
  // papel desconhecido / agenda cai no do atendente
  assert.deepEqual(A.passosDoPapel('qualquer').map(p => p.id), at);
});

test('tour: aparece uma vez por versão e papel; promoção mostra de novo; o aparelho lembra se o servidor falhar', () => {
  assert.equal(A.marcaDoTour('admin'), `v${A.VERSAO_TOUR}-admin`);
  assert.equal(A.precisaDoTour({}, 'atendente', null), true);
  assert.equal(A.precisaDoTour({ tour_visto: 'v1-atendente' }, 'atendente', null), false);
  assert.equal(A.precisaDoTour({ tour_visto: 'v1-atendente' }, 'gestor', null), true);
  assert.equal(A.precisaDoTour({}, 'gestor', 'v1-gestor'), false);
  assert.equal(A.precisaDoTour(null, 'admin', null), true);
});

test('tour: textos sem vocabulário proibido e com a regra da IA (nunca envia sozinha)', () => {
  const tudo = A.PASSOS.map(p => p.titulo + ' ' + p.texto).join(' ') + A.COMO.map(c => c.p + c.r).join(' ');
  assert.doesNotMatch(tudo, /prezad|efetu|comparec|veícul/i);
  assert.match(tudo, /Nada vai para o cliente sem você/);
  assert.match(tudo, /Quem conhece, Indyca!/);
});

test('ajuda: busca sem acento, por várias palavras; vazio = tudo', () => {
  assert.equal(A.filtrarComo('').length, A.COMO.length);
  assert.match(A.filtrarComo('AUDIO')[0].p, /áudio/);
  assert.match(A.filtrarComo('acordando')[0].p, /acordando/);
  assert.match(A.filtrarComo('passar colega')[0].p, /Passar a conversa/);
  assert.equal(A.filtrarComo('zzzz-nada').length, 0);
  assert.ok(A.filtrarComo('permissão')[0].r.includes('Peça ao gestor'));
});

test('preferências: tour_visto aceito só no formato certo', () => {
  assert.deepEqual(validarPreferencias({ tour_visto: 'v1-atendente' }), { preferencias: { tour_visto: 'v1-atendente' } });
  assert.deepEqual(validarPreferencias({ tour_visto: null }), { preferencias: { tour_visto: null } });
  assert.ok(validarPreferencias({ tour_visto: '<script>' }).erro);
  assert.ok(validarPreferencias({ tour_visto: 'v1-dono' }).erro);
});
