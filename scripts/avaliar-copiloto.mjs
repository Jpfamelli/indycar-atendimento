// ============================================================================
// Avaliação do copiloto da IA com conversas REAIS, em modo "só sugerir",
// SEM gravar nada no banco (rodada 4).
//
//   node scripts/avaliar-copiloto.mjs <id1,id2,...>  [--saida arquivo.json] [--rotulo antes|depois]
//
// - Lê o banco de verdade com a chave de serviço do .env, mas por um "banco só
//   leitura": todo insert/update/upsert/delete/rpc vira de mentira (nada é
//   gravado — nem em ia_acoes). A autonomia é forçada para "sugerir".
// - Chama a IA de verdade (custa tokens: ~10 conversas por rodada).
// - Imprime, por conversa, as últimas mensagens, a resposta sugerida, as ações e
//   as checagens automáticas (preço, vocabulário proibido, tamanho, nº de perguntas,
//   duas opções de horário quando o cliente quer agendar).
// ============================================================================
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(path.join(RAIZ, '.env'));
process.env.SO_FUNCOES = '1';
process.env.SINCRONIA = '0';
const { createClient } = require('@supabase/supabase-js');
const CTX = require(path.join(RAIZ, 'lib', 'contexto.js'));
const IA = require(path.join(RAIZ, 'lib', 'ia-copiloto.js'));
const app = require(path.join(RAIZ, 'server.js'));

const args = process.argv.slice(2);
const ids = (args.find(a => !a.startsWith('--')) || '').split(',').filter(Boolean);
const saida = args.includes('--saida') ? args[args.indexOf('--saida') + 1] : null;
const rotulo = args.includes('--rotulo') ? args[args.indexOf('--rotulo') + 1] : 'avaliacao';
if (!ids.length) { console.error('Informe os ids das conversas separados por vírgula.'); process.exit(1); }

const real = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const bloqueadas = [];

/** Banco só leitura: leitura vai ao banco; escrita vira de mentira e fica anotada. */
function soLeitura(sb) {
  const falsa = (tabela, op, dados) => {
    bloqueadas.push({ tabela, op });
    const linha = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...(Array.isArray(dados) ? {} : dados || {}) };
    const r = { data: op === 'delete' ? [] : linha, error: null };
    const cadeia = new Proxy(() => {}, {
      get(_a, k) {
        if (k === 'then') return (ok, ko) => Promise.resolve(k === 'then' ? r : r).then(ok, ko);
        if (k === 'select') return () => cadeia;
        return () => cadeia;
      },
    });
    return cadeia;
  };
  return new Proxy(sb, {
    get(alvo, k) {
      if (k === 'rpc') return (nome) => { bloqueadas.push({ tabela: 'rpc:' + nome, op: 'rpc' }); return Promise.resolve({ data: null, error: null }); };
      if (k !== 'from') return alvo[k];
      return (tabela) => {
        const b = alvo.from(tabela);
        return new Proxy(b, {
          get(bb, kk) {
            if (['insert', 'update', 'upsert', 'delete'].includes(kk)) return (d) => falsa(tabela, kk, d);
            if (tabela === 'ia_config' && kk === 'select') {
              // autonomia forçada para "sugerir" (nada executa nem com clique)
              return (...a) => {
                const q = bb.select(...a);
                const orig = q.then.bind(q);
                q.then = (ok, ko) => orig(r => ({ ...r, data: r.data ? (Array.isArray(r.data) ? r.data.map(x => ({ ...x, autonomia: 'sugerir' })) : { ...r.data, autonomia: 'sugerir' }) : r.data })).then(ok, ko);
                return q;
              };
            }
            const v = bb[kk];
            return typeof v === 'function' ? v.bind(bb) : v;
          },
        });
      };
    },
  });
}

const sb = soLeitura(real);
const contexto = CTX.criarContexto({ sb });
const cop = IA.criarCopiloto({ sb, contexto, criarIA: app.criarClienteIA, persona: app.PERSONA });

const PROIBIDAS = /\b(prezad[oa]s?|efetu\w+|comparec\w+|ve[ií]culos?)\b/i;
const PRECO = /R\$\s*\d|\b\d+(?:[.,]\d+)?\s*(?:reais|real)\b/i;
function checar(r, ficha) {
  const t = r.resposta_sugerida || '';
  const perguntas = (t.match(/\?/g) || []).length;
  const ultimaEntrada = [...(ficha?.mensagens || [])].reverse().find(m => m.direcao === 'entrada');
  const querAgendar = r.intencao === 'agendar';
  const horasCitadas = (t.match(/\b\d{1,2}h(\d{2})?\b|\b\d{1,2}:\d{2}\b/g) || []).length;
  const dias = (t.match(/\b(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|amanhã|amanha)\b|\b\d{2}\/\d{2}\b/gi) || []).length;
  const horas = Math.max(horasCitadas, dias);   // "8h na quinta ou na sexta" também são duas opções
  return {
    tem_resposta: !!t,
    sem_preco: !PRECO.test(t),
    sem_proibidas: !PROIBIDAS.test(t),
    curta: t.length <= 600,
    uma_pergunta: perguntas <= 1,
    duas_opcoes_se_agendar: !querAgendar || horas >= 2,
    abre_sem_tudo_bem: !/^tudo bem\??/i.test(t.trim()),
    tamanho: t.length, perguntas, horas_citadas: horas,
    ultima_do_cliente: ultimaEntrada?.corpo?.slice(0, 160) || null,
  };
}

const resultados = [];
for (const id of ids) {
  const inicio = Date.now();
  const ctx = await contexto.montarContexto(id);
  const ficha = ctx.ok ? ctx.ficha : null;
  let r;
  try { r = await cop.rodar({ conversaId: id, perfil: null }); }
  catch (e) { r = { ok: false, erro: e.message }; }
  const ultimas = (ficha?.mensagens || []).slice(-6).map(m => `${m.direcao === 'entrada' ? 'CLIENTE' : 'LOJA'}: ${String(m.corpo || '').replace(/\s+/g, ' ').slice(0, 180)}`);
  const item = { id, ok: r.ok, erro: r.erro || null, ultimas, resposta: r.resposta_sugerida || null,
    intencao: r.intencao, temperatura: r.temperatura, resumo: r.resumo, pendencias: r.pendencias,
    acoes: (r.acoes || []).map(a => `${a.tipo}: ${a.resumo}`), recusadas: r.recusadas_na_validacao || [], parou: r.parou_por || null, checagens: r.ok ? checar(r, ficha) : null,
    tokens: r.tokens, duracao_ms: Date.now() - inicio };
  resultados.push(item);
  console.log('\n==================', id, '==================');
  console.log(ultimas.join('\n'));
  console.log('--> SUGERIDA:', item.resposta);
  console.log('--> intenção/temperatura:', item.intencao, item.temperatura, '| ações:', item.acoes.join(' | ') || '—');
  console.log('--> resumo:', item.resumo, '| pendências:', (item.pendencias || []).join('; '));
  if (item.checagens) console.log('--> checagens:', JSON.stringify(item.checagens));
  if (item.recusadas.length) console.log('--> recusadas na validação:', JSON.stringify(item.recusadas), '| parou:', item.parou);
  if (item.erro) console.log('--> ERRO:', item.erro);
}

const passou = k => resultados.filter(x => x.checagens?.[k]).length;
const resumo = { rotulo, quando: new Date().toISOString(), conversas: resultados.length,
  ok: resultados.filter(x => x.ok).length,
  checagens: Object.fromEntries(['tem_resposta', 'sem_preco', 'sem_proibidas', 'curta', 'uma_pergunta', 'duas_opcoes_se_agendar', 'abre_sem_tudo_bem'].map(k => [k, passou(k)])),
  tamanho_medio: Math.round(resultados.reduce((a, x) => a + (x.checagens?.tamanho || 0), 0) / Math.max(1, resultados.length)),
  tokens_entrada: resultados.reduce((a, x) => a + (x.tokens?.entrada || 0), 0),
  tokens_saida: resultados.reduce((a, x) => a + (x.tokens?.saida || 0), 0),
  escritas_bloqueadas: bloqueadas.length };
console.log('\n==== RESUMO', JSON.stringify(resumo, null, 1));
if (saida) fs.writeFileSync(saida, JSON.stringify({ resumo, resultados }, null, 1));
process.exit(0);
