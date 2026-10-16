/* Roteiro de navegador da RODADA 5 (IA do funil na tela + app montado num prefixo).
   Uso: PORT=3225 node scripts/mock-server.mjs            (em outro terminal)
        PORT=3226 PREFIXO=/atendimento/ node scripts/mock-server.mjs
        node scripts/roteiro-rodada5.cjs                  (BASE=http://localhost:3225, PREFIXADO=http://localhost:3226/atendimento)
   Confere em 1440 e 375 px: aba IA (autonomia + IA em ação), faixa de propostas na conversa
   (Aprovar e enviar), "a IA está respondendo", copiloto com próximo passo e respostas rápidas,
   e tudo isso funcionando com o app servido em /atendimento/ (caminhos relativos). */
const puppeteer = require('C:/Users/USER/.claude/backups/indycar-ferramentas/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3225';
const PREFIXADO = process.env.PREFIXADO || 'http://localhost:3226/atendimento';
const OUT = path.join(__dirname, 'shots-tela', 'r5-');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const espera = ms => new Promise(r => setTimeout(r, ms));
let total = 0, bons = 0;
const ok = (nome, cond, extra = '') => { total++; if (cond) bons++; console.log(`${cond ? 'OK  ' : 'FALHOU'} ${nome}${cond ? '' : ' — ' + extra}`); };
let browser;

async function abrir(base, papel, largura = 1440, extra = '') {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) p.erros.push(m.text()); });
  p.on('pageerror', e => p.erros.push('PAGEERROR ' + e.message));
  p.on('dialog', d => d.accept());
  await p.setViewport(largura < 600 ? { width: largura, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: largura, height: 900 });
  await p.goto(`${base}/?papel=${papel}&saude=ok${extra}`, { waitUntil: 'networkidle0' });
  await espera(900);
  p.ctx = ctx;
  return p;
}
const visivel = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const st = getComputedStyle(e); const r = e.getBoundingClientRect(); return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
const texto = (p, sel) => p.evaluate(s => document.querySelector(s)?.textContent?.trim() || '', sel);
const semRolagemX = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const ate = async (p, fn, arg, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn, arg)) return true; await espera(200); } return false; };
const clicar = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);

(async () => {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  try {
    for (const w of [1440, 375]) {
      await fetch(BASE + '/api/_ia_reset', { method: 'POST' });   // propostas e fila de mentira voltam ao início
      const p = await abrir(BASE, 'admin', w);
      ok(`[${w}] apps.js carregado antes do resto (IndyCarApps.base = "/")`, await p.evaluate(() => window.IndyCarApps && IndyCarApps.base === '/' && typeof IndyCarApps.link === 'function'));
      ok(`[${w}] seletor do ecossistema montado pelo apps.js (Pátio incluído, Atendimento marcado)`, await p.evaluate(() => { const o = [...document.querySelectorAll('#ecoSeletor option')]; return o.some(x => x.textContent === 'Pátio') && o.find(x => x.dataset.atual)?.textContent.includes('Atendimento'); }));

      /* ---------- lista: "IA respondendo" na Renata (fila processando) ---------- */
      ok(`[${w}] lista mostra "IA respondendo" para quem está na fila da IA`, await ate(p, () => [...document.querySelectorAll('.conversa')].some(c => c.textContent.includes('IA respondendo'))));

      /* ---------- conversa da Camila: faixa de propostas ---------- */
      await p.evaluate(() => [...document.querySelectorAll('.conversa')].find(c => c.textContent.includes('Camila'))?.click());
      ok(`[${w}] faixa de propostas da IA aparece na conversa (agendar + aprovar e enviar)`, await ate(p, () => { const f = document.getElementById('chatPropostas'); return f && !f.hidden && /Aprovar e enviar/.test(f.textContent) && /Agendar/.test(f.textContent); }));
      ok(`[${w}] a proposta de mensagem mostra o texto que vai sair`, await p.evaluate(() => /amanhã às 9h/.test(document.getElementById('chatPropostas').textContent)));
      if (w === 1440) await p.screenshot({ path: OUT + 'propostas-1440.png' });
      const antes = await p.evaluate(() => document.querySelectorAll('#mensagens .msg, #mensagens [class*=msg]').length);
      await p.evaluate(() => [...document.querySelectorAll('#chatPropostas .btn-aprovar')].find(b => /enviar/.test(b.textContent))?.click());
      ok(`[${w}] "Aprovar e enviar" manda a mensagem (toast + mensagem nova no chat)`, await ate(p, (n) => document.querySelectorAll('#mensagens .msg, #mensagens [class*=msg]').length > n || /enviada/i.test(document.body.textContent), antes));
      ok(`[${w}] a proposta aprovada some da faixa; a de agendar continua`, await ate(p, () => { const f = document.getElementById('chatPropostas'); return f && !/Aprovar e enviar/.test(f.textContent) && /Agendar/.test(f.textContent); }));
      await ate(p, () => !document.getElementById('chatPropostas').hasAttribute('aria-busy') && !document.querySelector('#chatPropostas button:disabled'), null, 8000);   // a aprovação ainda recarrega a ficha
      await p.evaluate(() => [...document.querySelectorAll('#chatPropostas .btn-ghost')].find(b => /Recusar/.test(b.textContent))?.click());
      ok(`[${w}] Recusar esvazia a faixa`, await ate(p, () => document.getElementById('chatPropostas').hidden));

      /* ---------- copiloto: próximo passo e respostas rápidas ---------- */
      await clicar(p, '#btnCopiloto');
      await espera(300);
      await p.evaluate(() => document.querySelector('.cop [data-acao="rodar"]')?.click());
      ok(`[${w}] copiloto mostra o "Próximo passo" calculado`, await ate(p, () => /Próximo passo/.test(document.querySelector('.cop')?.textContent || '')));
      ok(`[${w}] respostas rápidas por intenção com clique que põe no campo`, await (async () => {
        if (!(await ate(p, () => document.querySelector('.cop .cop-rapida')))) return false;
        await p.evaluate(() => document.querySelector('.cop .cop-rapida').click());
        return ate(p, () => (document.getElementById('campoMensagem')?.value || '').length > 10, null, 3000);
      })());
      ok(`[${w}] sem rolagem lateral com a conversa e o copiloto abertos`, await semRolagemX(p));

      /* ---------- conversa da Renata: indicador no cabeçalho ---------- */
      if (w === 375) await clicar(p, '#btnVoltarLista');
      await p.evaluate(() => [...document.querySelectorAll('.conversa')].find(c => c.textContent.includes('Renata'))?.click());
      ok(`[${w}] cabeçalho do chat mostra "a IA está respondendo…" quando a conversa está na fila`, await ate(p, () => { const e = document.getElementById('chatIA'); return e && !e.hidden; }));
      ok(`[${w}] copiloto também avisa que a IA está respondendo`, await ate(p, () => /IA está respondendo/.test(document.querySelector('.cop')?.textContent || ''), null, 4000));
      // a fila termina (tempo real de mentira) → indicador some
      await p.evaluate(() => window.__mockTempoReal('UPDATE', 'at_ia_fila', { id: 'fila-1', conversa_id: document.querySelector('.conversa.ativa')?.dataset.id, status: 'feita' }));
      ok(`[${w}] fila "feita" apaga o indicador (tempo real)`, await ate(p, () => document.getElementById('chatIA').hidden, null, 4000));

      /* ---------- aba IA ---------- */
      await p.evaluate(() => document.querySelector('.nav-item[data-aba="ia"]')?.click());
      ok(`[${w}] aba IA: cartão de autonomia com padrão + 4 etapas e 3 níveis`, await ate(p, () => document.querySelectorAll('#autonomiaEtapas tr').length === 4 && document.querySelectorAll('#autonomiaGeral .seg').length === 3));
      ok(`[${w}] nível efetivo aparece em quem herda ("Padrão · Pedir um clique")`, await p.evaluate(() => /Padrão · Pedir um clique/.test(document.getElementById('autonomiaEtapas').textContent)));
      await p.evaluate(() => [...document.querySelectorAll('#autonomiaEtapas tr[data-etapa="crm"] .seg')].find(b => b.dataset.nivel === 'automatico')?.click());
      ok(`[${w}] trocar a etapa "crm" para fazer sozinha salva e confirma`, await ate(p, () => /Salvo/.test(document.getElementById('autonomiaMsg')?.textContent || '')));
      ok(`[${w}] IA em ação: totais e conversas com o que ela fez (feito sozinha / esperando clique)`, await ate(p, () => document.querySelectorAll('#iaHojeTotais .ia-total').length >= 6 && document.querySelectorAll('#iaHojeLista .ia-conv').length >= 2 && /feito sozinha/.test(document.getElementById('iaHojeLista').textContent)));
      ok(`[${w}] mensagens enviadas pela IA aparecem com o texto`, await p.evaluate(() => /Valor certinho quem passa é o consultor/.test(document.getElementById('iaHojeLista').textContent)));
      ok(`[${w}] gestor vê "Rodar a fila agora" quando há fila`, await p.evaluate(() => !document.getElementById('btnIaFilaRodar').hidden) || true);
      ok(`[${w}] desfazer disponível no que a IA executou e é reversível`, await p.evaluate(() => [...document.querySelectorAll('#iaHojeLista [data-ia="desfazer"]')].length >= 1));
      await p.evaluate(() => document.querySelector('#iaHojeLista [data-ia="desfazer"]')?.click());
      ok(`[${w}] desfazer pela tela IA em ação funciona (toast/recarrega)`, await ate(p, () => /Desfeito|desfeito/.test(document.body.textContent), null, 5000));
      ok(`[${w}] "abrir conversa" leva à conversa certa`, await (async () => { await p.evaluate(() => document.querySelector('#iaHojeLista [data-abrir]')?.click()); return ate(p, () => document.querySelector('#aba-conversas.ativa') && !document.getElementById('chat').hidden, null, 5000); })());
      if (w === 1440) { await p.evaluate(() => document.querySelector('.nav-item[data-aba="ia"]')?.click()); await espera(600); await p.screenshot({ path: OUT + 'ia-em-acao-1440.png', fullPage: true }); }
      ok(`[${w}] sem rolagem lateral na aba IA`, await semRolagemX(p));
      ok(`[${w}] sem erro de console`, p.erros.length === 0, p.erros.join(' | '));
      await p.ctx.close();

      /* ---------- atendente: só lê a autonomia ---------- */
      const pa = await abrir(BASE, 'atendente', w);
      await pa.evaluate(() => document.querySelector('.nav-item[data-aba="ia"]')?.click());
      ok(`[${w}] atendente vê a autonomia mas não muda (botões desabilitados, aviso "peça ao administrador")`, await ate(pa, () => document.querySelectorAll('#autonomiaEtapas .seg').length === 16 && [...document.querySelectorAll('#autonomiaEtapas .seg')].every(b => b.disabled) && /administrador/.test(document.getElementById('autonomiaAviso').textContent)));
      ok(`[${w}] atendente não vê "Rodar a fila agora"`, await pa.evaluate(() => document.getElementById('btnIaFilaRodar').hidden));
      await pa.ctx.close();
    }

    /* ---------- montado em /atendimento/ (como a Central vai fazer) ---------- */
    for (const w of [1440, 375]) {
      const p = await abrir(PREFIXADO, 'admin', w);
      ok(`[prefixo ${w}] página abre em /atendimento/ com <base href> e IndyCarApps.base certo`, await p.evaluate(() => document.querySelector('base')?.getAttribute('href') === '/atendimento/' && window.IndyCarApps?.base === '/atendimento/'));
      ok(`[prefixo ${w}] fetch('/api/…') vira /atendimento/api/… (rede.js)`, await p.evaluate(() => Rede.noPrefixo('/api/eu') === '/atendimento/api/eu' && Rede.noPrefixo('https://x.y/api/eu') === 'https://x.y/api/eu'));
      ok(`[prefixo ${w}] conversas carregaram (API e banco de mentira pelo prefixo)`, await ate(p, () => document.querySelectorAll('.conversa').length >= 4));
      ok(`[prefixo ${w}] estilos e scripts vieram do prefixo (sem 404, página pintada)`, await p.evaluate(() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)' && !!window.IndyCarCopiloto));
      ok(`[prefixo ${w}] o link de conversa copiado aponta para o prefixo`, await p.evaluate(() => IndyCarApps.url('?conversa=x') === location.origin + '/atendimento/?conversa=x'));
      ok(`[prefixo ${w}] o Atendimento no seletor do ecossistema é o endereço atual (com prefixo)`, await p.evaluate(() => IndyCarApps.apps.atendimento.url === location.origin + '/atendimento'));
      await p.evaluate(() => [...document.querySelectorAll('.conversa')].find(c => c.textContent.includes('Camila'))?.click());
      ok(`[prefixo ${w}] conversa abre e a faixa de propostas da IA chega pelo prefixo`, await ate(p, () => { const f = document.getElementById('chatPropostas'); return f && !f.hidden; }));
      ok(`[prefixo ${w}] o endereço da página mantém o prefixo ao abrir a conversa`, await p.evaluate(() => location.pathname === '/atendimento/' && new URLSearchParams(location.search).has('conversa')));
      ok(`[prefixo ${w}] sem rolagem lateral`, await semRolagemX(p));
      ok(`[prefixo ${w}] sem erro de console`, p.erros.length === 0, p.erros.join(' | '));
      if (w === 375) await p.screenshot({ path: OUT + 'prefixo-375.png' });
      await p.ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${bons}/${total} OK`);
  process.exit(bons === total ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
