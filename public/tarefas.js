/* ============================================================
   IndyCar Atendimento — SINO, TAREFAS, PRESENÇA e TRANSFERÊNCIA (rodada 3)
   - Sino: notificações (RLS: só as minhas) + tempo real; marcar lida/todas;
     o link abre no app certo.
   - Tarefas: minhas / que eu passei / feitas / equipe (gestor, com a carga de
     cada pessoa em GET /api/tarefas/equipe); criar a partir da conversa
     (responsável, prazo, prioridade); aparecem na ficha do cliente.
   - Presença: quem está com a MESMA conversa aberta (Realtime Presence no
     canal "conversa:<id>"), inclusive "digitando…".
   - Transferir conversa com motivo: POST /api/conversas/:id/transferir.
   Tabelas tarefas/notificacoes direto pelo supabase-js (o RLS já libera).
   ============================================================ */
const Tarefas = (() => {
  /* Rodada 5: endereços dos apps num lugar só (public/apps.js). */
  const LINKS_APP = new Proxy({}, { get: (_, app) => (window.IndyCarApps ? window.IndyCarApps.link(app) : null) || '' });
  const ICO_NOTIF = { tarefa: '✓', conversa: '↪', aguardando: '⏳', lead: '📈', sistema: '⚙️', ia: '✨' };
  const PRIO = { 1: { nome: 'Alta', cls: 'prio-1' }, 2: { nome: 'Normal', cls: 'prio-2' }, 3: { nome: 'Baixa', cls: 'prio-3' } };

  let NOTIFS = [];
  let MINHAS = [];          // abertas onde sou responsável ou que eu criei
  let FEITAS = [];
  let DA_EQUIPE = [];       // abertas de todo mundo (gestor)
  let CARGA = null;         // GET /api/tarefas/equipe
  let ver = 'minhas', verSino = 'nao', busca = '', filtroPessoa = '';
  let canalPessoal = null, canalPresenca = null, presencaConv = null;
  let recargaT = null, digitandoT = null, ultimoTrack = 0;
  let novaCtx = null;       // contexto da tarefa em criação
  let transf = null;        // { conv, para }
  let iniciado = false;

  const eu = () => perfil?.id;
  const ehGestor = () => perfil?.papel === 'admin' || perfil?.papel === 'gestor';
  const nomeDe = (id) => (id === eu() ? perfil.nome : EQUIPE.get(id)?.nome) || 'Alguém';
  const colegas = () => [...EQUIPE.values()].filter(p => (p.atende !== undefined ? p.atende : (p.ativo !== false && p.papel !== 'agenda')))
    .sort((a, b) => (a.id === eu() ? -1 : b.id === eu() ? 1 : String(a.nome).localeCompare(String(b.nome), 'pt-BR')));
  const miniAvatar = (id, titulo) => {
    const p = id === eu() ? perfil : EQUIPE.get(id);
    const cor = corDaPessoa(id, p);
    return `<span class="avatar mini" style="background:${cor}" title="${esc(titulo || p?.nome || '')}" aria-hidden="true">${esc(iniciais(p?.nome || '?'))}</span>`;
  };

  /* ---------------- Início / fim ---------------- */
  async function iniciar() {
    if (iniciado) return;
    iniciado = true;
    $('#segTarefasEquipe').hidden = !ehGestor();
    ligar();
    await Promise.all([carregarNotificacoes(), carregarTarefas()]);
    ligarTempoRealPessoal();
    // a conversa que já estava aberta antes deste módulo ligar
    if (conversaAtual) aoTrocarConversa(conversaAtual.id);
    setInterval(() => { if (!document.hidden) { pintarBadges(); if (abaVisivel('tarefas')) renderTarefas(); } }, 60_000);
  }
  function parar() {
    try { if (canalPessoal) sb.removeChannel(canalPessoal); } catch { /* ignora */ }
    sairDaPresenca();
    canalPessoal = null;
  }

  /* ---------------- Notificações ---------------- */
  async function carregarNotificacoes() {
    try {
      const { data, error } = await sb.from('notificacoes').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      NOTIFS = (data || []).filter(n => n.perfil_id === eu() || !n.perfil_id);
    } catch { NOTIFS = []; }
    pintarSino();
  }
  const visiveis = () => NOTIFS.filter(n => Acesso.prefAviso(n.tipo) || !['tarefa', 'conversa', 'aguardando', 'lead'].includes(n.tipo));
  function pintarSino() {
    const nao = visiveis().filter(n => !n.lida_em).length;
    const num = $('#sinoNum');
    num.hidden = !nao;
    num.textContent = nao > 99 ? '99+' : String(nao);
    $('#btnSino').setAttribute('aria-label', nao ? `Notificações: ${nao} não lida${nao > 1 ? 's' : ''}` : 'Notificações');
    $('#btnSino').classList.toggle('tem', !!nao);
    if (!$('#painelSino').hidden) renderSino();
  }
  function quando(iso) {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'ontem' : `${d} dias`;
  }
  function renderSino() {
    const lista = visiveis().filter(n => verSino === 'todas' || !n.lida_em);
    $('#btnSinoTodas').hidden = !visiveis().some(n => !n.lida_em);
    $('#sinoLista').innerHTML = lista.length ? lista.map(n => `
      <button type="button" class="ps-item${n.lida_em ? '' : ' nova'}" data-notif="${esc(n.id)}">
        <span class="ps-ico t-${esc(n.tipo || 'sistema')}" aria-hidden="true">${ICO_NOTIF[n.tipo] || '🔔'}</span>
        <span class="ps-txt"><b>${esc(n.titulo || 'Aviso')}</b>${n.corpo ? `<small>${esc(n.corpo)}</small>` : ''}
          <em>${esc(quando(n.created_at))}${n.app && n.app !== 'atendimento' ? ` · ${esc(Acesso.APPS[n.app]?.nome || n.app)} ↗` : ''}</em></span>
        ${n.lida_em ? '' : '<i class="ps-ponto" aria-label="não lida"></i>'}
      </button>`).join('')
      : `<div class="ps-vazio"><span aria-hidden="true">🎉</span><p>${verSino === 'nao' ? 'Nada novo por aqui.' : 'Nenhuma notificação ainda.'}</p></div>`;
  }
  function abrirSino() {
    const p = $('#painelSino'), anc = $('#btnSino');
    renderSino();
    p.hidden = false;
    anc.setAttribute('aria-expanded', 'true');
    const r = anc.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
    const embaixo = window.innerHeight - r.bottom > h + 10 || r.top < h + 10;
    p.style.top = `${Math.max(8, embaixo ? r.bottom + 8 : r.top - h - 8)}px`;
    p.style.left = `${Math.min(Math.max(8, r.left - (window.innerWidth > 900 ? 0 : w - r.width)), window.innerWidth - w - 8)}px`;
    setTimeout(() => $('.ps-item, .seg', p)?.focus(), 30);
  }
  function fecharSino() {
    const p = $('#painelSino');
    if (p.hidden) return;
    p.hidden = true;
    $('#btnSino').setAttribute('aria-expanded', 'false');
  }
  async function marcarLidas(ids) {
    const agora = new Date().toISOString();
    NOTIFS.forEach(n => { if (ids.includes(n.id) && !n.lida_em) n.lida_em = agora; });
    pintarSino();
    try { await sb.from('notificacoes').update({ lida_em: agora }).in('id', ids).is('lida_em', null); } catch { /* fica marcada aqui; volta na próxima carga */ }
  }
  function abrirLink(n) {
    const link = String(n.link || '');
    if (!link) return;
    // só links relativos ou do próprio ecossistema
    if (/^https?:\/\//i.test(link)) {
      try { const u = new URL(link); if (Object.values(LINKS_APP).some(b => b.startsWith(u.origin))) window.open(u.href, '_blank', 'noopener'); } catch { /* ignora */ }
      return;
    }
    if (!link.startsWith('/')) return;
    const app = n.app || 'atendimento';
    if (app !== 'atendimento') return void window.open((LINKS_APP[app] || '') + link, '_blank', 'noopener');
    const u = new URL(link, location.origin);
    const conversa = u.searchParams.get('conversa');
    if (conversa) return irParaConversa(conversa);
    if (u.searchParams.get('tarefas') !== null || u.pathname === '/tarefas') return irParaTarefas();
    if (u.searchParams.toString()) {
      const atual = new URL(location.href);
      u.searchParams.forEach((v, k) => atual.searchParams.set(k, v));
      history.replaceState(null, '', atual.pathname + '?' + atual.searchParams);
      irParaAbaConversas();
      abrirPeloEndereco();
    }
  }
  function chegouNotificacao(n) {
    if (!n?.id || NOTIFS.some(x => x.id === n.id)) return;
    NOTIFS.unshift(n);
    pintarSino();
    if (!Acesso.prefAviso(n.tipo) && ['tarefa', 'conversa', 'aguardando', 'lead'].includes(n.tipo)) return;
    toast(`🔔 ${n.titulo}${n.corpo ? ' — ' + n.corpo : ''}`);
    if (Acesso.prefAviso('som')) { try { tocarSom(); } catch { /* sem som */ } }
    $('#btnSino').classList.remove('balanca'); void $('#btnSino').offsetWidth; $('#btnSino').classList.add('balanca');
  }

  /* ---------------- Tarefas: dados ---------------- */
  async function carregarTarefas() {
    if (!eu()) return;
    try {
      const [abertas, feitas] = await Promise.all([
        sb.from('tarefas').select('*').eq('status', 'aberta').or(`responsavel_id.eq.${eu()},criado_por.eq.${eu()}`)
          .order('vence_em', { ascending: true, nullsFirst: false }).limit(300),
        sb.from('tarefas').select('*').eq('status', 'feita').eq('responsavel_id', eu())
          .order('concluida_em', { ascending: false }).limit(30),
      ]);
      if (abertas.error) throw abertas.error;
      MINHAS = abertas.data || [];
      FEITAS = feitas.data || [];
    } catch (err) {
      if (abaVisivel('tarefas')) $('#listaTarefas').innerHTML = `<div class="estado-vazio"><span class="vazio-ico">⚠️</span><p>Não consegui ler as tarefas: ${esc(err.message)}</p></div>`;
      return;
    }
    pintarBadges();
    if (abaVisivel('tarefas')) renderTarefas();
    renderFichaTarefas();
  }
  function agendarRecarga() {
    clearTimeout(recargaT);
    recargaT = setTimeout(async () => {
      await carregarTarefas();
      if (ver === 'equipe' && abaVisivel('tarefas')) carregarEquipe();
    }, 400);
  }
  const atrasada = (t) => t.status === 'aberta' && t.vence_em && new Date(t.vence_em).getTime() < Date.now();
  function pintarBadges() {
    const minhas = MINHAS.filter(t => t.responsavel_id === eu());
    const b = $('#badgeTarefas');
    b.hidden = !minhas.length;
    b.textContent = String(minhas.length);
    b.classList.toggle('atrasada', minhas.some(atrasada));
    b.title = minhas.some(atrasada) ? `${minhas.filter(atrasada).length} atrasada(s)` : '';
  }

  /* ---------------- Tarefas: tela ---------------- */
  function prazoTexto(t) {
    if (!t.vence_em) return 'sem prazo';
    const d = new Date(t.vence_em);
    const hoje = hojeSP(), dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    if (atrasada(t)) {
      const min = Math.round((Date.now() - d.getTime()) / 60_000);
      return `atrasada ${min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} dia${min >= 2880 ? 's' : ''}`}`;
    }
    if (dia === hoje) return `hoje ${hora}`;
    if (dia === amanhaSP()) return `amanhã ${hora}`;
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) + ' ' + hora;
  }
  function grupoDe(t) {
    if (!t.vence_em) return 'sem';
    if (atrasada(t)) return 'atrasadas';
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(t.vence_em));
    if (dia === hojeSP()) return 'hoje';
    if (dia === amanhaSP()) return 'amanha';
    return 'proximas';
  }
  const GRUPOS = [['atrasadas', '🔴 Atrasadas'], ['hoje', '📌 Hoje'], ['amanha', '🌅 Amanhã'], ['proximas', '🗓 Próximos dias'], ['sem', '📝 Sem prazo']];
  function nomeCliente(t) {
    const c = (t.conversa_id && (CONVERSAS.find(x => x.id === t.conversa_id))) || (t.cliente_id && CONVERSAS.find(x => x.cliente_id === t.cliente_id));
    return c ? tituloDaConversa(c) : '';
  }
  function linhaTarefa(t, { compacta = false } = {}) {
    const feita = t.status === 'feita';
    const podeApagar = ehGestor() || t.criado_por === eu();
    const cli = nomeCliente(t);
    const p = PRIO[t.prioridade] || PRIO[2];
    const deQuem = t.criado_por && t.criado_por !== t.responsavel_id ? (t.criado_por === eu() ? `você passou para ${primeiroNome(nomeDe(t.responsavel_id))}` : `de ${primeiroNome(nomeDe(t.criado_por))}`) : '';
    return `<div class="tarefa ${p.cls}${atrasada(t) ? ' atrasada' : ''}${feita ? ' feita' : ''}${compacta ? ' compacta' : ''}" data-tarefa="${esc(t.id)}">
      <button type="button" class="tf-check" data-tf="${feita ? 'reabrir' : 'concluir'}" aria-pressed="${feita}"
        aria-label="${feita ? 'Reabrir' : 'Concluir'}: ${esc(t.titulo)}" title="${feita ? 'Reabrir' : 'Concluir'}">${feita ? '✓' : ''}</button>
      <div class="tf-corpo">
        <strong>${esc(t.titulo)}</strong>
        <small>${[cli && `👤 ${esc(cli)}`, `<span class="tf-prazo">${esc(feita && t.concluida_em ? 'feita ' + quando(t.concluida_em) : prazoTexto(t))}</span>`,
          t.prioridade === 1 ? '<span class="tf-prio">alta</span>' : '', deQuem && esc(deQuem)].filter(Boolean).join(' · ')}</small>
        ${t.descricao && !compacta ? `<p>${esc(t.descricao)}</p>` : ''}
      </div>
      ${miniAvatar(t.responsavel_id, 'Responsável: ' + nomeDe(t.responsavel_id))}
      <div class="tf-acoes">
        ${t.conversa_id && !(compacta && conversaAtual?.id === t.conversa_id) ? `<button type="button" class="btn-icone" data-tf="abrir" title="Abrir a conversa" aria-label="Abrir a conversa">💬</button>` : ''}
        ${!feita ? `<button type="button" class="btn-icone" data-tf="cancelar" title="Cancelar (não precisa mais)" aria-label="Cancelar a tarefa">⊘</button>` : ''}
        ${podeApagar && !compacta ? `<button type="button" class="btn-icone" data-tf="apagar" title="Apagar" aria-label="Apagar a tarefa">🗑</button>` : ''}
      </div>
    </div>`;
  }
  function filtrarBusca(lista) {
    const q = semAcentoBusca(busca.trim());
    if (!q) return lista;
    return lista.filter(t => semAcentoBusca([t.titulo, t.descricao, nomeCliente(t), nomeDe(t.responsavel_id)].join(' ')).includes(q));
  }
  function agrupar(lista) {
    return GRUPOS.map(([g, rotulo]) => {
      const itens = lista.filter(t => grupoDe(t) === g).sort((a, b) => (a.prioridade || 2) - (b.prioridade || 2) || String(a.vence_em || '').localeCompare(String(b.vence_em || '')));
      return itens.length ? `<section class="tf-grupo g-${g}"><h4>${rotulo} <b>${itens.length}</b></h4>${itens.map(t => linhaTarefa(t)).join('')}</section>` : '';
    }).join('');
  }
  function vazio(txt) {
    return `<div class="estado-vazio"><span class="vazio-ico" aria-hidden="true">✅</span><p>${esc(txt)}</p>
      <button type="button" class="btn btn-primary sm" data-tf-nova="1">+ Nova tarefa</button></div>`;
  }
  function renderTarefas() {
    $('#cargaEquipe').hidden = ver !== 'equipe';
    const el = $('#listaTarefas');
    const minhas = MINHAS.filter(t => t.responsavel_id === eu());
    const at = minhas.filter(atrasada).length, hoje = minhas.filter(t => grupoDe(t) === 'hoje').length;
    $('#tarefasResumo').textContent = minhas.length
      ? `${minhas.length} aberta${minhas.length > 1 ? 's' : ''} com você${at ? ` · ${at} atrasada${at > 1 ? 's' : ''}` : ''}${hoje ? ` · ${hoje} para hoje` : ''}.`
      : 'Nada pendente com você. 🙌';
    if (ver === 'minhas') el.innerHTML = agrupar(filtrarBusca(minhas)) || vazio('Nenhuma tarefa aberta com você.');
    else if (ver === 'criei') {
      const l = filtrarBusca(MINHAS.filter(t => t.criado_por === eu() && t.responsavel_id !== eu()));
      el.innerHTML = l.length ? agrupar(l) : vazio('Você não passou tarefa para ninguém (que ainda esteja aberta).');
    } else if (ver === 'feitas') {
      const l = filtrarBusca(FEITAS);
      el.innerHTML = l.length ? `<section class="tf-grupo"><h4>✅ Feitas recentemente <b>${l.length}</b></h4>${l.map(t => linhaTarefa(t)).join('')}</section>` : vazio('Nenhuma tarefa concluída ainda.');
    } else {
      const l = filtrarBusca(DA_EQUIPE.filter(t => !filtroPessoa || t.responsavel_id === filtroPessoa));
      el.innerHTML = l.length ? agrupar(l) : `<div class="estado-vazio"><span class="vazio-ico">✅</span><p>${filtroPessoa ? 'Essa pessoa não tem tarefa aberta.' : 'A equipe não tem tarefa aberta.'}</p></div>`;
    }
  }
  function irParaTarefas() { $('.nav-item[data-aba="tarefas"]')?.click(); }
  function abrirAba() {
    renderTarefas();
    carregarTarefas();
    if (ver === 'equipe') carregarEquipe();
  }

  /* ---------------- Painel do gestor: carga por pessoa ---------------- */
  async function carregarEquipe() {
    if (!ehGestor()) return;
    const el = $('#cargaEquipe');
    el.hidden = false;
    if (!CARGA) el.innerHTML = '<div class="carga-pessoa esqueleto-cartao"></div>'.repeat(4);
    const [lista] = await Promise.all([
      sb.from('tarefas').select('*').eq('status', 'aberta').order('vence_em', { ascending: true, nullsFirst: false }).limit(400)
        .then(r => r.data || [], () => []),
      (async () => {
        try {
          const r = await fetch('/api/tarefas/equipe', { headers: await authCabecalhos() });
          const j = await r.json().catch(() => ({}));
          if (r.status === 404) { CARGA = 'sem-rota'; return; }
          if (!r.ok) throw new Error(j.erro || 'erro');
          CARGA = Array.isArray(j) ? j : (j.pessoas || j.equipe || []);
        } catch { CARGA = CARGA && CARGA !== 'sem-rota' ? CARGA : 'erro'; }
      })(),
    ]);
    DA_EQUIPE = lista;
    // sem a rota nova: calcula a carga com o que dá para ler daqui
    const linhas = Array.isArray(CARGA) ? CARGA : colegas().map(p => {
      const t = lista.filter(x => x.responsavel_id === p.id);
      return { perfil_id: p.id, nome: p.nome, tarefas_abertas: t.length, tarefas_atrasadas: t.filter(atrasada).length,
        tarefas_hoje: t.filter(x => grupoDe(x) === 'hoje').length, conversas_abertas: CONVERSAS.filter(c => c.atribuida_a === p.id).length, _local: true };
    });
    const max = Math.max(1, ...linhas.map(l => (l.tarefas_abertas || 0) + (l.conversas_abertas || 0)));
    el.innerHTML = (CARGA === 'sem-rota' ? '<p class="aviso carga-aviso">🛠 Carga calculada aqui na tela (o servidor ainda não tem GET /api/tarefas/equipe) — conversas contam só as carregadas.</p>' : '')
      + linhas.sort((a, b) => (b.tarefas_atrasadas || 0) - (a.tarefas_atrasadas || 0) || (b.tarefas_abertas || 0) - (a.tarefas_abertas || 0)).map(l => {
        const id = l.perfil_id || l.id;
        const tot = (l.tarefas_abertas || 0) + (l.conversas_abertas || 0);
        return `<button type="button" class="carga-pessoa${filtroPessoa === id ? ' ativa' : ''}${l.tarefas_atrasadas ? ' com-atraso' : ''}" data-carga-pessoa="${esc(id)}"
            aria-pressed="${filtroPessoa === id}" title="Mostrar só as tarefas de ${esc(l.nome)}">
          <span class="cp-topo">${miniAvatar(id, l.nome)}<b>${esc(primeiroNome(l.nome))}</b></span>
          <span class="cp-nums"><span title="Tarefas abertas">✓ ${esc(String(l.tarefas_abertas || 0))}</span>
            ${l.tarefas_atrasadas ? `<span class="cp-atraso" title="Atrasadas">🔴 ${esc(String(l.tarefas_atrasadas))}</span>` : ''}
            ${l.tarefas_hoje ? `<span title="Para hoje">📌 ${esc(String(l.tarefas_hoje))}</span>` : ''}
            <span title="Conversas em aberto">💬 ${esc(String(l.conversas_abertas || 0))}</span></span>
          <i class="cp-barra" style="--w:${Math.round((tot / max) * 100)}%" aria-hidden="true"></i>
        </button>`;
      }).join('');
    renderTarefas();
  }

  /* ---------------- Ações numa tarefa ---------------- */
  const acharTarefa = (id) => MINHAS.find(t => t.id === id) || FEITAS.find(t => t.id === id) || DA_EQUIPE.find(t => t.id === id) || FICHA.find(t => t.id === id);
  async function mudar(id, mudanca, aviso) {
    const t = acharTarefa(id);
    if (!t) return;
    const antes = { ...t };
    Object.assign(t, mudanca);
    if (mudanca.status === 'feita') { MINHAS = MINHAS.filter(x => x.id !== id); if (t.responsavel_id === eu()) FEITAS.unshift(t); DA_EQUIPE = DA_EQUIPE.filter(x => x.id !== id); }
    if (mudanca.status === 'aberta') { FEITAS = FEITAS.filter(x => x.id !== id); MINHAS.push(t); }
    if (mudanca.status === 'cancelada') { MINHAS = MINHAS.filter(x => x.id !== id); DA_EQUIPE = DA_EQUIPE.filter(x => x.id !== id); }
    pintarBadges(); renderTarefas(); renderFichaTarefas();
    try {
      const { data, error } = await sb.from('tarefas').update(mudanca).eq('id', id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('o banco não deixou mudar esta tarefa');
      if (aviso) toast(aviso, 'ok');
    } catch (err) {
      Object.assign(t, antes);
      toast('⚠️ Não consegui: ' + err.message, 'erro');
      agendarRecarga();
    }
  }
  async function apagar(id) {
    const t = acharTarefa(id);
    if (!t) return;
    const ok = await Acesso.confirmar({ titulo: 'Apagar esta tarefa?', texto: `“${t.titulo}” some para todo mundo. Se só não precisa mais, use “Cancelar”.`, botao: 'Apagar' });
    if (!ok) return;
    try {
      const { data, error } = await sb.from('tarefas').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('só quem criou a tarefa ou um gestor pode apagar');
      toast('🗑 Tarefa apagada');
      MINHAS = MINHAS.filter(x => x.id !== id); FEITAS = FEITAS.filter(x => x.id !== id); DA_EQUIPE = DA_EQUIPE.filter(x => x.id !== id);
      pintarBadges(); renderTarefas(); renderFichaTarefas();
    } catch (err) { toast('⚠️ ' + err.message, 'erro'); }
  }
  function cliqueEmTarefa(e) {
    const nova = e.target.closest('[data-tf-nova]');
    if (nova) return abrirNova({ daConversa: nova.dataset.tfNova === 'conversa' });
    const b = e.target.closest('[data-tf]');
    if (!b) return;
    const id = b.closest('[data-tarefa]')?.dataset.tarefa;
    const acao = b.dataset.tf;
    if (acao === 'concluir') return mudar(id, { status: 'feita' }, '✓ Feita!');
    if (acao === 'reabrir') return mudar(id, { status: 'aberta' }, '↺ Tarefa reaberta');
    if (acao === 'cancelar') return mudar(id, { status: 'cancelada' }, '⊘ Tarefa cancelada');
    if (acao === 'apagar') return apagar(id);
    if (acao === 'abrir') { const t = acharTarefa(id); if (t?.conversa_id) irParaConversa(t.conversa_id); }
  }

  /* ---------------- Ficha do cliente: as tarefas dele ---------------- */
  let FICHA = [], geracaoFicha = 0;
  async function renderFichaTarefas({ buscar = false } = {}) {
    const el = $('#fichaTarefas');
    const conv = conversaAtual;
    if (!conv) { el.hidden = true; return; }
    if (buscar) {
      const g = ++geracaoFicha;
      try {
        let q = sb.from('tarefas').select('*').in('status', ['aberta', 'feita']).order('created_at', { ascending: false }).limit(20);
        q = conv.cliente_id ? q.or(`conversa_id.eq.${conv.id},cliente_id.eq.${conv.cliente_id}`) : q.eq('conversa_id', conv.id);
        const { data, error } = await q;
        if (error) throw error;
        if (g !== geracaoFicha || conversaAtual?.id !== conv.id) return;
        FICHA = data || [];
      } catch { FICHA = []; }
    } else {
      // o que mudou aqui (concluir, criar) aparece sem nova busca
      const ids = new Set(FICHA.map(t => t.id));
      [...MINHAS, ...FEITAS, ...DA_EQUIPE].forEach(t => {
        if ((t.conversa_id === conv.id || (conv.cliente_id && t.cliente_id === conv.cliente_id)) && !ids.has(t.id)) FICHA.unshift(t);
      });
    }
    const abertas = FICHA.filter(t => t.status === 'aberta'), feitas = FICHA.filter(t => t.status === 'feita');
    el.hidden = false;
    el.innerHTML = `<div class="ft-topo"><h4>✓ Tarefas${abertas.length ? ` <b>${abertas.length}</b>` : ''}</h4>
        <button type="button" class="btn btn-ghost sm" data-tf-nova="conversa" title="Nova tarefa ligada a este cliente (Alt+T)">+ Tarefa</button></div>
      ${abertas.length ? abertas.map(t => linhaTarefa(t, { compacta: true })).join('') : '<p class="ft-vazio">Nenhuma tarefa aberta para este cliente.</p>'}
      ${feitas.length ? `<details class="ft-feitas"><summary>${feitas.length} feita${feitas.length > 1 ? 's' : ''}</summary>${feitas.slice(0, 5).map(t => linhaTarefa(t, { compacta: true })).join('')}</details>` : ''}`;
  }

  /* ---------------- Nova tarefa ---------------- */
  const paraLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  function prazoRapido(chave) {
    const d = new Date();
    if (chave === 'hoje17') { d.setHours(17, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); }
    else if (chave === 'amanha9') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
    else if (chave === '2dias') { d.setDate(d.getDate() + 2); d.setHours(9, 0, 0, 0); }
    else if (chave === 'semana') { d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); }
    else return '';
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);   // domingo a oficina não abre
    return paraLocal(d);
  }
  function abrirNova({ daConversa = false, titulo = '', responsavel = null } = {}) {
    const conv = daConversa ? conversaAtual : null;
    if (daConversa && !conv) return toast('Abra uma conversa primeiro.');
    novaCtx = conv ? { conversa_id: conv.id, cliente_id: conv.cliente_id || null, nome: tituloDaConversa(conv) } : null;
    const f = $('#formTarefa');
    f.reset();
    $('#tarefaErro').hidden = true;
    $('#tarefaLigada').hidden = !novaCtx;
    $('#tarefaLigada').innerHTML = novaCtx ? `Ligada a <b>${esc(novaCtx.nome)}</b> — aparece na ficha do cliente.` : '';
    const podeOutros = ehGestor();
    $('#tarefaResponsavel').disabled = !podeOutros;
    $('#tarefaResponsavel').title = podeOutros ? '' : 'Tarefa para outra pessoa: peça ao gestor (ou crie para você)';
    $('#tarefaResponsavel').innerHTML = colegas().filter(p => podeOutros || p.id === eu()).map(p => `<option value="${esc(p.id)}">${esc(p.nome)}${p.id === eu() ? ' (você)' : ''}</option>`).join('');
    $('#tarefaResponsavel').value = responsavel || eu();
    f.titulo.value = titulo;
    f.titulo.placeholder = novaCtx ? `Ex.: Ligar para ${primeiroNome(novaCtx.nome)} confirmando o horário` : 'Ex.: Conferir peças do pedido';
    $('#tarefaPrazo').value = prazoRapido('hoje17');
    $$('#tarefaPrazosRapidos .chip').forEach(c => c.classList.toggle('ativo', c.dataset.prazo === 'hoje17'));
    abrirModal('modalTarefaBg', '#formTarefa [name=titulo]');
  }
  async function salvarNova(e) {
    e.preventDefault();
    const f = e.target, erro = $('#tarefaErro'), btn = $('#btnSalvarTarefa');
    const titulo = f.titulo.value.trim();
    if (!titulo) { erro.textContent = 'Escreva o que precisa ser feito.'; erro.hidden = false; return f.titulo.focus(); }
    const prazo = f.vence_em.value ? new Date(f.vence_em.value) : null;
    if (prazo && isNaN(prazo)) { erro.textContent = 'Prazo inválido.'; erro.hidden = false; return; }
    const linha = { titulo, descricao: f.descricao.value.trim() || null, responsavel_id: f.responsavel_id.value || eu(),
      prioridade: Number(f.prioridade.value) || 2, vence_em: prazo ? prazo.toISOString() : null, status: 'aberta',
      origem: novaCtx ? 'atendimento' : 'manual', conversa_id: novaCtx?.conversa_id || null, cliente_id: novaCtx?.cliente_id || null };
    btn.disabled = true; btn.textContent = 'Criando…';
    try {
      /* Pelo servidor (valida responsável e prazo e registra na auditoria); sem a rota,
         direto no banco — o RLS deixa a equipe criar. */
      let data = null;
      const r = await fetch('/api/tarefas', { method: 'POST', headers: await authCabecalhos(), body: JSON.stringify(linha) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 && !j.codigo) {
        const ins = await sb.from('tarefas').insert(linha).select('*').single();
        if (ins.error) throw ins.error;
        data = ins.data;
      } else if (!r.ok || j.ok === false) {
        if (j.campo && f[j.campo]) f[j.campo].focus?.();
        throw new Error(j.erro || `o servidor respondeu ${r.status}`);
      } else data = { ...linha, criado_por: eu(), ...(j.tarefa || {}) };
      const nova = data || { ...linha, id: 'local' + Date.now(), criado_por: eu() };
      if (!nova.criado_por) nova.criado_por = eu();
      if (!MINHAS.some(t => t.id === nova.id) && (nova.responsavel_id === eu() || nova.criado_por === eu())) MINHAS.push(nova);
      if (novaCtx && !FICHA.some(t => t.id === nova.id)) FICHA.unshift(nova);
      fecharModal('modalTarefaBg');
      toast(nova.responsavel_id === eu() ? '✓ Tarefa criada' : `✓ Tarefa passada para ${primeiroNome(nomeDe(nova.responsavel_id))} — ela recebe o aviso no sino`, 'ok');
      pintarBadges(); renderTarefas(); renderFichaTarefas();
    } catch (err) {
      erro.textContent = 'Não consegui criar: ' + err.message;
      erro.hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Criar tarefa'; }
  }

  /* ---------------- Transferir conversa com motivo ---------------- */
  async function sincronizarDono(id) {
    try {
      const { data } = await sb.from('conversas').select('id,atribuida_a').eq('id', id).maybeSingle();
      if (data && conversaAtual?.id === id) { conversaAtual.atribuida_a = data.atribuida_a; renderDonoDoChat(); renderBotaoAssumir(); }
    } catch { /* ignora */ }
  }
  function abrirTransferir(conv = conversaAtual, para = null) {
    if (!conv) return toast('Abra uma conversa primeiro.');
    // atendente só passa o que é dele (ou sem dono); conversa de colega, só o gestor
    if (!ehGestor() && conv.atribuida_a && conv.atribuida_a !== eu()) return toast(`Esta conversa é de ${primeiroNome(nomeDe(conv.atribuida_a))}. Só ela ou o gestor podem passar para outra pessoa.`);
    transf = { conv, para };
    const lista = colegas().filter(p => p.id !== eu() || conv.atribuida_a !== eu());
    const contagem = (id) => CONVERSAS.filter(c => c.atribuida_a === id && !c.desfecho).length;
    $('#transferirSub').innerHTML = `<b>${esc(tituloDaConversa(conv))}</b> — hoje com ${conv.atribuida_a ? esc(nomeDe(conv.atribuida_a)) : 'ninguém'}.`;
    $('#transferirColegas').innerHTML = lista.filter(p => p.id !== conv.atribuida_a).map(p => `
      <label class="colega${p.id === para ? ' ativo' : ''}">
        <input type="radio" name="para" value="${esc(p.id)}" ${p.id === para ? 'checked' : ''} />
        ${miniAvatar(p.id, p.nome)}
        <span class="cl-nome"><b>${esc(p.nome)}${p.id === eu() ? ' (você)' : ''}</b><small>${esc(rotuloPapel(p.papel))}${p.recebe_leads === false ? ' · fora do rodízio' : ''}</small></span>
        <span class="cl-carga" title="Conversas com essa pessoa entre as carregadas">💬 ${contagem(p.id)}</span>
      </label>`).join('') || '<p class="ft-vazio">Não há colegas com acesso ao Atendimento.</p>';
    $('#transferirMotivo').value = '';
    $('#transferirErro').hidden = true;
    $('#btnTransferirOk').disabled = !para;
    $$('#transferirMotivos .chip').forEach(c => c.classList.remove('ativo'));
    abrirModal('modalTransferirBg', para ? '#transferirMotivo' : '#transferirColegas input');
  }
  async function confirmarTransferir(e) {
    e.preventDefault();
    const para = $('#formTransferir').querySelector('input[name=para]:checked')?.value;
    const motivo = $('#transferirMotivo').value.trim();
    const { conv } = transf || {};
    const erro = $('#transferirErro'), btn = $('#btnTransferirOk');
    if (!conv || !para) { erro.textContent = 'Escolha para quem.'; erro.hidden = false; return; }
    if (motivo.length < 3) { erro.textContent = 'Diga o motivo (a pessoa recebe junto com o aviso).'; erro.hidden = false; return $('#transferirMotivo').focus(); }
    btn.disabled = true; btn.textContent = 'Transferindo…';
    try {
      const r = await fetch(`/api/conversas/${encodeURIComponent(conv.id)}/transferir`, {
        method: 'POST', headers: await authCabecalhos(), body: JSON.stringify({ para, motivo }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 && /rota/i.test(j.erro || '')) {
        // servidor sem a rota nova: troca o dono do jeito antigo (sem o motivo)
        fecharModal('modalTransferirBg');
        await trocarDono(conv, para);
        toast('↪ Passou — mas o motivo não foi registrado (o servidor ainda não tem a transferência nova).');
        return;
      }
      if (!r.ok || j.ok === false) {
        // alguém mexeu no dono agora mesmo: recarrega para mostrar quem está com ela
        if (j.codigo === 'mudou_no_meio' || j.codigo === 'mesmo_dono') { agendarRecargaLista(); setTimeout(() => sincronizarDono(conv.id), 300); }
        throw new Error(j.erro || `o servidor respondeu ${r.status}`);
      }
      conv.atribuida_a = para;
      if (conversaAtual?.id === conv.id) { conversaAtual.atribuida_a = para; renderDonoDoChat(); renderBotaoAssumir(); }
      renderConversas();
      fecharModal('modalTransferirBg');
      toast(`↪ Conversa passada para ${primeiroNome(nomeDe(para))}${motivo ? ' com o motivo' : ''} — ela foi avisada no sino.`, 'ok');
      agendarRecargaLista();
    } catch (err) {
      erro.textContent = 'Não consegui transferir: ' + err.message;
      erro.hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Transferir'; }
  }

  /* ---------------- Presença: quem está vendo esta conversa ---------------- */
  function sairDaPresenca() {
    if (!canalPresenca) return;
    const c = canalPresenca;
    canalPresenca = null; presencaConv = null;
    try { c.untrack?.(); } catch { /* ignora */ }
    try { sb.removeChannel(c); } catch { /* ignora */ }
    $('#chatPresenca').hidden = true;
    $('#chatPresenca').innerHTML = '';
  }
  function meuEstado(extra = {}) {
    return { id: eu(), nome: perfil.nome, cor: corDaPessoa(eu(), perfil), desde: new Date().toISOString(), ...extra };
  }
  function entrarNaPresenca(convId) {
    if (presencaConv === convId) return;
    sairDaPresenca();
    if (!convId || typeof sb.channel !== 'function') return;
    presencaConv = convId;
    const c = sb.channel(`conversa:${convId}`, { config: { presence: { key: eu() } } });
    canalPresenca = c;
    c.on('presence', { event: 'sync' }, () => pintarPresenca(c))
      .subscribe((status) => { if (status === 'SUBSCRIBED' && canalPresenca === c) c.track(meuEstado()); });
  }
  function pintarPresenca(c) {
    if (c !== canalPresenca) return;
    let estado = {};
    try { estado = c.presenceState() || {}; } catch { estado = {}; }
    const outros = Object.entries(estado).filter(([k]) => k !== eu()).map(([, metas]) => metas?.[metas.length - 1]).filter(Boolean);
    const el = $('#chatPresenca');
    if (!outros.length) { el.hidden = true; el.innerHTML = ''; return; }
    const digitando = outros.filter(o => o.digitando);
    const nomes = outros.map(o => primeiroNome(o.nome || 'Alguém'));
    const txt = digitando.length
      ? `${digitando.map(o => primeiroNome(o.nome)).join(' e ')} ${digitando.length > 1 ? 'estão' : 'está'} digitando…`
      : nomes.length === 1 ? `${nomes[0]} também está aqui` : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)} também estão aqui`;
    el.hidden = false;
    el.classList.toggle('digitando', !!digitando.length);
    el.title = `Com esta conversa aberta agora: ${outros.map(o => o.nome).join(', ')} — combine quem responde para o cliente não receber duas respostas.`;
    el.innerHTML = `<span class="pr-avatares">${outros.slice(0, 3).map(o => `<span class="avatar mini" style="background:${/^#[0-9a-f]{6}$/i.test(o.cor || '') ? o.cor : corDoDono(o.id || '')}">${esc(iniciais(o.nome))}</span>`).join('')}</span>
      <span class="pr-txt">👀 ${esc(txt)}</span>`;
  }
  function avisarDigitando() {
    if (!canalPresenca || Date.now() - ultimoTrack < 2500) return;
    ultimoTrack = Date.now();
    try { canalPresenca.track(meuEstado({ digitando: true })); } catch { /* ignora */ }
    clearTimeout(digitandoT);
    digitandoT = setTimeout(() => { try { canalPresenca?.track(meuEstado()); } catch { /* ignora */ } ultimoTrack = 0; }, 4000);
  }

  function aoTrocarConversa(convId) {
    entrarNaPresenca(convId);
    FICHA = [];
    if (convId) renderFichaTarefas({ buscar: true }); else $('#fichaTarefas').hidden = true;
  }

  /* ---------------- Tempo real pessoal ---------------- */
  function ligarTempoRealPessoal() {
    if (typeof sb.channel !== 'function') return;
    canalPessoal = sb.channel(`pessoal:${eu()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificacoes', filter: `perfil_id=eq.${eu()}` }, (p) => chegouNotificacao(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notificacoes', filter: `perfil_id=eq.${eu()}` }, (p) => {
        const n = NOTIFS.find(x => x.id === p.new?.id); if (n) { Object.assign(n, p.new); pintarSino(); }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notificacoes' }, (p) => {
        const id = p.old?.id; if (id) { NOTIFS = NOTIFS.filter(x => x.id !== id); pintarSino(); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tarefas' }, (p) => {
        const t = p.new && p.new.id ? p.new : p.old || {};
        const minha = [t.responsavel_id, t.criado_por].includes(eu());
        const daFicha = conversaAtual && (t.conversa_id === conversaAtual.id || (conversaAtual.cliente_id && t.cliente_id === conversaAtual.cliente_id));
        if (minha || ver === 'equipe') agendarRecarga();
        if (daFicha) setTimeout(() => renderFichaTarefas({ buscar: true }), 450);
      })
      .subscribe();
  }

  /* ---------------- Ligações ---------------- */
  function ligar() {
    $('#btnSino').addEventListener('click', (e) => { e.stopPropagation(); $('#painelSino').hidden ? abrirSino() : fecharSino(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#painelSino') && !e.target.closest('#btnSino')) fecharSino(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#painelSino').hidden) { fecharSino(); $('#btnSino').focus(); } });
    window.addEventListener('resize', fecharSino);
    $('#sinoLista').addEventListener('click', (e) => {
      const b = e.target.closest('[data-notif]');
      if (!b) return;
      const n = NOTIFS.find(x => x.id === b.dataset.notif);
      if (!n) return;
      if (!n.lida_em) marcarLidas([n.id]);
      fecharSino();
      abrirLink(n);
    });
    $$('[data-sino-ver]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      verSino = b.dataset.sinoVer;
      $$('[data-sino-ver]').forEach(x => { const on = x === b; x.classList.toggle('ativo', on); x.setAttribute('aria-selected', String(on)); });
      renderSino();
    }));
    $('#btnSinoTodas').addEventListener('click', (e) => {
      e.stopPropagation();
      const ids = NOTIFS.filter(n => !n.lida_em).map(n => n.id);
      if (ids.length) { marcarLidas(ids); toast('✓ Tudo lido'); }
    });
    $('#btnSinoTarefas').addEventListener('click', () => { fecharSino(); irParaTarefas(); });

    $$('[data-tarefas-ver]').forEach(b => b.addEventListener('click', () => {
      ver = b.dataset.tarefasVer;
      filtroPessoa = '';
      $$('[data-tarefas-ver]').forEach(x => { const on = x === b; x.classList.toggle('ativo', on); x.setAttribute('aria-pressed', String(on)); });
      renderTarefas();
      if (ver === 'equipe') carregarEquipe();
    }));
    let tb = null;
    $('#tarefasBusca').addEventListener('input', (e) => { clearTimeout(tb); tb = setTimeout(() => { busca = e.target.value; renderTarefas(); }, 120); });
    $('#cargaEquipe').addEventListener('click', (e) => {
      const b = e.target.closest('[data-carga-pessoa]');
      if (!b) return;
      filtroPessoa = filtroPessoa === b.dataset.cargaPessoa ? '' : b.dataset.cargaPessoa;
      $$('#cargaEquipe [data-carga-pessoa]').forEach(x => { const on = x.dataset.cargaPessoa === filtroPessoa; x.classList.toggle('ativa', on); x.setAttribute('aria-pressed', String(on)); });
      renderTarefas();
    });
    $('#listaTarefas').addEventListener('click', cliqueEmTarefa);
    $('#fichaTarefas').addEventListener('click', cliqueEmTarefa);
    $('#btnNovaTarefa').addEventListener('click', () => abrirNova());
    $('#btnNovaTarefaChat').addEventListener('click', () => { $('#menuMaisAcoes').hidden = true; $('#btnMaisAcoes')?.setAttribute('aria-expanded', 'false'); abrirNova({ daConversa: true }); });
    $('#btnTransferir').addEventListener('click', () => { $('#menuMaisAcoes').hidden = true; $('#btnMaisAcoes')?.setAttribute('aria-expanded', 'false'); abrirTransferir(); });
    $('#formTarefa').addEventListener('submit', salvarNova);
    $('#tarefaPrazosRapidos').addEventListener('click', (e) => {
      const c = e.target.closest('[data-prazo]');
      if (!c) return;
      $('#tarefaPrazo').value = prazoRapido(c.dataset.prazo);
      $$('#tarefaPrazosRapidos .chip').forEach(x => x.classList.toggle('ativo', x === c));
    });
    $('#tarefaPrazo').addEventListener('input', () => $$('#tarefaPrazosRapidos .chip').forEach(x => x.classList.remove('ativo')));
    $('#formTransferir').addEventListener('submit', confirmarTransferir);
    $('#transferirColegas').addEventListener('change', () => {
      $$('#transferirColegas .colega').forEach(l => l.classList.toggle('ativo', l.querySelector('input').checked));
      $('#btnTransferirOk').disabled = false;
    });
    $('#transferirMotivos').addEventListener('click', (e) => {
      const c = e.target.closest('[data-motivo]');
      if (!c) return;
      $('#transferirMotivo').value = c.dataset.motivo;
      $$('#transferirMotivos .chip').forEach(x => x.classList.toggle('ativo', x === c));
    });
    // a conversa trocou (contrato do app.js com o copiloto): presença + tarefas da ficha
    window.addEventListener('indycar:conversa', (e) => aoTrocarConversa(e.detail?.conversaId || null));
    campo?.addEventListener('input', () => { if (campo.value.trim()) avisarDigitando(); });
  }

  return { iniciar, parar, abrirAba, abrirNova, abrirTransferir, recarregar: carregarTarefas,
    get notificacoes() { return NOTIFS; }, get tarefas() { return MINHAS; } };
})();
