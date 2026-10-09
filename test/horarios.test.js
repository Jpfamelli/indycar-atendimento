'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../lib/horarios.js');

// quarta 14/10/2026 10:00 em São Paulo
const AGORA = new Date('2026-10-14T13:00:00Z');

test('partesLocais usa o fuso de São Paulo', () => {
  const p = H.partesLocais(AGORA);
  assert.equal(p.dia, '2026-10-14');
  assert.equal(p.minutos, 600);
  assert.equal(p.semana, 3);
  // 01:30 UTC ainda é o dia anterior em Taubaté
  assert.equal(H.partesLocais(new Date('2026-10-15T01:30:00Z')).dia, '2026-10-14');
});

test('horaEmMinutos aceita 9:00, 09:00:00, 9h30 e 14h', () => {
  assert.equal(H.horaEmMinutos('9:00'), 540);
  assert.equal(H.horaEmMinutos('09:00:00'), 540);
  assert.equal(H.horaEmMinutos('9h30'), 570);
  assert.equal(H.horaEmMinutos('14h'), 840);
  assert.equal(H.horaEmMinutos('25:00'), null);
  assert.equal(H.horaEmMinutos('abc'), null);
});

test('dataValida recusa 30/02 e formato errado', () => {
  assert.equal(H.dataValida('2026-02-28'), true);
  assert.equal(H.dataValida('2026-02-30'), false);
  assert.equal(H.dataValida('14/10/2026'), false);
});

test('rotuloHorario fala como gente', () => {
  assert.equal(H.rotuloHorario('2026-10-15', '14:00'), 'quinta, 15/10 às 14h');
  assert.equal(H.rotuloHorario('2026-10-17', '08:30'), 'sábado, 17/10 às 8h30');
  assert.equal(H.rotuloHorario('2026-10-15', '14:00', { curto: true }), 'qui, 15/10 às 14h');
});

test('horariosLivres: expediente seg–sáb 8h–17h, passos de 30 min, domingo fora, hoje só com 1 h de antecedência', () => {
  const l = H.horariosLivres({ agora: AGORA, dias: 7 });
  assert.ok(l.length > 0);
  assert.ok(!l.some(h => H.diaDaSemana(h.data) === 0), 'domingo não aparece');
  const hoje = l.filter(h => h.data === '2026-10-14');
  assert.equal(hoje[0].hora, '11:00', 'agora 10:00 → primeiro 11:00');
  assert.ok(l.every(h => h.hora >= '08:00' && h.hora <= '17:00'));
  assert.ok(l.every(h => Number(h.hora.slice(3)) % 30 === 0));
  // 7 dias corridos a partir de quarta: qua..ter, com um domingo pulado
  assert.equal(new Set(l.map(h => h.data)).size, 6);
});

test('horariosLivres desconta agendamentos (cancelado e não veio não ocupam) e respeita capacidade', () => {
  const ags = [
    { id: 'a', data: '2026-10-15', hora: '08:00:00', status: 'confirmado' },          // ocupa 8:00 e 8:30 (60 min)
    { id: 'b', data: '2026-10-15', hora: '10:00:00', status: 'cancelado' },
    { id: 'c', data: '2026-10-15', hora: '11:00:00', status: 'nao_veio' },
    { id: 'd', data: '2026-10-15', hora: '14:00:00', status: 'aguardando', duracao_min: 30 },
  ];
  const l = H.horariosLivres({ agora: AGORA, dias: 3, agendamentos: ags });
  const qui = l.filter(h => h.data === '2026-10-15').map(h => h.hora);
  assert.ok(!qui.includes('08:00') && !qui.includes('08:30'));
  assert.ok(qui.includes('09:00') && qui.includes('10:00') && qui.includes('11:00'));
  assert.ok(!qui.includes('14:00'));
  assert.ok(!qui.includes('13:30'), '13:30 de 60 min bate no das 14:00');
  assert.ok(qui.includes('14:30'));
  // com 2 consultores o das 8:00 ainda tem vaga
  const l2 = H.horariosLivres({ agora: AGORA, dias: 3, agendamentos: ags, capacidade: 2 });
  assert.ok(l2.some(h => h.data === '2026-10-15' && h.hora === '08:00'));
});

test('horariosLivres por consultor: o consultor ocupado não serve, mesmo sobrando vaga', () => {
  const ags = [{ id: 'a', data: '2026-10-15', hora: '09:00', status: 'confirmado', consultor_id: 'K1' }];
  const l = H.horariosLivres({ agora: AGORA, dias: 3, agendamentos: ags, capacidade: 3, consultorId: 'K1' });
  assert.ok(!l.some(h => h.data === '2026-10-15' && h.hora === '09:00'));
  const outro = H.horariosLivres({ agora: AGORA, dias: 3, agendamentos: ags, capacidade: 3, consultorId: 'K2' });
  assert.ok(outro.some(h => h.data === '2026-10-15' && h.hora === '09:00'));
});

test('janelas: troca de óleo só nas janelas; serviço sem janela usa o expediente inteiro', () => {
  const janelas = [
    { tipo_servico: 'Troca de óleo do motor e filtros', dias: 'seg-sex', inicio: '08:00', fim: '11:00' },
    { tipo_servico: 'Troca de óleo do motor e filtros', dias: 'sabado', inicio: '08:00', fim: '09:00' },
    { tipo_servico: 'Pneus, alinhamento e balanceamento', dias: 'seg-sex', inicio: '14:00', fim: '16:30' },
  ];
  assert.equal(H.tipoDeJanela('troca de oleo', janelas), 'Troca de óleo do motor e filtros');
  assert.equal(H.tipoDeJanela('Alinhamento', janelas), 'Pneus, alinhamento e balanceamento');
  assert.equal(H.tipoDeJanela('pneu furado', janelas), 'Pneus, alinhamento e balanceamento');
  assert.equal(H.tipoDeJanela('Diagnóstico', janelas), null);
  const oleo = H.horariosLivres({ agora: AGORA, dias: 4, servico: 'Troca de óleo', janelas });
  assert.ok(oleo.every(h => (H.diaDaSemana(h.data) === 6 ? h.hora <= '09:00' : h.hora <= '11:00')));
  const diag = H.horariosLivres({ agora: AGORA, dias: 4, servico: 'Diagnóstico', janelas });
  assert.ok(diag.some(h => h.hora === '17:00'));
});

test('sugerirDois: duas opções concretas, de preferência outro dia e outro período', () => {
  const l = H.horariosLivres({ agora: AGORA, dias: 7 });
  const [a, b] = H.sugerirDois(l);
  assert.equal(a.data, '2026-10-14');
  assert.notEqual(b.data, a.data);
  assert.notEqual(b.periodo, a.periodo);
  assert.deepEqual(H.sugerirDois([]), []);
  assert.equal(H.sugerirDois([l[0]]).length, 1);
});

test('validarHorario: formato, domingo, expediente, passado, longe demais, ocupado e remarcação', () => {
  const ags = [{ id: 'x', data: '2026-10-15', hora: '09:00', status: 'confirmado' }];
  const v = o => H.validarHorario({ agora: AGORA, agendamentos: ags, ...o });
  assert.equal(v({ data: '2026-10-15', hora: '14:00' }).ok, true);
  assert.equal(v({ data: '2026-10-15', hora: '14h' }).hora, '14:00');
  assert.match(v({ data: '15/10/2026', hora: '14:00' }).motivo, /Data inválida/);
  assert.match(v({ data: '2026-10-18', hora: '10:00' }).motivo, /Domingo/);
  assert.match(v({ data: '2026-10-15', hora: '17:30' }).motivo, /expediente/);
  assert.match(v({ data: '2026-10-15', hora: '07:30' }).motivo, /expediente/);
  assert.match(v({ data: '2026-10-15', hora: '14:15' }).motivo, /30 em 30/);
  assert.match(v({ data: '2026-10-14', hora: '09:00' }).motivo, /passou/);
  assert.match(v({ data: '2027-03-01', hora: '09:00' }).motivo, /Longe/);
  assert.match(v({ data: '2026-10-15', hora: '09:00' }).motivo, /ocupado/);
  assert.match(v({ data: '2026-10-15', hora: '08:30' }).motivo, /ocupado/, '8:30 de 60 min invade o das 9');
  assert.equal(v({ data: '2026-10-15', hora: '09:00', ignorarId: 'x' }).ok, true, 'remarcar o próprio horário não conta como ocupado');
});
