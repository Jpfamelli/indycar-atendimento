'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../lib/acesso.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');

const ID = { admin: 'aaaaaaaa-0000-4000-8000-000000000001', gestor: 'aaaaaaaa-0000-4000-8000-000000000002',
  atendente: 'aaaaaaaa-0000-4000-8000-000000000003', agenda: 'aaaaaaaa-0000-4000-8000-000000000004',
  desativado: 'aaaaaaaa-0000-4000-8000-000000000005', semApp: 'aaaaaaaa-0000-4000-8000-000000000006',
  mfa: 'aaaaaaaa-0000-4000-8000-000000000007', semPerfil: 'aaaaaaaa-0000-4000-8000-000000000008' };
const TODOS = ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'];

function perfis() {
  return [
    { id: ID.admin, nome: 'Dono', papel: 'admin', ativo: true, apps: [] },
    { id: ID.gestor, nome: 'Gê', papel: 'gestor', ativo: true, apps: ['atendimento', 'crm'] },
    { id: ID.atendente, nome: 'Ana', papel: 'atendente', ativo: true, apps: TODOS, precisa_trocar_senha: true, preferencias: { tema: 'escuro' } },
    { id: ID.agenda, nome: 'Franklin', papel: 'agenda', ativo: true, apps: ['agenda'] },
    { id: ID.desativado, nome: 'Ex', papel: 'atendente', ativo: false, apps: TODOS },
    { id: ID.semApp, nome: 'Só CRM', papel: 'atendente', ativo: true, apps: ['crm'] },
    { id: ID.mfa, nome: 'Seguro', papel: 'atendente', ativo: true, apps: TODOS },
  ];
}
const jwt = (carga) => `x.${Buffer.from(JSON.stringify(carga)).toString('base64url')}.y`;

function montar({ agora = () => Date.now(), perfisDb = perfis(), fora = false } = {}) {
  const sb = criarSbFalso({ perfis: perfisDb });
  const idas = [];
  const acesso = A.criarAcesso({
    getSb: () => sb, agora, log: () => {},
    buscarUsuario: async token => {
      idas.push(token);
      if (fora) throw new Error('rede');
      const c = A.cargaDoToken(token);
      if (!c.sub) return { ok: false };
      return { ok: true, usuario: { id: c.sub, email: `${c.sub.slice(-1)}@x.com`, factors: c.sub === ID.mfa ? [{ id: 'f1', status: 'verified' }] : [] } };
    },
  });
  const req = carga => ({ headers: { authorization: `Bearer ${jwt({ exp: Math.floor(Date.now() / 1000) + 3600, ...carga })}` } });
  return { sb, acesso, idas, req };
}

test('sem token → 401 sem_login; token de ninguém → 401 sessao_invalida; vencido → sessao_expirada sem ir ao Supabase', async () => {
  const { acesso, idas, req } = montar();
  assert.deepEqual((await acesso.autenticar({ headers: {} })).codigo, 'sem_login');
  assert.equal((await acesso.autenticar(req({}))).codigo, 'sessao_invalida');
  const vencido = { headers: { authorization: `Bearer ${jwt({ sub: ID.admin, exp: 1 })}` } };
  const r = await acesso.autenticar(vencido);
  assert.equal(r.status, 401); assert.equal(r.codigo, 'sessao_expirada');
  assert.equal(idas.length, 1, 'o vencido nem consultou');
});

test('desativado → 401 desativado; agenda e sem o app → 403 sem_acesso_app com os apps que pode usar', async () => {
  const { acesso, req } = montar();
  const d = await acesso.autenticar(req({ sub: ID.desativado }));
  assert.equal(d.status, 401); assert.equal(d.codigo, 'desativado');
  const ag = await acesso.autenticar(req({ sub: ID.agenda }));
  assert.equal(ag.status, 403); assert.equal(ag.codigo, 'sem_acesso_app');
  assert.deepEqual(ag.apps.map(a => a.app), ['agenda']);
  assert.match(ag.apps[0].link, /indycar-agendamentos/);
  const s = await acesso.autenticar(req({ sub: ID.semApp }));
  assert.equal(s.status, 403); assert.equal(s.codigo, 'sem_acesso_app');
  assert.match(s.erro, /Atendimento/);
  const sp = await acesso.autenticar(req({ sub: ID.semPerfil }));
  assert.equal(sp.codigo, 'sem_perfil');
});

test('admin entra mesmo sem apps; gestor e atendente com o app entram; papel, apps e precisa_trocar_senha vêm junto', async () => {
  const { acesso, req } = montar();
  const a = await acesso.autenticar(req({ sub: ID.admin }));
  assert.equal(a.ok, true); assert.equal(a.usuario.papel, 'admin');
  assert.equal((await acesso.autenticar(req({ sub: ID.gestor }))).usuario.papel, 'gestor');
  const at = await acesso.autenticar(req({ sub: ID.atendente }));
  assert.equal(at.usuario.precisa_trocar_senha, true);
  assert.equal(at.usuario.email, '3@x.com');
  const eu = A.dadosDoEu(at.usuario);
  assert.deepEqual(Object.keys(eu).slice(0, 10), ['id', 'nome', 'email', 'papel', 'apps', 'cargo', 'telefone', 'avatar_cor', 'equipe_id', 'recebe_leads']);
  assert.equal(eu.precisa_trocar_senha, true);
  assert.deepEqual(eu.preferencias, { tema: 'escuro' });
  assert.equal(eu.pode.gerenciar_equipe, false);
  assert.deepEqual(A.dadosDoEu(a.usuario).apps, TODOS, 'admin vê todos os apps');
  assert.equal(A.dadosDoEu(a.usuario).pode.ver_auditoria, true);
});

test('MFA: com fator verificado e token aal1 → mfaPendente; aal2 libera', async () => {
  const { acesso, req } = montar();
  const r1 = await acesso.autenticar(req({ sub: ID.mfa, aal: 'aal1' }));
  assert.equal(r1.ok, true); assert.equal(r1.usuario.mfaPendente, true); assert.equal(r1.usuario.mfa.ativo, true);
  const r2 = await acesso.autenticar(req({ sub: ID.mfa, aal: 'aal2', jti: 'outro' }));
  assert.equal(r2.usuario.mfaPendente, false); assert.equal(r2.usuario.mfa.nivel, 'aal2');
  const r3 = await acesso.autenticar(req({ sub: ID.atendente, aal: 'aal1' }));
  assert.equal(r3.usuario.mfaPendente, false, 'sem fator não pede código');
});

test('cache: 60 s por token; desativar no meio + esquecerPerfil derruba na hora', async () => {
  let t = Date.now();
  const { acesso, idas, req, sb } = montar({ agora: () => t });
  const r = req({ sub: ID.atendente });
  await acesso.autenticar(r); await acesso.autenticar(r);
  assert.equal(idas.length, 1, 'segunda veio do cache');
  sb.db.perfis.find(p => p.id === ID.atendente).ativo = false;
  assert.equal((await acesso.autenticar(r)).ok, true, 'ainda no cache');
  assert.equal(acesso.esquecerPerfil(ID.atendente), 1);
  const d = await acesso.autenticar(r);
  assert.equal(d.codigo, 'desativado');
  // a recusa também é esquecida quando reativa
  sb.db.perfis.find(p => p.id === ID.atendente).ativo = true;
  acesso.esquecerPerfil(ID.atendente);
  assert.equal((await acesso.autenticar(r)).ok, true);
  t += 61_000;
  await acesso.autenticar(r);
  assert.equal(idas.length, 4, 'depois de 60 s confere de novo');
});

test('Supabase fora do ar → 503 (não confunde com senha errada); sem banco → 503 fail-closed', async () => {
  const { acesso, req } = montar({ fora: true });
  const r = await acesso.autenticar(req({ sub: ID.admin }));
  assert.equal(r.status, 503); assert.equal(r.codigo, 'auth_fora');
  const semBanco = A.criarAcesso({ getSb: () => null, buscarUsuario: async () => ({ ok: true, usuario: { id: ID.admin } }) });
  assert.equal((await semBanco.autenticar(req({ sub: ID.admin }))).status, 503);
});

test('último acesso: grava ultimo_acesso_em/ultimo_app no máximo a cada 5 min por pessoa', async () => {
  let t = Date.parse('2026-10-13T12:00:00Z');
  const { acesso, sb } = montar({ agora: () => t });
  const u = { id: ID.atendente, ultimo_acesso_em: null };
  assert.equal(acesso.marcarAcesso(u), true);
  await new Promise(r => setImmediate(r));
  const p = sb.db.perfis.find(x => x.id === ID.atendente);
  assert.equal(p.ultimo_acesso_em, '2026-10-13T12:00:00.000Z');
  assert.equal(p.ultimo_app, 'atendimento');
  t += 4 * 60_000;
  assert.equal(acesso.marcarAcesso(u), false);
  t += 61_000;
  assert.equal(acesso.marcarAcesso(u), true);
  // quem acabou de acessar (pelo banco) não grava de novo logo depois de o servidor reiniciar
  const outro = montar({ agora: () => t }).acesso;
  assert.equal(outro.marcarAcesso({ id: ID.gestor, ultimo_acesso_em: new Date(t - 60_000).toISOString(), ultimo_app: 'atendimento' }), false);
  assert.equal(outro.marcarAcesso({ id: ID.gestor, ultimo_acesso_em: new Date(t - 60_000).toISOString(), ultimo_app: 'crm' }), true);
});

test('conferirPerfil e tokenDe (Bearer sem diferenciar maiúsculas)', () => {
  assert.equal(A.tokenDe({ headers: { authorization: '  bearer   abc  ' } }), 'abc');
  assert.equal(A.tokenDe({ headers: { authorization: 'Basic abc' } }), null);
  assert.equal(A.conferirPerfil({ papel: 'gestor', ativo: true, apps: ['atendimento'] }).ok, true);
  assert.equal(A.conferirPerfil({ papel: 'gestor', ativo: true, apps: ['crm'] }).codigo, 'sem_acesso_app');
  assert.equal(A.conferirPerfil({ papel: 'admin', ativo: false }).codigo, 'desativado');
});
