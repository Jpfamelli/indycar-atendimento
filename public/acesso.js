/* ============================================================
   IndyCar Atendimento — LOGIN, PERFIL e ACESSO (rodada 3, 13/10/2026)
   O padrão comum do ecossistema:
     1. login com mostrar senha, Caps Lock, lembrar e-mail, mensagens claras
        e espera progressiva depois de 5 erros seguidos;
     2. esqueci a senha (link por e-mail) e a volta do link (PASSWORD_RECOVERY);
     3. troca obrigatória quando perfis.precisa_trocar_senha;
     4. acesso por app (perfis.apps) — sem o Atendimento, mostra para onde ir;
     5. menu do perfil: perfil, senha, duas etapas (TOTP), tema, avisos, sair;
     6. último acesso a cada 5 min no máximo;
     9. sessão: 401/403 do servidor voltam ao login com o motivo.
   Usa o estado global do app.js (sb, perfil, usuario, $, esc, toast…).
   ============================================================ */
const Acesso = (() => {
  /* Os apps do ecossistema (os links do "sem acesso" e do menu) */
  /* Rodada 5: os endereços moram num lugar só (public/apps.js); aqui só a forma que esta tela usa. */
  const APPS = Object.fromEntries(Object.entries((window.IndyCarApps && window.IndyCarApps.apps) || {})
    .filter(([k]) => k !== 'site' && k !== 'patio').map(([k, v]) => [k, { nome: v.nome, ico: v.ico, url: v.url }]));
  const CORES = ['#e50914', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#a855f7', '#ec4899', '#64748b'];
  const K = { lembrar: 'indycar_lembrar_email', manter: 'indycar_manter_conectado', espera: 'indycar_login_espera' };
  const MAX_ERROS = 5;

  let usuarioPendente = null;     // logou, mas falta o código (MFA) ou a troca de senha
  let modoNovaSenha = 'recuperar';
  let vigiaTimer = null, esperaTimer = null;
  let enrolando = null;           // fator TOTP em cadastro

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* aba anônima */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignora */ } },
  };

  /* ---------------- Onde o login fica guardado ----------------
     "Manter conectado" marcado (padrão): localStorage, como sempre foi.
     Desmarcado: sessionStorage — fecha o navegador e sai sozinho. */
  const manter = () => ls.get(K.manter) !== '0';
  function armazenamentoDaSessao() {
    const um = () => (manter() ? localStorage : sessionStorage);
    const outro = () => (manter() ? sessionStorage : localStorage);
    return {
      getItem(k) { try { return um().getItem(k) ?? outro().getItem(k); } catch { return null; } },
      setItem(k, v) { try { um().setItem(k, v); outro().removeItem(k); } catch { /* ignora */ } },
      removeItem(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* ignora */ } },
    };
  }

  /* ---------------- Mensagens de erro claras ---------------- */
  function traduzirErro(m = '') {
    const t = String(m || '').toLowerCase();
    if (t.includes('invalid login') || t.includes('invalid credentials')) return 'E-mail ou senha incorretos.';
    if (t.includes('failed to fetch') || t.includes('network') || t.includes('load failed') || navigator.onLine === false)
      return 'Sem internet (ou o servidor não respondeu). Confira a conexão e tente de novo.';
    if (t.includes('banned') || t.includes('desativ')) return 'Seu acesso foi desativado. Fale com o administrador.';
    if (t.includes('email not confirmed')) return 'Confirme o e-mail antes de entrar.';
    if (t.includes('rate limit') || t.includes('too many') || t.includes('security purposes'))
      return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
    if (t.includes('should be different') || t.includes('same password')) return 'A senha nova precisa ser diferente da atual.';
    if (t.includes('weak') || t.includes('pwned') || t.includes('compromised')) return 'Essa senha é fraca ou já vazou na internet. Escolha outra.';
    if (t.includes('reauthentication') || t.includes('aal2')) return 'Por segurança, saia e entre de novo (com o código) para fazer isso.';
    if (t.includes('invalid totp') || t.includes('mfa_verification') || t.includes('invalid code')) return 'Código errado. Confira o relógio do celular e digite o código que está na tela agora.';
    if (t.includes('password')) return 'A senha precisa ter pelo menos 8 caracteres.';
    return m || 'Não consegui entrar.';
  }

  /* ---------------- Vistas da tela de entrada ---------------- */
  const VISTAS = { entrar: 'formLogin', esqueci: 'formEsqueci', novaSenha: 'formNovaSenha', mfa: 'formMfa', semAcesso: 'vistaSemAcesso' };
  const TITULOS = {
    entrar: ['Bem-vindo!', 'Informe seu e-mail e senha para entrar:'],
    esqueci: ['Esqueceu a senha?', 'A gente manda um link para você criar uma nova.'],
    mfa: ['Verificação em duas etapas', 'Falta só o código do seu celular.'],
    semAcesso: ['Sem acesso a este app', ''],
  };
  function mostrarVista(nome, { titulo, sub } = {}) {
    const login = $('#telaLogin');
    if (login) login.hidden = false;
    $('#telaApp').hidden = true;
    Object.entries(VISTAS).forEach(([v, id]) => { const el = document.getElementById(id); if (el) el.hidden = v !== nome; });
    $('#formPrimeiro').hidden = true;
    $('#btnVoltarLogin').hidden = true;
    $('.login-rodape').hidden = nome !== 'entrar';
    const [t, s] = TITULOS[nome] || ['', ''];
    $('#loginTitulo').textContent = titulo ?? t;
    $('#loginSub').textContent = sub ?? s;
    $('#loginSub').hidden = !(sub ?? s);
    const foco = { entrar: '#loginEmail', esqueci: '#esqueciEmail', novaSenha: '#novaSenha1', mfa: '#mfaCodigo' }[nome];
    if (foco) setTimeout(() => { const el = $(foco); if (el && !el.value) el.focus(); else if (nome === 'entrar') $('#loginSenha')?.focus(); }, 60);
  }

  /* ---------------- Espera progressiva (5 erros seguidos) ---------------- */
  function lerEspera() { try { return JSON.parse(ls.get(K.espera) || '{}'); } catch { return {}; } }
  function registrarErro() {
    const e = lerEspera();
    e.n = (e.n || 0) + 1;
    if (e.n >= MAX_ERROS) e.ate = Date.now() + Math.min(30_000 * 2 ** (e.n - MAX_ERROS), 300_000);   // 30 s, 1 min, 2 min… até 5 min
    ls.set(K.espera, JSON.stringify(e));
    pintarEspera();
    return e;
  }
  const zerarEspera = () => { ls.del(K.espera); pintarEspera(); };
  function pintarEspera() {
    clearInterval(esperaTimer);
    const btn = $('#btnEntrar');
    if (!btn) return;
    const tick = () => {
      const { ate = 0, n = 0 } = lerEspera();
      const falta = Math.ceil((ate - Date.now()) / 1000);
      if (falta > 0) {
        btn.disabled = true;
        btn.textContent = `Aguarde ${falta} s`;
        btn.dataset.esperando = '1';
        $('#loginErro').hidden = false;
        $('#loginErro').textContent = `${n} tentativas erradas seguidas. Por segurança, espere ${falta} s para tentar de novo — ou use "Esqueci a senha".`;
      } else if (btn.dataset.esperando) {
        delete btn.dataset.esperando;
        btn.disabled = false; btn.textContent = 'Entrar';
        clearInterval(esperaTimer);
      }
    };
    tick();
    if (lerEspera().ate > Date.now()) esperaTimer = setInterval(tick, 1000);
  }

  /* ---------------- Força da senha ---------------- */
  function forcaDaSenha(s) {
    let p = 0;
    if (s.length >= 8) p++;
    if (s.length >= 12) p++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) p++;
    if (/\d/.test(s) && /[^a-z0-9]/i.test(s)) p++;
    if (/^(.)\1+$/.test(s) || /^(12345678|senha|password|indycar)/i.test(s)) p = Math.min(p, 1);
    return p;
  }
  function pintarRegras() {
    const s1 = $('#novaSenha1').value, s2 = $('#novaSenha2').value;
    const email = (usuarioPendente?.email || usuario?.email || perfil?.email || '').toLowerCase();
    const ok = { tam: s1.length >= 8, email: !!s1 && s1.toLowerCase() !== email && !email.startsWith(s1.toLowerCase() + '@'), igual: !!s1 && s1 === s2 };
    $$('#regrasSenha [data-regra]').forEach(li => li.classList.toggle('ok', !!ok[li.dataset.regra]));
    const f = forcaDaSenha(s1);
    const caixa = $('#forcaSenha');
    caixa.dataset.nivel = s1 ? String(f) : '';
    caixa.querySelector('span').textContent = !s1 ? '' : ['muito fraca', 'fraca', 'média', 'boa', 'forte'][f];
    return ok;
  }

  /* ---------------- Quem pode usar este app ---------------- */
  function podeUsar(p) {
    if (!p) return false;
    if (p.papel === 'admin') return true;
    if (p.papel === 'agenda') return false;
    return Array.isArray(p.apps) ? p.apps.includes('atendimento') : true;   // perfil antigo sem apps: o servidor decide
  }
  function mostrarSemAcesso(p, doServidor = null) {
    // o servidor (403 sem_acesso_app) manda a lista pronta: [{app, nome, link}]
    if (Array.isArray(doServidor)) doServidor.forEach(x => { if (x?.app && APPS[x.app] && /^https:\/\//.test(x.link || '')) APPS[x.app].url = x.link; });
    const apps = (Array.isArray(doServidor) ? doServidor.map(x => x?.app)
      : p?.papel === 'admin' ? Object.keys(APPS) : (Array.isArray(p?.apps) ? p.apps : [])).filter(a => a !== 'atendimento' && APPS[a]);
    $('#semAcessoTxt').textContent = `${primeiroNome(p?.nome || 'Olá')}, a sua conta não abre o Atendimento.`
      + (apps.length ? ' Estes você pode usar:' : ' Peça ao administrador para liberar o que você precisa.');
    $('#appsLiberados').innerHTML = apps.map(a => {
      const x = APPS[a];
      return x.url
        ? `<a class="app-link" href="${esc(x.url)}" rel="noopener"><span aria-hidden="true">${x.ico}</span> ${esc(x.nome)} <i aria-hidden="true">→</i></a>`
        : `<span class="app-link desligado"><span aria-hidden="true">${x.ico}</span> ${esc(x.nome)} <small>em breve</small></span>`;
    }).join('');
    mostrarVista('semAcesso');
  }

  /* ---------------- Portão: roda a cada entrada ----------------
     Devolve true quando pode abrir o app. Senão mostra a tela certa e para. */
  async function portao(user, p, daBase) {
    usuarioPendente = user;
    if (daBase && daBase.ativo === false) {
      await sairQuieto();
      mostrarVista('entrar');
      return mostrarErro('Seu acesso foi desativado. Fale com o administrador.'), false;
    }
    try {
      const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
        $('#mfaCodigo').value = '';
        $('#mfaErro').hidden = true;
        mostrarVista('mfa');
        return false;
      }
    } catch { /* sem MFA no projeto: segue */ }
    if (!podeUsar(p)) { mostrarSemAcesso(p); return false; }
    if (p?.precisa_trocar_senha) {
      modoNovaSenha = 'obrigatoria';
      prepararNovaSenha();
      mostrarVista('novaSenha', { titulo: `Olá, ${primeiroNome(p.nome || '')}!`,
        sub: 'Antes de começar, troque a senha temporária por uma só sua. Ninguém mais vai saber.' });
      return false;
    }
    usuarioPendente = null;
    return true;
  }
  function prepararNovaSenha() {
    $('#formNovaSenha').reset();
    $('#novaSenhaErro').hidden = true;
    pintarRegras();
  }
  const mostrarErro = (msg) => { const el = $('#loginErro'); el.textContent = msg; el.hidden = false; };
  async function sairQuieto() {
    Acesso.saindoSozinho = true;
    try { await sb.auth.signOut({ scope: 'local' }); } catch { /* já estava fora */ }
  }

  /* Volta do link do e-mail: tela de nova senha, por cima de tudo */
  let emRecuperacao = /type=recovery/.test(location.hash || '');
  function recuperacao() {
    emRecuperacao = true;
    Acesso.emRecuperacao = true;
    modoNovaSenha = 'recuperar';
    prepararNovaSenha();
    mostrarVista('novaSenha', { titulo: 'Crie uma senha nova', sub: 'Você veio pelo link do e-mail. Escolha a senha nova:' });
  }

  /* ---------------- Ligações da tela de entrada ---------------- */
  function preparar() {
    instalarVigiaDoServidor();
    // lembrar e-mail / manter conectado
    const lembrado = ls.get(K.lembrar);
    if (lembrado) { $('#loginEmail').value = lembrado; $('#loginLembrar').checked = true; }
    $('#loginManter').checked = manter();
    // mostrar senha
    $$('[data-olho]').forEach(b => b.addEventListener('click', () => {
      const campo = document.getElementById(b.dataset.olho);
      const mostrar = campo.type === 'password';
      campo.type = mostrar ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(mostrar));
      b.setAttribute('aria-label', mostrar ? 'Esconder a senha' : 'Mostrar a senha');
      b.title = b.getAttribute('aria-label');
      b.classList.toggle('ligado', mostrar);
      campo.focus();
    }));
    // Caps Lock
    const caps = (e) => { if (typeof e.getModifierState === 'function') $('#avisoCaps').hidden = !e.getModifierState('CapsLock'); };
    ['keydown', 'keyup'].forEach(ev => ['#loginSenha', '#novaSenha1', '#novaSenha2'].forEach(s => $(s)?.addEventListener(ev, caps)));
    $('#loginSenha').addEventListener('blur', () => { $('#avisoCaps').hidden = true; });
    // trocar de vista
    $$('[data-vista-login]').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.vistaLogin)));
    $('#btnEsqueci').addEventListener('click', () => { $('#esqueciEmail').value = $('#loginEmail').value.trim(); $('#esqueciMsg').hidden = true; mostrarVista('esqueci'); });
    $$('[data-acao-login="sair"]').forEach(b => b.addEventListener('click', async () => {
      await sairQuieto(); usuarioPendente = null; emRecuperacao = false; Acesso.emRecuperacao = false;
      history.replaceState(null, '', location.pathname + location.search);
      mostrarVista('entrar'); Acesso.saindoSozinho = false;
    }));
    $('#formLogin').addEventListener('submit', entrar);
    $('#formEsqueci').addEventListener('submit', esqueci);
    $('#formNovaSenha').addEventListener('submit', salvarNovaSenha);
    ['#novaSenha1', '#novaSenha2'].forEach(s => $(s).addEventListener('input', () => { pintarRegras(); $('#novaSenhaErro').hidden = true; }));
    // o erro some quando a pessoa começa a corrigir (menos durante a espera)
    ['#loginEmail', '#loginSenha'].forEach(s => $(s).addEventListener('input', () => { if (!(lerEspera().ate > Date.now())) $('#loginErro').hidden = true; }));
    $('#formMfa').addEventListener('submit', confirmarMfa);
    $('#mfaCodigo').addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
      if (e.target.value.length === 6) $('#formMfa').requestSubmit();
    });
    pintarEspera();
    if (emRecuperacao) recuperacao();
  }

  async function entrar(e) {
    e.preventDefault();
    const email = $('#loginEmail').value.trim().toLowerCase();
    const senha = $('#loginSenha').value;
    const btn = $('#btnEntrar');
    $('#loginErro').hidden = true;
    if (lerEspera().ate > Date.now()) return pintarEspera();
    if (!email || !senha) return mostrarErro('Preencha e-mail e senha.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return mostrarErro('Esse e-mail não parece certo. Confira se tem @ e o domínio.');
    if (navigator.onLine === false) return mostrarErro('Sem internet. Confira a conexão e tente de novo.');
    // a escolha vale ANTES do login: é ela que decide onde o token será guardado
    ls.set(K.manter, $('#loginManter').checked ? '1' : '0');
    btn.disabled = true;
    btn.innerHTML = '<span class="girando"></span>Entrando…';
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw error;
      zerarEspera();
      if ($('#loginLembrar').checked) ls.set(K.lembrar, email); else ls.del(K.lembrar);
      $('#loginSenha').value = '';
      await entrarNoApp(data.user);
    } catch (err) {
      const texto = traduzirErro(err?.message);
      const contaComoErro = /incorretos/.test(texto);
      const est = contaComoErro ? registrarErro() : lerEspera();
      if (!(est.ate > Date.now())) {
        const resta = MAX_ERROS - (est.n || 0);
        mostrarErro(texto + (contaComoErro && resta > 0 && resta <= 2 ? ` Mais ${resta} tentativa${resta > 1 ? 's' : ''} e o login espera um pouco.` : ''));
      }
    } finally {
      if (!$('#btnEntrar').dataset.esperando) { btn.disabled = false; btn.textContent = 'Entrar'; }
    }
  }

  async function esqueci(e) {
    e.preventDefault();
    const email = $('#esqueciEmail').value.trim().toLowerCase();
    const msg = $('#esqueciMsg'), btn = $('#btnEsqueciEnviar');
    const mostrar = (t, ok) => { msg.textContent = t; msg.hidden = false; msg.classList.toggle('ok', !!ok); };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return mostrar('Digite o e-mail com que você entra.');
    btn.disabled = true; btn.textContent = 'Mandando…';
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' });
      if (error) throw error;
      mostrar(`✅ Se ${email} estiver cadastrado, o link chega em alguns minutos (veja também o spam). Não chegou? Peça ao administrador uma senha temporária.`, true);
    } catch (err) {
      mostrar('⚠️ ' + traduzirErro(err?.message) + ' Se precisar com urgência, peça ao administrador uma senha temporária.');
    } finally { btn.disabled = false; btn.textContent = 'Mandar o link'; }
  }

  async function salvarNovaSenha(e) {
    e.preventDefault();
    const erro = $('#novaSenhaErro'), btn = $('#btnNovaSenha');
    erro.hidden = true;
    const ok = pintarRegras();
    const falha = (t) => { erro.textContent = t; erro.hidden = false; };
    if (!ok.tam) return falha('A senha precisa ter pelo menos 8 caracteres.');
    if (!ok.email) return falha('A senha não pode ser o seu e-mail.');
    if (!ok.igual) return falha('As duas senhas não são iguais.');
    if (forcaDaSenha($('#novaSenha1').value) < 1) return falha('Essa senha é fácil demais de adivinhar. Misture letras e números.');
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      const { error } = await sb.auth.updateUser({ password: $('#novaSenha1').value });
      if (error) throw error;
      const { data: s } = await sb.auth.getSession();
      const user = s?.session?.user || usuarioPendente;
      if (user?.id) {
        // o servidor desliga a troca obrigatória e registra na auditoria; sem a rota,
        // o gatilho do banco deixa a própria pessoa desligar
        const r = await chamarEu('/api/eu/senha-trocada', 'POST', {});
        if (!r.ok) await sb.from('perfis').update({ precisa_trocar_senha: false }).eq('id', user.id);
      }
      $('#formNovaSenha').reset();
      emRecuperacao = false; Acesso.emRecuperacao = false;
      history.replaceState(null, '', location.pathname + location.search);
      toast('✅ Senha nova salva. Use ela da próxima vez.', 'ok');
      if (user) await entrarNoApp(user); else mostrarVista('entrar');
    } catch (err) {
      falha(traduzirErro(err?.message));
    } finally { btn.disabled = false; btn.textContent = 'Salvar a nova senha'; }
  }

  async function confirmarMfa(e) {
    e.preventDefault();
    const codigo = $('#mfaCodigo').value.trim();
    const erro = $('#mfaErro'), btn = $('#btnMfa');
    erro.hidden = true;
    if (!/^\d{6}$/.test(codigo)) { erro.textContent = 'São 6 números.'; erro.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Conferindo…';
    try {
      const { data: f, error: e1 } = await sb.auth.mfa.listFactors();
      if (e1) throw e1;
      const fator = (f?.totp || []).find(x => x.status === 'verified') || (f?.all || []).find(x => x.status === 'verified');
      if (!fator) throw new Error('Nenhum aplicativo autenticador cadastrado nesta conta.');
      const { data: ch, error: e2 } = await sb.auth.mfa.challenge({ factorId: fator.id });
      if (e2) throw e2;
      const { error: e3 } = await sb.auth.mfa.verify({ factorId: fator.id, challengeId: ch.id, code: codigo });
      if (e3) throw e3;
      const { data: s } = await sb.auth.getSession();
      await entrarNoApp(s?.session?.user || usuarioPendente);
    } catch (err) {
      erro.textContent = traduzirErro(err?.message);
      erro.hidden = false;
      $('#mfaCodigo').select();
    } finally { btn.disabled = false; btn.textContent = 'Confirmar'; }
  }

  /** /api/eu (GET/PATCH) e /api/eu/senha-trocada: {ok, status, j}; 404 = servidor antigo. */
  async function chamarEu(url, metodo = 'GET', corpo) {
    try {
      const r = await fetch(url, { method: metodo, headers: await authCabecalhos(), body: corpo ? JSON.stringify(corpo) : undefined });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok && j.ok !== false, status: r.status, j };
    } catch (err) { return { ok: false, status: 0, j: { erro: err.message } }; }
  }

  /* ---------------- 401/403 do servidor: volta ao login com o motivo ----------------
     Embrulha o fetch do próprio app (só /api/ desta origem). Token vencido tenta
     renovar uma vez antes de derrubar a sessão. */
  let renovando = null;
  function instalarVigiaDoServidor() {
    if (window.__fetchVigiado) return;
    window.__fetchVigiado = true;
    const original = window.fetch.bind(window);
    window.fetch = async (entrada, opcoes) => {
      const r = await original(entrada, opcoes);
      try {
        if (r.status !== 401 && r.status !== 403 && r.status !== 429) return r;
        const u = new URL(typeof entrada === 'string' ? entrada : entrada.url, location.href);
        if (u.origin !== location.origin || !u.pathname.startsWith('/api/') || /^\/api\/(config|primeiro-acesso|_mock)$/.test(u.pathname)) return r;
        if (!window.__jaEntrou) return r;
        const j = await r.clone().json().catch(() => ({}));
        tratarRecusa(r.status, j);
      } catch { /* nunca atrapalha a resposta */ }
      return r;
    };
  }
  let avisouLimite = 0;
  async function tratarRecusa(status, j = {}) {
    const codigo = String(j.codigo || '');
    // o servidor manda 401 'desativado' (versões antigas mandavam 403): os dois valem
    if (codigo === 'desativado') return sessaoMorreu('Seu acesso foi desativado. Fale com o administrador.');
    if (status === 403 && codigo === 'sem_acesso_app') {
      pararVigia(); try { Tarefas.parar(); } catch { /* ignora */ }
      window.__jaEntrou = false;
      return mostrarSemAcesso(perfil, j.apps);
    }
    // tem verificação em duas etapas e o login ainda está no nível 1: pede o código
    if (status === 401 && codigo === 'mfa_pendente') {
      if (!$('#formMfa').hidden) return;
      pararVigia(); try { Tarefas.parar(); } catch { /* ignora */ }
      usuarioPendente = usuario;
      $('#mfaCodigo').value = '';
      $('#mfaErro').hidden = true;
      return mostrarVista('mfa', { sub: 'Por segurança, confirme o código do seu celular para continuar.' });
    }
    if (status === 429) {
      if (Date.now() - avisouLimite > 20_000) { avisouLimite = Date.now(); toast('⏳ ' + (j.erro || 'Muitos pedidos seguidos. Espere um minuto.'), 'erro'); }
      return;
    }
    if (status === 401) {
      renovando = renovando || sb.auth.refreshSession().catch(() => ({ error: true })).finally(() => setTimeout(() => { renovando = null; }, 3000));
      const r = await renovando;
      if (r?.error || !r?.data?.session) sessaoMorreu('Sua sessão expirou. Entre de novo para continuar.');
    }
  }

  /* ---------------- Depois de entrar ---------------- */
  function depoisDeEntrar() {
    // o link de recuperação chegou no meio da entrada: a tela de nova senha manda
    if (emRecuperacao) return recuperacao();
    $('#telaLogin').hidden = true;
    pintarPerfil();
    ligarMenuPerfil();
    ligarConta();
    pintarMfa();
    gravarUltimoAcesso();
    clearInterval(vigiaTimer);
    // a cada 5 min: último acesso + confere se continuo ativo e com o app
    vigiaTimer = setInterval(() => { if (!document.hidden) vigiar(); }, 5 * 60_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && window.__jaEntrou) vigiar(); });
    $('#sessaoInfo').textContent = `Entrou às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · `
      + (manter() ? 'continua conectado neste aparelho ao fechar o navegador.' : 'sai sozinho ao fechar o navegador.');
  }
  const pararVigia = () => clearInterval(vigiaTimer);
  let ultimaVigia = 0;
  async function vigiar() {
    if (Date.now() - ultimaVigia < 60_000) return;
    ultimaVigia = Date.now();
    const eu = await chamarEu('/api/eu');
    if (eu.status === 401 || eu.status === 403) return;     // o vigia do fetch já cuidou
    try {
      let p = eu.ok ? eu.j : null;
      if (!p) { const r = await sb.from('perfis').select('id,ativo,papel,apps,precisa_trocar_senha').eq('id', perfil.id).maybeSingle(); if (r.error) return; p = r.data; }
      if (p && p.ativo === undefined) p.ativo = true;
      if (p && p.ativo === false) return sessaoMorreu('Seu acesso foi desativado. Fale com o administrador.');
      if (p && !podeUsar({ ...perfil, ...p })) { Object.assign(perfil, p); return tratarRecusa(403, { codigo: 'sem_acesso_app' }); }
      if (p && p.papel !== perfil.papel) { toast('Seu papel mudou — recarregando para mostrar o que você pode fazer agora.'); setTimeout(() => location.reload(), 1800); }
    } catch { /* rede: tenta na próxima */ }
    gravarUltimoAcesso();
  }
  let servidorGravaAcesso = null;
  async function gravarUltimoAcesso() {
    // o porteiro do servidor já grava o último acesso a cada 5 min; a tela só grava sem ele
    if (servidorGravaAcesso === null) servidorGravaAcesso = (await chamarEu('/api/eu')).status !== 404;
    if (servidorGravaAcesso) return;
    const ultimo = perfil?.ultimo_acesso_em ? new Date(perfil.ultimo_acesso_em).getTime() : 0;
    if (!perfil?.id || Date.now() - ultimo < 5 * 60_000) return;
    const agora = new Date().toISOString();
    try {
      const { error } = await sb.from('perfis').update({ ultimo_acesso_em: agora, ultimo_app: 'atendimento' }).eq('id', perfil.id);
      if (!error) perfil.ultimo_acesso_em = agora;
    } catch { /* silencioso */ }
  }

  /* ---------------- Perfil: avatar, nome, cargo, telefone, cor ---------------- */
  const corDoPerfil = () => (/^#[0-9a-f]{6}$/i.test(String(perfil?.avatar_cor || '')) ? perfil.avatar_cor : null);
  function pintarAvatar(el, nome, cor) {
    if (!el) return;
    el.textContent = iniciais(nome || '?');
    el.style.background = cor ? `linear-gradient(135deg, ${cor}, color-mix(in srgb, ${cor} 65%, #000))` : '';
  }
  function pintarPerfil() {
    const cor = corDoPerfil();
    ['#usuarioAvatar', '#mpAvatar', '#perfilAvatarPrevia'].forEach(s => pintarAvatar($(s), perfil.nome, cor));
    $('#usuarioNome').textContent = perfil.nome;
    $('#usuarioPapel').textContent = rotuloPapel(perfil.papel) + (perfil.cargo ? ` · ${perfil.cargo}` : '');
    $('#mpNome').textContent = perfil.nome;
    $('#mpEmail').textContent = perfil.email || usuario?.email || '';
    $('#mpPapel').textContent = rotuloPapel(perfil.papel);
    $('#mpPapel').dataset.papel = perfil.papel;
    $('#perfilNome').value = perfil.nome || '';
    $('#perfilCargo').value = perfil.cargo || '';
    $('#perfilTelefone').value = perfil.telefone ? telefoneBonito(perfil.telefone) : '';
    $('#perfilEmail').value = perfil.email || usuario?.email || '';
    $('#perfilPapel').value = rotuloPapel(perfil.papel);
    const apps = perfil.papel === 'admin' ? Object.keys(APPS) : (Array.isArray(perfil.apps) ? perfil.apps : []);
    $('#perfilApps').innerHTML = apps.length ? 'Seus apps: ' + apps.filter(a => APPS[a]).map(a => `<span class="app-chip mini">${APPS[a].ico} ${esc(APPS[a].nome)}</span>`).join(' ') : '';
    $('#coresAvatar').innerHTML = CORES.map(c => `<button type="button" role="radio" class="cor-op${c === cor ? ' ativa' : ''}" data-cor="${c}"
      style="--c:${c}" aria-checked="${c === cor}" aria-label="Cor ${c}" title="Usar esta cor"></button>`).join('');
  }
  let corEscolhida = null;
  function ligarConta() {
    if (ligarConta.feito) return;
    ligarConta.feito = true;
    $('#coresAvatar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cor]');
      if (!b) return;
      corEscolhida = b.dataset.cor;
      $$('#coresAvatar .cor-op').forEach(x => { const on = x === b; x.classList.toggle('ativa', on); x.setAttribute('aria-checked', String(on)); });
      pintarAvatar($('#perfilAvatarPrevia'), $('#perfilNome').value || perfil.nome, corEscolhida);
    });
    $('#perfilNome').addEventListener('input', () => pintarAvatar($('#perfilAvatarPrevia'), $('#perfilNome').value || '?', corEscolhida || corDoPerfil()));
    $('#formPerfil').addEventListener('submit', salvarPerfil);
    $('#formSenha').addEventListener('submit', trocarSenhaConta);
    $('#btnMfaLigar').addEventListener('click', abrirLigarMfa);
    $('#btnMfaDesligar').addEventListener('click', desligarMfa);
    $('#formMfaLigar').addEventListener('submit', confirmarLigarMfa);
    $('#mfaLigarCodigo').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    $('#btnCopiarSegredo').addEventListener('click', () => copiar($('#mfaSegredo').textContent, 'Chave copiada'));
    $('#btnSairTodos').addEventListener('click', pedirSairDeTodos);
    $('#btnLimparAparelho').addEventListener('click', () => { const n = limparAparelho({ soRascunhos: true }); toast(n ? `🧹 ${n} rascunho${n > 1 ? 's' : ''} apagado${n > 1 ? 's' : ''} deste aparelho` : 'Nenhum rascunho guardado aqui.'); });
    $('#btnConfirmarSair').addEventListener('click', () => sair({ limpar: $('#sairLimpar').checked }));
    // preferências de aviso (vão para perfis.preferencias: valem em todo aparelho)
    const prefs = perfil.preferencias?.notificacoes || perfil.preferencias?.avisos || {};
    $$('#cartaoPrefs [data-pref]').forEach(cx => {
      if (cx.dataset.pref in prefs) cx.checked = !!prefs[cx.dataset.pref];
      cx.addEventListener('change', salvarPreferencias);
    });
  }
  async function salvarPerfil(e) {
    e.preventDefault();
    const nome = $('#perfilNome').value.trim();
    if (!nome) return toast('⚠️ O nome não pode ficar vazio.', 'erro');
    const tel = $('#perfilTelefone').value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (tel && !/^\d{10,11}$/.test(tel)) return toast('⚠️ Telefone com DDD, ex.: (12) 99999-8888.', 'erro');
    const mudanca = { nome, cargo: $('#perfilCargo').value.trim() || null, telefone: tel || null };
    if (corEscolhida) mudanca.avatar_cor = corEscolhida;
    const btn = e.submitter || $('#formPerfil [type=submit]');
    btn.disabled = true;
    try {
      const r = await chamarEu('/api/eu', 'PATCH', mudanca);
      if (!r.ok && r.status !== 404) throw new Error(r.j?.erro || 'o servidor recusou');
      if (r.status === 404) { const { error } = await sb.from('perfis').update(mudanca).eq('id', usuario.id); if (error) throw error; }
      Object.assign(perfil, mudanca);
      corEscolhida = null;
      pintarPerfil();
      const eu = EQUIPE.get(perfil.id); if (eu) Object.assign(eu, mudanca);
      toast('✅ Perfil salvo', 'ok');
    } catch (err) { toast('⚠️ Não consegui salvar: ' + err.message, 'erro'); }
    finally { btn.disabled = false; }
  }
  async function trocarSenhaConta(e) {
    e.preventDefault();
    const s1 = $('#senhaNova').value, s2 = $('#senhaNova2').value;
    const msg = $('#senhaMsg'), btn = $('#btnTrocarSenha');
    const mostrar = (texto, ok) => { msg.textContent = texto; msg.className = 'form-msg ' + (ok ? 'ok' : 'erro'); msg.hidden = false; };
    if (s1.length < 8) return mostrar('A senha precisa ter pelo menos 8 caracteres.', false);
    if (s1.toLowerCase() === String(perfil.email || '').toLowerCase()) return mostrar('A senha não pode ser o seu e-mail.', false);
    if (s1 !== s2) return mostrar('As duas senhas não são iguais. Confira e tente de novo.', false);
    btn.disabled = true; btn.textContent = 'Trocando…';
    try {
      const { error } = await sb.auth.updateUser({ password: s1 });
      if (error) throw error;
      $('#formSenha').reset();
      mostrar('✅ Senha trocada. Use a nova da próxima vez que entrar.', true);
      toast('✅ Senha alterada com sucesso', 'ok');
    } catch (err) { mostrar('⚠️ ' + traduzirErro(err?.message), false); }
    finally { btn.disabled = false; btn.textContent = 'Trocar senha'; }
  }
  async function salvarPreferencias() {
    const notificacoes = {};
    $$('#cartaoPrefs [data-pref]').forEach(cx => { notificacoes[cx.dataset.pref] = cx.checked; });
    // merge profundo: o que outros apps guardaram em preferencias (e em notificacoes) continua lá
    const mesclar = (b, p) => { const o = b && typeof b === 'object' && !Array.isArray(b) ? { ...b } : {};
      for (const [k, x] of Object.entries(p || {})) o[k] = x && typeof x === 'object' && !Array.isArray(x) ? mesclar(o[k], x) : x; return o; };
    let preferencias = mesclar(perfil.preferencias, { notificacoes });
    try {
      const r = await chamarEu('/api/eu', 'PATCH', { preferencias: { notificacoes } });
      if (!r.ok && r.status !== 404) throw new Error(r.j?.erro || 'o servidor recusou');
      if (r.ok && r.j?.preferencias) preferencias = r.j.preferencias;
      if (r.status === 404) {
        // servidor antigo: lê o valor ATUAL do banco antes de gravar (outro app pode ter mudado)
        const { data: atual } = await sb.from('perfis').select('preferencias').eq('id', perfil.id).maybeSingle();
        preferencias = mesclar(atual?.preferencias ?? perfil.preferencias, { notificacoes });
        const { error } = await sb.from('perfis').update({ preferencias }).eq('id', perfil.id); if (error) throw error;
      }
      perfil.preferencias = preferencias;
      toast('✅ Preferências salvas', 'ok');
    } catch (err) { toast('⚠️ Não consegui salvar: ' + err.message, 'erro'); }
  }
  /** Este tipo de aviso entra no sino? (padrão: sim; som: não) */
  const prefAviso = (tipo) => { const a = perfil?.preferencias?.notificacoes || perfil?.preferencias?.avisos || {}; return tipo in a ? !!a[tipo] : tipo !== 'som'; };

  /* ---------------- Verificação em duas etapas (TOTP) ---------------- */
  let mfaFator = null;
  async function pintarMfa() {
    const el = $('#mfaEstado');
    try {
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) throw error;
      mfaFator = (data?.totp || []).find(f => f.status === 'verified') || null;
    } catch { mfaFator = null; }
    el.innerHTML = mfaFator
      ? '<span class="selo on">ligada</span> <span class="mfa-txt">Ao entrar, o sistema pede o código do aplicativo.</span>'
      : '<span class="selo off">desligada</span> <span class="mfa-txt">Recomendado para quem é administrador ou gestor.</span>';
    $('#btnMfaLigar').hidden = !!mfaFator;
    $('#btnMfaDesligar').hidden = !mfaFator;
    $('#mpMfaSelo').textContent = mfaFator ? 'ligada' : '';
  }
  async function abrirLigarMfa() {
    $('#mfaQr').innerHTML = '<span class="girando"></span>';
    $('#mfaSegredo').textContent = '—';
    $('#mfaLigarCodigo').value = '';
    $('#mfaLigarErro').hidden = true;
    abrirModal('modalMfaBg', '#mfaLigarCodigo');
    try {
      // sobra de tentativa anterior não confirmada atrapalha o cadastro novo
      const { data: f } = await sb.auth.mfa.listFactors();
      for (const x of (f?.all || []).filter(x => x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: x.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `IndyCar ${new Date().toLocaleDateString('pt-BR')}` });
      if (error) throw error;
      enrolando = data;
      const img = new Image();
      img.alt = 'QR para o aplicativo autenticador';
      img.src = data.totp.qr_code;
      $('#mfaQr').replaceChildren(img);
      $('#mfaSegredo').textContent = data.totp.secret;
    } catch (err) {
      $('#mfaQr').innerHTML = '';
      $('#mfaLigarErro').textContent = '⚠️ ' + traduzirErro(err?.message);
      $('#mfaLigarErro').hidden = false;
    }
  }
  async function confirmarLigarMfa(e) {
    e.preventDefault();
    const codigo = $('#mfaLigarCodigo').value.trim();
    const erro = $('#mfaLigarErro'), btn = $('#btnMfaConfirmar');
    if (!enrolando) return;
    if (!/^\d{6}$/.test(codigo)) { erro.textContent = 'São 6 números.'; erro.hidden = false; return; }
    btn.disabled = true;
    try {
      const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId: enrolando.id });
      if (e1) throw e1;
      const { error: e2 } = await sb.auth.mfa.verify({ factorId: enrolando.id, challengeId: ch.id, code: codigo });
      if (e2) throw e2;
      enrolando = null;
      fecharModal('modalMfaBg');
      toast('🛡 Verificação em duas etapas ligada. Da próxima vez, o código é pedido depois da senha.', 'ok');
      pintarMfa();
    } catch (err) { erro.textContent = traduzirErro(err?.message); erro.hidden = false; }
    finally { btn.disabled = false; }
  }
  async function desligarMfa() {
    if (!mfaFator) return;
    const ok = await confirmar({ titulo: 'Desligar a verificação em duas etapas?', texto: 'A sua conta volta a pedir só a senha para entrar.', botao: 'Desligar' });
    if (!ok) return;
    try {
      const { error } = await sb.auth.mfa.unenroll({ factorId: mfaFator.id });
      if (error) throw error;
      toast('Verificação em duas etapas desligada.');
      pintarMfa();
    } catch (err) { toast('⚠️ ' + traduzirErro(err?.message), 'erro'); }
  }

  /* ---------------- Confirmação bonita (no lugar do confirm()) ---------------- */
  function confirmar({ titulo, texto, botao = 'Confirmar', perigo = true, caixa = '', caixaMarcada = false }) {
    return new Promise((resolve) => {
      $('#confirmarCaixaRotulo').hidden = !caixa;
      $('#confirmarCaixaTexto').textContent = caixa;
      $('#confirmarCaixa').checked = !!caixaMarcada;
      $('#confirmarTitulo').textContent = titulo;
      $('#confirmarTexto').textContent = texto || '';
      const ok = $('#btnConfirmarOk');
      ok.textContent = botao;
      ok.className = 'btn sm ' + (perigo ? 'btn-excluir' : 'btn-primary');
      const bg = $('#modalConfirmarBg');
      let decidiu = false;
      const fim = (v) => { if (decidiu) return; decidiu = true; obs.disconnect(); ok.removeEventListener('click', sim); fecharModal('modalConfirmarBg'); resolve(v); };
      const sim = () => fim(true);
      ok.addEventListener('click', sim);
      const obs = new MutationObserver(() => { if (!bg.classList.contains('aberto')) fim(false); });
      obs.observe(bg, { attributes: true, attributeFilter: ['class'] });
      abrirModal('modalConfirmarBg', '#btnConfirmarOk');
    });
  }
  async function copiar(texto, aviso = 'Copiado') {
    try { await navigator.clipboard.writeText(texto); toast('📋 ' + aviso, 'ok'); }
    catch { toast('Não consegui copiar sozinho — selecione e copie (Ctrl+C).'); }
  }

  /* ---------------- Sair ---------------- */
  function chavesDoAparelho() {
    const r = [];
    try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (/^indycar_rascunho_/.test(k)) r.push(k); } } catch { /* ignora */ }
    return r;
  }
  function pedirSair() {
    const rasc = chavesDoAparelho().length;
    const fila = typeof lerFila === 'function' ? lerFila().length : 0;
    $('#sairResumo').textContent = `${primeiroNome(perfil?.nome || '')}, seu login sai deste navegador.`;
    $('#sairLimparDetalhe').textContent = [rasc ? `${rasc} rascunho${rasc > 1 ? 's' : ''} de mensagem` : 'rascunhos de mensagem',
      'fila sem internet', 'filtros e preferências', 'arquivos do app'].join(', ');
    const aviso = $('#sairFilaAviso');
    aviso.hidden = !fila;
    aviso.textContent = fila ? `⚠️ ${fila} mensage${fila > 1 ? 'ns ainda não saíram' : 'm ainda não saiu'} (fila sem internet). Se apagar, ela${fila > 1 ? 's se perdem' : ' se perde'}.` : '';
    $('#sairLimpar').checked = false;
    fecharMenuPerfil();
    abrirModal('modalSairBg', '#btnConfirmarSair');
  }
  async function pedirSairDeTodos() {
    fecharMenuPerfil();
    const ok = await confirmar({ titulo: 'Sair de todos os aparelhos?', botao: 'Sair de todos',
      texto: 'Todo computador e celular em que você entrou vai pedir a senha de novo — inclusive este.' });
    if (ok) sair({ limpar: false, global: true });
  }
  /** Apaga deste aparelho o que o app guardou. Devolve quantos rascunhos saíram. */
  function limparAparelho({ soRascunhos = false } = {}) {
    const rasc = chavesDoAparelho();
    rasc.forEach(k => { try { sessionStorage.removeItem(k); } catch { /* ignora */ } });
    try { Object.keys(localStorage).filter(k => /^indycar_rascunho_/.test(k)).forEach(k => localStorage.removeItem(k)); } catch { /* ignora */ }
    if (soRascunhos) { if (typeof campo !== 'undefined' && campo) { campo.value = ''; campo.dispatchEvent(new Event('input')); } return rasc.length; }
    try {
      // fica só o tema (não é dado de ninguém); o resto — fila, filtros, e-mail lembrado — sai
      Object.keys(localStorage).filter(k => /^indycar_/.test(k) && k !== 'indycar_tema').forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch { /* ignora */ }
    if (window.caches?.keys) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
    return rasc.length;
  }
  async function sair({ limpar = false, global = false } = {}) {
    Acesso.saindoSozinho = true;
    const btn = $('#btnConfirmarSair'); if (btn) btn.disabled = true;
    try { Tarefas.parar(); } catch { /* ignora */ }
    try { if (canalRealtime) await sb.removeChannel(canalRealtime); } catch { /* ignora */ }
    if (limpar) limparAparelho();
    try { await sb.auth.signOut({ scope: global ? 'global' : 'local' }); } catch { /* sai mesmo assim */ }
    location.replace(location.pathname);
  }

  /* ---------------- Menu do perfil (avatar) ---------------- */
  function fecharMenuPerfil() {
    const m = $('#menuPerfil');
    if (!m || m.hidden) return;
    m.hidden = true;
    $('#usuarioBox').setAttribute('aria-expanded', 'false');
  }
  function abrirMenuPerfil() {
    const m = $('#menuPerfil'), anc = $('#usuarioBox');
    $('#mpTemaTxt').textContent = document.documentElement.getAttribute('data-tema') === 'claro' ? 'Tema escuro' : 'Tema claro';
    m.hidden = false;
    anc.setAttribute('aria-expanded', 'true');
    const r = anc.getBoundingClientRect(), h = m.offsetHeight, w = m.offsetWidth;
    const embaixo = window.innerHeight - r.bottom > h + 12 || r.top < h + 12;
    m.style.top = `${Math.max(8, embaixo ? r.bottom + 6 : r.top - h - 6)}px`;
    m.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - w - 8)}px`;
    setTimeout(() => $('.mp-item', m)?.focus(), 30);
  }
  function ligarMenuPerfil() {
    if (ligarMenuPerfil.feito) return;
    ligarMenuPerfil.feito = true;
    $('#usuarioBox').addEventListener('click', (e) => { e.stopPropagation(); $('#menuPerfil').hidden ? abrirMenuPerfil() : fecharMenuPerfil(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#menuPerfil')) fecharMenuPerfil(); });
    window.addEventListener('resize', fecharMenuPerfil);
    $('#menuPerfil').addEventListener('keydown', (e) => {
      const itens = $$('#menuPerfil .mp-item');
      const i = itens.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); fecharMenuPerfil(); $('#usuarioBox').focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); itens[(i + 1) % itens.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); itens[(i - 1 + itens.length) % itens.length].focus(); }
      else if (e.key === 'Tab') fecharMenuPerfil();
    });
    $('#menuPerfil').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mp]');
      if (!b) return;
      const acao = b.dataset.mp;
      if (acao === 'tema') { $('#btnTema').click(); $('#mpTemaTxt').textContent = document.documentElement.getAttribute('data-tema') === 'claro' ? 'Tema escuro' : 'Tema claro'; return; }
      fecharMenuPerfil();
      if (acao === 'ajuda') return window.Ajuda?.abrir('como');
      if (acao === 'sair') return pedirSair();
      if (acao === 'sair-todos') return pedirSairDeTodos();
      irParaCartao({ perfil: 'cartaoPerfil', senha: 'cartaoSenha', mfa: 'cartaoMfa', avisos: 'cartaoPrefs' }[acao]);
    });
  }
  function irParaCartao(id) {
    $('.nav-item[data-aba="config"]')?.click();
    $('#configTabs .config-pilula[data-secao="conta"]')?.click();
    const c = document.getElementById(id);
    if (!c) return;
    c.scrollIntoView({ block: 'start', behavior: 'smooth' });
    c.classList.remove('destaque'); void c.offsetWidth; c.classList.add('destaque');
    setTimeout(() => $('input:not([disabled]),button', c)?.focus({ preventScroll: true }), 350);
  }

  return {
    preparar, portao, depoisDeEntrar, recuperacao, mostrarVista, traduzirErro, armazenamentoDaSessao,
    pedirSair, sair, limparAparelho, confirmar, copiar, prefAviso, podeUsar, APPS,
    get emRecuperacao() { return emRecuperacao; }, set emRecuperacao(v) { emRecuperacao = !!v; },
    saindoSozinho: false,
  };
})();
