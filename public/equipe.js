/* ============================================================
   IndyCar Atendimento — EQUIPE e AUDITORIA (rodada 3, 13/10/2026)
   Equipe: admin convida, muda papel/apps/equipe, gera senha temporária e
   desativa; gestor só lê. Nunca deixa mexer em si mesmo nem no último admin
   (o servidor confere de novo).
   Auditoria (admin): linha do tempo em português, filtros e CSV.
   Contrato com o servidor: GET/POST /api/equipe, PATCH /api/equipe/:id,
   POST /api/equipe/:id/senha-temporaria, GET /api/auditoria(.csv).
   ============================================================ */
const Equipe = (() => {
  const PAPEIS = {
    admin:     { nome: 'Administrador', ico: '👑', txt: 'Tudo: equipe, auditoria, configurações e todos os apps.' },
    gestor:    { nome: 'Gestor',        ico: '🧭', txt: 'Vê a equipe e os relatórios, distribui conversas e pode apagar registros.' },
    atendente: { nome: 'Atendente',     ico: '💬', txt: 'Conversas, funil, agenda e tarefas do dia a dia.' },
    agenda:    { nome: 'Agenda',        ico: '📅', txt: 'Só a Agenda da oficina — não vê conversas nem CRM.' },
  };
  const APPS_PADRAO = {
    admin: ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'],
    gestor: ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador'],
    atendente: ['atendimento', 'crm', 'agenda'],
    agenda: ['agenda'],
  };
  const ORDEM_APPS = ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'];
  let PESSOAS = [];          // GET /api/equipe
  let TIMES = [];            // tabela equipes
  let semRotaEquipe = false;
  let AVISOS = [];
  let filtros = { busca: '', papel: '', time: '', situacao: 'ativos' };
  let editando = null;       // pessoa aberta no modal
  let convite = { passo: 1, papel: 'atendente', apps: [...APPS_PADRAO.atendente] };

  const ehAdmin = () => perfil?.papel === 'admin';
  const ehGestor = () => ehAdmin() || perfil?.papel === 'gestor';
  const nomeApp = (a) => Acesso.APPS[a]?.nome || a;
  const icoApp = (a) => Acesso.APPS[a]?.ico || '•';
  const timePorId = (id) => TIMES.find(t => t.id === id) || null;
  const adminsAtivos = () => PESSOAS.filter(p => p.papel === 'admin' && p.ativo).length;

  /* ---------------- Chamadas ao servidor ----------------
     404 de rota que ainda não existe vira aviso amigável, não erro vermelho. */
  class SemRota extends Error {}
  async function api(url, { metodo = 'GET', corpo, texto = false } = {}) {
    const r = await fetch(url, { method: metodo, headers: await authCabecalhos(), body: corpo ? JSON.stringify(corpo) : undefined });
    if (texto && r.ok) return r;
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    if (r.status === 404 && (!j || /rota/i.test(j?.erro || ''))) throw new SemRota('rota');
    if (!r.ok || j?.ok === false) throw new Error(j?.erro || `O servidor respondeu ${r.status}.`);
    return j;
  }
  const avisoSemRota = (oque) => `<div class="estado-vazio aviso-rota"><span class="vazio-ico" aria-hidden="true">🛠</span>
    <p><b>${esc(oque)} ainda não chegou no servidor.</b><br>A tela já está pronta — assim que o servidor for atualizado, aparece aqui sozinho.</p></div>`;

  /* ---------------- Início ---------------- */
  async function iniciar() {
    $('#navEquipe').hidden = !ehGestor();
    $('#navAuditoria').hidden = !ehAdmin();
    $('#navGrupoEquipe').hidden = !ehGestor();
    $('#btnConvidar').hidden = !ehAdmin();
    $('#equipeSoLeitura').hidden = ehAdmin();
    await carregarTimes();
    ligar();
    if (ehGestor() && TIMES.length && !sabeEquipes()) recarregar().then(() => { $('#filtroEquipe').hidden = !sabeEquipes(); });
  }
  async function carregarTimes() {
    try {
      const { data, error } = await sb.from('equipes').select('id,nome,cor').order('nome');
      if (error) throw error;
      TIMES = data || [];
    } catch { TIMES = []; }
    preencherTimes();
  }
  const sabeEquipes = () => [...EQUIPE.values()].some(p => p.equipe_id !== undefined);
  function preencherTimes() {
    const opcoes = TIMES.map(t => `<option value="${esc(t.id)}">${esc(t.nome)}</option>`).join('');
    $('#filtroEquipe').innerHTML = '<option value="">👥 Equipes</option>' + TIMES.map(t => `<option value="${esc(t.id)}">Equipe ${esc(t.nome)}</option>`).join('');
    $('#filtroEquipe').hidden = !TIMES.length || !sabeEquipes();
    if (filtroEquipeLista && !TIMES.some(t => t.id === filtroEquipeLista)) filtroEquipeLista = '';
    $('#filtroEquipe').value = filtroEquipeLista;
    $('#equipeFiltroTime').innerHTML = '<option value="">Todas as equipes</option>' + opcoes;
    $('#equipeFiltroTime').hidden = !TIMES.length;
    ['#conviteEquipe', '#pessoaEquipe'].forEach(s => { $(s).innerHTML = '<option value="">Sem equipe</option>' + opcoes; });
  }

  function ligar() {
    if (ligar.feito) return;
    ligar.feito = true;
    // filtro "da equipe X" na lista de conversas
    $('#filtroEquipe').addEventListener('change', (e) => {
      filtroEquipeLista = e.target.value;
      try { sessionStorage.setItem('indycar_filtro_equipe', filtroEquipeLista); } catch { /* ignora */ }
      e.target.classList.toggle('ativo', !!filtroEquipeLista);
      carregarConversas();
    });
    $('#filtroEquipe').classList.toggle('ativo', !!filtroEquipeLista);
    // filtros da tela Equipe
    let t = null;
    $('#equipeBusca').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { filtros.busca = e.target.value; renderEquipe(); }, 120); });
    $$('[data-papel-filtro]').forEach(b => b.addEventListener('click', () => {
      filtros.papel = b.dataset.papelFiltro;
      $$('[data-papel-filtro]').forEach(x => { const on = x === b; x.classList.toggle('ativo', on); x.setAttribute('aria-pressed', String(on)); });
      renderEquipe();
    }));
    $('#equipeFiltroTime').addEventListener('change', (e) => { filtros.time = e.target.value; renderEquipe(); });
    $('#equipeFiltroSituacao').addEventListener('change', (e) => { filtros.situacao = e.target.value; renderEquipe(); });
    $('#gradeEquipe').addEventListener('click', (e) => {
      const c = e.target.closest('[data-pessoa]');
      if (c) abrirPessoa(c.dataset.pessoa);
    });
    $('#gradeEquipe').addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-pessoa]')) { e.preventDefault(); abrirPessoa(e.target.dataset.pessoa); }
    });
    $('#btnConvidar').addEventListener('click', abrirConvite);
    $('#formConvite').addEventListener('submit', avancarConvite);
    $('#btnConviteVoltar').addEventListener('click', () => irPasso(Math.max(1, convite.passo - 1)));
    $('#formPessoa').addEventListener('submit', salvarPessoa);
    $('#btnPessoaSenha').addEventListener('click', gerarSenhaTemporaria);
    $('#btnPessoaMfa').addEventListener('click', tirarMfa);
    $('#btnPessoaAtivo').addEventListener('click', alternarAtivo);
    // senha temporária: some do DOM quando o modal fecha (não fica "escondida" na página)
    ['modalSenhaTempBg', 'modalConviteBg'].forEach(id => new MutationObserver(() => {
      if (!document.getElementById(id).classList.contains('aberto')) {
        if (id === 'modalSenhaTempBg') $('#senhaTempCaixa').innerHTML = '';
        else if (convite.passo === 4) { $('#conviteResultado').innerHTML = ''; convite.passo = 1; }
      }
    }).observe(document.getElementById(id), { attributes: true, attributeFilter: ['class'] }));
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-copiar-senha]');
      if (b) Acesso.copiar(b.dataset.copiarSenha, b.dataset.copiarAviso || 'Senha copiada');
    });
    // auditoria
    let ta = null;
    ['#audPessoa', '#audTabela', '#audAcao', '#audDe', '#audAte'].forEach(s => $(s).addEventListener('change', () => { clearTimeout(ta); ta = setTimeout(() => carregarAuditoria(1), 150); }));
    $('#formAuditoria').addEventListener('submit', (e) => { e.preventDefault(); carregarAuditoria(1); });
    $('#btnAudLimpar').addEventListener('click', () => { $('#formAuditoria').reset(); carregarAuditoria(1); });
    $('#audAnterior').addEventListener('click', () => carregarAuditoria(paginaAud - 1));
    $('#audProxima').addEventListener('click', () => carregarAuditoria(paginaAud + 1));
    $('#btnAuditoriaCsv').addEventListener('click', exportarCsv);
  }

  /* ---------------- Tela Equipe ---------------- */
  function esqueleto(n = 6) {
    return Array.from({ length: n }, () => '<div class="pessoa-cartao esqueleto-cartao" aria-hidden="true"><i></i><i></i><i></i></div>').join('');
  }
  async function abrirEquipe() {
    if (!ehGestor()) { $('#gradeEquipe').innerHTML = '<div class="vazio">Só gestor ou administrador vê a equipe.</div>'; return; }
    if (!PESSOAS.length) $('#gradeEquipe').innerHTML = esqueleto();
    await recarregar();
  }
  async function recarregar() {
    if (!ehGestor()) return;
    try {
      const j = await api('/api/equipe');
      PESSOAS = Array.isArray(j) ? j : (j.pessoas || j.equipe || j.itens || []);
      AVISOS = Array.isArray(j.avisos) ? j.avisos : [];
      if (Array.isArray(j.equipes) && j.equipes.length && !TIMES.length) { TIMES = j.equipes; preencherTimes(); }
      // a equipe de cada pessoa também serve ao filtro "Equipe X" da lista de conversas
      PESSOAS.forEach(p => { const e = EQUIPE.get(p.id); if (e && p.equipe_id !== undefined) e.equipe_id = p.equipe_id; });
      semRotaEquipe = false;
    } catch (err) {
      if (err instanceof SemRota) {
        semRotaEquipe = true;
        // enquanto o servidor não tem a rota: mostra o que dá, só leitura
        PESSOAS = [...EQUIPE.values()].map(p => ({ ...p, email: p.id === perfil.id ? perfil.email : '', apps: p.apps || null, carga: null }));
      } else {
        $('#gradeEquipe').innerHTML = `<div class="estado-vazio"><span class="vazio-ico" aria-hidden="true">⚠️</span><p>${esc(err.message)}</p>
          <button type="button" class="btn btn-ghost sm" data-de-novo="equipe">Tentar de novo</button></div>`;
        return;
      }
    }
    renderEquipe();
  }
  function quandoTexto(iso) {
    if (!iso) return 'ainda não entrou';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (min < 2) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'ontem' : d < 30 ? `há ${d} dias` : new Date(iso).toLocaleDateString('pt-BR');
  }
  const ultimoAcesso = (p) => p.ultimo_acesso_em || p.ultimo_login_em || null;
  const nuncaEntrou = (p) => p.situacao ? p.situacao === 'convite_pendente' : !ultimoAcesso(p);
  function filtrar() {
    const q = semAcentoBusca(filtros.busca.trim());
    return PESSOAS.filter(p => {
      if (filtros.papel && p.papel !== filtros.papel) return false;
      if (filtros.time && p.equipe_id !== filtros.time) return false;
      if (filtros.situacao === 'ativos' && p.ativo === false) return false;
      if (filtros.situacao === 'desativados' && p.ativo !== false) return false;
      if (filtros.situacao === 'pendentes' && (!nuncaEntrou(p) || p.ativo === false)) return false;
      if (q && !semAcentoBusca([p.nome, p.email, p.cargo].join(' ')).includes(q)) return false;
      return true;
    }).sort((a, b) => (a.id === perfil.id ? -1 : b.id === perfil.id ? 1 : 0)
      || (['admin', 'gestor', 'atendente', 'agenda'].indexOf(a.papel) - ['admin', 'gestor', 'atendente', 'agenda'].indexOf(b.papel))
      || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  }
  function avatarHtml(p, classe = '') {
    const cor = corDaPessoa(p.id, p);
    return `<span class="avatar ${classe}" style="background:linear-gradient(135deg, ${cor}, color-mix(in srgb, ${cor} 62%, #000))" aria-hidden="true">${esc(iniciais(p.nome))}</span>`;
  }
  function cartaoPessoa(p) {
    const eu = p.id === perfil.id;
    const time = timePorId(p.equipe_id);
    const apps = p.papel === 'admin' ? ORDEM_APPS : (Array.isArray(p.apps) ? ORDEM_APPS.filter(a => p.apps.includes(a)) : []);
    const carga = p.carga || {};
    const maxConv = Math.max(1, ...PESSOAS.map(x => x.carga?.conversas_abertas || 0));
    const selos = [
      p.ativo === false ? '<span class="selo-p perigo">⛔ desativado</span>' : '',
      p.precisa_trocar_senha && p.ativo !== false && !nuncaEntrou(p) ? '<span class="selo-p alerta" title="Ainda está com a senha temporária">🔑 troca de senha pendente</span>' : '',
      p.mfa_ativo ? '<span class="selo-p ok" title="Verificação em duas etapas ligada">🛡 2 etapas</span>' : '',
      nuncaEntrou(p) && p.ativo !== false ? '<span class="selo-p alerta" title="Recebeu o convite e ainda não entrou">✉ convite pendente</span>' : '',
      p.banido && p.ativo !== false ? '<span class="selo-p perigo" title="O login está bloqueado no Supabase">⛔ login bloqueado</span>' : '',
      p.recebe_leads && p.ativo !== false ? '<span class="selo-p" title="Entra no rodízio de clientes novos">🎯 recebe clientes</span>' : '',
    ].join('');
    return `<article class="pessoa-cartao${p.ativo === false ? ' inativo' : ''}${eu ? ' eu' : ''}" data-pessoa="${esc(p.id)}" tabindex="0"
        role="button" aria-label="${esc(p.nome)}, ${esc(PAPEIS[p.papel]?.nome || p.papel)}${eu ? ' (você)' : ''}. Abrir detalhes">
      <header class="pc-topo">
        ${avatarHtml(p)}
        <div class="pc-quem">
          <strong>${esc(p.nome)}${eu ? ' <em class="voce">você</em>' : ''}</strong>
          <small>${esc([p.cargo, time?.nome].filter(Boolean).join(' · ') || p.email || '—')}</small>
        </div>
        <span class="papel-selo" data-papel="${esc(p.papel)}">${PAPEIS[p.papel]?.ico || ''} ${esc(PAPEIS[p.papel]?.nome || p.papel)}</span>
      </header>
      <div class="pc-apps">${apps.length ? apps.map(a => `<span class="app-chip mini" title="${esc(nomeApp(a))}">${icoApp(a)} ${esc(nomeApp(a))}</span>`).join('')
        : '<span class="pc-nada">nenhum app liberado</span>'}</div>
      ${p.carga ? `<div class="pc-carga">
        <div class="pc-barra" title="${esc(String(carga.conversas_abertas || 0))} conversas em aberto"><span>💬 ${esc(String(carga.conversas_abertas || 0))} conversa${carga.conversas_abertas === 1 ? "" : "s"}</span>
          <i style="--w:${Math.round(((carga.conversas_abertas || 0) / maxConv) * 100)}%"></i></div>
        <span class="pc-tarefas">✓ ${esc(String(carga.tarefas_abertas || 0))} tarefa${carga.tarefas_abertas === 1 ? '' : 's'}</span>
      </div>` : ''}
      <footer class="pc-rodape">
        <span class="pc-acesso" title="${ultimoAcesso(p) ? esc(new Date(ultimoAcesso(p)).toLocaleString('pt-BR')) : ''}">
          <i class="ponto${ultimoAcesso(p) && Date.now() - new Date(ultimoAcesso(p)).getTime() < 15 * 60_000 ? ' online' : ''}"></i>
          ${esc(nuncaEntrou(p) && !ultimoAcesso(p) ? 'ainda não entrou' : quandoTexto(ultimoAcesso(p)))}${p.ultimo_app && p.ultimo_acesso_em ? ` · ${esc(nomeApp(p.ultimo_app))}` : ''}</span>
        <span class="pc-selos">${selos}</span>
      </footer>
    </article>`;
  }
  function renderEquipe() {
    const lista = filtrar();
    const ativos = PESSOAS.filter(p => p.ativo !== false).length;
    const pend = PESSOAS.filter(p => p.ativo !== false && nuncaEntrou(p)).length;
    $('#equipeResumo').textContent = `${ativos} pessoa${ativos === 1 ? '' : 's'} com acesso`
      + (pend ? ` · ${pend} ainda não entr${pend === 1 ? 'ou' : 'aram'}` : '')
      + (PESSOAS.length - ativos ? ` · ${PESSOAS.length - ativos} desativad${PESSOAS.length - ativos === 1 ? 'a' : 'as'}` : '');
    $('#btnConvidar').hidden = !ehAdmin() || semRotaEquipe;
    $('#gradeEquipe').innerHTML = (semRotaEquipe ? avisoSemRota('A lista completa da equipe (GET /api/equipe)') : '')
      + AVISOS.map(a => `<p class="aviso faixa-leitura aviso-rota-linha">⚠️ ${esc(a)}</p>`).join('')
      + (lista.length ? lista.map(cartaoPessoa).join('')
        : `<div class="estado-vazio"><span class="vazio-ico" aria-hidden="true">🔍</span><p>Ninguém com esses filtros.</p></div>`);
  }

  /* ---------------- Papel e apps (convite e edição) ---------------- */
  function papeisHtml(selecionado, travado) {
    return Object.entries(PAPEIS).map(([k, v]) => `<label class="papel-op${k === selecionado ? ' ativo' : ''}${travado ? ' travado' : ''}">
      <input type="radio" name="papel" value="${k}" ${k === selecionado ? 'checked' : ''} ${travado ? 'disabled' : ''} />
      <span class="po-ico" aria-hidden="true">${v.ico}</span><span class="po-txt"><b>${esc(v.nome)}</b><small>${esc(v.txt)}</small></span></label>`).join('');
  }
  function appsHtml(lista, papel, travado) {
    const tudo = papel === 'admin', soAgenda = papel === 'agenda';
    return ORDEM_APPS.map(a => {
      const on = tudo || (soAgenda ? a === 'agenda' : lista.includes(a));
      const trava = travado || tudo || soAgenda;
      return `<button type="button" class="app-chip${on ? ' ligado' : ''}" data-app="${a}" aria-pressed="${on}" ${trava ? 'disabled' : ''}>
        <span aria-hidden="true">${icoApp(a)}</span> ${esc(nomeApp(a))}${on ? ' <i aria-hidden="true">✓</i>' : ''}</button>`;
    }).join('') + (tudo ? '<p class="apps-nota">Administrador abre todos os apps.</p>' : soAgenda ? '<p class="apps-nota">O papel Agenda abre só a Agenda.</p>' : '');
  }
  function ligarEscolhas(raiz, estado, aoMudar) {
    raiz.querySelector('.papeis-cartoes').onchange = (e) => {
      if (e.target.name !== 'papel') return;
      estado.papel = e.target.value;
      if (estado.novo) estado.apps = [...APPS_PADRAO[estado.papel]];
      aoMudar();
    };
    raiz.querySelector('.apps-chips').onclick = (e) => {
      const b = e.target.closest('[data-app]');
      if (!b || b.disabled) return;
      const a = b.dataset.app;
      estado.apps = estado.apps.includes(a) ? estado.apps.filter(x => x !== a) : [...estado.apps, a];
      aoMudar();
    };
  }

  /* ---------------- Convite em passos ---------------- */
  function abrirConvite() {
    if (!ehAdmin()) return;
    convite = { passo: 1, papel: 'atendente', apps: [...APPS_PADRAO.atendente], novo: true };
    $('#formConvite').reset();
    $('#conviteErro').hidden = true;
    $('#conviteResultado').innerHTML = '';
    pintarConvite();
    irPasso(1);
    abrirModal('modalConviteBg', '#formConvite [name=nome]');
  }
  function pintarConvite() {
    $('#convitePapeis').innerHTML = papeisHtml(convite.papel, false);
    $('#conviteApps').innerHTML = appsHtml(convite.apps, convite.papel, false);
    const f = $('#formConvite');
    const time = timePorId(f.equipe_id.value);
    const apps = convite.papel === 'admin' ? ORDEM_APPS : convite.papel === 'agenda' ? ['agenda'] : convite.apps;
    $('#conviteRevisao').innerHTML = `<h4>Revisão</h4><dl>
      <dt>Nome</dt><dd>${esc(f.nome.value.trim() || '—')}</dd>
      <dt>E-mail</dt><dd>${esc(f.email.value.trim() || '—')}</dd>
      <dt>Papel</dt><dd>${PAPEIS[convite.papel].ico} ${esc(PAPEIS[convite.papel].nome)}${time ? ` · ${esc(time.nome)}` : ''}</dd>
      <dt>Apps</dt><dd>${apps.length ? apps.map(a => esc(nomeApp(a))).join(', ') : '<b class="carga-alerta">nenhum</b>'}</dd></dl>`;
    ligarEscolhas($('#modalConviteBg'), convite, pintarConvite);
  }
  function irPasso(n) {
    convite.passo = n;
    $$('#convitePassos li').forEach(li => {
      const k = Number(li.dataset.passo);
      li.classList.toggle('ativo', k === n);
      li.classList.toggle('feito', k < n);
      li.setAttribute('aria-current', k === n ? 'step' : 'false');
    });
    $$('#formConvite .passo-corpo').forEach(c => { c.hidden = Number(c.dataset.corpo) !== n; });
    $('#btnConviteVoltar').hidden = n === 1 || n === 4;
    $('#btnConviteAvancar').textContent = n === 3 ? 'Convidar' : n === 4 ? 'Concluir' : 'Continuar';
    $('#conviteErro').hidden = true;
    if (n === 3) pintarConvite();
    const foco = { 1: '[name=nome]', 2: '#convitePapeis input:checked', 3: '#conviteApps [data-app]:not([disabled])', 4: '[data-copiar-senha]' }[n];
    setTimeout(() => $('#formConvite ' + foco)?.focus() || $(foco)?.focus(), 60);
  }
  async function avancarConvite(e) {
    e.preventDefault();
    const f = e.target, erro = $('#conviteErro');
    const falha = (t) => { erro.textContent = t; erro.hidden = false; };
    if (convite.passo === 1) {
      const nome = f.nome.value.trim(), email = f.email.value.trim().toLowerCase();
      if (!nome) return falha('Informe o nome da pessoa.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return falha('Esse e-mail não parece certo.');
      if (PESSOAS.some(p => String(p.email || '').toLowerCase() === email)) return falha('Esse e-mail já está na equipe.');
      const tel = f.telefone.value.replace(/\D/g, '');
      if (tel && !/^(55)?\d{10,11}$/.test(tel)) return falha('Telefone com DDD, ex.: (12) 99999-8888.');
      return irPasso(2);
    }
    if (convite.passo === 2) return irPasso(3);
    if (convite.passo === 4) return fecharModal('modalConviteBg');
    // passo 3: cria a conta
    const apps = convite.papel === 'admin' ? ORDEM_APPS : convite.papel === 'agenda' ? ['agenda'] : convite.apps;
    if (!apps.length) return falha('Escolha pelo menos um app.');
    const btn = $('#btnConviteAvancar');
    btn.disabled = true; btn.textContent = 'Criando…';
    try {
      const corpo = { email: f.email.value.trim().toLowerCase(), nome: f.nome.value.trim(), papel: convite.papel, apps,
        equipe_id: f.equipe_id.value || null, cargo: f.cargo.value.trim() || null,
        telefone: f.telefone.value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '') || null };
      const j = await api('/api/equipe', { metodo: 'POST', corpo });
      $('#conviteResultado').innerHTML = caixaSenha({ nome: j.perfil?.nome || corpo.nome, email: j.perfil?.email || corpo.email, senha: j.senha_temporaria, novo: true });
      irPasso(4);
      recarregar();
      carregarNomesDaEquipe();
    } catch (err) {
      falha(err instanceof SemRota ? 'O servidor ainda não tem o convite novo (POST /api/equipe). Fale com quem cuida do sistema.' : err.message);
    } finally { btn.disabled = false; if (convite.passo === 3) btn.textContent = 'Convidar'; }
  }
  function caixaSenha({ nome, email, senha, novo }) {
    if (!senha) return `<p class="alerta">A conta foi criada, mas o servidor não devolveu a senha. Gere uma senha temporária na ficha da pessoa.</p>`;
    const tudo = `E-mail: ${email}\nSenha temporária: ${senha}\nEndereço: ${location.origin}`;
    return `<p class="st-titulo">✅ ${novo ? 'Conta de' : 'Senha nova para'} <b>${esc(nome)}</b> ${novo ? 'criada' : ''}</p>
      <div class="st-linha"><span>E-mail</span><code>${esc(email || '—')}</code></div>
      <div class="st-senha"><code aria-label="Senha temporária">${esc(senha)}</code>
        <button type="button" class="btn btn-primary sm" data-copiar-senha="${esc(senha)}">📋 Copiar senha</button></div>
      <button type="button" class="link" data-copiar-senha="${esc(tudo)}" data-copiar-aviso="E-mail, senha e endereço copiados">Copiar e-mail + senha + endereço</button>
      <p class="aviso st-aviso">🔒 <b>Esta senha aparece só agora.</b> Entregue pessoalmente (ou ditando) — não mande por WhatsApp nem por e-mail.
        No primeiro acesso o sistema pede para ${esc(primeiroNome(nome))} criar uma senha só dela.</p>`;
  }

  /* ---------------- Uma pessoa: papel, apps, equipe, acesso ---------------- */
  function travaDe(p) {
    if (!ehAdmin()) return 'Só o administrador muda papel, apps e acesso. Você está vendo em modo leitura.';
    if (p.id === perfil.id) return 'Este é você: papel, apps e acesso só outro administrador muda (assim ninguém se tranca para fora sem querer).';
    if (p.papel === 'admin' && p.ativo !== false && adminsAtivos() <= 1) return 'É o último administrador: para mudar o papel ou desativar, promova outra pessoa antes.';
    return '';
  }
  function abrirPessoa(id) {
    const p = PESSOAS.find(x => x.id === id);
    if (!p) return;
    editando = { p, papel: p.papel, apps: Array.isArray(p.apps) ? [...p.apps] : [...(APPS_PADRAO[p.papel] || [])] };
    const trava = travaDe(p);
    const leitura = !ehAdmin() || semRotaEquipe;
    const travaAcesso = leitura || p.id === perfil.id || (p.papel === 'admin' && p.ativo !== false && adminsAtivos() <= 1);
    editando.travaAcesso = travaAcesso;
    $('#pessoaAvatar').outerHTML = avatarHtml(p, 'avatar-grande').replace('<span ', '<span id="pessoaAvatar" ');
    $('#pessoaNome').textContent = p.nome + (p.id === perfil.id ? ' (você)' : '');
    $('#pessoaSub').textContent = [p.email, ultimoAcesso(p) ? `último acesso ${quandoTexto(ultimoAcesso(p))}${p.ultimo_app && p.ultimo_acesso_em ? ' no ' + nomeApp(p.ultimo_app) : ''}` : 'ainda não entrou',
      p.mfa_ativo ? '🛡 duas etapas' : ''].filter(Boolean).join(' · ');
    $('#pessoaTrava').textContent = semRotaEquipe ? 'O servidor ainda não tem a edição da equipe — só leitura por enquanto.' : trava;
    $('#pessoaTrava').hidden = !(semRotaEquipe || trava);
    const f = $('#formPessoa');
    f.equipe_id.value = p.equipe_id || '';
    f.cargo.value = p.cargo || '';
    f.telefone.value = p.telefone ? telefoneBonito(p.telefone) : '';
    f.recebe_leads.checked = !!p.recebe_leads;
    [f.equipe_id, f.cargo, f.telefone, f.recebe_leads].forEach(c => { c.disabled = leitura; });
    $('#pessoaErro').hidden = true;
    $('#btnPessoaSalvar').hidden = leitura;
    $('#btnPessoaSenha').hidden = leitura || p.id === perfil.id || p.ativo === false;
    $('#btnPessoaMfa').hidden = leitura || p.id === perfil.id || !p.mfa_ativo;
    const bAtivo = $('#btnPessoaAtivo');
    bAtivo.hidden = leitura || p.id === perfil.id;
    bAtivo.disabled = travaAcesso && p.ativo !== false;
    bAtivo.textContent = p.ativo === false ? '↺ Reativar acesso' : '⛔ Desativar';
    bAtivo.className = 'btn sm ' + (p.ativo === false ? 'btn-agendar' : 'btn-excluir');
    pintarPessoa();
    abrirModal('modalPessoaBg', leitura ? '.modal-x' : '#pessoaPapeis input:checked');
  }
  function pintarPessoa() {
    const t = editando.travaAcesso;
    $('#pessoaPapeis').innerHTML = papeisHtml(editando.papel, t);
    $('#pessoaApps').innerHTML = appsHtml(editando.apps, editando.papel, t);
    ligarEscolhas($('#modalPessoaBg'), editando, pintarPessoa);
  }
  async function patch(id, corpo) {
    const j = await api(`/api/equipe/${encodeURIComponent(id)}`, { metodo: 'PATCH', corpo });
    const novo = j.perfil || j;
    const i = PESSOAS.findIndex(x => x.id === id);
    if (i >= 0 && novo && novo.id) PESSOAS[i] = { ...PESSOAS[i], ...novo };
    return novo;
  }
  async function salvarPessoa(e) {
    e.preventDefault();
    if (!editando || !ehAdmin()) return;
    const { p } = editando, f = e.target, erro = $('#pessoaErro');
    const tel = f.telefone.value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (tel && !/^\d{10,11}$/.test(tel)) { erro.textContent = 'Telefone com DDD, ex.: (12) 99999-8888.'; erro.hidden = false; return; }
    const corpo = {};
    const appsFinal = editando.papel === 'admin' ? ORDEM_APPS : editando.papel === 'agenda' ? ['agenda'] : editando.apps;
    if (!editando.travaAcesso) {
      if (editando.papel !== p.papel) corpo.papel = editando.papel;
      const antes = [...(p.apps || [])].sort().join(','), depois = [...appsFinal].sort().join(',');
      if (antes !== depois) corpo.apps = appsFinal;
      if (!appsFinal.length) { erro.textContent = 'Deixe pelo menos um app liberado (ou desative a pessoa).'; erro.hidden = false; return; }
    }
    if ((f.equipe_id.value || null) !== (p.equipe_id || null)) corpo.equipe_id = f.equipe_id.value || null;
    if ((f.cargo.value.trim() || null) !== (p.cargo || null)) corpo.cargo = f.cargo.value.trim() || null;
    if ((tel || null) !== (p.telefone || null)) corpo.telefone = tel || null;
    if (f.recebe_leads.checked !== !!p.recebe_leads) corpo.recebe_leads = f.recebe_leads.checked;
    if (!Object.keys(corpo).length) return fecharModal('modalPessoaBg');
    if (corpo.papel === 'admin') {
      const ok = await Acesso.confirmar({ titulo: `Tornar ${primeiroNome(p.nome)} administrador?`, perigo: false, botao: 'Tornar administrador',
        texto: 'Administrador vê e muda tudo: equipe, auditoria, chaves e configurações.' });
      if (!ok) return;
    }
    const btn = $('#btnPessoaSalvar');
    btn.disabled = true;
    try {
      await patch(p.id, corpo);
      fecharModal('modalPessoaBg');
      toast(`✅ ${primeiroNome(p.nome)} atualizado`, 'ok');
      renderEquipe();
      carregarNomesDaEquipe();
    } catch (err) {
      erro.textContent = err instanceof SemRota ? 'O servidor ainda não tem a edição da equipe (PATCH /api/equipe/:id).' : err.message;
      erro.hidden = false;
    } finally { btn.disabled = false; }
  }
  async function alternarAtivo() {
    if (!editando || !ehAdmin()) return;
    const { p } = editando;
    const ativar = p.ativo === false;
    let redistribuir = false;
    if (!ativar) {
      if (editando.travaAcesso) return;
      const conv = p.carga?.conversas_abertas || 0;
      const ok = await Acesso.confirmar({ titulo: `Desativar ${p.nome}?`, botao: 'Desativar',
        texto: `${primeiroNome(p.nome)} sai de todos os apps na hora (o login é bloqueado e as sessões caem) e não consegue mais entrar. O histórico continua. Dá para reativar depois.`,
        caixa: conv ? `Passar as ${conv} conversa${conv > 1 ? 's' : ''} abertas dela para o rodízio` : '', caixaMarcada: true });
      if (!ok) return;
      redistribuir = !!conv && $('#confirmarCaixa').checked;
    }
    try {
      let j;
      try {
        j = await api(`/api/equipe/${encodeURIComponent(p.id)}/${ativar ? 'reativar' : 'desativar'}`, { metodo: 'POST', corpo: ativar ? {} : { redistribuir } });
      } catch (err) {
        if (!(err instanceof SemRota)) throw err;
        j = await patch(p.id, { ativo: ativar });      // servidor antigo: só o PATCH
      }
      p.ativo = ativar;
      const i = PESSOAS.findIndex(x => x.id === p.id); if (i >= 0) PESSOAS[i].ativo = ativar;
      fecharModal('modalPessoaBg');
      const mov = j?.redistribuidas?.movidas;
      // o aviso do servidor (login não bloqueado no Supabase) é o que mais importa: fica por último
      toast(j?.aviso ? '⚠️ ' + j.aviso : ativar ? `↺ ${primeiroNome(p.nome)} voltou a ter acesso`
        : `⛔ ${primeiroNome(p.nome)} foi desativado${mov ? ` — ${mov} conversa${mov > 1 ? 's voltaram' : ' voltou'} para o rodízio` : ''}`, j?.aviso ? 'erro' : ativar ? 'ok' : '');
      renderEquipe();
      carregarNomesDaEquipe();
    } catch (err) {
      $('#pessoaErro').textContent = err instanceof SemRota ? 'O servidor ainda não tem a edição da equipe (PATCH /api/equipe/:id).' : err.message;
      $('#pessoaErro').hidden = false;
    }
  }
  async function tirarMfa() {
    if (!editando || !ehAdmin()) return;
    const { p } = editando;
    const ok = await Acesso.confirmar({ titulo: `Tirar a verificação em duas etapas de ${primeiroNome(p.nome)}?`, botao: 'Tirar',
      texto: 'Use quando a pessoa perdeu ou trocou o celular. Ela volta a entrar só com a senha e pode ligar de novo em Minha conta.' });
    if (!ok) return;
    try {
      await api(`/api/equipe/${encodeURIComponent(p.id)}/mfa/remover`, { metodo: 'POST', corpo: {} });
      p.mfa_ativo = false;
      fecharModal('modalPessoaBg');
      toast(`🛡 Verificação em duas etapas de ${primeiroNome(p.nome)} removida`, 'ok');
      renderEquipe();
    } catch (err) {
      $('#pessoaErro').textContent = err instanceof SemRota ? 'O servidor ainda não remove a verificação (POST /api/equipe/:id/mfa/remover).' : err.message;
      $('#pessoaErro').hidden = false;
    }
  }
  async function gerarSenhaTemporaria() {
    if (!editando || !ehAdmin()) return;
    const { p } = editando;
    const ok = await Acesso.confirmar({ titulo: `Gerar senha temporária para ${primeiroNome(p.nome)}?`, perigo: false, botao: 'Gerar senha',
      texto: 'A senha atual dela para de valer. A nova aparece uma vez só, e no primeiro acesso o sistema pede para trocar.' });
    if (!ok) return;
    try {
      const j = await api(`/api/equipe/${encodeURIComponent(p.id)}/senha-temporaria`, { metodo: 'POST' });
      p.precisa_trocar_senha = true;
      fecharModal('modalPessoaBg');
      $('#senhaTempCaixa').innerHTML = caixaSenha({ nome: p.nome, email: p.email, senha: j.senha_temporaria, novo: false });
      abrirModal('modalSenhaTempBg', '[data-copiar-senha]');
      renderEquipe();
    } catch (err) {
      $('#pessoaErro').textContent = err instanceof SemRota ? 'O servidor ainda não gera senha temporária (POST /api/equipe/:id/senha-temporaria).' : err.message;
      $('#pessoaErro').hidden = false;
    }
  }

  /* ============================================================
     AUDITORIA
     ============================================================ */
  let paginaAud = 1, totalAud = 0, geracaoAud = 0;
  const POR_PAGINA = 20;
  function filtrosAud(pagina) {
    const q = new URLSearchParams();
    const add = (k, s) => { const v = $(s).value; if (v) q.set(k, v); };
    add('pessoa', '#audPessoa'); add('tabela', '#audTabela'); add('acao', '#audAcao'); add('de', '#audDe'); add('ate', '#audAte');
    if (pagina) q.set('pagina', String(pagina));
    return q;
  }
  function abrirAuditoria() {
    if (!ehAdmin()) { $('#linhaAuditoria').innerHTML = '<div class="vazio">Só o administrador vê a auditoria.</div>'; return; }
    const sel = $('#audPessoa'), atual = sel.value;
    const gente = [...EQUIPE.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    sel.innerHTML = '<option value="">Todas</option>' + gente.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('');
    sel.value = atual;
    carregarAuditoria(1);
  }
  async function carregarAuditoria(pagina = 1) {
    const g = ++geracaoAud;
    paginaAud = Math.max(1, pagina);
    const el = $('#linhaAuditoria');
    el.innerHTML = Array.from({ length: 5 }, () => '<div class="lt-item esqueleto-linha" aria-hidden="true"><i></i><i></i></div>').join('');
    try {
      const j = await api('/api/auditoria?' + filtrosAud(paginaAud));
      if (g !== geracaoAud) return;
      const itens = j.itens || [];
      totalAud = Number(j.total) || itens.length;
      el.innerHTML = itens.length ? linhaDoTempo(itens)
        : `<div class="estado-vazio"><span class="vazio-ico" aria-hidden="true">🗂</span><p>Nada registrado com esses filtros.</p></div>`;
      const paginas = Math.max(1, Math.ceil(totalAud / (j.por_pagina || POR_PAGINA)));
      $('#audPaginacao').hidden = paginas <= 1;
      $('#audPaginaTxt').textContent = `Página ${paginaAud} de ${paginas} · ${totalAud} registro${totalAud === 1 ? '' : 's'}`;
      $('#audAnterior').disabled = paginaAud <= 1;
      $('#audProxima').disabled = paginaAud >= paginas;
    } catch (err) {
      if (g !== geracaoAud) return;
      $('#audPaginacao').hidden = true;
      el.innerHTML = err instanceof SemRota ? avisoSemRota('A auditoria (GET /api/auditoria)')
        : `<div class="estado-vazio"><span class="vazio-ico" aria-hidden="true">⚠️</span><p>${esc(err.message)}</p>
           <button type="button" class="btn btn-ghost sm" data-de-novo="auditoria">Tentar de novo</button></div>`;
    }
  }
  async function exportarCsv() {
    const btn = $('#btnAuditoriaCsv');
    btn.disabled = true; btn.textContent = 'Gerando…';
    try {
      const r = await api('/api/auditoria.csv?' + filtrosAud(0), { texto: true });
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `auditoria-indycar-${hojeSP()}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('⬇ Auditoria exportada (a exportação também fica registrada)', 'ok');
    } catch (err) {
      toast(err instanceof SemRota ? '🛠 O servidor ainda não exporta a auditoria (GET /api/auditoria.csv).' : '⚠️ ' + err.message, err instanceof SemRota ? '' : 'erro');
    } finally { btn.disabled = false; btn.textContent = '⬇ Exportar CSV'; }
  }

  /* ---------------- Frases em português ---------------- */
  const STATUS_LEAD = { novo: 'novo', contato: 'em contato', orcamento: 'orçamento', agendado: 'agendado', em_servico: 'em serviço', concluido: 'concluído', perdido: 'perdido' };
  const CONFIGS = { codewords_config: 'do WhatsApp (CodeWords)', agenda_ia_config: 'da IA da Agenda', ia_config: 'da IA', whatsapp_config: 'do WhatsApp (Cloud API)',
    posvenda_config: 'do Comunicar', funil_config: 'do funil', vigia_config: 'do vigia' };
  const CAMPO_NOME = { papel: 'papel', apps: 'apps', ativo: 'acesso', equipe_id: 'equipe', recebe_leads: 'rodízio', cargo: 'cargo', telefone: 'telefone',
    nome: 'nome', status: 'situação', valor_orcado: 'valor orçado', valor_pago: 'valor pago', responsavel_id: 'responsável', api_key: 'chave de API' };
  const b = (t) => `<b>${esc(t)}</b>`;
  const rotPapel = (p) => (PAPEIS[p]?.nome || p || '—').toLowerCase();
  const reais = (v) => v == null ? '—' : brl(v);
  function alvoDe(it) {
    const a = it.antes || {}, d = it.depois || {}, x = it.detalhes || {};
    return d.nome || a.nome || x.alvo_nome || x.cliente_nome || d.cliente_nome || a.cliente_nome
      || (it.tabela === 'perfis' && EQUIPE.get(it.registro_id)?.nome)
      || (it.tabela === 'conversas' && (CONVERSAS.find(c => c.id === it.registro_id) || null) && tituloDaConversa(CONVERSAS.find(c => c.id === it.registro_id))) || '';
  }
  /* O servidor grava "equipe.editar" com detalhes {antes, depois}; os gatilhos do banco gravam
     antes/depois na própria linha. Aqui os dois viram o mesmo formato. */
  function normalizar(it) {
    const x = it.detalhes || {};
    if (!it.antes && !it.depois && x.antes && x.depois && typeof x.depois === 'object') {
      return { ...it, antes: { ...x.antes }, depois: { ...x.depois }, campos: it.campos || Object.keys(x.depois) };
    }
    return it;
  }
  function frase(bruto) {
    const it = normalizar(bruto);
    const quem = it.perfil_nome ? b(it.perfil_nome) : (it.perfil_id ? b('Alguém') : b('O sistema'));
    const a = it.antes || {}, d = it.depois || {}, x = it.detalhes || {};
    const alvo = alvoDe(it), A = alvo ? b(alvo) : 'alguém';
    const campos = it.campos || Object.keys(d).filter(k => !['nome', 'cliente_nome', 'responsavel_nome'].includes(k));
    const nomeDe = (id) => (id && EQUIPE.get(id)?.nome) || '';
    switch (it.acao) {
      case 'equipe.convidar': return `${quem} convidou ${alvo ? A : b(x.email || 'alguém')} como ${esc(rotPapel(x.papel))}${Array.isArray(x.apps) && x.apps.length ? ` (${esc(x.apps.map(nomeApp).join(', '))})` : ''}`;
      case 'equipe.desativar': return `${quem} desativou o acesso de ${A}${x.motivo ? ` — “${esc(x.motivo)}”` : ''}`;
      case 'equipe.reativar': return `${quem} reativou o acesso de ${A}`;
      case 'equipe.redefinir_senha': return `${quem} gerou uma senha temporária para ${A}`;
      case 'equipe.remover_mfa': return `${quem} tirou a verificação em duas etapas de ${A}`;
      case 'perfil.senha_trocada': return `${quem} trocou a senha temporária por uma própria`;
      case 'conversa.transferir': return `${quem} passou ${alvo ? `a conversa de ${A}` : 'uma conversa'}${x.de ? ` de ${b(nomeDe(x.de) || 'outra pessoa')}` : ''} para ${b(nomeDe(x.para) || x.para_nome || 'um colega')}${x.motivo ? ` — “${esc(x.motivo)}”` : ''}`;
      case 'conversa.distribuir': return `${quem === b('O sistema') ? 'O rodízio' : quem} deu dono ${alvo ? `à conversa de ${A}` : 'a uma conversa sem responsável'}${x.para ? ` (${b(nomeDe(x.para) || 'colega')})` : ''}`;
      case 'conversa.redistribuir': return `O sistema devolveu ao rodízio uma conversa de ${b(nomeDe(x.de || x.donoAnterior) || 'alguém sem acesso')}`;
      case 'auditoria.exportar': return `${quem} exportou a auditoria${x.linhas != null ? ` (${esc(String(x.linhas))} linhas)` : ''}`;
      case 'tarefa.criar': return `${quem} criou uma tarefa${x.responsavel_id && x.responsavel_id !== it.perfil_id ? ` para ${b(nomeDe(x.responsavel_id) || 'um colega')}` : ''}`;
      case 'config.ia': return `${quem} mudou a configuração da IA${Array.isArray(x.campos) && x.campos.length ? `: ${esc(x.campos.join(', '))}` : ''}`;
      case 'ia.executar': case 'ia.recusar': case 'ia.desfazer':
        return `${quem} ${{ 'ia.executar': 'executou', 'ia.recusar': 'recusou', 'ia.desfazer': 'desfez' }[it.acao]} uma ação da IA${x.tipo ? ` (${esc(String(x.tipo).replace(/_/g, ' '))})` : ''}`;
      default: if (/^automacao\./.test(it.acao || '')) return `O sistema rodou a automação ${esc(x.tarefa || it.acao.split('.')[1])}`;
    }
    if (it.acao === 'equipe.editar') it.acao = 'update';
    if (it.acao === 'convidar') return `${quem} convidou ${A} como ${esc(rotPapel(x.papel))}${Array.isArray(x.apps) && x.apps.length ? ` (${esc(x.apps.map(nomeApp).join(', '))})` : ''}`;
    if (it.acao === 'senha_temporaria') return `${quem} gerou uma senha temporária para ${A}`;
    if (it.acao === 'transferir_conversa') return `${quem} passou a conversa de ${A} ${x.de_nome ? `de ${b(x.de_nome)} ` : ''}para ${b(x.para_nome || 'um colega')}${x.motivo ? ` — “${esc(x.motivo)}”` : ''}`;
    if (it.acao === 'exportar_csv') return `${quem} exportou ${it.tabela === 'auditoria' ? 'a auditoria' : esc(it.tabela || 'dados')}${x.linhas != null ? ` (${esc(String(x.linhas))} linhas)` : ''}`;
    if (it.acao === 'ia_executar') return `${quem} executou a ação da IA “${esc(x.resumo || x.tipo || 'ação')}”${alvo ? ` em ${A}` : ''}`;
    if (it.acao === 'delete' || it.acao === 'excluir') {
      const oque = { clientes: `o cliente ${A}`, conversas: `a conversa de ${A}`, leads: `o lead de ${A}`, tarefas: `a tarefa ${A}`,
        agendamentos: `o agendamento de ${A}${a.servico ? ` (${esc(a.servico)}${a.data ? ', ' + esc(String(a.data).split('-').reverse().join('/')) : ''})` : ''}` }[it.tabela];
      return `${quem} apagou ${oque || `um registro de ${esc(it.tabela)}`}`;
    }
    if (it.acao === 'insert' || it.acao === 'criar') return `${quem} criou ${it.tabela === 'perfis' ? `o acesso de ${A}` : `um registro em ${esc(it.tabela)}`}`;
    if (CONFIGS[it.tabela]) return `${quem} mudou a configuração ${esc(CONFIGS[it.tabela])}${campos.length ? `: ${esc(campos.map(c => CAMPO_NOME[c] || c).join(', '))}` : ''}`;
    if (it.tabela === 'perfis') {
      const partes = campos.map(c => {
        if (c === 'papel') return `mudou o papel de ${A} de ${esc(rotPapel(a.papel))} para ${b(rotPapel(d.papel))}`;
        if (c === 'ativo') return d.ativo === false ? `desativou o acesso de ${A}` : `reativou o acesso de ${A}`;
        if (c === 'apps') {
          const antes = a.apps || [], depois = d.apps || [];
          const deu = depois.filter(z => !antes.includes(z)), tirou = antes.filter(z => !depois.includes(z));
          return `mudou os apps de ${A}` + [deu.length ? `liberou ${esc(deu.map(nomeApp).join(', '))}` : '', tirou.length ? `tirou ${esc(tirou.map(nomeApp).join(', '))}` : ''].filter(Boolean).map((t, i) => (i ? '; ' : ': ') + t).join('');
        }
        if (c === 'equipe_id') return `mudou ${A} para a equipe ${b(timePorId(d.equipe_id)?.nome || 'sem equipe')}`;
        if (c === 'recebe_leads') return d.recebe_leads ? `colocou ${A} no rodízio de clientes novos` : `tirou ${A} do rodízio de clientes novos`;
        return `mudou ${esc(CAMPO_NOME[c] || c)} de ${A}`;
      });
      return `${quem} ${partes.join(' e ') || `mexeu no perfil de ${A}`}`;
    }
    if (it.tabela === 'leads') {
      const partes = campos.map(c => {
        if (c === 'status') return `moveu o lead de ${A} de ${esc(STATUS_LEAD[a.status] || a.status || '—')} para ${b(STATUS_LEAD[d.status] || d.status || '—')}`;
        if (c === 'valor_orcado' || c === 'valor_pago') return `mudou o ${CAMPO_NOME[c]} de ${A} de ${esc(reais(a[c]))} para ${b(reais(d[c]))}`;
        if (c === 'responsavel_id') return `passou o lead de ${A} para ${b(d.responsavel_nome || EQUIPE.get(d.responsavel_id)?.nome || 'ninguém')}`;
        return `mudou ${esc(CAMPO_NOME[c] || c)} do lead de ${A}`;
      });
      return `${quem} ${partes.join(' e ') || `mexeu no lead de ${A}`}`;
    }
    return `${quem} ${esc(it.acao || 'mudou')} ${campos.length ? esc(campos.join(', ')) + ' ' : ''}em ${esc(it.tabela || '—')}${alvo ? ` (${A})` : ''}`;
  }
  const ICONE_ACAO = { 'equipe.convidar': '✉️', 'equipe.desativar': '⛔', 'equipe.reativar': '↺', 'equipe.redefinir_senha': '🔑', 'equipe.remover_mfa': '🛡',
    'perfil.senha_trocada': '🔑', 'conversa.transferir': '↪', 'conversa.distribuir': '🎯', 'conversa.redistribuir': '🎯', 'auditoria.exportar': '⬇',
    'tarefa.criar': '✓', 'config.ia': '⚙️', 'ia.executar': '✨', 'ia.recusar': '✨', 'ia.desfazer': '✨' };
  const ICONE = (it) => ICONE_ACAO[it.acao] || (/^automacao\./.test(it.acao || '') ? '🤖' : it.acao === 'equipe.editar' ? '👤' : ICONE_ANTIGO(it));
  const ICONE_ANTIGO = (it) => it.acao === 'delete' ? '🗑' : it.acao === 'convidar' ? '✉️' : it.acao === 'senha_temporaria' ? '🔑'
    : it.acao === 'transferir_conversa' ? '↪' : it.acao === 'exportar_csv' ? '⬇' : it.acao === 'ia_executar' ? '✨'
    : CONFIGS[it.tabela] ? '⚙️' : it.tabela === 'perfis' ? ((it.campos || []).includes('ativo') ? (it.depois?.ativo === false ? '⛔' : '↺') : '👤')
    : it.tabela === 'leads' ? '📈' : '✎';
  const tom = (it) => it.acao === 'delete' || it.acao === 'equipe.desativar' || it.depois?.ativo === false ? 'perigo'
    : ['equipe.redefinir_senha', 'equipe.remover_mfa', 'config.ia'].includes(it.acao) ? 'alerta' : CONFIGS[it.tabela] || it.acao === 'senha_temporaria' ? 'alerta' : '';
  function valorLegivel(k, v) {
    if (v == null) return '—';
    if (k === 'papel') return PAPEIS[v]?.nome || v;
    if (k === 'apps' && Array.isArray(v)) return v.map(nomeApp).join(', ') || 'nenhum';
    if (k === 'ativo' || typeof v === 'boolean') return v ? 'sim' : 'não';
    if (/valor/.test(k)) return reais(v);
    if (k === 'status') return STATUS_LEAD[v] || v;
    if (k === 'equipe_id') return timePorId(v)?.nome || v;
    if (/_id$/.test(k)) return EQUIPE.get(v)?.nome || v;
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  function detalhesHtml(bruto) {
    const it = normalizar(bruto);
    const a = it.antes || {}, d = it.depois || {};
    const chaves = [...new Set([...(it.campos || []), ...Object.keys(d)])].filter(k => !['nome', 'cliente_nome', 'responsavel_nome'].includes(k));
    const linhas = chaves.map(k => `<tr><th>${esc(CAMPO_NOME[k] || k)}</th><td>${esc(valorLegivel(k, a[k]))}</td><td aria-hidden="true">→</td><td>${esc(valorLegivel(k, d[k]))}</td></tr>`).join('');
    const extra = it.detalhes && Object.keys(it.detalhes).length
      ? `<p class="lt-extra">${Object.entries(it.detalhes).filter(([k]) => !['antes', 'depois'].includes(k)).map(([k, v]) => `<span>${esc(k.replace(/_/g, ' '))}: <b>${esc(valorLegivel(k, v))}</b></span>`).join('')}</p>` : '';
    if (!linhas && !extra) return '';
    return `<details class="lt-detalhes"><summary>ver detalhes</summary>
      ${linhas ? `<table class="lt-tabela"><thead><tr><th>Campo</th><th>Antes</th><th></th><th>Depois</th></tr></thead><tbody>${linhas}</tbody></table>` : ''}${extra}
      <small class="lt-id">${esc(it.tabela || '')}${it.registro_id ? ' · ' + esc(String(it.registro_id)) : ''} · #${esc(String(it.id))}</small></details>`;
  }
  function linhaDoTempo(itens) {
    let dia = '';
    return itens.map(it => {
      const dt = new Date(it.created_at);
      const d = dt.toDateString();
      const sep = d !== dia ? `<div class="lt-dia" role="separator">${esc(rotuloDoDia(it.created_at))}</div>` : '';
      dia = d;
      return `${sep}<article class="lt-item ${tom(it)}">
        <span class="lt-ico" aria-hidden="true">${ICONE(it)}</span>
        <div class="lt-corpo">
          <p class="lt-frase">${frase(it)}</p>
          <p class="lt-meta"><time datetime="${esc(it.created_at)}">${esc(dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}</time>
            ${it.app ? `<span class="app-chip mini">${icoApp(it.app)} ${esc(nomeApp(it.app))}</span>` : ''}</p>
          ${detalhesHtml(it)}
        </div>
      </article>`;
    }).join('');
  }

  return { iniciar, abrirEquipe, recarregar, abrirAuditoria, frase, get pessoas() { return PESSOAS; }, get times() { return TIMES; } };
})();
