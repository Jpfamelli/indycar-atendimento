/* Roteiro de navegador da RODADA 4 (confiabilidade com o Render dormindo, tour e ajuda).
   Uso: PORT=3221 node scripts/mock-server.mjs   (em outro terminal)
        node scripts/roteiro-rodada4.cjs          (BASE=http://localhost:3221)
   Simula o 503 "hibernate-wake-error" com POST /api/_dormir {segundos} no servidor de mentira:
   toda rota /api/ responde 503 em HTML sem o cabeçalho do app; o "banco" (dublê) segue de pé. */
const puppeteer = require('C:/Users/USER/.claude/backups/indycar-ferramentas/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3221';
const OUT = path.join(__dirname, 'shots-tela', 'r4-');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const espera = ms => new Promise(r => setTimeout(r, ms));
let total = 0, bons = 0;
const ok = (nome, cond, extra = '') => { total++; if (cond) bons++; console.log(`${cond ? 'OK  ' : 'FALHOU'} ${nome}${cond ? '' : ' — ' + extra}`); };
const dormir = s => fetch(BASE + '/api/_dormir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segundos: s }) });
const envios = async () => (await (await fetch(BASE + '/api/_envios')).json()).envios;
let browser;

async function abrir(papel, largura = 1440, extra = '', { ctx = null } = {}) {
  ctx = ctx || await browser.createBrowserContext();
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) p.erros.push(m.text()); });
  p.on('pageerror', e => p.erros.push('PAGEERROR ' + e.message));
  p.on('dialog', d => d.accept());
  await p.setViewport(largura < 600 ? { width: largura, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: largura, height: 900 });
  await p.goto(`${BASE}/?papel=${papel}&saude=ok${extra}`, { waitUntil: 'networkidle0' });
  await espera(900);
  p.ctx = ctx;
  return p;
}
const visivel = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const st = getComputedStyle(e); const r = e.getBoundingClientRect(); return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
const texto = (p, sel) => p.evaluate(s => document.querySelector(s)?.textContent?.trim() || '', sel);
const semRolagemX = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const ate = async (p, fn, arg, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn, arg)) return true; await espera(250); } return false; };

(async () => {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  try {
    for (const w of [1440, 375]) {
      /* ---------- 1. pedido GET durante o 503: espera, faixa, volta ---------- */
      await dormir(0);
      const p = await abrir('atendente', w, '&envio=ok');
      ok(`[${w}] rede.js carregado antes do app (window.Rede, fetch embrulhado)`, await p.evaluate(() => !!window.Rede && typeof Rede.fetch === 'function' && window.__fetchVigiado && Rede.estado === 'ok'));
      await dormir(9);
      const t0 = Date.now();
      const pedido = p.evaluate(async () => { const r = await fetch('/api/equipe/nomes', { headers: await authCabecalhos() }); return { status: r.status, j: await r.json() }; });
      ok(`[${w}] 503 do Render: faixa "acordando" aparece com contagem`, await ate(p, () => { const f = document.getElementById('faixaServidor'); return f && !f.hidden && /acordando/i.test(f.textContent) && /tentando de novo em \d+ s/.test(f.textContent); }, null, 6000));
      ok(`[${w}] faixa sem rolagem lateral e dentro da tela`, await p.evaluate(() => { const r = document.getElementById('faixaServidor').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }) && await semRolagemX(p));
      ok(`[${w}] faixa tem "Tentar agora"; leitor de tela anuncia o estado, não a contagem`, await p.evaluate(() => { const f = document.getElementById('faixaServidor'); return f.querySelector('.fs-titulo').getAttribute('role') === 'status' && f.querySelector('.fs-sub').getAttribute('aria-live') === 'off' && /Tentar agora/.test(f.querySelector('button').textContent); }));
      if (w === 1440) await p.screenshot({ path: OUT + 'acordando-1440.png' }); else await p.screenshot({ path: OUT + 'acordando-375.png' });
      const res = await pedido;
      ok(`[${w}] o pedido esperou e deu certo sozinho quando acordou (sem erro cru)`, res.status === 200 && res.j.ok === true && Date.now() - t0 >= 8000, JSON.stringify(res).slice(0, 120));
      ok(`[${w}] avisa "O sistema voltou"`, await ate(p, () => /voltou/.test(document.getElementById('faixaServidor')?.textContent || ''), null, 3000));
      ok(`[${w}] faixa some depois de voltar`, await ate(p, () => document.getElementById('faixaServidor').hidden, null, 6000));

      /* ---------- 2. Tentar agora acorda na hora ---------- */
      await dormir(4);
      const ped2 = p.evaluate(async () => (await fetch('/api/config')).status);
      await espera(1200);
      await dormir(0);
      await p.evaluate(() => document.querySelector('#faixaServidor .fs-btn').click());
      const t1 = Date.now();
      ok(`[${w}] "Tentar agora" refaz o pedido na hora`, (await ped2) === 200 && Date.now() - t1 < 2500);

      /* ---------- 3. POST que nunca chegou (503) não vira erro; POST com 502 do app não repete ---------- */
      const sintetico = await p.evaluate(async () => { const r = await fetch('/api/teste/limite', { headers: await authCabecalhos(), tetoMs: 0 }); return r.status; });
      ok(`[${w}] resposta do PRÓPRIO app (429) passa direto, sem nova tentativa`, sintetico === 429);
      await dormir(30);
      const desistiu = await p.evaluate(async () => { const r = await fetch('/api/eu', { headers: await authCabecalhos(), tetoMs: 0 }); return { s: r.status, sint: r.headers.get('x-indycar-sintetica'), j: await r.json() }; });
      ok(`[${w}] sem tempo para insistir: JSON em português (não HTML)`, desistiu.s === 503 && desistiu.sint === '1' && /acordando/.test(desistiu.j.erro), JSON.stringify(desistiu));
      await dormir(0);
      await p.evaluate(() => Rede.tentarAgora());
      await ate(p, () => Rede.estado === 'ok', null, 5000);

      /* ---------- 4. envio durante o 503: espera, sai uma vez só ---------- */
      await p.evaluate(() => document.querySelector('#listaConversas .conversa')?.click());
      await espera(900);
      await dormir(7);
      const antes = (await envios()).length;
      await p.evaluate(() => { const c = document.getElementById('campoMensagem'); c.value = 'Teste rodada 4 — servidor dormindo ' + Date.now(); c.dispatchEvent(new Event('input')); });
      await p.focus('#campoMensagem'); await p.keyboard.press('Enter');
      ok(`[${w}] envio com o servidor dormindo: bolha "esperando o sistema"`, await ate(p, () => /esperando o sistema/.test(document.getElementById('mensagens').textContent), null, 5000));
      ok(`[${w}] entrega anotada no aparelho enquanto espera`, await p.evaluate(() => Entregas.ler().length >= 1));
      ok(`[${w}] acordou: mensagem sai (✓) sem reenviar`, await ate(p, () => { const ult = [...document.querySelectorAll('#mensagens .msg.saida')].pop(); return ult && /✓/.test(ult.textContent); }, null, 20000));
      const depois = await envios();
      ok(`[${w}] saiu exatamente uma vez`, depois.length === antes + 1, `${antes} → ${depois.length}`);
      ok(`[${w}] anotação some depois de sair`, await p.evaluate(() => Entregas.ler().length === 0));

      /* ---------- 5. fechou a página no meio: retoma ao abrir de novo, sem duplicar ---------- */
      await dormir(60);
      await p.evaluate(() => { const c = document.getElementById('campoMensagem'); c.value = 'Teste rodada 4 — recarregou no meio ' + Date.now(); c.dispatchEvent(new Event('input')); });
      await p.focus('#campoMensagem'); await p.keyboard.press('Enter');
      await espera(1500);
      const pend = await p.evaluate(() => Entregas.ler().map(x => x.mensagemId));
      ok(`[${w}] entrega pendente gravada antes de recarregar`, pend.length === 1);
      const n0 = (await envios()).length;
      await dormir(0);
      const p2 = await p.ctx.newPage();
      p2.erros = [];
      p2.on('pageerror', e => p2.erros.push('PAGEERROR ' + e.message));
      await p.close();
      await p2.setViewport(w < 600 ? { width: w, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: w, height: 900 });
      p2.ctx = p.ctx;
      await p2.goto(`${BASE}/?papel=atendente&saude=ok&envio=ok`, { waitUntil: 'networkidle0' });
      ok(`[${w}] ao abrir de novo, a entrega pendente sai sozinha`, await ate(p2, () => Entregas.ler().length === 0, null, 15000));
      const n1 = await envios();
      ok(`[${w}] …uma vez só (id ${pend[0] ? 'confere' : '?'})`, n1.length === n0 + 1 && n1.at(-1) === pend[0], `${n0} → ${n1.length}`);

      /* ---------- 6. abrir o app com o servidor dormindo (configuração guardada) ---------- */
      ok(`[${w}] configuração pública guardada no aparelho`, await p2.evaluate(() => !!JSON.parse(localStorage.getItem('indycar_cfg_publica') || 'null')?.supabaseUrl));
      await dormir(25);
      const t2 = Date.now();
      await p2.goto(`${BASE}/?papel=atendente&saude=ok`, { waitUntil: 'domcontentloaded' });
      ok(`[${w}] servidor dormindo: o app abre mesmo assim (casca + banco direto)`, await ate(p2, () => !document.getElementById('telaApp').hidden && document.querySelectorAll('#listaConversas .conversa').length > 0, null, 9000), `${Date.now() - t2} ms`);
      ok(`[${w}] …em poucos segundos (sem esperar o servidor)`, Date.now() - t2 < 9000, `${Date.now() - t2} ms`);
      ok(`[${w}] …com a faixa avisando que está acordando`, await ate(p2, () => { const f = document.getElementById('faixaServidor'); return f && !f.hidden; }, null, 4000));
      ok(`[${w}] nenhum alarme falso de WhatsApp/saúde enquanto dorme`, await p2.evaluate(() => document.getElementById('faixaSaude').hidden));
      await dormir(0);
      await p2.evaluate(() => Rede.tentarAgora());
      ok(`[${w}] servidor volta → faixa "voltou"`, await ate(p2, () => Rede.estado === 'ok', null, 15000));
      ok(`[${w}] sem erro de console no caminho todo`, p2.erros.length === 0, p2.erros.join(' | '));
      await p2.ctx.close();

      /* ---------- 7. primeira vez no aparelho com o servidor dormindo ---------- */
      const ctx3 = await browser.createBrowserContext();
      const p3 = await ctx3.newPage();
      await p3.setViewport(w < 600 ? { width: w, height: 812, isMobile: true, hasTouch: true } : { width: w, height: 900 });
      await dormir(6);
      await p3.goto(`${BASE}/?papel=atendente&saude=ok`, { waitUntil: 'domcontentloaded' });
      ok(`[${w}] sem cópia guardada: tela de entrar mostra "Conectando…" e a faixa`, await ate(p3, () => !document.getElementById('loginEspera').hidden && !document.getElementById('faixaServidor')?.hidden, null, 4000));
      ok(`[${w}] …e entra sozinho quando o servidor acorda`, await ate(p3, () => !document.getElementById('telaApp').hidden, null, 20000));
      await ctx3.close();

      /* ---------- 8. tempo real perdeu mensagem: o Recuperador busca ---------- */
      await dormir(0);
      const p4 = await abrir('atendente', w);
      await p4.evaluate(() => document.querySelector('#listaConversas .conversa')?.click());
      await espera(900);
      const conv = await p4.evaluate(() => conversaAtual?.id);
      const corpo = 'Mensagem que o tempo real perdeu ' + Date.now();
      await fetch(BASE + '/api/_mock', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-22222222-2222-4222-8222-222222222222' },
        body: JSON.stringify({ tabela: 'whatsapp_mensagens', acao: 'insert', corpo: { conversa_id: conv, direcao: 'entrada', corpo, telefone: '12999990000', created_at: new Date(Date.now() + 2000).toISOString() }, filtros: [], ordem: [] }) });
      await p4.evaluate(() => Recuperador.conferir());
      ok(`[${w}] mensagem perdida pelo tempo real aparece na conversa aberta`, await ate(p4, c => document.getElementById('mensagens').textContent.includes(c), corpo, 6000));
      ok(`[${w}] …com aviso de quantas foram recuperadas`, await ate(p4, () => /recuperad/.test(document.getElementById('toast').textContent), null, 3000));
      const dup = await p4.evaluate(c => { Recuperador.buscar('de novo'); return [...document.querySelectorAll('#mensagens .msg')].filter(m => m.textContent.includes(c)).length; }, corpo);
      ok(`[${w}] …sem duplicar ao buscar de novo`, dup === 1, String(dup));
      ok(`[${w}] sem erro de console`, p4.erros.length === 0, p4.erros.join(' | '));

      /* ---------- 9. ajuda ---------- */
      await p4.evaluate(() => { document.activeElement?.blur(); document.body.focus(); });
      await p4.keyboard.press('?');
      ok(`[${w}] "?" abre a Ajuda em "Como faço…"`, await ate(p4, () => document.getElementById('modalAjudaBg').classList.contains('aberto') && !document.getElementById('ajudaComo').hidden, null, 2000));
      const nItens = await p4.evaluate(() => document.querySelectorAll('#ajudaLista .ajuda-item').length);
      ok(`[${w}] ajuda tem os "como faço" (≥ 12)`, nItens >= 12, String(nItens));
      await p4.type('#ajudaBusca', 'audio');
      ok(`[${w}] busca sem acento acha "áudio"`, await p4.evaluate(() => { const l = [...document.querySelectorAll('#ajudaLista .ajuda-item')]; return l.length >= 1 && /áudio/.test(l[0].textContent) && l[0].open; }));
      await p4.evaluate(() => { document.getElementById('ajudaBusca').value = 'xyzw'; document.getElementById('ajudaBusca').dispatchEvent(new Event('input')); });
      ok(`[${w}] busca sem resultado explica o que fazer`, await visivel(p4, '#ajudaNada'));
      await p4.evaluate(() => document.querySelector('[data-ajuda-aba="teclas"]').click());
      ok(`[${w}] aba Atalhos lista as teclas (e as etapas)`, await p4.evaluate(() => !document.getElementById('ajudaTeclas').hidden && document.querySelectorAll('#listaTeclas dt').length >= 15));
      ok(`[${w}] modal da Ajuda sem rolagem lateral`, await semRolagemX(p4));
      if (w === 375) await p4.screenshot({ path: OUT + 'ajuda-375.png' });
      await p4.keyboard.press('Escape');
      ok(`[${w}] Esc fecha a Ajuda`, await ate(p4, () => !document.getElementById('modalAjudaBg').classList.contains('aberto'), null, 2000));
      await p4.ctx.close();
    }

    /* ---------- 10. tour por papel ---------- */
    for (const [papel, n] of [['atendente', 7], ['gestor', 8], ['admin', 10]]) {
      for (const w of [1440, 375]) {
        await dormir(0);
        const p = await abrir(papel, w, '&tour=1');
        ok(`[${w}] tour do ${papel} abre sozinho na primeira vez`, await ate(p, () => !!document.querySelector('.tour-card'), null, 4000));
        const passo = await texto(p, '#tourPasso');
        ok(`[${w}] tour do ${papel} tem ${n} passos`, passo === `1 de ${n}`, passo);
        ok(`[${w}] cartão do tour dentro da tela e com foco no botão`, await p.evaluate(() => { const r = document.querySelector('.tour-card').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && document.activeElement?.dataset.tour === 'seguir'; }));
        await p.keyboard.press('Enter');
        ok(`[${w}] Enter/Próximo avança e acende a lista`, (await texto(p, '#tourPasso')) === `2 de ${n}` && await p.evaluate(() => getComputedStyle(document.querySelector('.tour-buraco')).display === 'block'));
        if (papel === 'admin' && w === 1440) await p.screenshot({ path: OUT + 'tour-1440.png' });
        if (papel === 'atendente' && w === 375) await p.screenshot({ path: OUT + 'tour-375.png' });
        await p.keyboard.press('ArrowLeft');
        ok(`[${w}] ← volta`, (await texto(p, '#tourPasso')) === `1 de ${n}`);
        await p.keyboard.press('Escape');
        ok(`[${w}] Esc encerra o tour`, await ate(p, () => !document.querySelector('.tour-card'), null, 2000));
        const marca = await p.evaluate(() => localStorage.getItem('indycar_tour_visto'));
        ok(`[${w}] marcado como visto no aparelho (${papel})`, marca === `v1-${papel}`, String(marca));
        await espera(600);
        const noPerfil = await (await fetch(BASE + '/api/_mock', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-11111111-1111-4111-8111-111111111111' }, body: JSON.stringify({ tabela: 'perfis', acao: 'select', colunas: '*', filtros: [], ordem: [] }) })).json();
        ok(`[${w}] …e no perfil (vale em outro aparelho)`, (noPerfil.data || []).some(x => x.papel === papel && x.preferencias?.tour_visto === `v1-${papel}`));
        await p.reload({ waitUntil: 'networkidle0' });
        await espera(1800);
        ok(`[${w}] não aparece de novo depois de visto`, !(await p.evaluate(() => !!document.querySelector('.tour-card'))));
        ok(`[${w}] sem erro de console (${papel})`, p.erros.length === 0, p.erros.join(' | '));
        await p.ctx.close();
      }
    }
    // rever o tour pela Ajuda
    const pr = await abrir('atendente', 1440);
    await pr.evaluate(() => Ajuda.abrir('como'));
    await espera(300);
    await pr.evaluate(() => document.getElementById('btnReverTour').click());
    ok('Ajuda › "Rever o tour" abre o tour de novo', await ate(pr, () => !!document.querySelector('.tour-card'), null, 2000));
    await pr.keyboard.press('Escape');
    await pr.evaluate(() => { document.getElementById('usuarioBox').click(); });
    await espera(300);
    await pr.evaluate(() => document.querySelector('[data-mp="ajuda"]').click());
    ok('menu do perfil › "Ajuda e atalhos" abre a Ajuda', await ate(pr, () => document.getElementById('modalAjudaBg').classList.contains('aberto'), null, 2000));
    await pr.keyboard.press('Escape');
    // erro técnico vira português claro
    const t1 = await pr.evaluate(() => { toast('⚠️ Não consegui salvar: TypeError: Failed to fetch'); return document.getElementById('toast').textContent; });
    ok('aviso com "Failed to fetch" vira "Sem conexão…"', /^⚠️ Sem conexão/.test(t1) && !/fetch/i.test(t1), t1);
    const t2 = await pr.evaluate(() => { toast('⚠️ new row violates row-level security policy'); return document.getElementById('toast').textContent; });
    ok('aviso de RLS vira "Peça ao gestor"', /Peça ao gestor/.test(t2), t2);
    const t3 = await pr.evaluate(() => { toast('✅ Salvo'); return document.getElementById('toast').textContent; });
    ok('aviso comum continua igual', t3 === '✅ Salvo', t3);
    ok('chat vazio ensina: atalhos e "ver o tour"', await visivel(pr, '.chat-vazio-dica') && /Ctrl/.test(await texto(pr, '.chat-vazio-dica')));
    await pr.evaluate(() => document.getElementById('btnVazioTour').click());
    ok('"ver o tour de novo" no chat vazio abre o tour', await ate(pr, () => !!document.querySelector('.tour-card'), null, 2000));
    await pr.keyboard.press('Escape');
    const teto = await pr.evaluate(() => { for (let i = 0; i < 60; i++) Entregas.anotar({ mensagemId: 'x' + i, criada: new Date().toISOString() }); const n = Entregas.ler().length; localStorage.removeItem('indycar_entregas_pendentes'); return n; });
    ok('anotações de entrega com teto (50) — o aparelho não enche', teto === 50, String(teto));
    ok('sem erro de console (ajuda/avisos)', pr.erros.length === 0, pr.erros.join(' | '));
    await pr.ctx.close();
  } finally {
    await dormir(0).catch(() => {});
    await browser.close();
  }
  console.log(`\n${bons}/${total} OK`);
  process.exit(bons === total ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
