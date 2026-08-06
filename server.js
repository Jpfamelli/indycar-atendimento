/* ============================================================
   IndyCar — App de Atendimento (WhatsApp)
   Servidor enxuto: entrega os arquivos da interface e faz a ponte
   com a Claude. O acesso ao banco é feito pelo próprio navegador,
   direto no Supabase, usando o login do atendente (RLS protege).
   A chave da IA NUNCA vai para o navegador.
   ============================================================ */
'use strict';

const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');

// Configuração via .env (sem depender do Registro do Windows)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
    console.log('📄 Configuração lida de .env');
  }
} catch (e) {
  console.warn('⚠️  Não consegui ler o .env:', e.message);
}

const PORT   = process.env.PORT || 3200;
/* Na nuvem (Render) TEM de ser 0.0.0.0 — preso em 127.0.0.1 o roteador do
   Render nunca alcança o processo e o serviço responde por timeout.
   Na máquina da oficina fica em 127.0.0.1. */
const NA_NUVEM = !!(process.env.RENDER || process.env.PORT);
const HOST   = process.env.HOST || (NA_NUVEM ? '0.0.0.0' : '127.0.0.1');
const PUBLIC = path.join(__dirname, 'public');

const SUPABASE_URL      = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const MODELO_IA         = process.env.MODELO_IA || 'claude-opus-5';

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
               '.js':'text/javascript; charset=utf-8', '.png':'image/png',
               '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

const json = (res, code, data) => {
  const corpo = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
                        'Content-Length': Buffer.byteLength(corpo) });
  res.end(corpo);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => {
      d += c;
      if (d.length > 1e6) { reject(new Error('payload grande demais')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('acesso negado'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ------------------------------------------------------------
   IA — sugestão de resposta para o atendente
   ------------------------------------------------------------ */
const PERSONA = `Você é o atendente virtual da IndyCar Centro Automotivo, oficina mecânica em Taubaté-SP.

Sobre a oficina:
- Av. Bandeirantes, 875 - Parque Paduan, Taubaté-SP | (12) 99683-0272
- Seg a Sex 08h-18h, Sáb 08h-12h
- +18 anos de mercado, 4,8 estrelas com +1.200 avaliações no Google
- Especialidade: câmbio automático (troca de óleo 100% na máquina, por diálise)
- Serviços: troca de óleo de motor e de câmbio, freios, suspensão, direção,
  correia dentada, pneus, alinhamento 3D, embreagem, scanner, revisão de motor,
  revisão de suspensão, limpeza de bicos
- Diferenciais: diagnóstico gratuito, leva e traz grátis em Taubaté,
  garantia em peças e serviços, parcelamento em até 10x

Como responder:
- Português brasileiro, tom cordial e direto, como um balconista experiente
- Mensagens CURTAS (WhatsApp), no máximo 3 linhas
- Nunca invente preço fechado: ofereça diagnóstico gratuito e convide para agendar
- Se o cliente já é conhecido, use o histórico dele
- Nunca prometa prazo que não foi informado`;

async function sugerirResposta({ mensagens = [], cliente = null, contexto = '' }) {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) {
    return { ok: false, erro: 'A chave da Claude não está configurada.',
             instrucao: 'Preencha ANTHROPIC_API_KEY no arquivo .env e reinicie.' };
  }

  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); }
  catch {
    return { ok: false, erro: 'SDK da Anthropic não instalado.',
             instrucao: 'Rode: npm install @anthropic-ai/sdk' };
  }

  // Limita quantidade E tamanho: sem o teto por mensagem, 14 textos enormes
  // entrariam inteiros no prompt e a conta da IA dispararia.
  const historico = (Array.isArray(mensagens) ? mensagens : []).slice(-14)
    .map(m => `${m?.direcao === 'entrada' ? 'Cliente' : 'Atendente'}: ${String(m?.corpo ?? '').slice(0, 1500)}`)
    .join('\n')
    .slice(0, 12000);

  const fichaCliente = cliente ? [
    `Nome: ${cliente.nome || '—'}`,
    cliente.carro_modelo ? `Carro: ${cliente.carro_modelo}` : null,
    cliente.placa ? `Placa: ${cliente.placa}` : null,
    cliente.total_gasto ? `Já gastou: R$ ${cliente.total_gasto}` : null,
    cliente.servicos_feitos ? `Serviços feitos: ${cliente.servicos_feitos}` : null,
    cliente.proximo_horario ? `Tem horário marcado para: ${cliente.proximo_horario}` : null,
    cliente.ultimo_servico_em ? `Último serviço: ${cliente.ultimo_servico_em}` : null,
  ].filter(Boolean).join('\n') : 'Cliente novo (sem cadastro ainda).';

  const prompt = `Ficha do cliente:
${fichaCliente}

Conversa até agora:
${historico || '(nenhuma mensagem ainda)'}

${contexto ? `Orientação do atendente: ${String(contexto).slice(0, 1000)}\n` : ''}
Escreva APENAS a próxima mensagem do atendente, pronta para enviar. Sem aspas, sem rótulo.`;

  try {
    const client = new Anthropic({ apiKey: chave });
    const stream = client.messages.stream({
      model: MODELO_IA,
      max_tokens: 8000,
      output_config: { effort: 'low' },
      system: PERSONA,
      messages: [{ role: 'user', content: prompt }],
    });
    const msg = await stream.finalMessage();

    if (msg.stop_reason === 'refusal') {
      return { ok: false, erro: 'A IA recusou responder a esta mensagem.' };
    }
    const texto = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!texto) return { ok: false, erro: 'A IA devolveu resposta vazia. Tente de novo.' };

    return { ok: true, sugestao: texto, modelo: MODELO_IA,
             truncado: msg.stop_reason === 'max_tokens' };
  } catch (err) {
    return { ok: false, erro: err.message || 'falha ao falar com a Claude' };
  }
}

/* ============================================================
   CODEWORDS — a IA externa que fala com o WhatsApp
   Entrada: o CodeWords chama /api/webhook/codewords quando o
   cliente manda mensagem. Saída: quando o atendente responde,
   mandamos para o CodeWords entregar.
   ============================================================ */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Destino fixo do "Testar conexão": o WhatsApp da própria oficina
const TELEFONE_DA_OFICINA = process.env.TELEFONE_OFICINA || '5512996830272';

/* Cliente com poderes de servidor (ignora RLS). Só é preciso para o
   webhook, que chega sem usuário logado. */
function adminSupabase() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const { createClient } = require('@supabase/supabase-js');
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function registrarEvento(sb, dados) {
  try { await sb.from('codewords_eventos').insert(dados); } catch { /* log é best-effort */ }
}

/** Compara segredos sem dar pista pelo tempo de resposta. */
function segredosIguais(a, b) {
  const crypto = require('node:crypto');
  const A = Buffer.from(String(a ?? ''), 'utf8');
  const B = Buffer.from(String(b ?? ''), 'utf8');
  if (A.length !== B.length) {
    crypto.timingSafeEqual(B, B);      // gasta o mesmo tempo mesmo quando o tamanho difere
    return false;
  }
  return crypto.timingSafeEqual(A, B);
}

/** Texto vindo de fora: só aceita string/número e corta no limite.
    Objetos e arrays viram vazio, para não quebrar o insert nem gravar lixo. */
function texto1(v, max) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v).slice(0, max);
}

/** Guarda no máximo 4 KB do payload na auditoria. */
function recortarPayload(body) {
  try {
    const t = JSON.stringify(body);
    return t.length > 4000 ? { recortado: true, inicio: t.slice(0, 4000) } : body;
  } catch { return { erro: 'payload não serializável' }; }
}

/* ------------------------------------------------------------
   Porteiro: as rotas que gastam dinheiro (CodeWords, IA) só
   funcionam para atendente LOGADO e ATIVO. Essencial quando o
   servidor está exposto na internet por um túnel.
   ------------------------------------------------------------ */
const CACHE_LOGIN = new Map();   // token -> { usuario, expira } | { negado:true, expira }

/** Quando expira o próprio JWT (campo exp). Sem isso, o cache poderia
    aceitar por mais 60s um token que já venceu. */
function validadeDoToken(token) {
  try {
    const [, carga] = token.split('.');
    const { exp } = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch { return 0; }
}

async function usuarioLogado(req) {
  const auth = req.headers['authorization'] || '';
  // "Bearer" é case-insensitive no RFC 7235 e pode vir com espaços sobrando
  const m = /^\s*bearer\s+(\S+)\s*$/i.exec(auth);
  const token = m ? m[1] : null;
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const lembrado = CACHE_LOGIN.get(token);
  if (lembrado && lembrado.expira > Date.now()) {
    return lembrado.negado ? null : lembrado.usuario;
  }

  // Recusa de graça o que já venceu, sem gastar uma ida ao Supabase
  const vence = validadeDoToken(token);
  if (vence && vence <= Date.now()) return null;

  // Sem a chave de servidor não dá para conferir se o atendente segue ativo.
  // Fecha em vez de deixar passar (fail-closed).
  const sb = adminSupabase();
  if (!sb) return null;

  const negar = () => {
    if (CACHE_LOGIN.size > 500) CACHE_LOGIN.clear();
    // lembra a recusa por 30s: token inválido não derruba o servidor a cada tentativa
    CACHE_LOGIN.set(token, { negado: true, expira: Date.now() + 30_000 });
    return null;
  };

  try {
    // 1) O token é mesmo de alguém logado?
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return negar();
    const usuario = await r.json();
    if (!usuario?.id) return negar();

    // 2) E o perfil ainda está ativo? (um atendente desligado perde o acesso na hora)
    const { data: p, error } = await sb.from('perfis')
      .select('ativo, papel').eq('id', usuario.id).maybeSingle();
    if (error || !p?.ativo) return negar();
    usuario.papel = p.papel;

    if (CACHE_LOGIN.size > 500) CACHE_LOGIN.clear();          // nunca cresce sem limite
    // o cache nunca sobrevive ao próprio token
    const ate = Math.min(Date.now() + 60_000, vence || Infinity);
    CACHE_LOGIN.set(token, { usuario, expira: ate });
    return usuario;
  } catch { return null; }
}

/* Freio simples por usuário: evita que um token válido (ou um script
   distraído) queime a cota da IA e do CodeWords em segundos. */
const USO = new Map();   // chave -> { qtd, zeraEm }

function dentroDoLimite(chave, teto, janelaMs) {
  const agora = Date.now();
  const atual = USO.get(chave);
  if (!atual || atual.zeraEm <= agora) {
    if (USO.size > 500) USO.clear();
    USO.set(chave, { qtd: 1, zeraEm: agora + janelaMs });
    return true;
  }
  if (atual.qtd >= teto) return false;
  atual.qtd++;
  return true;
}

/** Mensagem chegou do WhatsApp (via CodeWords) → vira conversa + lead aqui. */
async function receberDoCodeWords(req, body) {
  const sb = adminSupabase();
  if (!sb) {
    return { status: 503, corpo: { erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY — o webhook não pode gravar.' } };
  }

  const { data: cfg, error: erroCfg } = await sb.from('codewords_config')
    .select('*').maybeSingle();

  // Confere o segredo combinado (cabeçalho ou campo no corpo).
  // FECHA quando não há token configurado ou a leitura falhou — o contrário
  // deixaria o webhook aberto para qualquer um justo no estado inicial.
  const enviado  = req.headers['x-codewords-token'] || req.headers['x-webhook-token'] || body.token;
  const esperado = typeof cfg?.token_webhook === 'string' ? cfg.token_webhook.trim() : '';
  if (erroCfg || !esperado || !segredosIguais(enviado, esperado)) {
    await registrarEvento(sb, { direcao:'entrada', sucesso:false,
      resumo: esperado ? 'token inválido' : 'webhook sem token configurado',
      erro: erroCfg ? 'não consegui ler a configuração'
                    : (esperado ? 'x-codewords-token não confere'
                                : 'defina o Token do webhook em Configurações'),
      payload: recortarPayload(body) });
    return { status: 401, corpo: { erro: 'token inválido' } };
  }

  // Aceita formatos diferentes para não travar na variação do CodeWords
  const telefone = texto1(body.telefone || body.phone || body.from || body.numero ||
                          body.sender || body.wa_id, 40);
  const texto    = texto1(body.mensagem || body.message || body.text || body.corpo ||
                          body.body, 4000);
  const nome     = texto1(body.nome || body.name || body.pushname || body.contact_name, 120) || null;

  if (!telefone || !texto) {
    await registrarEvento(sb, { direcao:'entrada', sucesso:false,
      resumo:'faltou telefone ou texto', payload: recortarPayload(body) });
    return { status: 400, corpo: { erro: 'informe telefone e mensagem',
             recebido: Object.keys(body).slice(0, 20) } };
  }

  const { error } = await sb.from('whatsapp_mensagens').insert({
    telefone, nome, corpo: texto,
    direcao: 'entrada', status: 'recebido',
    wamid: texto1(body.wamid || body.message_id, 120) || null,
  });

  if (error) {
    await registrarEvento(sb, { direcao:'entrada', sucesso:false, telefone,
      resumo:'falha ao gravar', erro: error.message, payload: recortarPayload(body) });
    return { status: 500, corpo: { erro: error.message } };
  }

  await sb.from('codewords_config').update({ ultimo_evento_em: new Date().toISOString(), ultimo_erro: null })
    .eq('id', true);
  await registrarEvento(sb, { direcao:'entrada', sucesso:true, telefone,
    resumo: texto.slice(0, 120) });

  return { status: 200, corpo: { ok: true } };
}

/** Atendente respondeu → pede ao CodeWords para entregar no WhatsApp. */
async function enviarPeloCodeWords({ telefone, corpo, nome, conversaId }) {
  const sb = adminSupabase();
  // "desligado" = ainda não configurado; a mensagem fica registrada aqui e o
  // chat não fica reclamando a cada envio.
  if (!sb) return { ok:false, desligado:true,
    erro:'Falta SUPABASE_SERVICE_ROLE_KEY no .env — a entrega pelo CodeWords está inativa.' };

  const { data: cfg } = await sb.from('codewords_config').select('*').maybeSingle();
  if (!cfg?.ativo) return { ok:false, erro:'Integração com o CodeWords está desligada.', desligado:true };

  // Se não houver URL explícita, monta a padrão do CodeWords a partir do Service ID
  const destino = cfg.url_envio || (cfg.service_id
    ? `https://runtime.codewords.ai/run/${cfg.service_id}` : null);
  if (!destino) {
    return { ok:false, desligado:true,
      erro:'Informe o Service ID do seu fluxo no CodeWords (ou a URL completa de envio).' };
  }

  const cabecalhos = { 'Content-Type': 'application/json',
                       ...(cfg.cabecalho_extra || {}) };
  if (cfg.api_key) {
    cabecalhos['Authorization'] = `Bearer ${cfg.api_key}`;
    cabecalhos['X-API-Key'] = cfg.api_key;   // cobre as duas convenções
  }

  try {
    const resposta = await fetch(destino, {
      method: 'POST', headers: cabecalhos,
      body: JSON.stringify({
        service_id: cfg.service_id || undefined,
        telefone, phone: telefone,        // nomes alternativos, por compatibilidade
        mensagem: corpo, message: corpo,
        nome, conversa_id: conversaId,
        origem: 'indycar-atendimento',
      }),
      signal: AbortSignal.timeout(20000),
    });

    const txt = await resposta.text();
    if (!resposta.ok) {
      await sb.from('codewords_config').update({ ultimo_erro: `HTTP ${resposta.status}: ${txt.slice(0,200)}` }).eq('id', true);
      await registrarEvento(sb, { direcao:'saida', sucesso:false, telefone,
        resumo: corpo.slice(0,120), erro:`HTTP ${resposta.status}` });

      // Erros comuns traduzidos para o atendente entender na hora
      let erro = `CodeWords respondeu ${resposta.status}`;
      if (resposta.status === 429 && /limit/i.test(txt)) {
        erro = 'A cota mensal do CodeWords acabou — a mensagem ficou registrada aqui, '
             + 'mas não saiu no WhatsApp. Renove o plano ou aguarde virar o mês.';
      } else if (resposta.status === 401 || resposta.status === 403) {
        erro = 'O CodeWords recusou a chave de API — confira em Configurações.';
      } else if (resposta.status === 404) {
        erro = 'O CodeWords não achou esse fluxo — confira o Service ID em Configurações.';
      }
      return { ok:false, erro };
    }

    await sb.from('codewords_config').update({
      ultimo_evento_em: new Date().toISOString(), ultimo_erro: null }).eq('id', true);
    await registrarEvento(sb, { direcao:'saida', sucesso:true, telefone, resumo: corpo.slice(0,120) });
    return { ok:true, resposta: txt.slice(0, 500) };
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'CodeWords não respondeu a tempo (20s)' : err.message;
    await sb.from('codewords_config').update({ ultimo_erro: msg }).eq('id', true);
    await registrarEvento(sb, { direcao:'saida', sucesso:false, telefone,
      resumo: corpo.slice(0,120), erro: msg });
    return { ok:false, erro: msg };
  }
}

/* ------------------------------------------------------------
   Servidor
   ------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  try {
    // Dentro do try de propósito: um Host malformado (ex.: "Host: [") faz o
    // parser de URL lançar, e fora daqui isso derrubaria o processo inteiro.
    let pathname;
    try {
      pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    } catch {
      return json(res, 400, { erro: 'requisição malformada' });
    }

    // A interface precisa saber onde fica o Supabase (a anon key é pública por design)
    if (pathname === '/api/config' && req.method === 'GET') {
      return json(res, 200, {
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        configurado: !!(SUPABASE_URL && SUPABASE_ANON_KEY),
        iaConfigurada: !!process.env.ANTHROPIC_API_KEY,
      });
    }

    if (pathname === '/api/ia/sugerir' && req.method === 'POST') {
      const quem = await usuarioLogado(req);
      if (!quem) return json(res, 401, { erro: 'Faça login para usar a IA.' });
      if (!dentroDoLimite(`ia:${quem.id}`, 30, 60_000)) {
        return json(res, 429, { erro: 'Muitas sugestões seguidas. Espere um minuto.' });
      }
      const r = await sugerirResposta(await readBody(req));
      return json(res, r.ok ? 200 : 503, r);
    }

    // ---- CodeWords: mensagem chegando do WhatsApp ----
    if (pathname === '/api/webhook/codewords') {
      if (req.method === 'GET') {
        // alguns serviços validam a URL antes de começar a mandar.
        // Não contamos aqui se há chave de servidor: isso só diria a um
        // curioso se vale a pena tentar o POST.
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST') {
        const r = await receberDoCodeWords(req, await readBody(req));
        return json(res, r.status, r.corpo);
      }
      return json(res, 405, { erro: 'use POST' });
    }

    // ---- CodeWords: entregar a resposta do atendente ----
    if (pathname === '/api/enviar' && req.method === 'POST') {
      const quem = await usuarioLogado(req);
      if (!quem) return json(res, 401, { erro: 'Faça login para enviar mensagens.' });
      if (!dentroDoLimite(`enviar:${quem.id}`, 60, 60_000)) {
        return json(res, 429, { erro: 'Muitas mensagens seguidas. Espere um minuto.' });
      }
      const bruto = await readBody(req);
      const dados = {
        telefone:   texto1(bruto.telefone, 40),
        corpo:      texto1(bruto.corpo, 4000),
        nome:       texto1(bruto.nome, 120) || null,
        conversaId: texto1(bruto.conversaId, 60) || null,
      };
      if (!dados.telefone || !dados.corpo) {
        return json(res, 400, { erro: 'informe telefone e corpo' });
      }
      const r = await enviarPeloCodeWords(dados);
      // "desligado" não é erro: a mensagem fica registrada aqui mesmo assim
      return json(res, r.ok || r.desligado ? 200 : 502, r);
    }

    // ---- Teste da conexão com o CodeWords ----
    if (pathname === '/api/codewords/testar' && req.method === 'POST') {
      // Manda WhatsApp de verdade e gasta cota: só admin, e só para o
      // número da própria oficina (senão viraria uma máquina de spam).
      const quem = await usuarioLogado(req);
      if (!quem) return json(res, 401, { erro: 'Faça login para testar a conexão.' });
      if (quem.papel !== 'admin') {
        return json(res, 403, { erro: 'Só o administrador pode testar a conexão.' });
      }
      await readBody(req);   // consome o corpo; o número de destino é fixo de propósito
      const r = await enviarPeloCodeWords({
        telefone: TELEFONE_DA_OFICINA,
        corpo: '🏁 Teste de conexão do painel de atendimento da IndyCar.',
        nome: 'Teste',
      });
      return json(res, r.ok ? 200 : 502, r);
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { erro: 'rota não encontrada' });

    serveStatic(res, pathname);
  } catch (err) {
    json(res, 500, { erro: err.message || 'erro interno' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n💬 IndyCar Atendimento em http://localhost:${PORT}`);
  console.log(SUPABASE_URL && SUPABASE_ANON_KEY
    ? '   🗄️  Supabase conectado'
    : '   ⚠️  Falta configurar SUPABASE_URL e SUPABASE_ANON_KEY no .env');
  console.log(process.env.ANTHROPIC_API_KEY
    ? '   ✨ IA pronta'
    : '   ⚠️  Sem ANTHROPIC_API_KEY — a aba de IA fica desativada');
  console.log(HOST === '127.0.0.1' ? '   (acessível só neste computador)\n' : `   exposto em ${HOST}\n`);
});
