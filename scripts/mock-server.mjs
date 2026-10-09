// ============================================================================
// Servidor de MENTIRA para mexer na tela sem login e sem dado real de cliente.
//
//   node scripts/mock-server.mjs            → http://localhost:3211  (perfil admin)
//   abra  http://localhost:3211/?papel=atendente   para ver como o atendente vê
//   abra  http://localhost:3211/?saude=ok          para ver a tela sem a faixa de saúde
//
// Serve a pasta public/ de verdade (o mesmo index.html, app.js e styles.css que
// vão para o Render) e responde /api/* com dados inventados. A única coisa
// trocada no HTML é a biblioteca do Supabase, que vira um dublê "já logado"
// respondendo às tabelas que o app usa, com os dados em memória.
// NUNCA é usado em produção: o Render sobe o server.js.
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 3211);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

const agora = Date.now();
const h = (n) => new Date(agora - n * 3600_000).toISOString();          // n horas atrás
const d = (n) => new Date(agora - n * 86400_000).toISOString();         // n dias atrás
const hojeMMDD = () => { const x = new Date(); return `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const U = { admin: '11111111-1111-4111-8111-111111111111', atendente: '22222222-2222-4222-8222-222222222222' };
const ETAPA = { novo: 'e1', orc: 'e2', agendado: 'e3', servico: 'e4', concluido: 'e5' };
const CLI = {
  camila: '5f6c1a2e-0001-4abc-9def-000000000001', jose: '5f6c1a2e-0002-4abc-9def-000000000002',
  renata: '5f6c1a2e-0003-4abc-9def-000000000003', marcos: '5f6c1a2e-0004-4abc-9def-000000000004',
};
const CONV = { camila: 'c0000000-0000-4000-8000-000000000001', jose: 'c0000000-0000-4000-8000-000000000002',
  renata: 'c0000000-0000-4000-8000-000000000003', marcos: 'c0000000-0000-4000-8000-000000000004',
  semcad: 'c0000000-0000-4000-8000-000000000005' };

// ---------------------------------------------------------------- dados
const DB = {
  perfis: [
    { id: U.admin, nome: 'João Pedro', email: 'joao@indycartaubate.com', papel: 'admin', ativo: true, equipe_id: null },
    { id: U.atendente, nome: 'Leonardo', email: 'leo@indycartaubate.com', papel: 'atendente', ativo: true, equipe_id: null },
  ],
  etapas_funil: [
    { id: ETAPA.novo, nome: 'Novo contato', cor: '#3b82f6', ordem: 1, ativa: true, gatilhos: [] },
    { id: ETAPA.orc, nome: 'Orçamento enviado', cor: '#f59e0b', ordem: 2, ativa: true, gatilhos: [] },
    { id: ETAPA.agendado, nome: 'Agendado', cor: '#22c55e', ordem: 3, ativa: true, gatilhos: [] },
    { id: ETAPA.servico, nome: 'Em serviço', cor: '#a855f7', ordem: 4, ativa: true, gatilhos: [] },
    { id: ETAPA.concluido, nome: 'Serviço concluído', cor: '#14b8a6', ordem: 5, ativa: true, gatilhos: [] },
  ],
  funil_config: [{ id: true, ia_classifica: false, confianca_minima: 0.6 }],
  clientes: [
    { id: CLI.camila, nome: 'Camila Rodrigues', telefone: '12996830111', telefone_e164: '12996830111', carro_modelo: 'Corolla 2020', placa: 'FHR6F16',
      origem: 'whatsapp', email: 'camila@exemplo.com', observacoes: 'Gosta de ser chamada pelo primeiro nome.',
      nascimento: `1904-${hojeMMDD()}`, aceita_mensagens: true, aceita_mensagens_em: null, aceita_mensagens_motivo: null, created_at: d(400) },
    { id: CLI.jose, nome: 'José Antônio Ferreira', telefone: '12988887777', telefone_e164: '12988887777', carro_modelo: 'S10 2018', placa: 'GFK3H26',
      origem: 'google', nascimento: '1979-03-22', aceita_mensagens: false, aceita_mensagens_em: d(12),
      aceita_mensagens_motivo: 'Pediu para parar pelo WhatsApp (resposta à campanha)', created_at: d(700) },
    { id: CLI.renata, nome: 'Renata Figueiredo', telefone: '12977776666', telefone_e164: '12977776666', carro_modelo: 'Compass 2022', placa: 'ABC1D23',
      origem: 'instagram', nascimento: null, aceita_mensagens: true, created_at: d(90) },
    { id: CLI.marcos, nome: 'Marcos Vinícius', telefone: '12966665555', telefone_e164: '12966665555', carro_modelo: 'Gol 2012', placa: null,
      origem: 'indicacao', nascimento: '1990-11-02', aceita_mensagens: true, created_at: d(30) },
  ],
  conversas: [
    { id: CONV.camila, cliente_id: CLI.camila, telefone: '5512996830111', telefone_e164: '12996830111', nome: 'Camila Rodrigues', status: 'aberta',
      atribuida_a: U.admin, ia_ativa: false, nao_lidas: 2, ultima_mensagem_em: h(0.2), ultima_previa: 'Consigo levar amanhã de manhã?', created_at: d(3),
      tipo: 'atendimento', etapa_id: ETAPA.orc, desfecho: null, aguardando_consultor: false },
    { id: CONV.jose, cliente_id: CLI.jose, telefone: '5512988887777', telefone_e164: '12988887777', nome: 'José Antônio Ferreira', status: 'pendente',
      atribuida_a: U.atendente, ia_ativa: true, nao_lidas: 0, ultima_mensagem_em: h(5), ultima_previa: 'Ok, obrigado', created_at: d(40),
      tipo: 'atendimento', etapa_id: ETAPA.novo, desfecho: null, aguardando_consultor: true, aguardando_desde: h(3) },
    { id: CONV.renata, cliente_id: CLI.renata, telefone: '5512977776666', telefone_e164: '12977776666', nome: 'Renata Figueiredo', status: 'aberta',
      atribuida_a: null, ia_ativa: true, nao_lidas: 1, ultima_mensagem_em: h(26), ultima_previa: '🖼 Foto', created_at: h(26),
      tipo: 'atendimento', etapa_id: ETAPA.novo, desfecho: null, aguardando_consultor: false },
    { id: CONV.marcos, cliente_id: CLI.marcos, telefone: '5512966665555', telefone_e164: '12966665555', nome: 'Marcos Vinícius', status: 'resolvida',
      atribuida_a: U.admin, ia_ativa: false, nao_lidas: 0, ultima_mensagem_em: d(2), ultima_previa: 'Valeu!', created_at: d(20),
      tipo: 'atendimento', etapa_id: ETAPA.novo, desfecho: null, aguardando_consultor: false },
    { id: CONV.semcad, cliente_id: null, telefone: '5512955554444', telefone_e164: '12955554444', nome: null, status: 'aberta',
      atribuida_a: null, ia_ativa: true, nao_lidas: 1, ultima_mensagem_em: h(1), ultima_previa: 'Vocês fazem alinhamento?', created_at: h(1),
      tipo: 'atendimento', etapa_id: ETAPA.novo, desfecho: null, aguardando_consultor: false },
  ],
  whatsapp_mensagens: [
    { id: 'm1', conversa_id: CONV.camila, telefone: '5512996830111', nome: 'Camila', corpo: 'Oi! Quanto fica a troca de óleo do Corolla?', direcao: 'entrada', status: 'recebido', created_at: d(1) },
    { id: 'm2', conversa_id: CONV.camila, corpo: 'Oi, Camila! Aqui é o atendimento da IndyCar. Para o Corolla a gente faz o diagnóstico gratuito primeiro, pode trazer?', direcao: 'saida', status: 'enviado', created_at: d(1) },
    { id: 'm3', conversa_id: CONV.camila, corpo: 'Consigo levar amanhã de manhã?', direcao: 'entrada', status: 'recebido', created_at: h(0.2) },
    { id: 'm4', conversa_id: CONV.jose, corpo: 'Bom dia, meu freio está fazendo barulho', direcao: 'entrada', status: 'recebido', created_at: h(6) },
    { id: 'm5', conversa_id: CONV.jose, corpo: 'Bom dia, José! Vou passar para um consultor te atender.', direcao: 'saida', status: 'enviado', gerada_por_ia: true, created_at: h(5.5) },
    { id: 'm6', conversa_id: CONV.jose, corpo: 'Ok, obrigado', direcao: 'entrada', status: 'recebido', created_at: h(5) },
    { id: 'm7', conversa_id: CONV.renata, corpo: '🖼 Foto', direcao: 'entrada', status: 'recebido', created_at: h(26) },
    { id: 'm8', conversa_id: CONV.semcad, corpo: 'Vocês fazem alinhamento?', direcao: 'entrada', status: 'recebido', created_at: h(1) },
  ],
  leads: [
    { id: 'l1', cliente_id: CLI.camila, servico: 'Troca de óleo do motor', valor_orcado: 320, valor_pago: 340, status: 'concluido', created_at: d(200), closed_at: d(190), origem: 'whatsapp' },
    { id: 'l2', cliente_id: CLI.camila, servico: 'Alinhamento 3D', valor_orcado: 180, valor_pago: 0, status: 'orcamento', created_at: d(1), origem: 'whatsapp' },
    { id: 'l3', cliente_id: CLI.jose, servico: 'Pastilha de freio', valor_orcado: 450, valor_pago: 450, status: 'concluido', created_at: d(400), closed_at: d(395), origem: 'google' },
  ],
  agendamentos: [
    { id: 'a1', cliente_id: CLI.camila, servico: 'Troca de óleo do motor', inicio_em: d(190), status: 'concluido', valor: 340, consultores: { nome: 'Leonardo' } },
    { id: 'a2', cliente_id: CLI.camila, servico: 'Alinhamento 3D', inicio_em: new Date(agora + 86400_000).toISOString(), status: 'confirmado', valor: 0, consultores: { nome: 'Leonardo' } },
    { id: 'a3', cliente_id: CLI.jose, servico: 'Pastilha de freio', inicio_em: d(395), status: 'concluido', valor: 450, consultores: { nome: 'Leonardo' } },
    { id: 'a4', cliente_id: CLI.jose, servico: 'Revisão', inicio_em: d(100), status: 'nao_veio', valor: 0, consultores: null },
  ],
  v_cliente_360: [
    { id: CLI.camila, nome: 'Camila Rodrigues', telefone: '12996830111', carro_modelo: 'Corolla 2020', placa: 'FHR6F16', origem: 'whatsapp', cliente_desde: d(400),
      total_leads: 2, total_agendamentos: 2, servicos_feitos: 1, faltas: 0, total_gasto: 340, ultimo_servico_em: d(190), proximo_horario: new Date(agora + 86400_000).toISOString(),
      email: 'camila@exemplo.com', observacoes: 'Gosta de ser chamada pelo primeiro nome.' },
    { id: CLI.jose, nome: 'José Antônio Ferreira', telefone: '12988887777', carro_modelo: 'S10 2018', placa: 'GFK3H26', origem: 'google', cliente_desde: d(700),
      total_leads: 1, total_agendamentos: 2, servicos_feitos: 1, faltas: 1, total_gasto: 450, ultimo_servico_em: d(395), proximo_horario: null },
    { id: CLI.renata, nome: 'Renata Figueiredo', telefone: '12977776666', carro_modelo: 'Compass 2022', placa: 'ABC1D23', origem: 'instagram', cliente_desde: d(90),
      total_leads: 0, total_agendamentos: 0, servicos_feitos: 0, faltas: 0, total_gasto: 0, ultimo_servico_em: null, proximo_horario: null },
    { id: CLI.marcos, nome: 'Marcos Vinícius', telefone: '12966665555', carro_modelo: 'Gol 2012', placa: null, origem: 'indicacao', cliente_desde: d(30),
      total_leads: 0, total_agendamentos: 0, servicos_feitos: 0, faltas: 0, total_gasto: 0, ultimo_servico_em: null, proximo_horario: null },
  ],
  atalhos_mensagem: [
    { id: 't1', comando: 'bomdia', titulo: 'Bom dia', corpo: 'Bom dia, {primeiro_nome}! Aqui é o atendimento da IndyCar. Como posso ajudar com o {carro}?', categoria: 'saudacao', ativo: true, usos: 12 },
    { id: 't2', comando: 'revisao', titulo: 'Lembrete de revisão', corpo: '{primeiro_nome}, sua {ultimo_servico} tem revisão prevista para {proxima_revisao}. Quer já deixar marcado?', categoria: 'retorno', ativo: true, usos: 3 },
    { id: 't3', comando: 'confirmar', titulo: 'Confirmar horário', corpo: 'Combinado, {primeiro_nome}! Te esperamos {horario} com o {carro} ({placa}). Quem conhece, Indyca! 🏎', categoria: 'agenda', ativo: true, usos: 30 },
  ],
  servicos: [{ id: 's1', nome: 'Troca de óleo do motor', ativo: true }, { id: 's2', nome: 'Alinhamento 3D', ativo: true }, { id: 's3', nome: 'Pastilha de freio', ativo: true }],
  consultores: [{ id: 'c1', nome: 'Leonardo', ativo: true }],
  codewords_config: [{ id: true, ativo: true, url_envio: null, service_id: 'indycar_carlos_whatsapp_e3cd01d3', token_webhook: 'segredo-de-teste', responder_auto: true,
    ultimo_erro: 'WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações', ultimo_evento_em: d(6),
    url_webhook_publica: 'https://nppfqhavqahapmugnyng.supabase.co/functions/v1/codewords-webhook', modo_envio: 'dispositivo' }],
  codewords_fluxos: [{ id: 'f1', nome: 'Carlos — Indycar Centro Automotivo', service_id: 'indycar_carlos_whatsapp_e3cd01d3', descricao: 'envio e recebimento', ativo: true }],
  whatsapp_config: [{ id: true, numero_exibicao: '+55 12 99683-0272', ativo: false }],
  equipes: [], etiquetas: [], conversa_etiquetas: [], conversa_eventos: [], numeros_bloqueados: [],
};
let CHAVE = 'cwk-chave-antiga-de-teste-0000000000943a';
let ultimoEnvio401 = true;   // o primeiro envio simula a chave recusada

// ------------------------------------------------- dublê do supabase-js
// Montado em texto para ser injetado no HTML. Encadeia .from().select().eq()...
// e resolve { data, error, count } lendo o DB em memória pela rota /api/_mock.
const DUBLE_SUPABASE = `<script>
(function(){
  var PAPEL = ${JSON.stringify('__PAPEL__')};
  function pedir(op){ return fetch('/api/_mock', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(op)}).then(function(r){return r.json();}); }
  function builder(tabela){
    var op = { tabela: tabela, acao: 'select', colunas: '*', filtros: [], ordem: [], limite: null, um: false, head: false, count: null, corpo: null };
    var p = {};
    p.select = function(c, o){ if (op.acao === 'select') op.colunas = c || '*'; if (o && o.count) { op.count = o.count; op.head = !!o.head; } return p; };
    p.insert = function(c){ op.acao = 'insert'; op.corpo = c; return p; };
    p.update = function(c){ op.acao = 'update'; op.corpo = c; return p; };
    p.upsert = function(c){ op.acao = 'upsert'; op.corpo = c; return p; };
    p.delete = function(){ op.acao = 'delete'; return p; };
    ['eq','neq','gt','gte','lt','lte','like','ilike','is','in','not','or'].forEach(function(f){
      p[f] = function(a,b,c){ op.filtros.push([f,a,b,c]); return p; };
    });
    p.order = function(c,o){ op.ordem.push([c, o||{}]); return p; };
    p.limit = function(n){ op.limite = n; return p; };
    p.maybeSingle = function(){ op.um = 'maybe'; return p; };
    p.single = function(){ op.um = 'single'; return p; };
    p.then = function(ok, ko){ return pedir(op).then(ok, ko); };
    return p;
  }
  var canal = { on: function(){ return canal; }, subscribe: function(cb){ setTimeout(function(){ cb && cb('SUBSCRIBED'); }, 300); return canal; } };
  window.supabase = { createClient: function(){ return {
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: { access_token: 'mock-' + PAPEL, user: { id: PAPEL === 'admin' ? ${JSON.stringify(U.admin)} : ${JSON.stringify(U.atendente)}, email: 'teste@indycartaubate.com' } } } }); },
      signInWithPassword: function(){ return Promise.resolve({ error: null }); },
      signOut: function(){ return Promise.resolve({ error: null }); },
      updateUser: function(){ return Promise.resolve({ error: null }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; }
    },
    from: builder,
    channel: function(){ return canal; },
    removeChannel: function(){},
    storage: { from: function(){ return { createSignedUrl: function(){ return Promise.resolve({ data: { signedUrl: '' } }); }, upload: function(){ return Promise.resolve({ error: null }); } }; } }
  }; } };
})();
</script>`;

// ---------------------------------------------------------------- motor de consulta
function pegar(linha, col) { return linha?.[col]; }
function aplicarFiltro(l, [f, a, b]) {
  const v = pegar(l, a);
  switch (f) {
    case 'eq': return v === b || String(v) === String(b);
    case 'neq': return v !== b;
    case 'gt': return v > b; case 'gte': return v >= b; case 'lt': return v < b; case 'lte': return v <= b;
    case 'is': return b === null ? (v === null || v === undefined) : v === b;
    case 'in': return (b || []).map(String).includes(String(v));
    case 'like': case 'ilike': return new RegExp('^' + String(b).replace(/%/g, '.*') + '$', 'i').test(String(v ?? ''));
    case 'not': { const [, , op, val] = [f, a, b]; if (op === 'is' && val === null) return !(v === null || v === undefined); return !aplicarFiltro(l, [op, a, val]); }
    case 'or': return String(a).split(',').some(parte => {
      const m = /^([a-z_0-9]+)\.(eq|in|is)\.(.*)$/.exec(parte.trim());
      if (!m) return false;
      if (m[2] === 'in') return m[3].replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/"/g, '')).includes(String(pegar(l, m[1])));
      return aplicarFiltro(l, [m[2], m[1], m[3] === 'null' ? null : m[3]]);
    });
    default: return true;
  }
}
function consultar(op) {
  const tabela = DB[op.tabela];
  if (!tabela) return { data: op.acao === 'select' ? [] : null, error: null, count: 0 };
  if (op.acao === 'insert') {
    const linhas = (Array.isArray(op.corpo) ? op.corpo : [op.corpo]).map(c => ({ id: c.id || `n${Date.now()}${Math.random().toString(16).slice(2, 6)}`, created_at: new Date().toISOString(), ...c }));
    tabela.push(...linhas);
    if (op.tabela === 'whatsapp_mensagens') {
      const conv = DB.conversas.find(c => c.id === linhas[0].conversa_id);
      if (conv) { conv.ultima_previa = linhas[0].corpo; conv.ultima_mensagem_em = linhas[0].created_at; }
    }
    return { data: op.um ? linhas[0] : linhas, error: null };
  }
  if (op.acao === 'upsert') {
    const c = op.corpo; const i = tabela.findIndex(l => String(l.id) === String(c.id));
    if (i >= 0) Object.assign(tabela[i], c); else tabela.push({ ...c });
    return { data: op.um ? c : [c], error: null };
  }
  // o builder guarda [f,a,b,c]; o filtro 'not' chega como ['not', coluna, 'is', null]
  let linhas = tabela.filter(l => op.filtros.every(([f, a, b, c]) => f === 'not' ? !aplicarFiltro(l, [b, a, c]) : aplicarFiltro(l, [f, a, b])));
  if (op.acao === 'update') { linhas.forEach(l => Object.assign(l, op.corpo)); return { data: linhas, error: null }; }
  if (op.acao === 'delete') { linhas.forEach(l => tabela.splice(tabela.indexOf(l), 1)); return { data: linhas, error: null }; }
  for (const [col, o] of op.ordem.slice().reverse()) {
    const asc = o.ascending !== false;
    linhas.sort((x, y) => {
      const a = pegar(x, col), b = pegar(y, col);
      if (a == null && b == null) return 0; if (a == null) return o.nullsFirst ? -1 : 1; if (b == null) return o.nullsFirst ? 1 : -1;
      return (a < b ? -1 : a > b ? 1 : 0) * (asc ? 1 : -1);
    });
  }
  if (op.limite) linhas = linhas.slice(0, op.limite);
  if (op.count) return { data: op.head ? null : linhas, error: null, count: linhas.length };
  if (op.um) return { data: linhas[0] ?? null, error: op.um === 'single' && !linhas[0] ? { message: 'nenhuma linha' } : null };
  return { data: linhas, error: null };
}

// ---------------------------------------------------------------- servidor
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
let PAPEL = 'admin', SAUDE_OK = false;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname, m = req.method;
  if (!p.startsWith('/api/')) {
    if (p === '/' || p === '/index.html') {
      PAPEL = url.searchParams.get('papel') === 'atendente' ? 'atendente' : 'admin';
      SAUDE_OK = url.searchParams.get('saude') === 'ok';
      const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
        .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^"]*"><\/script>/, DUBLE_SUPABASE.replace('__PAPEL__', PAPEL))
        .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, '');   // sem fonte externa no teste
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }); return res.end(html);
    }
    if (p === '/sw.js') { res.writeHead(200, { 'Content-Type': MIME['.js'] }); return res.end('/* sem service worker no modo de teste */'); }
    const arq = path.join(PUBLIC, path.normalize(p));
    if (!arq.startsWith(PUBLIC) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    return fs.createReadStream(arq).pipe(res);
  }

  let body = {};
  if (m !== 'GET') { let b = ''; for await (const c of req) b += c; try { body = JSON.parse(b || '{}'); } catch {} }
  if (p === '/api/_mock') return json(res, 200, consultar(body));
  await new Promise(r => setTimeout(r, 180));            // latência de verdade, para ver esqueletos
  const admin = PAPEL === 'admin';
  let mm;

  if (p === '/api/config') return json(res, 200, { configurado: true, supabaseUrl: 'http://mock.local', supabaseAnonKey: 'mock', iaConfigurada: true, modeloIA: 'claude-opus-5' });
  if (p === '/api/primeiro-acesso') return json(res, 200, { aberto: false });
  if (p === '/api/equipe/nomes') return json(res, 200, { ok: true, equipe: DB.perfis.map(x => ({ id: x.id, nome: x.nome, papel: x.papel })) });
  if (p === '/api/whatsapp/status') return json(res, 200, { conectado: true, inscrito: true, numero: '(12) 99683-0272' });
  if (p === '/api/saude') return json(res, 200, SAUDE_OK
    ? { ok: true, problema: null, desde: null, resumo: null, texto: '' }
    : { ok: false, problema: 'codewords-fora', desde: '2026-10-01T16:56:31.089+00:00', checadoEm: new Date().toISOString(),
        resumo: 'O CodeWords respondeu com erro 401.', texto: 'WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações' });
  if ((mm = /^\/api\/clientes\/([^/]+)\/ficha$/.exec(p))) {
    const cli = DB.clientes.find(c => c.id === mm[1]);
    if (!cli) return json(res, 404, { ok: false, erro: 'Cliente não encontrado.' });
    const r360 = DB.v_cliente_360.find(c => c.id === cli.id) || {};
    const ultimo = DB.agendamentos.filter(a => a.cliente_id === cli.id && a.status === 'concluido').sort((a, b) => b.inicio_em.localeCompare(a.inicio_em))[0] || null;
    const regra = ultimo && /[óo]leo/i.test(ultimo.servico) ? { rotulo: 'Troca de óleo do motor', meses: 6, padrao: false }
      : ultimo && /freio|pastilha/i.test(ultimo.servico) ? { rotulo: 'Freios', meses: 12, padrao: false } : { rotulo: 'Revisão geral', meses: 6, padrao: true };
    const prevista = ultimo ? new Date(new Date(ultimo.inicio_em).getTime() + regra.meses * 30.4 * 86400_000).toISOString() : null;
    const envios = cli.id === CLI.camila ? [
      { id: 'pe1', tipo: 'posvenda', status: 'enviado', enviar_em: d(187), enviado_em: d(187), respondido_em: d(187), resposta_tipo: 'positiva', rotulo: 'Pós-venda' },
      { id: 'pe2', tipo: 'aniversario', status: 'enviado', enviar_em: d(0.3), enviado_em: d(0.3), resposta_tipo: null, rotulo: 'Aniversário' },
      { id: 'pe3', tipo: 'retorno', status: 'pendente', enviar_em: new Date(agora + 5 * 86400_000).toISOString(), rotulo: 'Retorno de revisão' },
    ] : cli.id === CLI.jose ? [
      { id: 'pe4', tipo: 'campanha', status: 'enviado', enviar_em: d(12), enviado_em: d(12), respondido_em: d(12), resposta_tipo: 'parar', rotulo: 'Campanha' },
      { id: 'pe5', tipo: 'retorno', status: 'pulado', enviar_em: d(5), rotulo: 'Retorno de revisão' },
      { id: 'pe6', tipo: 'lembrete', status: 'falhou', enviar_em: d(101), erro: 'HTTP 401', rotulo: 'Lembrete de horário' },
    ] : [];
    return json(res, 200, { ok: true,
      cliente: { id: cli.id, nome: cli.nome, nascimento: cli.nascimento, aceita_mensagens: cli.aceita_mensagens !== false,
        aceita_mensagens_em: cli.aceita_mensagens_em, aceita_mensagens_motivo: cli.aceita_mensagens_motivo },
      resumo: r360, ultimoServico: ultimo, revisao: ultimo ? { prevista, ...regra, regraId: null } : null, envios,
      comunicarUrl: 'https://indycar-posvenda.onrender.com' });
  }
  if (p === '/api/codewords/chave' && m === 'GET') {
    if (!admin) return json(res, 403, { erro: 'Só o administrador vê a chave.' });
    return json(res, 200, { ok: true, mascara: '••••••••' + CHAVE.slice(-4), mascaraAgenda: '••••••••' + CHAVE.slice(-4), iguais: true, atualizadoEm: d(60),
      ultimoErro: ultimoEnvio401 ? 'WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações' : null });
  }
  if (p === '/api/codewords/testar-chave') {
    if (!admin) return json(res, 403, { erro: 'Só o administrador testa a chave.' });
    const k = body.chave || CHAVE;
    const recusada = /antiga/.test(k);
    return json(res, 200, recusada
      ? { ok: false, resultado: 'recusada', mensagem: 'Chave recusada pelo CodeWords (401). Ela foi revogada ou está errada.', status: 401, mascara: '••••••••' + k.slice(-4), salva: !body.chave }
      : { ok: true, resultado: 'ok', mensagem: 'Chave aceita pelo CodeWords — 1 conexão de WhatsApp.', status: 200, mascara: '••••••••' + k.slice(-4), salva: !body.chave });
  }
  if (p === '/api/codewords/chave' && m === 'POST') {
    if (!admin) return json(res, 403, { erro: 'Só o administrador troca a chave.' });
    const k = String(body.chave || '').trim();
    if (k.length < 20 || /\s/.test(k)) return json(res, 400, { ok: false, erro: 'Isso não parece uma chave do CodeWords (cole a chave inteira, sem espaços).' });
    if (/antiga|ruim/.test(k)) return json(res, 400, { ok: false, erro: 'O CodeWords recusou essa chave (401) — nada foi salvo. Confira se copiou a chave nova inteira.', teste: { resultado: 'recusada' } });
    CHAVE = k; ultimoEnvio401 = false; SAUDE_OK = true;
    return json(res, 200, { ok: true, mascara: '••••••••' + k.slice(-4), salvoEm: ['codewords_config', 'agenda_ia_config'], teste: { resultado: 'ok', mensagem: 'Chave aceita pelo CodeWords — 1 conexão de WhatsApp.' }, avisos: [] });
  }
  if (p === '/api/enviar') {
    if (ultimoEnvio401) return json(res, 502, { ok: false, codigo: 'codewords-401', status: 401,
      erro: 'WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações' });
    return json(res, 200, { ok: true, resposta: '{"status":"sent"}' });
  }
  if (p === '/api/conversas/sincronizar') return json(res, 200, { ok: true, novas: 0 });
  if (p === '/api/ia/sugerir') return json(res, 200, { ok: true, sugestao: 'Oi! Aqui é o atendimento da IndyCar. Pode trazer o carro amanhã às 9h para o diagnóstico gratuito?', modelo: 'mock' });
  if (p === '/api/relatorios') {
    if (!admin) return json(res, 403, { erro: 'Só o administrador vê os relatórios da equipe.' });
    const dias = Array.from({ length: 7 }, (_, i) => new Date(agora - (6 - i) * 86400_000).toISOString().slice(0, 10));
    const porDia = dias.map((dia, i) => ({ dia, leads: 2 + (i % 3), ganhos: i % 2, perdidos: 0, conversao: i % 2 ? 50 : 0, novas: 3, resolvidas: 2, backlog: 4 }));
    return json(res, 200, { ok: true, periodo: { de: dias[0], ate: dias[6], dias, fuso: 'America/Sao_Paulo' },
      resumo: { leads: 15, ganhos: 4, perdidos: 2, conversao: 66.7 }, porDia,
      origens: [{ rotulo: 'WhatsApp', volume: 9, ganhos: 3, perdidos: 1, conversao: 75 }, { rotulo: 'Google', volume: 6, ganhos: 1, perdidos: 1, conversao: 50 }],
      leadsPorAtendente: [{ atendente: 'João Pedro', volume: 10, ganhos: 3, perdidos: 1, conversao: 75 }],
      capacidade: { novos: 21, concluidos: 14, desempenho: 66.7, backlogInicial: 3, porDia },
      espera: { media: 12, amostras: 20, porDia: dias.map(dia => ({ dia, minutos: 12, amostras: 3 })) },
      duracao: { media: 240, amostras: 14, porDia: dias.map(dia => ({ dia, minutos: 240, amostras: 2 })) },
      canais: [], etiquetas: [], atendentes: [], equipes: [], mapaCalor: { matriz: Array.from({ length: 7 }, () => Array(24).fill(0)), total: 0, pico: null },
      comunicar: { total: 42, enviadas: 37, respondidas: 9, pararam: 2, falharam: 3, pendentes: 2, canceladas: 0, puladas: 0, agendaram: 4, positivas: 6,
        porTipo: { aniversario: 18, posvenda: 12, retorno: 9, campanha: 3 } },
      avisos: [] });
  }
  if (m === 'GET') return json(res, 200, { ok: true });
  return json(res, 200, { ok: true });
}).listen(PORT, () => console.log(`Atendimento (dados de MENTIRA) em http://localhost:${PORT}  ·  atendente: /?papel=atendente  ·  sem faixa: /?saude=ok`));
