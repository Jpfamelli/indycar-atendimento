'use strict';
/* Pátio (16/10/2026): o carro dentro da oficina na ficha e no copiloto.
   Banco de mentira (sb-falso) e o server.js numa porta livre — nada sai para a rede. */
const test = require('node:test');
const assert = require('node:assert/strict');
const PAT = require('../lib/patio.js');
const CTX = require('../lib/contexto.js');
const { criarSbFalso } = require('./apoio/sb-falso.js');
const { ID, AGORA, tabelas } = require('./apoio/dados.js');

const OS_ID = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'ab12cd34ef56ab12cd34ef56ab12cd34';
const os = (o = {}) => ({ id: OS_ID, numero: 57, etapa: 'em_execucao', etapa_em: new Date(AGORA - 95 * 60_000).toISOString(),
  cliente_id: ID.cliente, telefone: '12977776666', veiculo: 'Corolla', placa: 'GFK3H26', servico: 'Troca de pastilhas',
  previsao_entrega: null, entregue_em: null, token_publico: TOKEN, link_visto_em: null, created_at: new Date(AGORA - 3 * 3600_000).toISOString(), ...o });
const extras = () => [
  { os_id: OS_ID, descricao: 'Disco de freio dianteiro', urgencia: 'seguranca', status: 'pendente', valor: 680, created_at: '2026-10-15T10:00:00Z' },
  { os_id: OS_ID, descricao: 'Fluido de freio', urgencia: 'recomendado', status: 'aprovado', valor: 120.5, created_at: '2026-10-15T09:00:00Z' },
  { os_id: OS_ID, descricao: 'Palheta', urgencia: 'pode_esperar', status: 'recusado', valor: 60, created_at: '2026-10-15T09:30:00Z' },
];

test('links: acompanhar, área do cliente e pátio — token/base estranhos viram null', () => {
  assert.equal(PAT.linkAcompanhar('https://indycar-patio.netlify.app/', TOKEN), `https://indycar-patio.netlify.app/acompanhar/?t=${TOKEN}`);
  assert.equal(PAT.linkArea(null, TOKEN), `${PAT.PATIO_URL}/minha/?c=${TOKEN}`);
  assert.equal(PAT.linkArea('javascript:alert(1)', TOKEN), null);
  assert.equal(PAT.linkAcompanhar('https://x.app', '<script>'), null);
  assert.equal(PAT.linkPatio(OS_ID), `${PAT.PATIO_URL}/?os=${OS_ID}`);
  assert.equal(PAT.linkPatio('x'), PAT.PATIO_URL);
});

test('textos do chat: primeiro nome, "carro", sem prezado/veículo', () => {
  const t = PAT.textoDoAcompanhamento({ nome: 'Camila Souza', veiculo: '', link: 'https://x/acompanhar/?t=1' });
  assert.match(t, /^Oi Camila!/); assert.match(t, /seu carro/); assert.doesNotMatch(t, /prezad|veículo|efetu/i);
  assert.match(PAT.textoDaArea({ nome: 'Ana', link: 'https://x/minha/?c=1' }), /Área do Cliente/);
  assert.equal(PAT.textoDaArea({ nome: 'Ana' }), '');
});

test('escolher a ordem: aberta mais nova; sem aberta, entregue há até 2 dias; cancelada nunca', () => {
  const agora = new Date(AGORA);
  assert.equal(PAT.escolherOrdem([os({ id: 'a', etapa: 'entregue', entregue_em: new Date(AGORA - 3600_000).toISOString() }), os({ id: 'b' })], agora).id, 'b');
  assert.equal(PAT.escolherOrdem([os({ etapa: 'entregue', entregue_em: new Date(AGORA - 3600_000).toISOString() })], agora).etapa, 'entregue');
  assert.equal(PAT.escolherOrdem([os({ etapa: 'entregue', entregue_em: new Date(AGORA - 5 * 86400_000).toISOString() })], agora), null);
  assert.equal(PAT.escolherOrdem([os({ etapa: 'cancelado' })], agora), null);
});

test('resumo da ordem para a tela: etapa, tempo, extras e soma dos aprovados', () => {
  const r = PAT.resumoDaOs(os(), extras(), 'https://indycar-patio.netlify.app', new Date(AGORA));
  assert.equal(r.etapa_rotulo, 'Em execução'); assert.equal(r.tempo_na_etapa, '2 h');
  assert.equal(r.extras_pendentes.length, 1); assert.equal(r.extras_pendentes[0].valor, 680);
  assert.equal(r.extras_aprovados, 1); assert.equal(r.extras_recusados, 1); assert.equal(r.valor_aprovado, 120.5);
  assert.match(r.link_cliente, /acompanhar\/\?t=/);
  assert.equal(PAT.resumoDaOs(os({ etapa: 'cancelado' }), [], undefined, new Date(AGORA)).link_cliente, null);
});

test('texto da IA: etapa real, SEM previsão → não promete prazo; sem R$, sem link, sem token', () => {
  const r = PAT.resumoDaOs(os(), extras(), undefined, new Date(AGORA));
  const t = PAT.textoPatioParaIA(r, new Date(AGORA));
  assert.match(t, /Etapa atual: Em execução \(há 2 h\)/);
  assert.match(t, /AINDA NÃO está pronto/);
  assert.match(t, /NÃO há previsão de entrega registrada: NÃO prometa prazo/);
  assert.match(t, /Disco de freio dianteiro \(segurança\)/);
  assert.doesNotMatch(t, /R\$|680|120/);
  assert.doesNotMatch(t, new RegExp(TOKEN));
  assert.doesNotMatch(t, /https?:\/\//);
});

test('texto da IA: previsão registrada vale como "a previsão é"; previsão vencida não é repetida; pronto e entregue', () => {
  const fut = PAT.textoPatioParaIA(PAT.resumoDaOs(os({ previsao_entrega: new Date(AGORA + 5 * 3600_000).toISOString() }), [], undefined, new Date(AGORA)), new Date(AGORA));
  assert.match(fut, /Previsão registrada pela equipe:/);
  const venc = PAT.textoPatioParaIA(PAT.resumoDaOs(os({ previsao_entrega: new Date(AGORA - 3600_000).toISOString() }), [], undefined, new Date(AGORA)), new Date(AGORA));
  assert.match(venc, /JÁ PASSOU: não repita esse prazo/);
  const pronto = PAT.textoPatioParaIA(PAT.resumoDaOs(os({ etapa: 'pronto' }), [], undefined, new Date(AGORA)), new Date(AGORA));
  assert.match(pronto, /ESTÁ PRONTO/); assert.match(pronto, /8h às 17h30/);
  const ent = PAT.textoPatioParaIA(PAT.resumoDaOs(os({ etapa: 'entregue', entregue_em: new Date(AGORA - 3600_000).toISOString() }), [], undefined, new Date(AGORA)), new Date(AGORA));
  assert.match(ent, /já foi ENTREGUE/);
  assert.equal(PAT.textoPatioParaIA(null), '');
});

test('contexto do copiloto: a ficha traz a OS em andamento e o prompt responde "está pronto?" com a etapa real', async () => {
  const t = tabelas();
  t.patio_os = [os(), os({ id: '44444444-4444-4444-8444-444444444445', etapa: 'cancelado', created_at: new Date(AGORA).toISOString() })];
  t.patio_extras = extras();
  t.patio_config = [{ id: true, link_base: 'https://indycar-patio.netlify.app' }];
  const sb = criarSbFalso(t);
  const ctx = CTX.criarContexto({ sb, agora: () => AGORA });
  const r = await ctx.montarContexto(ID.conversa);
  assert.equal(r.ok, true);
  assert.equal(r.ficha.patio.id, OS_ID);
  assert.equal(r.ficha.patio.etapa, 'em_execucao');
  assert.deepEqual(r.ficha.avisos, []);
  const txt = CTX.textoParaIA(r.ficha);
  assert.match(txt, /CARRO NA OFICINA/);
  assert.match(txt, /Etapa atual: Em execução/);
  assert.doesNotMatch(txt, new RegExp(TOKEN), 'o token do cliente não vai para a IA');
  // a tela recebe o link (é do atendente)
  assert.match(CTX.fichaParaTela(r.ficha).patio.link_cliente, /acompanhar/);
});

test('contexto: cliente sem pátio → patio null e o prompt não ganha o bloco; erro do pátio vira aviso', async () => {
  const sb = criarSbFalso(tabelas());
  const r = await CTX.criarContexto({ sb, agora: () => AGORA }).montarContexto(ID.conversa);
  assert.equal(r.ficha.patio, null);
  assert.doesNotMatch(CTX.textoParaIA(r.ficha), /CARRO NA OFICINA/);
  const sb2 = criarSbFalso(tabelas(), { falhas: { patio_os: { msg: 'tabela fora' } } });
  const r2 = await CTX.criarContexto({ sb: sb2, agora: () => AGORA }).montarContexto(ID.conversa);
  assert.equal(r2.ok, true);
  assert.equal(r2.ficha.patio, null);
  assert.ok(r2.ficha.avisos.some(a => /pátio/.test(a)));
});

test('Área do Cliente: a rpc devolve o token uma vez e vira o link /minha/?c=', async () => {
  const sb = criarSbFalso({ patio_config: [{ id: true, link_base: 'https://indycar-patio.netlify.app' }] },
    { rpc: { cliente_gerar_acesso: (a) => (a.p_cliente === ID.cliente ? { data: TOKEN, error: null } : { data: null, error: { message: 'cliente não encontrado' } }) } });
  const p = PAT.criarPatio({ sb });
  assert.deepEqual(await p.gerarLinkDaArea(ID.cliente), { ok: true, link: `https://indycar-patio.netlify.app/minha/?c=${TOKEN}` });
  assert.equal((await p.gerarLinkDaArea('33333333-3333-4333-8333-000000000000')).status, 404);
  assert.equal((await p.gerarLinkDaArea('nada')).status, 400);
});

test('copiloto: regra de não prometer prazo do pátio está no system prompt', () => {
  const fonte = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'ia-copiloto.js'), 'utf8');
  assert.match(fonte, /CARRO NA OFICINA/);
  assert.match(fonte, /sem previsão, não\s+prometa dia nem hora/);
});

test('server.js: rota da Área do Cliente plugada e exige login', async () => {
  process.env.SO_FUNCOES = '1';
  const app = require('../server.js');
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const r = await fetch(`${base}/api/clientes/${ID.cliente}/area-cliente`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 401);
    assert.match(r.headers.get('content-type'), /json/);
  } finally { await new Promise(r => app.server.close(r)); }
});
