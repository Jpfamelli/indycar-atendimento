/* ============================================================
   ROTAS DO COPILOTO e de CONECTIVIDADE (login obrigatório em todas)

   GET  /api/ia/contexto/:conversaId     ficha completa (tela)
   POST /api/ia/copiloto                 {conversaId, pedido?} → propostas
   POST /api/ia/acoes/:id/executar       um clique executa
   POST /api/ia/acoes/:id/recusar        {motivo?}
   POST /api/ia/acoes/:id/desfazer       quando reversível
   GET  /api/ia/acoes?conversaId=        histórico da conversa
   GET  /api/ia/config | PUT (só admin)  ia_config
   GET  /api/ia/uso                      chamadas e tokens do dia
   GET  /api/ia/horarios?servico=&dias=  horários livres (Agenda)
   POST /api/ia/resumo-do-dia            gestor/admin: pendências do dia
   GET  /api/conversa-por-telefone?t=    {conversaId} para CRM/Agenda abrirem
                                         ?conversa=<id> na tela

   As dependências vêm de fora (server.js) para dar para subir estas
   rotas num servidor de teste com dublês.
   ============================================================ */
'use strict';

const COM = require('./comunicar.js');
const CTX = require('./contexto.js');
/* Apps do ecossistema que podem chamar estas rotas pelo navegador (mesmo
   login do Supabase). A lista mora em lib/seguranca.js, junto com o resto. */
const { ORIGENS_ECOSSISTEMA } = require('./seguranca.js');

/** Variantes do telefone incluindo o 9º dígito (celular gravado com e sem o 9). */
function variantesComNove(t) {
  const d = COM.normalizarTelefone(t);
  if (!d) return [];
  const base = new Set([d]);
  if (d.length === 10 && /[6-9]/.test(d[2])) base.add(d.slice(0, 2) + '9' + d.slice(2));
  if (d.length === 11 && d[2] === '9') base.add(d.slice(0, 2) + d.slice(3));
  const out = new Set();
  for (const x of base) for (const v of COM.variantesDoTelefone(x)) out.add(v);
  return [...out];
}

/* Compara segredos sem dar pista pelo tempo de resposta (mesma regra do webhook). */
function segredosIguais(a, b) {
  const A = Buffer.from(String(a ?? ''), 'utf8'), B = Buffer.from(String(b ?? ''), 'utf8');
  if (!A.length || !B.length) return false;
  const crypto = require('node:crypto');
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function criarRotasIA({ getSb, usuarioLogado, dentroDoLimite, readBody, copiloto, resumoDoDia, contexto, auditar = async () => ({ ok: true }),
  funil = null, tokenWebhook = async () => null, ipDe = () => 'x' }) {
  const enviar = (req, res, code, data) => {
    const corpo = JSON.stringify(data);
    const cab = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(corpo),
                  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const origem = req.headers.origin;
    if (origem && ORIGENS_ECOSSISTEMA.has(origem)) {
      cab['Access-Control-Allow-Origin'] = origem;
      cab['Vary'] = 'Origin';
    }
    res.writeHead(code, cab);
    res.end(corpo);
    return true;
  };

  const exigirLogin = async (req, res, msg = 'Faça login para usar a IA.') => {
    const quem = await usuarioLogado(req);
    if (!quem) { enviar(req, res, 401, { ok: false, erro: msg }); return null; }
    return quem;
  };
  const limite = (req, res, chave, teto, janela, msg) => {
    if (dentroDoLimite(chave, teto, janela)) return true;
    enviar(req, res, 429, { ok: false, erro: msg || 'Muitos pedidos seguidos. Espere um minuto.' });
    return false;
  };
  const semBanco = (req, res) => enviar(req, res, 503, { ok: false, erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY — a IA não enxerga o banco.' });

  /** @returns {Promise<boolean>} true se a rota foi tratada aqui */
  const obterFunil = () => (typeof funil === 'function' ? funil() : funil) || null;

  return async function tratar(req, res, pathname, parametros) {
    if (!pathname.startsWith('/api/ia/') && pathname !== '/api/conversa-por-telefone') return false;
    const F = pathname.startsWith('/api/ia/funil/') || pathname === '/api/ia/hoje' || pathname === '/api/ia/config' ? obterFunil() : null;

    // pré-voo do navegador (CRM/Agenda chamando daqui)
    if (req.method === 'OPTIONS') {
      const origem = req.headers.origin;
      const cab = { 'Content-Length': 0, 'Cache-Control': 'no-store' };
      if (origem && ORIGENS_ECOSSISTEMA.has(origem)) Object.assign(cab, {
        'Access-Control-Allow-Origin': origem, Vary: 'Origin',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' });
      res.writeHead(origem && ORIGENS_ECOSSISTEMA.has(origem) ? 204 : 403, cab);
      res.end();
      return true;
    }

    /* ---------- IA do funil (rodada 5) ---------- */
    /* O banco (gatilho at_ia_enfileirar / pg_cron) avisa que há mensagem nova. Sem login:
       autenticado pelo MESMO token do webhook do CodeWords (x-codewords-token). Este pedido é
       também o que acorda o Render gratuito quando ele está dormindo. */
    if (pathname === '/api/ia/funil/acordar' && req.method === 'POST') {
      if (!limite(req, res, `funil-acordar:${ipDe(req)}`, 60, 60_000, 'Muitos avisos seguidos.')) return true;
      const esperado = await tokenWebhook().catch(() => null);
      const enviado = req.headers['x-codewords-token'] || req.headers['x-webhook-token'];
      if (!esperado || !segredosIguais(enviado, esperado)) return enviar(req, res, 401, { ok: false, erro: 'Token inválido.', codigo: 'token-invalido' });
      if (!getSb() || !F) return enviar(req, res, 503, { ok: false, erro: 'IA do funil indisponível neste servidor.' });
      await readBody(req).catch(() => ({}));
      const acordou = F.acordar();
      return enviar(req, res, 200, { ok: true, acordou, app: 'atendimento' });
    }
    if (pathname === '/api/ia/funil/estado' && req.method === 'GET') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (!limite(req, res, `funil-estado:${quem.id}`, 120, 60_000)) return true;
      if (!getSb() || !F) return enviar(req, res, 200, { ok: true, disponivel: false });
      const e = await F.estado();
      return enviar(req, res, 200, { ...e, disponivel: true });
    }
    /* Gestor/admin: processa a fila agora (botão "Rodar agora" da tela IA em ação). */
    if (pathname === '/api/ia/funil/processar' && req.method === 'POST') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (!['admin', 'gestor'].includes(quem.papel)) return enviar(req, res, 403, { ok: false, erro: 'Só gestor ou administrador roda a fila da IA à mão.' });
      if (!limite(req, res, `funil-processar:${quem.id}`, 6, 60_000, 'Espere um minuto para rodar de novo.')) return true;
      if (!getSb() || !F) return enviar(req, res, 503, { ok: false, erro: 'IA do funil indisponível neste servidor.' });
      const r = await F.processarFila({ limite: 10 });
      await auditar({ perfil: quem.id, acao: 'ia.funil.processar', tabela: 'at_ia_fila', registro: null, detalhes: r });
      return enviar(req, res, 200, { ok: true, ...r });
    }
    /* "IA em ação": o que a IA fez hoje, por conversa. */
    if (pathname === '/api/ia/hoje' && req.method === 'GET') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (!limite(req, res, `ia-hoje:${quem.id}`, 60, 60_000)) return true;
      if (!getSb() || !F) return enviar(req, res, 503, { ok: false, erro: 'IA do funil indisponível neste servidor.' });
      const r = await F.hoje({ limite: Math.min(500, Number(parametros.get('limite')) || 300) });
      return enviar(req, res, r.ok ? 200 : (r.status || 503), r);
    }

    /* ---------- ficha completa ---------- */
    let m = /^\/api\/ia\/contexto\/([^/]+)$/.exec(pathname);
    if (m && req.method === 'GET') {
      const quem = await exigirLogin(req, res, 'Faça login para ver a ficha.'); if (!quem) return true;
      if (!limite(req, res, `ctx:${quem.id}`, 120, 60_000, 'Muitas fichas seguidas. Espere um minuto.')) return true;
      if (!getSb()) return semBanco(req, res);
      const id = decodeURIComponent(m[1]);
      if (!COM.ehUuid(id)) return enviar(req, res, 400, { ok: false, erro: 'id de conversa inválido' });
      const r = await contexto.montarContexto(id, { forcar: parametros.get('fresco') === '1' });
      if (!r.ok) return enviar(req, res, r.status || 503, r);
      return enviar(req, res, 200, { ok: true, doCache: r.doCache, ficha: CTX.fichaParaTela(r.ficha) });
    }

    /* ---------- o copiloto ---------- */
    if (pathname === '/api/ia/copiloto' && req.method === 'POST') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (!limite(req, res, `copiloto:${quem.id}`, 20, 60_000, 'Muitos pedidos ao copiloto seguidos. Espere um minuto.')) return true;
      if (!limite(req, res, `copiloto-dia:${quem.id}`, 400, 86_400_000, 'Você já pediu muito ao copiloto hoje. Volta amanhã.')) return true;
      if (!getSb()) return semBanco(req, res);
      const b = await readBody(req);
      const conversaId = typeof b.conversaId === 'string' ? b.conversaId.trim() : '';
      if (!COM.ehUuid(conversaId)) return enviar(req, res, 400, { ok: false, erro: 'Informe a conversa (conversaId).' });
      const pedido = typeof b.pedido === 'string' ? b.pedido.slice(0, 800) : '';
      try {
        const r = await copiloto.rodar({ conversaId, pedido, perfil: quem });
        return enviar(req, res, r.ok ? 200 : (r.status || 503), r);
      } catch (e) {
        console.error('copiloto:', e?.message);
        return enviar(req, res, 500, { ok: false, erro: 'O copiloto falhou agora. Tente de novo em instantes.', codigo: 'erro_interno' });
      }
    }

    /* ---------- executar / recusar / desfazer ---------- */
    m = /^\/api\/ia\/acoes\/([^/]+)\/(executar|recusar|desfazer)$/.exec(pathname);
    if (m && req.method === 'POST') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (!limite(req, res, `acoes:${quem.id}`, 60, 60_000)) return true;
      if (!getSb()) return semBanco(req, res);
      const id = decodeURIComponent(m[1]);
      if (!COM.ehUuid(id)) return enviar(req, res, 400, { ok: false, erro: 'id de ação inválido' });
      const b = await readBody(req);
      const r = m[2] === 'executar' ? await copiloto.executarAcao(id, quem)
              : m[2] === 'recusar' ? await copiloto.recusarAcao(id, quem, typeof b.motivo === 'string' ? b.motivo : '')
              : await copiloto.desfazerAcao(id, quem);
      // executar/desfazer mexem no banco em nome de alguém: ficam na auditoria (recusar não muda nada)
      if (r.ok && m[2] !== 'recusar') {
        await auditar({ perfil: quem.id, acao: `ia.${m[2]}`, tabela: 'ia_acoes', registro: id, detalhes: { tipo: r.tipo || null } });
      }
      return enviar(req, res, r.ok ? 200 : (r.status || 422), r);
    }

    if (pathname === '/api/ia/acoes' && req.method === 'GET') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (!limite(req, res, `acoes-lista:${quem.id}`, 120, 60_000)) return true;
      if (!getSb()) return semBanco(req, res);
      const r = await copiloto.listarAcoes(parametros.get('conversaId') || '', { limite: Number(parametros.get('limite')) || 40 });
      return enviar(req, res, r.ok ? 200 : (r.status || 503), r);
    }

    /* ---------- configuração ---------- */
    if (pathname === '/api/ia/config' && req.method === 'GET') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (!getSb()) return semBanco(req, res);
      const cfg = await copiloto.lerConfig({ forcar: parametros.get('fresco') === '1' });
      const IAc = require('./ia-copiloto.js');
      return enviar(req, res, 200, { ok: true, config: cfg, podeEditar: quem.papel === 'admin',
        modelosPermitidos: IAc.MODELOS_PERMITIDOS, etapasFunil: IAc.ETAPAS_FUNIL, niveis: IAc.NIVEIS,
        funilDisponivel: !!F, iaConfigurada: !!process.env.ANTHROPIC_API_KEY });
    }
    if (pathname === '/api/ia/config' && req.method === 'PUT') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (quem.papel !== 'admin') return enviar(req, res, 403, { ok: false, erro: 'Só o administrador muda a configuração da IA.' });
      if (!limite(req, res, `ia-config:${quem.id}`, 20, 60_000)) return true;
      if (!getSb()) return semBanco(req, res);
      const corpo = await readBody(req);
      const r = await copiloto.salvarConfig(corpo, quem);
      if (r.ok) await auditar({ perfil: quem.id, acao: 'config.ia', tabela: 'ia_config', registro: 'true',
        detalhes: { campos: Object.keys(corpo || {}).filter(k => ['ativo', 'autonomia', 'modelo_rapido', 'modelo_forte', 'limite_chamadas_dia', 'instrucoes_extras', 'funil_ativo', 'funil_autonomia', 'funil_url'].includes(k)),
          funil_autonomia: corpo?.funil_autonomia || undefined } });
      return enviar(req, res, r.ok ? 200 : (r.status || 400), r);
    }

    /* ---------- uso do dia ---------- */
    if (pathname === '/api/ia/uso' && req.method === 'GET') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (!getSb()) return semBanco(req, res);
      const [cfg, u] = await Promise.all([copiloto.lerConfig(), copiloto.usoDoDia()]);
      return enviar(req, res, 200, { ok: true, ativo: cfg.ativo, autonomia: cfg.autonomia, limite: cfg.limite_chamadas_dia,
        funil_ativo: cfg.funil_ativo !== false, niveis: cfg.funil_niveis || null,
        chamadas: u.chamadas, restante: Math.max(0, cfg.limite_chamadas_dia - u.chamadas),
        tokensEntrada: u.tokensEntrada, tokensSaida: u.tokensSaida, executadas: u.executadas, recusadas: u.recusadas,
        porTipo: u.porTipo, minhas: u.porPerfil?.[quem.id] || 0, desde: u.desde });
    }

    /* ---------- horários livres ---------- */
    if (pathname === '/api/ia/horarios' && req.method === 'GET') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (!limite(req, res, `horarios:${quem.id}`, 120, 60_000)) return true;
      if (!getSb()) return semBanco(req, res);
      const dias = Math.min(30, Math.max(1, Number(parametros.get('dias')) || 7));
      const consultor = parametros.get('consultor');
      const livres = await contexto.livres({ servico: (parametros.get('servico') || '').slice(0, 120), dias,
        consultorId: COM.ehUuid(consultor) ? consultor : null });
      return enviar(req, res, 200, { ok: true, livres, sugeridos: require('./horarios.js').sugerirDois(livres) });
    }

    /* ---------- resumo do dia (gestor) ---------- */
    if (pathname === '/api/ia/resumo-do-dia' && req.method === 'POST') {
      const quem = await exigirLogin(req, res); if (!quem) return true;
      if (!['admin', 'gestor'].includes(quem.papel)) return enviar(req, res, 403, { ok: false, erro: 'O resumo do dia é do gestor ou do administrador.' });
      if (!limite(req, res, `resumo-dia:${quem.id}`, 6, 60_000, 'Espere um minuto para pedir outro resumo.')) return true;
      if (!getSb()) return semBanco(req, res);
      const b = await readBody(req);
      const r = await resumoDoDia({ perfil: quem, forte: b.forte === true, forcar: b.forcar === true });
      return enviar(req, res, r.ok ? 200 : (r.status || 503), r);
    }

    /* ---------- conectividade: telefone → conversa ---------- */
    if (pathname === '/api/conversa-por-telefone' && req.method === 'GET') {
      const quem = await exigirLogin(req, res, 'Faça login.'); if (!quem) return true;
      if (!limite(req, res, `tel:${quem.id}`, 120, 60_000)) return true;
      const sb = getSb();
      if (!sb) return semBanco(req, res);
      const t = (parametros.get('t') || parametros.get('tel') || '').slice(0, 40);
      const digitos = COM.normalizarTelefone(t);
      if (digitos.length < 10 || digitos.length > 11) {
        return enviar(req, res, 400, { ok: false, erro: 'Telefone inválido: mande DDD + número (10 ou 11 dígitos, com ou sem 55).' });
      }
      const vars = variantesComNove(digitos);
      const cols = 'id,nome,telefone,cliente_id,ultima_mensagem_em,tipo';
      const [a, b] = await Promise.all([
        sb.from('conversas').select(cols).in('telefone_e164', vars).limit(5),
        sb.from('conversas').select(cols).in('telefone', vars).limit(5),
      ]);
      if (a.error && b.error) return enviar(req, res, 503, { ok: false, erro: 'Não consegui procurar a conversa.' });
      const todas = [...(a.data || []), ...(b.data || [])].filter((c, i, l) => l.findIndex(x => x.id === c.id) === i)
        .sort((x, y) => String(y.ultima_mensagem_em || '').localeCompare(String(x.ultima_mensagem_em || '')));
      if (!todas.length) return enviar(req, res, 404, { ok: false, conversaId: null, erro: 'Nenhuma conversa com esse telefone ainda.', telefone: digitos });
      const c = todas[0];
      return enviar(req, res, 200, { ok: true, conversaId: c.id, nome: c.nome, clienteId: c.cliente_id, telefone: c.telefone,
        link: `/?conversa=${c.id}`, outras: todas.slice(1).map(x => x.id) });
    }

    return false;
  };
}

module.exports = { criarRotasIA, variantesComNove, ORIGENS_ECOSSISTEMA, segredosIguais };
