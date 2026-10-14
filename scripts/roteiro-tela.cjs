/* Roteiro de navegador da tela (rodada 3) — puppeteer-core + Chrome instalado, contra o servidor de mentira.
   Uso: PORT=3221 node scripts/mock-server.mjs  (estado limpo a cada rodada) e, em outro terminal,
   node scripts/roteiro-tela.cjs [grupo]   grupos: login papeis admin equipe auditoria tarefas lista restricoes sessao semrotas celular
   LARG=375 só no celular · BASE=http://localhost:3221 · capturas em scripts/shots-tela/ (fora do git). */
const puppeteer = require('C:/Users/USER/.claude/backups/indycar-ferramentas/node_modules/puppeteer-core');
const fs = require('fs');
const OUT = __dirname + '/shots-tela/';
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:3221';
const FILTRO = process.argv[2] || '';
const LARG = (process.env.LARG || '1440,375').split(',').map(Number);
const U = { admin: '11111111-1111-4111-8111-111111111111', atendente: '22222222-2222-4222-8222-222222222222', gestor: '33333333-3333-4333-8333-333333333333',
  desativado: '55555555-5555-4555-8555-555555555555', semapp: '66666666-6666-4666-8666-666666666666' };
const CAMILA = 'c0000000-0000-4000-8000-000000000001', JOSE = 'c0000000-0000-4000-8000-000000000002';
const resultados = [];
const ok = (nome, cond, det = '') => { resultados.push({ nome, ok: !!cond, det }); console.log(`${cond ? 'OK  ' : 'FALHOU'} ${nome}${det && !cond ? ' — ' + det : ''}`); };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

let browser;
async function abrir(papel, largura = 1440, extra = '', { limpo = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  p.erros = [];
  p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of (40[134])/.test(m.text())) p.erros.push(m.text()); });
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
const clicar = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) throw new Error('não achei ' + s); e.click(); }, sel);
const semRolagemX = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shot = (p, nome) => p.screenshot({ path: OUT + nome + '.png' });
async function digitar(p, sel, valor) { await p.evaluate((s) => { const e = document.querySelector(s); e.value = ''; e.focus(); }, sel); await p.type(sel, valor); }
async function mock(op, token) {
  return (await fetch(BASE + '/api/_mock', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer mock-' + token } : {}) }, body: JSON.stringify(op) })).json();
}
const sel = (tabela, filtros = []) => ({ tabela, acao: 'select', colunas: '*', filtros, ordem: [], limite: null, um: false, head: false, count: null, corpo: null });
const roda = (nome) => !FILTRO || nome.includes(FILTRO);

(async () => {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });

  /* ================= LOGIN ================= */
  for (const w of LARG) if (roda('login')) {
    const p = await abrir('deslogado', w);
    ok(`[${w}] login: tela de entrar aparece e o app não`, await visivel(p, '#formLogin') && !(await visivel(p, '#telaApp')));
    ok(`[${w}] login: sem rolagem horizontal`, await semRolagemX(p));
    await digitar(p, '#loginSenha', 'abc');
    await clicar(p, '[data-olho="loginSenha"]');
    ok(`[${w}] login: olho mostra a senha (type=text, aria-pressed)`, await p.evaluate(() => document.querySelector('#loginSenha').type === 'text' && document.querySelector('[data-olho="loginSenha"]').getAttribute('aria-pressed') === 'true'));
    await clicar(p, '[data-olho="loginSenha"]');
    await p.evaluate(() => document.querySelector('#loginSenha').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', modifierCapsLock: true, bubbles: true })));
    ok(`[${w}] login: aviso de Caps Lock`, await visivel(p, '#avisoCaps'));
    await p.evaluate(() => document.querySelector('#loginSenha').dispatchEvent(new KeyboardEvent('keyup', { key: 'a', modifierCapsLock: false, bubbles: true })));
    ok(`[${w}] login: aviso de Caps Lock some ao desligar`, !(await visivel(p, '#avisoCaps')));
    await digitar(p, '#loginEmail', 'joao-sem-arroba');
    await clicar(p, '#btnEntrar');
    ok(`[${w}] login: e-mail inválido avisa antes de chamar o servidor`, /não parece certo/.test(await texto(p, '#loginErro')));
    await p.setOfflineMode(true);
    await digitar(p, '#loginEmail', 'joao@indycartaubate.com');
    await clicar(p, '#btnEntrar');
    await espera(200);
    ok(`[${w}] login: sem internet tem mensagem própria`, /Sem internet/.test(await texto(p, '#loginErro')));
    await p.setOfflineMode(false);
    for (let i = 0; i < 5; i++) { await digitar(p, '#loginSenha', 'errada'); await clicar(p, '#btnEntrar'); await espera(260); }
    const t = await texto(p, '#btnEntrar');
    ok(`[${w}] login: 5 erros seguidos travam com espera progressiva`, /Aguarde \d+ s/.test(t) && await p.$eval('#btnEntrar', b => b.disabled), t);
    ok(`[${w}] login: mensagem da espera sugere "Esqueci a senha"`, /Esqueci a senha/.test(await texto(p, '#loginErro')));
    if (w === 1440) await shot(p, 'login-espera-1440');
    // esqueci a senha
    await clicar(p, '#btnEsqueci');
    ok(`[${w}] esqueci: vista própria com o e-mail já preenchido`, await visivel(p, '#formEsqueci') && (await p.$eval('#esqueciEmail', e => e.value)) === 'joao@indycartaubate.com');
    await clicar(p, '#btnEsqueciEnviar');
    await espera(300);
    const reset = await p.evaluate(() => window.__ultimoReset);
    ok(`[${w}] esqueci: resetPasswordForEmail com redirectTo do app`, reset?.email === 'joao@indycartaubate.com' && reset?.redirectTo === BASE + '/', JSON.stringify(reset));
    ok(`[${w}] esqueci: avisa do limite do e-mail grátis e da senha temporária`, /senha temporária/.test(await texto(p, '#esqueciMsg')) && /limitado/.test(await texto(p, '#formEsqueci')));
    if (w === 375) await shot(p, 'esqueci-375');
    await p.ctx.close();
  }

  if (roda('login')) {
    // entrar de verdade (depois de zerar a espera): lembrar e-mail + manter conectado
    const p = await abrir('deslogado', 1440);
    await p.evaluate(() => localStorage.removeItem('indycar_login_espera'));
    await digitar(p, '#loginEmail', 'leo@indycartaubate.com');
    await digitar(p, '#loginSenha', 'qualquer-coisa');
    await p.evaluate(() => { document.querySelector('#loginLembrar').checked = true; document.querySelector('#loginManter').checked = false; });
    await clicar(p, '#btnEntrar');
    await espera(1500);
    ok('login: entra e abre o app', await visivel(p, '#telaApp') && !(await visivel(p, '#telaLogin')));
    ok('login: lembra o e-mail (só o e-mail) e grava a escolha de manter conectado', await p.evaluate(() => localStorage.getItem('indycar_lembrar_email') === 'leo@indycartaubate.com' && localStorage.getItem('indycar_manter_conectado') === '0'));
    ok('login: senha não fica no campo depois de entrar', (await p.$eval('#loginSenha', e => e.value)) === '');
    await p.ctx.close();
  }

  /* ================= PAPÉIS NA ENTRADA ================= */
  if (roda('papeis')) for (const w of LARG) {
    let p = await abrir('desativado', w);
    ok(`[${w}] desativado: volta ao login com "acesso foi desativado"`, await visivel(p, '#formLogin') && /desativado/.test(await texto(p, '#loginErro')));
    await shot(p, `desativado-${w}`); await p.ctx.close();

    p = await abrir('semapp', w);
    const links = await p.$$eval('#appsLiberados a', as => as.map(a => a.textContent.trim()));
    ok(`[${w}] sem o app: tela "sem acesso" com links para CRM e Comunicar`, await visivel(p, '#vistaSemAcesso') && links.some(l => /CRM/.test(l)) && links.some(l => /Comunicar/.test(l)), links.join('|'));
    ok(`[${w}] sem o app: sem rolagem horizontal`, await semRolagemX(p));
    await shot(p, `semapp-${w}`); await p.ctx.close();

    p = await abrir('agenda', w);
    const l2 = await p.$$eval('#appsLiberados a', as => as.map(a => a.textContent.trim()));
    ok(`[${w}] papel agenda: não entra no Atendimento, link só para a Agenda`, await visivel(p, '#vistaSemAcesso') && l2.length === 1 && /Agenda/.test(l2[0]), l2.join('|'));
    await p.ctx.close();

    p = await abrir('trocarsenha', w);
    ok(`[${w}] troca obrigatória: abre a tela de nova senha com o nome`, await visivel(p, '#formNovaSenha') && /Carlos/.test(await texto(p, '#loginTitulo')));
    await digitar(p, '#novaSenha1', 'carlos@indycartaubate.com'); await digitar(p, '#novaSenha2', 'carlos@indycartaubate.com');
    await clicar(p, '#btnNovaSenha');
    ok(`[${w}] troca obrigatória: senha igual ao e-mail é recusada`, /e-mail/.test(await texto(p, '#novaSenhaErro')));
    await digitar(p, '#novaSenha1', 'Oficina#2026'); await digitar(p, '#novaSenha2', 'Oficina#2027');
    ok(`[${w}] troca obrigatória: regras ficam verdes/cinza ao digitar e mostra a força`, await p.evaluate(() => document.querySelector('[data-regra="tam"]').classList.contains('ok') && !document.querySelector('[data-regra="igual"]').classList.contains('ok') && /boa|forte/.test(document.querySelector('#forcaSenha span').textContent)));
    await digitar(p, '#novaSenha2', 'Oficina#2026');
    if (w === 1440) await shot(p, 'troca-obrigatoria-1440');
    await clicar(p, '#btnNovaSenha');
    await espera(1500);
    const perf = await mock(sel('perfis', [['eq', 'id', '77777777-7777-4777-8777-777777777777']]), '77777777-7777-4777-8777-777777777777');
    ok(`[${w}] troca obrigatória: grava a senha e desliga precisa_trocar_senha, abre o app`, await visivel(p, '#telaApp') && perf.data?.[0]?.precisa_trocar_senha === false);
    await mock({ ...sel('perfis', [['eq', 'id', '77777777-7777-4777-8777-777777777777']]), acao: 'update', corpo: { precisa_trocar_senha: true } }, U.admin);
    await p.ctx.close();

    p = await abrir('mfa', w);
    ok(`[${w}] duas etapas: pede o código antes de abrir o app`, await visivel(p, '#formMfa') && !(await visivel(p, '#telaApp')));
    await digitar(p, '#mfaCodigo', '111111');
    await espera(600);
    ok(`[${w}] duas etapas: código errado explica (relógio do celular)`, /Código errado/.test(await texto(p, '#mfaErro')));
    if (w === 375) await shot(p, 'mfa-375');
    await digitar(p, '#mfaCodigo', '123456');
    await espera(1500);
    ok(`[${w}] duas etapas: código certo (6 dígitos já envia sozinho) abre o app`, await visivel(p, '#telaApp'));
    await p.ctx.close();

    p = await abrir('admin', w, '&recuperar=1');
    await espera(500);
    ok(`[${w}] volta do link do e-mail: tela "Crie uma senha nova"`, await visivel(p, '#formNovaSenha') && /senha nova/i.test(await texto(p, '#loginTitulo')));
    await p.ctx.close();
  }

  /* ================= ADMIN: sino, menu do perfil, minha conta ================= */
  if (roda('admin')) {
    const p = await abrir('admin', 1440);
    ok('admin: Equipe e Auditoria no menu', await visivel(p, '#navEquipe') && await visivel(p, '#navAuditoria'));
    ok('admin: sino com 3 não lidas', (await texto(p, '#sinoNum')) === '3');
    ok('admin: badge de tarefas com 2 e marcado como atrasado', (await texto(p, '#badgeTarefas')) === '2' && await p.$eval('#badgeTarefas', b => b.classList.contains('atrasada')));
    await clicar(p, '#btnSino');
    await espera(200);
    ok('sino: painel abre com 3 itens não lidos', (await p.$$('#sinoLista .ps-item.nova')).length === 3);
    await shot(p, 'sino-1440');
    await clicar(p, '[data-sino-ver="todas"]');
    ok('sino: aba "Todas" mostra também as lidas (4)', (await p.$$('#sinoLista .ps-item')).length === 4);
    await clicar(p, '#sinoLista .ps-item.nova');
    await espera(1200);
    ok('sino: clicar abre a conversa do link e marca como lida', (await texto(p, '#chatNome')) === 'Camila Rodrigues' && (await texto(p, '#sinoNum')) === '2');
    await p.evaluate((me) => window.__mockTempoReal('INSERT', 'notificacoes', { id: 'f9', perfil_id: me, tipo: 'conversa', titulo: 'Conversa passada para você', corpo: 'Teste tempo real', link: '/?conversa=x', app: 'atendimento', lida_em: null, created_at: new Date().toISOString() }), U.admin);
    await espera(300);
    ok('sino: notificação nova em tempo real sobe o contador e mostra aviso', (await texto(p, '#sinoNum')) === '3' && /Teste tempo real/.test(await texto(p, '#toast')));
    await clicar(p, '#btnSino'); await espera(150);
    await clicar(p, '#btnSinoTodas'); await espera(300);
    ok('sino: "Marcar todas como lidas" zera o contador', await p.$eval('#sinoNum', e => e.hidden));
    const lidas = await mock(sel('notificacoes', [['is', 'lida_em', null]]), U.admin);
    ok('sino: marcação gravada no banco (RLS: só as minhas)', (lidas.data || []).length === 0);
    await p.keyboard.press('Escape');

    // menu do perfil
    await clicar(p, '#usuarioBox'); await espera(150);
    ok('menu do perfil: abre com nome, e-mail e papel', await visivel(p, '#menuPerfil') && /joao@/.test(await texto(p, '#mpEmail')) && /Administrador/.test(await texto(p, '#mpPapel')));
    await shot(p, 'menu-perfil-1440');
    await p.keyboard.press('ArrowDown');
    ok('menu do perfil: setas andam entre os itens', await p.evaluate(() => document.activeElement?.dataset?.mp === 'senha'));
    await p.keyboard.press('Escape');
    ok('menu do perfil: Esc fecha e devolve o foco ao avatar', !(await visivel(p, '#menuPerfil')) && await p.evaluate(() => document.activeElement?.id === 'usuarioBox'));
    await clicar(p, '#usuarioBox'); await clicar(p, '[data-mp="perfil"]'); await espera(500);
    ok('menu do perfil: "Meu perfil" leva ao cartão em Minha conta', await visivel(p, '#cartaoPerfil') && await p.$eval('#aba-config', e => e.classList.contains('ativa')));
    await digitar(p, '#perfilCargo', 'Sócio');
    await clicar(p, '#coresAvatar [data-cor="#14b8a6"]');
    await clicar(p, '#formPerfil [type=submit]'); await espera(500);
    const eu = await mock(sel('perfis', [['eq', 'id', U.admin]]), U.admin);
    ok('meu perfil: cargo e cor salvos no banco e no avatar da barra', eu.data[0].cargo === 'Sócio' && eu.data[0].avatar_cor === '#14b8a6' && /Sócio/.test(await texto(p, '#usuarioPapel')) && /20, 184, 166|14b8a6/.test(await p.$eval('#usuarioAvatar', e => e.style.background)));
    await digitar(p, '#perfilTelefone', '1234');
    await clicar(p, '#formPerfil [type=submit]'); await espera(200);
    ok('meu perfil: telefone sem DDD é recusado com exemplo', /DDD/.test(await texto(p, '#toast')));
    // senha
    await digitar(p, '#senhaNova', 'joao@indycartaubate.com'); await digitar(p, '#senhaNova2', 'joao@indycartaubate.com');
    await clicar(p, '#btnTrocarSenha'); await espera(150);
    ok('trocar senha: igual ao e-mail é recusada', /e-mail/.test(await texto(p, '#senhaMsg')));
    await digitar(p, '#senhaNova', 'Oficina#2026'); await digitar(p, '#senhaNova2', 'Oficina#2026');
    await clicar(p, '#btnTrocarSenha'); await espera(300);
    ok('trocar senha: grava com updateUser', (await p.evaluate(() => window.__ultimoUpdateUser || [])).includes('password'));
    // duas etapas
    ok('duas etapas: cartão mostra "desligada" para quem não tem', /desligada/.test(await texto(p, '#mfaEstado')));
    await clicar(p, '#btnMfaLigar'); await espera(500);
    ok('duas etapas: modal com QR e chave para digitar', await p.$eval('#mfaQr img', i => i.src.startsWith('data:image/svg')) && (await texto(p, '#mfaSegredo')).length > 10);
    await shot(p, 'mfa-ligar-1440');
    await digitar(p, '#mfaLigarCodigo', '000000'); await clicar(p, '#btnMfaConfirmar'); await espera(300);
    ok('duas etapas: código errado no cadastro avisa', /Código errado/.test(await texto(p, '#mfaLigarErro')));
    await digitar(p, '#mfaLigarCodigo', '123456'); await clicar(p, '#btnMfaConfirmar'); await espera(500);
    ok('duas etapas: ligada (cartão e menu do perfil)', /ligada/.test(await texto(p, '#mfaEstado')) && (await texto(p, '#mpMfaSelo')) === 'ligada');
    // preferências do sino
    await p.evaluate(() => { const c = document.querySelector('[data-pref="aguardando"]'); c.checked = false; c.dispatchEvent(new Event('change')); });
    await espera(400);
    const eu2 = await mock(sel('perfis', [['eq', 'id', U.admin]]), U.admin);
    ok('preferências de aviso: gravadas em perfis.preferencias.notificacoes via PATCH /api/eu (valem em todo aparelho)', eu2.data[0].preferencias?.notificacoes?.aguardando === false);
    await clicar(p, '#btnSino'); await clicar(p, '[data-sino-ver="todas"]'); await espera(100);
    ok('preferências de aviso: o tipo desligado some do sino', !(await p.$$eval('#sinoLista .ps-ico', is => is.map(i => i.className))).some(c => /aguardando/.test(c)));
    await p.keyboard.press('Escape');
    ok('admin: nenhum erro de console', !p.erros.length, p.erros.join(' | '));
    await p.ctx.close();
  }

  /* ================= EQUIPE ================= */
  if (roda('equipe')) for (const w of LARG) {
    const p = await abrir('admin', w);
    await clicar(p, '.nav-item[data-aba="equipe"]'); await espera(900);
    const n = (await p.$$('#gradeEquipe .pessoa-cartao')).length;
    const api = (await (await fetch(BASE + '/api/equipe', { headers: { Authorization: 'Bearer mock-' + U.admin } })).json()).pessoas;
    ok(`[${w}] equipe: um cartão por pessoa com acesso`, n === api.filter(x => x.ativo).length && n >= 7, String(n));
    ok(`[${w}] equipe: resumo com quem ainda não entrou e desativados`, /ainda não entr/.test(await texto(p, '#equipeResumo')) && /desativad/.test(await texto(p, '#equipeResumo')));
    ok(`[${w}] equipe: sem rolagem horizontal`, await semRolagemX(p));
    await shot(p, `equipe-${w}`);
    await p.select('#equipeFiltroSituacao', 'desativados'); await espera(100);
    ok(`[${w}] equipe: filtro "Desativados" mostra só o Paulo`, (await p.$$eval('#gradeEquipe .pessoa-cartao', cs => cs.map(c => c.textContent))).join('').includes('Paulo') && (await p.$$('#gradeEquipe .pessoa-cartao')).length === 1);
    await p.select('#equipeFiltroSituacao', 'todos');
    await clicar(p, '[data-papel-filtro="gestor"]'); await espera(100);
    ok(`[${w}] equipe: filtro por papel (só gestores)`, (await p.$$('#gradeEquipe .pessoa-cartao')).length === api.filter(x => x.papel === 'gestor').length && /Maria/.test(await texto(p, '#gradeEquipe')));
    await clicar(p, '[data-papel-filtro=""]');
    await digitar(p, '#equipeBusca', 'renan'); await espera(250);
    ok(`[${w}] equipe: busca por nome`, (await p.$$('#gradeEquipe .pessoa-cartao')).length === 1);
    await digitar(p, '#equipeBusca', ' '); await espera(250);
    await p.select('#equipeFiltroTime', 'e0000000-0000-4000-8000-0000000000a2'); await espera(100);
    ok(`[${w}] equipe: filtro por equipe (Oficina)`, (await p.$$eval('#gradeEquipe .pessoa-cartao', cs => cs.every(c => /Oficina/.test(c.textContent)))));
    await p.select('#equipeFiltroTime', '');
    await p.select('#equipeFiltroSituacao', 'ativos');
    if (w === 1440) {
      // eu mesmo: travado
      await clicar(p, `[data-pessoa="${U.admin}"]`); await espera(300);
      ok('equipe: em si mesmo não muda papel/apps/acesso (aviso + campos travados)', /Este é você/.test(await texto(p, '#pessoaTrava')) && await p.$$eval('#pessoaPapeis input', is => is.every(i => i.disabled)) && !(await visivel(p, '#btnPessoaAtivo')));
      await p.keyboard.press('Escape'); await espera(200);
      // Leonardo: vira gestor + Comunicar
      await clicar(p, `[data-pessoa="${U.atendente}"]`); await espera(300);
      await shot(p, 'pessoa-1440');
      await p.evaluate(() => { const r = document.querySelector('#pessoaPapeis input[value="gestor"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
      await clicar(p, '#pessoaApps [data-app="comunicar"]');
      await clicar(p, '#btnPessoaSalvar'); await espera(600);
      const leo = (await (await fetch(BASE + '/api/equipe', { headers: { Authorization: 'Bearer mock-' + U.admin } })).json()).pessoas.find(x => x.id === U.atendente);
      ok('equipe: muda papel e apps (PATCH) e o cartão atualiza', leo.papel === 'gestor' && leo.apps.includes('comunicar') && /Gestor/.test(await texto(p, `[data-pessoa="${U.atendente}"] .papel-selo`)));
      await fetch(BASE + `/api/equipe/${U.atendente}`, { method: 'PATCH', headers: { Authorization: 'Bearer mock-' + U.admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ papel: 'atendente', apps: ['atendimento', 'crm', 'agenda'] }) });
      // senha temporária
      await clicar(p, `[data-pessoa="${U.gestor}"]`); await espera(300);
      await clicar(p, '#btnPessoaSenha'); await espera(200);
      await clicar(p, '#btnConfirmarOk'); await espera(600);
      const senha = await texto(p, '#senhaTempCaixa .st-senha code');
      ok('senha temporária: aparece uma vez, com copiar e aviso de entregar pessoalmente', /^[A-Za-z0-9]{4}-[A-Za-z0-9]{3}-[A-Za-z0-9]{3}$/.test(senha) && /pessoalmente/.test(await texto(p, '#senhaTempCaixa')) && !!(await p.$('#senhaTempCaixa [data-copiar-senha]')), senha);
      await shot(p, 'senha-temp-1440');
      await p.keyboard.press('Escape'); await espera(200);
      ok('senha temporária: some da página ao fechar', (await p.$eval('#senhaTempCaixa', e => e.innerHTML)) === '');
      ok('senha temporária: cartão passa a mostrar "troca de senha pendente"', /troca de senha pendente/.test(await texto(p, `[data-pessoa="${U.gestor}"]`)));
      // desativar com confirmação
      await clicar(p, '[data-pessoa="88888888-8888-4888-8888-888888888888"]'); await espera(300);
      await clicar(p, '#btnPessoaAtivo'); await espera(200);
      ok('desativar: pede confirmação explicando o efeito', await visivel(p, '#modalConfirmarBg') && /não consegue mais entrar/.test(await texto(p, '#confirmarTexto')));
      await clicar(p, '#btnConfirmarOk'); await espera(600);
      ok('desativar: Renan sai da lista de quem tem acesso', !(await p.$('[data-pessoa="88888888-8888-4888-8888-888888888888"]')));
      await fetch(BASE + '/api/equipe/88888888-8888-4888-8888-888888888888/reativar', { method: 'POST', headers: { Authorization: 'Bearer mock-' + U.admin, 'Content-Type': 'application/json' }, body: '{}' });
      const ult = await (await fetch(BASE + `/api/equipe/${U.admin}`, { method: 'PATCH', headers: { Authorization: 'Bearer mock-' + U.admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ papel: 'atendente' }) })).json();
      ok('mock: servidor recusa mexer no próprio papel (409 proprio_papel)', ult.codigo === 'proprio_papel');
    }
    // convite em passos
    await clicar(p, '#btnConvidar'); await espera(300);
    await clicar(p, '#btnConviteAvancar'); await espera(100);
    ok(`[${w}] convite: passo 1 exige nome`, /nome/.test(await texto(p, '#conviteErro')));
    await digitar(p, '#formConvite [name=nome]', 'Ana Teste'); await digitar(p, '#formConvite [name=email]', 'maria@indycartaubate.com');
    await clicar(p, '#btnConviteAvancar'); await espera(100);
    ok(`[${w}] convite: e-mail que já está na equipe é barrado`, /já está/.test(await texto(p, '#conviteErro')));
    await digitar(p, '#formConvite [name=email]', `ana${w}@indycartaubate.com`);
    await clicar(p, '#btnConviteAvancar'); await espera(200);
    ok(`[${w}] convite: passo 2 com os 4 papéis explicados`, (await p.$$('#convitePapeis .papel-op')).length === 4 && /Só a Agenda/.test(await texto(p, '#convitePapeis')));
    await p.evaluate(() => { const r = document.querySelector('#convitePapeis input[value="gestor"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
    await clicar(p, '#btnConviteAvancar'); await espera(200);
    const ligados = await p.$$eval('#conviteApps .app-chip.ligado', bs => bs.map(b => b.dataset.app));
    ok(`[${w}] convite: passo 3 já marca os apps do papel (gestor = 5)`, ligados.length === 5, ligados.join(','));
    ok(`[${w}] convite: revisão antes de criar`, /Ana Teste/.test(await texto(p, '#conviteRevisao')) && /Gestor/.test(await texto(p, '#conviteRevisao')));
    if (w === 375) await shot(p, 'convite-375');
    await clicar(p, '#btnConviteAvancar'); await espera(700);
    ok(`[${w}] convite: passo 4 mostra a senha temporária uma vez`, await visivel(p, '#conviteResultado .st-senha') && /Concluir/.test(await texto(p, '#btnConviteAvancar')));
    if (w === 1440) await shot(p, 'convite-pronto-1440');
    await clicar(p, '#btnConviteAvancar'); await espera(300);
    ok(`[${w}] convite: concluir fecha e apaga a senha da página; a pessoa aparece na grade`, (await p.$eval('#conviteResultado', e => e.innerHTML)) === '' && /Ana Teste/.test(await texto(p, '#gradeEquipe')));
    ok(`[${w}] equipe: nenhum erro de console`, !p.erros.length, p.erros.join(' | '));
    await p.ctx.close();
  }

  /* ================= AUDITORIA ================= */
  if (roda('auditoria')) for (const w of LARG) {
    const p = await abrir('admin', w);
    await clicar(p, '.nav-item[data-aba="auditoria"]'); await espera(900);
    const frases = await p.$$eval('#linhaAuditoria .lt-frase', fs => fs.map(f => f.textContent.replace(/\s+/g, ' ').trim()));
    ok(`[${w}] auditoria: linha do tempo com 20 por página e separador de dia`, frases.length === 20 && (await p.$$('#linhaAuditoria .lt-dia')).length > 0, String(frases.length));
    ok(`[${w}] auditoria: paginação`, /Página 1 de \d+/.test(await texto(p, '#audPaginaTxt')));
    ok(`[${w}] auditoria: sem rolagem horizontal`, await semRolagemX(p));
    await shot(p, `auditoria-${w}`);
    await p.select('#audTabela', 'perfis'); await espera(700);
    const fp = await p.$$eval('#linhaAuditoria .lt-frase', fs => fs.map(f => f.textContent.replace(/\s+/g, ' ').trim()));
    ok(`[${w}] auditoria: filtro "Equipe e acessos" + frases de papel/desativou/apps/senha/convite`,
      fp.some(f => /mudou o papel de Maria Souza de atendente para gestor/.test(f)) && fp.some(f => /desativou o acesso de Paulo Mendes/.test(f))
      && fp.some(f => /mudou os apps de Bianca Lopes: liberou Comunicar; tirou Atendimento/.test(f)) && fp.some(f => /gerou uma senha temporária para Carlos Henrique/.test(f))
      && fp.some(f => /convidou Carlos Henrique como atendente/.test(f)) && fp.some(f => /desativou o acesso de Paulo Mendes — “Saiu da empresa”/.test(f)), fp.join(' || '));
    await p.select('#audTabela', ''); await p.select('#audPessoa', U.gestor); await espera(700);
    const fg = await p.$$eval('#linhaAuditoria .lt-frase', fs => fs.map(f => f.textContent.trim()));
    ok(`[${w}] auditoria: filtro por pessoa (só Maria)`, fg.length > 0 && fg.every(f => f.startsWith('Maria Souza')), fg[0]);
    ok(`[${w}] auditoria: frases de lead, transferência e exclusão`, fg.some(f => /moveu o lead de Camila Rodrigues de em contato para orçamento/.test(f)) && fg.some(f => /passou a conversa de José Antônio Ferreira de Maria Souza para Leonardo Alves — “Fim do meu turno”/.test(f)) && fg.some(f => /apagou o agendamento de Hugo Teste/.test(f)), fg.join(' || '));
    await p.select('#audPessoa', ''); await espera(700);
    await clicar(p, '#audProxima'); await espera(700);
    ok(`[${w}] auditoria: "Mais antigos" vai para a página 2`, /Página 2/.test(await texto(p, '#audPaginaTxt')));
    if (w === 1440) {
      await p.evaluate(() => { const o = URL.createObjectURL; URL.createObjectURL = (b) => { window.__csv = b; return o(b); }; });
      await clicar(p, '#btnAuditoriaCsv'); await espera(900);
      const csv = await p.evaluate(async () => window.__csv ? await window.__csv.text() : '');
      ok('auditoria: exportar CSV baixa o arquivo com cabeçalho (com token, sem expor nada na URL)', /^\ufeff?quando;pessoa;app;acao/.test(csv), csv.slice(0, 60));
      await clicar(p, '#audAnterior'); await espera(700);
      await p.evaluate(() => document.querySelector('#linhaAuditoria details')?.setAttribute('open', ''));
      ok('auditoria: "ver detalhes" mostra antes → depois', (await p.$$('#linhaAuditoria .lt-tabela')).length > 0);
      await shot(p, 'auditoria-detalhes-1440');
    }
    ok(`[${w}] auditoria: nenhum erro de console`, !p.erros.length, p.erros.join(' | '));
    await p.ctx.close();
  }

  /* ================= TAREFAS, FICHA, PRESENÇA, TRANSFERIR ================= */
  if (roda('tarefas')) for (const w of LARG) {
    const p = await abrir('admin', w);
    await clicar(p, '.nav-item[data-aba="tarefas"]'); await espera(700);
    ok(`[${w}] tarefas: grupos Atrasadas e Hoje`, await visivel(p, '.tf-grupo.g-atrasadas') && await visivel(p, '.tf-grupo.g-hoje'));
    ok(`[${w}] tarefas: resumo no topo ("2 abertas com você · 1 atrasada")`, /2 abertas com você · 1 atrasada/.test(await texto(p, '#tarefasResumo')), await texto(p, '#tarefasResumo'));
    ok(`[${w}] tarefas: sem rolagem horizontal`, await semRolagemX(p));
    await shot(p, `tarefas-${w}`);
    await clicar(p, '.g-hoje [data-tf="concluir"]'); await espera(500);
    ok(`[${w}] tarefas: concluir tira da lista e baixa o contador`, (await texto(p, '#badgeTarefas')) === '1' && !(await p.$('.g-hoje')));
    await clicar(p, '[data-tarefas-ver="feitas"]'); await espera(200);
    ok(`[${w}] tarefas: aparece em "Feitas" e dá para reabrir`, (await p.$$('#listaTarefas .tarefa.feita')).length >= 2);
    await clicar(p, '#listaTarefas .tarefa.feita [data-tf="reabrir"]'); await espera(500);
    ok(`[${w}] tarefas: reabrir devolve para as abertas`, (await texto(p, '#badgeTarefas')) === '2');
    await clicar(p, '[data-tarefas-ver="criei"]'); await espera(200);
    ok(`[${w}] tarefas: "Que eu passei" mostra a tarefa passada ao Leonardo`, /Conferir peças do Compass/.test(await texto(p, '#listaTarefas')));
    await clicar(p, '[data-tarefas-ver="equipe"]'); await espera(900);
    const pessoas = (await p.$$('#cargaEquipe .carga-pessoa')).length;
    ok(`[${w}] painel do gestor: carga por pessoa (GET /api/tarefas/equipe)`, pessoas >= 5, String(pessoas));
    if (w === 1440) await shot(p, 'tarefas-equipe-1440');
    await clicar(p, `#cargaEquipe [data-carga-pessoa="${U.atendente}"]`); await espera(200);
    ok(`[${w}] painel do gestor: clicar na pessoa filtra as tarefas dela`, (await p.$$eval('#listaTarefas .tarefa strong', s => s.map(x => x.textContent))).every(t => /Compass|Marcos/.test(t)));
    await clicar(p, '[data-tarefas-ver="minhas"]');

    // conversa da Camila: ficha com tarefas, presença, autor das mensagens
    await clicar(p, '.nav-item[data-aba="conversas"]');
    await p.evaluate((id) => abrirConversa(id), CAMILA); await espera(1400);
    ok(`[${w}] ficha: tarefas do cliente aparecem na ficha`, /Ligar para a Camila/.test(await texto(p, '#fichaTarefas')));
    ok(`[${w}] presença: mostra quem mais está com a conversa aberta`, await visivel(p, '#chatPresenca') && /Maria também está aqui/.test(await texto(p, '#chatPresenca')));
    await p.evaluate((id) => window.__mockPresenca(id, [{ id: '33333333-3333-4333-8333-333333333333', nome: 'Maria Souza', cor: '#a855f7', digitando: true }, { id: '22222222-2222-4222-8222-222222222222', nome: 'Leonardo Alves', cor: '#0ea5e9' }]), CAMILA);
    await espera(200);
    ok(`[${w}] presença: "digitando…" em tempo real`, /Maria está digitando/.test(await texto(p, '#chatPresenca')));
    const autores = await p.$$eval('#mensagens .msg-autor', a => a.map(x => x.textContent.trim()));
    ok(`[${w}] mensagens: iniciais e nome de quem da equipe enviou`, autores.some(a => /LA/.test(a) && /Leonardo/.test(a)) && autores.some(a => /MS/.test(a) && /Maria/.test(a)), autores.join('|'));
    if (w === 1440) await shot(p, 'chat-presenca-1440');
    if (w === 375) await shot(p, 'chat-presenca-375');
    // nova tarefa a partir da conversa
    await p.evaluate(() => Tarefas.abrirNova({ daConversa: true })); await espera(300);
    ok(`[${w}] nova tarefa: ligada à conversa (mostra o cliente)`, /Camila Rodrigues/.test(await texto(p, '#tarefaLigada')));
    await digitar(p, '#formTarefa [name=titulo]', `Confirmar alinhamento ${w}`);
    await p.select('#tarefaResponsavel', U.gestor);
    await clicar(p, '[data-prazo="amanha9"]');
    await p.evaluate(() => { document.querySelector('input[name=prioridade][value="1"]').checked = true; });
    if (w === 375) await shot(p, 'nova-tarefa-375');
    await clicar(p, '#btnSalvarTarefa'); await espera(700);
    const t = await mock(sel('tarefas', [['eq', 'titulo', `Confirmar alinhamento ${w}`]]), U.admin);
    const nt = await mock(sel('notificacoes', [['eq', 'tipo', 'tarefa']]), U.gestor);
    ok(`[${w}] nova tarefa: gravada com responsável, prazo, prioridade e conversa/cliente`, t.data?.[0]?.responsavel_id === U.gestor && t.data[0].prioridade === 1 && t.data[0].conversa_id === CAMILA && !!t.data[0].vence_em && t.data[0].origem === 'atendimento');
    ok(`[${w}] nova tarefa: aparece na ficha na hora e a Maria recebe aviso`, (await texto(p, '#fichaTarefas')).includes(`Confirmar alinhamento ${w}`) && (nt.data || []).some(n => /Confirmar alinhamento/.test(n.corpo)));
    // transferir com motivo
    await p.evaluate(() => Tarefas.abrirTransferir()); await espera(300);
    const opcoes = await p.$$eval('#transferirColegas .colega', ls => ls.map(l => l.textContent));
    ok(`[${w}] transferir: lista colegas (sem o papel agenda nem o dono atual)`, opcoes.length >= 3 && !opcoes.some(o => /Franklin/.test(o)) && !opcoes.some(o => /João Pedro/.test(o)), opcoes.length + '');
    await p.evaluate((id) => { const r = document.querySelector(`#transferirColegas input[value="${id}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, U.atendente);
    await clicar(p, '#btnTransferirOk'); await espera(200);
    ok(`[${w}] transferir: sem motivo não deixa (o servidor exige)`, /motivo/.test(await texto(p, '#transferirErro')));
    await clicar(p, '[data-motivo="Fim do meu turno"]');
    if (w === 1440) await shot(p, 'transferir-1440');
    await clicar(p, '#btnTransferirOk'); await espera(700);
    const nl = await mock(sel('notificacoes', [['eq', 'tipo', 'conversa']]), U.atendente);
    ok(`[${w}] transferir: dono muda na tela e o colega é avisado com o motivo`, /LEONARDO/i.test(await texto(p, '#chatDono')) && (nl.data || []).some(n => /motivo: Fim do meu turno/.test(n.corpo)));
    await fetch(BASE + '/api/_mock', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-' + U.admin }, body: JSON.stringify({ ...sel('conversas', [['eq', 'id', CAMILA]]), acao: 'update', corpo: { atribuida_a: U.admin } }) });
    // rascunho em sessionStorage
    await p.evaluate(() => { campo.value = 'rascunho de teste'; campo.dispatchEvent(new Event('input')); });
    await p.evaluate((id) => abrirConversa(id), JOSE); await espera(900);
    ok(`[${w}] rascunho: guardado no sessionStorage (nada de texto de cliente no localStorage)`, await p.evaluate((id) => !!sessionStorage.getItem('indycar_rascunho_' + id) && !Object.keys(localStorage).some(k => k.startsWith('indycar_rascunho_')), CAMILA));
    ok(`[${w}] presença: trocar de conversa sai do canal anterior`, !(await visivel(p, '#chatPresenca')) && await p.evaluate((id) => !window.__mockCanais().includes('conversa:' + id), CAMILA));
    ok(`[${w}] tarefas/conversas: sem rolagem horizontal`, await semRolagemX(p));
    ok(`[${w}] tarefas: nenhum erro de console`, !p.erros.length, p.erros.join(' | '));
    await p.ctx.close();
  }

  /* ================= LISTA: filtro por equipe e menu de dono ================= */
  if (roda('lista')) {
    const p = await abrir('admin', 1440);
    ok('lista: seletor de equipe aparece (há equipes)', await visivel(p, '#filtroEquipe'));
    await p.select('#filtroEquipe', 'e0000000-0000-4000-8000-0000000000a2'); await espera(900);
    ok('lista: "Equipe Oficina" mostra só conversas de quem é da Oficina (nenhuma)', (await p.$$('#listaConversas .conversa')).length === 0);
    await p.select('#filtroEquipe', 'e0000000-0000-4000-8000-0000000000a1'); await espera(900);
    const n = (await p.$$('#listaConversas .conversa')).length;
    ok('lista: "Equipe Recepção" mostra as conversas dos donos da Recepção', n === 3, String(n));
    ok('lista: o filtro de equipe fica lembrado na aba', await p.evaluate(() => sessionStorage.getItem('indycar_filtro_equipe') === 'e0000000-0000-4000-8000-0000000000a1'));
    await p.select('#filtroEquipe', ''); await espera(700);
    await clicar(p, '[data-dono-filtro="sem"]'); await espera(700);
    ok('lista: "Sem dono" continua funcionando', (await p.$$('#listaConversas .conversa')).length === 2);
    await clicar(p, '[data-dono-filtro=""]'); await espera(700);
    await p.evaluate((id) => abrirConversa(id), CAMILA); await espera(1000);
    await clicar(p, '#chatDono [data-dono]'); await espera(200);
    await p.evaluate((id) => document.querySelector(`#menuDonoLista [data-novo="${id}"]`).click(), U.gestor); await espera(300);
    ok('menu de dono: escolher um colega abre a transferência já com ele marcado', await visivel(p, '#modalTransferirBg') && await p.evaluate((id) => document.querySelector(`#transferirColegas input[value="${id}"]`).checked, U.gestor));
    await p.keyboard.press('Escape');
    await clicar(p, '#btnMaisAcoes'); await espera(150);
    ok('chat ⋯: "Nova tarefa" e "Transferir para colega" no menu', await visivel(p, '#btnNovaTarefaChat') && await visivel(p, '#btnTransferir'));
    await p.keyboard.press('Escape');
    await p.keyboard.down('Alt'); await p.keyboard.press('KeyT'); await p.keyboard.up('Alt'); await espera(300);
    ok('atalho Alt+T abre "Nova tarefa" ligada à conversa', await visivel(p, '#modalTarefaBg') && /Camila/.test(await texto(p, '#tarefaLigada')));
    await p.ctx.close();
  }

  /* ================= PAPÉIS: atendente e gestor ================= */
  if (roda('restricoes')) {
    let p = await abrir('atendente', 1440);
    ok('atendente: sem Equipe/Auditoria no menu e sem "Equipe e sistema"', !(await visivel(p, '#navEquipe')) && !(await visivel(p, '#navAuditoria')) && !(await visivel(p, '#configTabs')));
    await p.evaluate((id) => abrirConversa(id), CAMILA); await espera(1000);
    ok('atendente: botões de apagar conversa/mensagens escondidos', await p.evaluate(() => document.querySelector('#btnExcluirConversa').hidden && document.querySelector('#btnSelecionarMsgs').hidden && document.querySelector('#btnApagarLead').hidden));
    const r = await p.evaluate(async () => { const { data } = await sb.from('leads').delete().eq('id', 'l1').select('id'); return data; });
    ok('atendente: o banco (RLS) não apaga lead — 0 linhas', Array.isArray(r) && r.length === 0);
    ok('atendente: sem a aba "Equipe" nas tarefas', !(await visivel(p, '#segTarefasEquipe')));
    ok('atendente: o rótulo do papel aparece certo', /Atendente/.test(await texto(p, '#usuarioPapel')));
    await clicar(p, '.nav-item[data-aba="equipe"]').catch(() => {});
    ok('atendente: nenhum erro de console', !p.erros.length, p.erros.join(' | '));
    await shot(p, 'atendente-1440');
    await p.ctx.close();

    // a Maria pode ter ganhado senha temporária no grupo "equipe": volta ao normal
    await mock({ ...sel('perfis', [['eq', 'id', U.gestor]]), acao: 'update', corpo: { precisa_trocar_senha: false } }, U.admin);
    p = await abrir('gestor', 1440);
    ok('gestor: vê Equipe, não vê Auditoria', await visivel(p, '#navEquipe') && !(await visivel(p, '#navAuditoria')));
    await p.evaluate((id) => abrirConversa(id), CAMILA); await espera(1000);
    ok('gestor: pode apagar (botões visíveis no ⋯)', await p.evaluate(() => !document.querySelector('#btnExcluirConversa').hidden));
    await clicar(p, '.nav-item[data-aba="equipe"]'); await espera(900);
    ok('gestor: equipe só leitura (sem convidar, com aviso)', !(await visivel(p, '#btnConvidar')) && await visivel(p, '#equipeSoLeitura'));
    await clicar(p, `[data-pessoa="${U.atendente}"]`); await espera(300);
    ok('gestor: ficha da pessoa sem salvar e com tudo travado', !(await visivel(p, '#btnPessoaSalvar')) && await p.$$eval('#pessoaApps [data-app]', bs => bs.every(b => b.disabled)) && /Só o administrador/.test(await texto(p, '#pessoaTrava')));
    await shot(p, 'gestor-pessoa-1440');
    await p.keyboard.press('Escape');
    const aud = await (await fetch(BASE + '/api/auditoria', { headers: { Authorization: 'Bearer mock-' + U.gestor } })).status;
    ok('gestor: auditoria é só do admin (403)', aud === 403);
    await clicar(p, '.nav-item[data-aba="tarefas"]'); await espera(400);
    ok('gestor: aba "Equipe" nas tarefas', await visivel(p, '#segTarefasEquipe'));
    ok('gestor: nenhum erro de console', !p.erros.length, p.erros.join(' | '));
    await p.ctx.close();
  }

  /* ================= SESSÃO: 401/403, sair ================= */
  if (roda('sessao')) {
    let p = await abrir('admin', 1440);
    await p.evaluate(async (tok) => { await fetch('/api/saude', { headers: { Authorization: 'Bearer mock-' + tok } }); }, U.desativado);
    await espera(600);
    ok('401 "desativado" no meio do uso: volta ao login com o motivo (não "sessão expirou")', await visivel(p, '#formLogin') && /desativado/.test(await texto(p, '#loginErro')) && !/expirou/.test(await texto(p, '#loginErro')) && !(await visivel(p, '#telaApp')));
    await p.ctx.close();

    p = await abrir('admin', 1440);
    await p.evaluate(async (tok) => { await fetch('/api/saude', { headers: { Authorization: 'Bearer mock-' + tok } }); }, U.semapp);
    await espera(600);
    ok('403 "sem_acesso_app": mostra a tela de sem acesso com os links que o servidor mandou', await visivel(p, '#vistaSemAcesso') && (await p.$$eval('#appsLiberados a', as => as.map(a => a.href))).some(h => /indycar-crm/.test(h)));
    await p.ctx.close();

    p = await abrir('admin', 1440);
    await p.evaluate(async (tok) => { await fetch('/api/saude', { headers: { Authorization: 'Bearer mock-' + tok } }); }, '88888888-8888-4888-8888-888888888888');
    await espera(600);
    ok('401 "mfa_pendente": abre a tela do código', await visivel(p, '#formMfa') && !(await visivel(p, '#telaApp')));
    await p.ctx.close();

    p = await abrir('admin', 1440);
    await p.evaluate(async () => { await fetch('/api/teste/limite', { headers: await authCabecalhos() }); });
    await espera(400);
    ok('429 "muitas_tentativas": aviso claro e continua no app', /Espere/.test(await texto(p, '#toast')) && await visivel(p, '#telaApp'));
    await p.ctx.close();

    p = await abrir('admin', 1440);
    await p.evaluate(async () => { await fetch('/api/saude', { headers: { Authorization: 'Bearer mock-invalido' } }); });
    await espera(500);
    ok('401 com sessão renovável: tenta renovar e continua no app', await visivel(p, '#telaApp'));
    await p.evaluate(async () => { sb.auth.refreshSession = async () => ({ data: {}, error: { message: 'expirou' } }); await fetch('/api/saude', { headers: { Authorization: 'Bearer mock-invalido' } }); });
    await espera(3500);
    await p.evaluate(async () => { await fetch('/api/saude', { headers: { Authorization: 'Bearer mock-invalido' } }); });
    await espera(600);
    ok('401 sem renovação: volta ao login com "sessão expirou"', await visivel(p, '#formLogin') && /expirou/.test(await texto(p, '#loginErro')));
    await p.ctx.close();

    p = await abrir('atendente', 1440);
    await mock({ ...sel('perfis', [['eq', 'id', U.atendente]]), acao: 'update', corpo: { papel: 'gestor' } }, U.admin);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await espera(900);
    ok('vigia: papel mudado no meio do uso avisa e recarrega a tela', /Seu papel mudou/.test(await texto(p, '#toast')));
    await mock({ ...sel('perfis', [['eq', 'id', U.atendente]]), acao: 'update', corpo: { papel: 'atendente' } }, U.admin);
    await p.ctx.close();

    p = await abrir('atendente', 1440);
    await mock({ ...sel('perfis', [['eq', 'id', U.atendente]]), acao: 'update', corpo: { ativo: false } }, U.admin);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await espera(1200);
    ok('vigia: desativado no meio do uso (ao voltar para a aba) cai no login com o motivo', await visivel(p, '#formLogin') && /desativado/.test(await texto(p, '#loginErro')));
    await mock({ ...sel('perfis', [['eq', 'id', U.atendente]]), acao: 'update', corpo: { ativo: true } }, U.admin);
    await p.ctx.close();

    p = await abrir('admin', 1440);
    await p.evaluate(() => { sessionStorage.setItem('indycar_rascunho_x', 'oi'); localStorage.setItem('indycar_ordem', 'espera'); localStorage.setItem('indycar_tema', 'escuro'); });
    await clicar(p, '#btnSair'); await espera(250);
    ok('sair: pergunta se limpa o aparelho (conta os rascunhos)', await visivel(p, '#modalSairBg') && /1 rascunho/.test(await texto(p, '#sairLimparDetalhe')));
    await shot(p, 'sair-1440');
    await p.evaluate(() => { document.querySelector('#sairLimpar').checked = true; });
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), clicar(p, '#btnConfirmarSair')]);
    await espera(600);
    const ls = await p.evaluate(() => ({ chaves: Object.keys(localStorage).filter(k => k.startsWith('indycar_')), sess: sessionStorage.getItem('indycar_rascunho_x') }));
    ok('sair + limpar: rascunhos, filtros e preferências somem (fica só o tema e a configuração pública)', ls.sess === null && ls.chaves.filter(k => !['indycar_cfg_publica', 'indycar_equipe_nomes'].includes(k)).join(',') === 'indycar_tema', JSON.stringify(ls));
    await p.ctx.close();

    p = await abrir('admin', 1440);
    await clicar(p, '#usuarioBox'); await clicar(p, '[data-mp="sair-todos"]'); await espera(200);
    ok('sair de todos: confirmação explicando o efeito', await visivel(p, '#modalConfirmarBg') && /inclusive este/.test(await texto(p, '#confirmarTexto')));
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), clicar(p, '#btnConfirmarOk')]);
    await espera(300);
    ok('sair de todos: signOut com scope global', (await p.evaluate(() => sessionStorage.getItem('__mock_signout'))) === 'global');
    await p.ctx.close();
  }

  /* ================= SERVIDOR SEM AS ROTAS NOVAS ================= */
  if (roda('semrotas')) {
    const p = await abrir('admin', 1440, '&sem_rotas=1');
    await clicar(p, '.nav-item[data-aba="equipe"]'); await espera(900);
    ok('sem rotas: Equipe mostra aviso amigável e a lista que dá (só leitura)', /ainda não chegou no servidor/.test(await texto(p, '#gradeEquipe')) && (await p.$$('#gradeEquipe .pessoa-cartao')).length > 0 && !(await visivel(p, '#btnConvidar')));
    await shot(p, 'sem-rotas-equipe-1440');
    await clicar(p, '.nav-item[data-aba="auditoria"]'); await espera(800);
    ok('sem rotas: Auditoria mostra aviso amigável (sem erro vermelho)', /ainda não chegou no servidor/.test(await texto(p, '#linhaAuditoria')));
    await clicar(p, '.nav-item[data-aba="tarefas"]'); await clicar(p, '[data-tarefas-ver="equipe"]'); await espera(900);
    ok('sem rotas: carga da equipe calculada na tela, com aviso', /calculada aqui/.test(await texto(p, '#cargaEquipe')) && (await p.$$('#cargaEquipe .carga-pessoa')).length > 0);
    await clicar(p, '.nav-item[data-aba="conversas"]');
    await p.evaluate((id) => abrirConversa(id), JOSE); await espera(900);
    await p.evaluate((id) => Tarefas.abrirTransferir(conversaAtual, id), U.gestor); await espera(200);
    await clicar(p, '[data-motivo="Fim do meu turno"]');
    await clicar(p, '#btnTransferirOk'); await espera(900);
    ok('sem rotas: transferir cai no jeito antigo e avisa que o motivo não foi registrado', /motivo não foi registrado/.test(await texto(p, '#toast')));
    ok('sem rotas: nenhum erro de console', !p.erros.length, p.erros.join(' | '));
    await p.ctx.close();
  }

  /* ================= CELULAR: popovers dentro da tela ================= */
  if (roda('celular')) {
    const p = await abrir('admin', 375);
    ok('375: app sem rolagem horizontal', await semRolagemX(p));
    await clicar(p, '#btnSino'); await espera(200);
    const r = await p.$eval('#painelSino', e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; });
    ok('375: painel do sino cabe na tela', r.l >= 0 && r.r <= 375 && r.t >= 0 && r.b <= 812, JSON.stringify(r));
    await shot(p, 'sino-375');
    await p.keyboard.press('Escape');
    await clicar(p, '#usuarioBox'); await espera(200);
    const m = await p.$eval('#menuPerfil', e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; });
    ok('375: menu do perfil cabe na tela', m.l >= 0 && m.r <= 375 && m.t >= 0 && m.b <= 812, JSON.stringify(m));
    await shot(p, 'menu-perfil-375');
    await p.keyboard.press('Escape');
    await clicar(p, '.nav-item[data-aba="config"]'); await espera(300);
    ok('375: Minha conta sem rolagem horizontal', await semRolagemX(p));
    await shot(p, 'conta-375');
    ok('375: nenhum erro de console', !p.erros.length, p.erros.join(' | '));
    await p.ctx.close();
  }

  await browser.close();
  const falhas = resultados.filter(r => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} OK`);
  fs.writeFileSync(OUT + 'resultado.json', JSON.stringify(resultados, null, 1));
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
