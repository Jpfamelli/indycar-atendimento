/* Roteiro da CASCA EM CACHE (rodada 4) contra o server.js DE VERDADE.
   Sobe o server.js (porta 3210, sem sincronia nem automações) e, na frente dele, um
   "Render" de mentira (porta 3230) que pode responder 503 "hibernate-wake-error" em
   tudo. Confere que, com o servidor dormindo, a página abre do service worker, a
   biblioteca do Supabase vem do cache e a faixa avisa. Ninguém faz login (nada de senha).
   Uso: node scripts/roteiro-casca.cjs */
const puppeteer = require('C:/Users/USER/.claude/backups/indycar-ferramentas/node_modules/puppeteer-core');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const espera = ms => new Promise(r => setTimeout(r, ms));
let total = 0, bons = 0;
const ok = (nome, cond, extra = '') => { total++; if (cond) bons++; console.log(`${cond ? 'OK  ' : 'FALHOU'} ${nome}${cond ? '' : ' — ' + extra}`); };
let dormindo = false;

const app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: '3210', HOST: '127.0.0.1', SINCRONIA: '0', AUTOMACOES: '0' }, stdio: 'ignore' });
const proxy = http.createServer((req, res) => {
  if (dormindo) { res.writeHead(503, { 'Content-Type': 'text/html', 'x-render-routing': 'hibernate-wake-error' }); return res.end('<h1>Service Unavailable</h1>'); }
  const p = http.request({ host: '127.0.0.1', port: 3210, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:3230' } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(p);
}).listen(3230);

(async () => {
  let browser;
  try {
    for (let i = 0; i < 40; i++) { try { await fetch('http://127.0.0.1:3210/api/status'); break; } catch { await espera(250); } }
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
    const p = await browser.newPage();
    const erros = [];
    p.on('pageerror', e => erros.push(e.message));
    await p.goto('http://localhost:3230/', { waitUntil: 'networkidle0' });
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload({ waitUntil: 'networkidle0' });
    ok('service worker controla a página', await p.evaluate(() => !!navigator.serviceWorker.controller));
    const cache = await p.evaluate(async () => { const c = await caches.open((await caches.keys()).find(k => k.startsWith('indycar-atendimento-'))); return (await c.keys()).map(r => new URL(r.url).pathname); });
    ok('casca guardada inclui rede.js, vendor do Supabase, ajuda e casca', ['/', '/rede.js', '/vendor/supabase.js', '/ajuda.js', '/casca.js', '/app.js'].every(x => cache.includes(x)), cache.join(','));
    ok('preconnect com o Supabase já no começo (configuração guardada)', await p.evaluate(() => !!document.querySelector('link[rel="preconnect"][href*="supabase.co"]')));
    ok('meta mobile-web-app-capable (sem aviso de descontinuado)', await p.evaluate(() => !!document.querySelector('meta[name="mobile-web-app-capable"]')));
    ok('configuração pública guardada no aparelho',await p.evaluate(() => !!localStorage.getItem('indycar_cfg_publica')));
    ok('cabeçalho X-IndyCar-App nas respostas do app', (await fetch('http://localhost:3230/api/status')).headers.get('x-indycar-app') === 'atendimento');

    dormindo = true;
    ok('o "Render" agora responde 503 em HTML', (await fetch('http://localhost:3230/')).status === 503);
    const t0 = Date.now();
    await p.reload({ waitUntil: 'domcontentloaded' });
    await espera(5500);
    ok('servidor dormindo: a página abre da casca (não a tela do 503)', await p.evaluate(() => !!document.getElementById('telaLogin') && document.title.includes('IndyCar')), `${Date.now() - t0} ms`);
    ok('biblioteca do Supabase veio do cache', await p.evaluate(() => !!window.supabase?.createClient));
    ok('faixa "acordando" aparece', await p.evaluate(() => { const f = document.getElementById('faixaServidor'); return !!f && !f.hidden; }));
    ok('formulário de entrar pronto (não ficou esperando o servidor)', await p.evaluate(() => !document.getElementById('formLogin').hidden));
    await p.screenshot({ path: path.join(__dirname, 'shots-tela', 'r4-casca-dormindo.png') });

    dormindo = false;
    await p.evaluate(() => Rede.tentarAgora());
    let voltou = false;
    for (let i = 0; i < 40 && !voltou; i++) { voltou = await p.evaluate(() => Rede.estado === 'ok'); if (!voltou) await espera(250); }
    ok('servidor acordou: a tela percebe sozinha', voltou);
    ok('sem erro de script', erros.length === 0, erros.join(' | '));
  } catch (e) { ok('roteiro rodou', false, e.message); }
  finally { await browser?.close(); proxy.close(); app.kill(); }
  console.log(`\n${bons}/${total} OK`);
  process.exit(bons === total ? 0 : 1);
})();
