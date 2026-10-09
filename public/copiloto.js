/* ============================================================
   COPILOTO DA IA — painel que se pluga na tela do atendimento.
   Não depende do código interno do app.js. Contrato:
   - ouve  window 'indycar:conversa'  {conversaId, clienteId, telefone, nome} (conversaId null = fechou)
   - ouve  window 'indycar:mensagem'  {conversaId, direcao}
   - ouve  window 'indycar:copiloto-abrir' e 'indycar:pronto' (opcionais)
   - usa   window.IndyCar = { authCabecalhos(), toast(msg,tipo), inserirNoCampo(texto),
                              recarregarFicha(), recarregarConversa(), papel, conversa? }
   - desenha em  <section id="copilotoSlot">; sem o slot, abre um painel flutuante.
   Se nada disso existir, não quebra nada: só fica quieto.
   ============================================================ */
(function () {
  'use strict';
  if (window.__copilotoIndyCar) return;              // carregado duas vezes? ignora
  window.__copilotoIndyCar = true;

  /* ---------------- utilidades ---------------- */
  const esc = v => String(v ?? '').replace(/[&<>"'`=\/]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    "'": '&#39;', '`': '&#96;', '=': '&#61;', '/': '&#47;' }[c]));
  const ehUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  const API = () => window.IndyCar || {};
  const DEBOUNCE_MS = 6000;          // espera o cliente terminar de digitar várias mensagens
  const INTERVALO_MIN_MS = 45000;    // no máximo uma atualização automática a cada 45 s por conversa
  const CHAVE_AUTO = 'indycar_copiloto_auto';

  async function cabecalhos() {
    try { if (typeof API().authCabecalhos === 'function') return await API().authCabecalhos(); } catch { /* reserva abaixo */ }
    // reserva: token do supabase-js guardado no navegador
    const h = { 'Content-Type': 'application/json' };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k)) {
          const t = JSON.parse(localStorage.getItem(k) || '{}').access_token;
          if (t) h.Authorization = `Bearer ${t}`;
        }
      }
    } catch { /* sem armazenamento */ }
    return h;
  }
  function avisar(msg, tipo) {
    try { if (typeof API().toast === 'function') return API().toast(msg, tipo); } catch { /* reserva */ }
    const el = document.createElement('div');
    el.className = 'cop-toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  async function noCampo(texto) {
    try { if (typeof API().inserirNoCampo === 'function' && API().inserirNoCampo(texto) !== false) return true; } catch { /* reserva */ }
    try { await navigator.clipboard.writeText(texto); avisar('Texto copiado — cole no campo da mensagem.'); return true; }
    catch { avisar('Não consegui pôr o texto no campo.'); return false; }
  }
  const recarregar = async () => {
    try { await API().recarregarFicha?.(); } catch { /* ignora */ }
    try { await API().recarregarConversa?.(); } catch { /* ignora */ }
  };

  async function pedir(metodo, url, corpo, sinal) {
    const r = await fetch(url, { method: metodo, headers: await cabecalhos(), body: corpo ? JSON.stringify(corpo) : undefined, signal: sinal });
    let j = {};
    try { j = await r.json(); } catch { /* resposta sem JSON */ }
    if (!r.ok || j.ok === false) {
      const e = new Error(j.erro || (r.status === 401 ? 'Sua sessão expirou — entre de novo.' : `Erro ${r.status}`));
      e.status = r.status;
      throw e;
    }
    return j;
  }

  /* ---------------- estado ---------------- */
  const S = {
    conversa: null,           // {conversaId, nome, …}
    resultado: new Map(),     // conversaId -> último resultado do copiloto
    historico: [],
    uso: null,
    carregando: false,
    erro: '',
    controlador: null,
    timer: null,
    ultimaAuto: new Map(),    // conversaId -> quando rodou sozinho
    confirmacao: null,        // texto de confirmação depois de agendar
    ocupado: new Set(),       // ids de ação com clique em andamento
  };
  const auto = () => { try { return localStorage.getItem(CHAVE_AUTO) !== '0'; } catch { return true; } };

  /* ---------------- onde desenhar ---------------- */
  let raiz = null, flutuante = null;
  function alvo() {
    const slot = document.getElementById('copilotoSlot');
    if (slot) {
      if (flutuante) { flutuante.remove(); flutuante = null; }
      if (!slot.querySelector('.cop')) { slot.innerHTML = '<div class="cop"></div>'; }
      raiz = slot.querySelector('.cop');
      return raiz;
    }
    // reserva: painel flutuante recolhível
    if (!flutuante) {
      flutuante = document.createElement('div');
      flutuante.className = 'cop-flutuante';
      flutuante.innerHTML = '<button type="button" class="cop-fab" aria-expanded="false" aria-controls="copFlutuantePainel" aria-label="Abrir o copiloto da IA">✨</button>'
        + '<div class="cop-painel" id="copFlutuantePainel" role="dialog" aria-label="Copiloto da IA" hidden><div class="cop"></div></div>';
      document.body.appendChild(flutuante);
      const fab = flutuante.querySelector('.cop-fab'), painel = flutuante.querySelector('.cop-painel');
      fab.addEventListener('click', () => { const abrir = painel.hidden; painel.hidden = !abrir; fab.setAttribute('aria-expanded', String(abrir)); if (abrir) painel.querySelector('button')?.focus(); });
      painel.addEventListener('keydown', e => { if (e.key === 'Escape') { painel.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.focus(); } });
    }
    flutuante.hidden = !S.conversa;
    raiz = flutuante.querySelector('.cop');
    return raiz;
  }

  /* ---------------- desenho ---------------- */
  const TIPOS = {
    agendar: ['📅', 'Agendar'], remarcar: ['🔁', 'Remarcar'], cancelar_agendamento: ['✖', 'Cancelar horário'],
    mover_etapa: ['🏷', 'Etapa do funil'], atualizar_ficha: ['📝', 'Completar ficha'], registrar_interesse: ['🧾', 'Pedido de orçamento'],
    marcar_aguardando_consultor: ['⏳', 'Aguardando consultor'], agendar_retorno: ['🔔', 'Chamar de novo'],
    responder: ['💬', 'Resposta'], resumir: ['🗒', 'Resumo'], classificar: ['🎯', 'Classificação'], copiloto: ['✨', 'Consulta ao copiloto'],
    sugerir: ['✨', 'Sugestão'], classificar_etapa: ['🏷', 'Etapa automática'], resumo_do_dia: ['📋', 'Resumo do dia'], config: ['⚙', 'Configuração'],
  };
  const STATUS = { proposta: 'aguardando você', executada: 'feito', recusada: 'recusado', erro: 'deu erro', desfeita: 'desfeito' };
  const TEMP = { quente: ['🔥', 'Quente'], morno: ['🌤', 'Morno'], frio: ['❄', 'Frio'] };
  const INTENCAO = { agendar: 'Quer agendar', orcamento: 'Quer orçamento', duvida: 'Dúvida', reclamacao: 'Reclamação', remarcar: 'Quer remarcar',
    cancelar: 'Quer cancelar', retorno: 'Retorno', pos_venda: 'Pós-venda', saudacao: 'Só cumprimentou', outro: 'Outro assunto' };

  function hora(iso) {
    try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  }

  function detalhes(a) {
    const p = a.parametros || a.entrada || {};
    const linhas = [];
    if (a.tipo === 'atualizar_ficha' && p.avisos?.length) linhas.push(`Ignorado: ${p.avisos.join('; ')}`);
    if (a.tipo === 'registrar_interesse' && p.aviso) linhas.push(p.aviso);
    if (a.tipo === 'agendar_retorno' && p.texto) linhas.push(`Texto: “${p.texto}”`);
    if (p.motivo) linhas.push(`Motivo: ${p.motivo}`);
    if (p.observacoes) linhas.push(`Obs.: ${p.observacoes}`);
    return linhas.map(l => `<p class="cop-acao-det">${esc(l)}</p>`).join('');
  }

  function cartaoAcao(a, { compacto = false } = {}) {
    const [ico, nome] = TIPOS[a.tipo] || ['•', a.tipo];
    const autonomia = S.uso?.autonomia || S.resultado.get(S.conversa?.conversaId)?.autonomia || 'confirmar';
    const ocupado = S.ocupado.has(a.id);
    const botoes = [];
    if (a.status === 'proposta' && a.tipo !== 'responder') {
      if (autonomia !== 'sugerir') botoes.push(`<button type="button" class="cop-btn cop-btn-sim" data-acao="executar" data-id="${esc(a.id)}" ${ocupado ? 'disabled' : ''} aria-label="Executar: ${esc(a.resumo)}">Executar</button>`);
      botoes.push(`<button type="button" class="cop-btn" data-acao="recusar" data-id="${esc(a.id)}" ${ocupado ? 'disabled' : ''} aria-label="Recusar: ${esc(a.resumo)}">Recusar</button>`);
    }
    if (a.status === 'executada' && (a.reversivel || a.reversivel === undefined && ['agendar', 'remarcar', 'cancelar_agendamento', 'mover_etapa', 'atualizar_ficha', 'registrar_interesse', 'marcar_aguardando_consultor', 'agendar_retorno'].includes(a.tipo))) {
      botoes.push(`<button type="button" class="cop-btn" data-acao="desfazer" data-id="${esc(a.id)}" ${ocupado ? 'disabled' : ''} aria-label="Desfazer: ${esc(a.resumo)}">↶ Desfazer</button>`);
    }
    return `<li class="cop-acao st-${esc(a.status)}${compacto ? ' compacto' : ''}">
      <div class="cop-acao-topo"><span class="cop-acao-ico" aria-hidden="true">${esc(ico)}</span>
        <span class="cop-acao-tipo">${esc(nome)}</span>
        <span class="cop-st">${esc(a.automatica ? 'feito sozinho' : (STATUS[a.status] || a.status))}</span>
        ${compacto && a.created_at ? `<span class="cop-hora">${esc(hora(a.created_at))}</span>` : ''}</div>
      <p class="cop-acao-resumo">${esc(a.resumo || '')}</p>
      ${compacto ? '' : detalhes(a)}
      ${a.erro ? `<p class="cop-acao-erro">${esc(a.erro)}</p>` : ''}
      ${a.precisa_clique && a.status === 'proposta' && autonomia === 'automatico' ? '<p class="cop-acao-det">Esta sempre pede o seu clique.</p>' : ''}
      ${botoes.length ? `<div class="cop-acao-botoes">${botoes.join('')}</div>` : ''}
    </li>`;
  }

  function desenhar() {
    const el = alvo();
    if (!el) return;
    if (!S.conversa?.conversaId) { el.innerHTML = ''; return; }
    const r = S.resultado.get(S.conversa.conversaId);
    const uso = S.uso;
    const pouco = uso && uso.limite && uso.restante <= Math.max(5, uso.limite * 0.1);
    const tEmp = r?.temperatura && TEMP[r.temperatura];
    const papelSugerir = (uso?.autonomia || r?.autonomia) === 'sugerir';
    const hist = S.historico.filter(a => !['copiloto', 'classificar', 'resumir', 'sugerir', 'classificar_etapa'].includes(a.tipo)).slice(0, 15);

    el.innerHTML = `
      <header class="cop-cab">
        <h2 class="cop-titulo"><span aria-hidden="true">✨</span> Copiloto</h2>
        ${uso ? `<span class="cop-uso${pouco ? ' pouco' : ''}" title="Chamadas à IA hoje (todas as pessoas)">${esc(uso.chamadas)}/${esc(uso.limite)} hoje</span>` : ''}
        ${uso && !uso.ativo ? '<span class="cop-uso pouco">IA desligada</span>' : ''}
      </header>
      ${pouco ? `<p class="cop-aviso" role="note">Restam ${esc(uso.restante)} chamadas à IA hoje.</p>` : ''}
      ${papelSugerir ? '<p class="cop-aviso suave">Modo “só sugerir”: o copiloto mostra, você faz pela tela.</p>' : ''}
      <div class="cop-pedir">
        <button type="button" class="cop-principal" data-acao="rodar" ${S.carregando ? 'disabled aria-busy="true"' : ''}>
          ${S.carregando ? '<span class="cop-gira" aria-hidden="true"></span> Lendo a ficha toda…' : (r ? '↻ O que fazer agora?' : '✨ O que fazer agora?')}
        </button>
        <details class="cop-mais"${S.pedidoAberto ? ' open' : ''}>
          <summary>Pedir algo específico</summary>
          <form class="cop-form" data-acao="pedido">
            <label class="cop-rot" for="copPedido">O que você quer que a IA faça?</label>
            <textarea id="copPedido" rows="2" maxlength="800" placeholder="ex.: oferece leva e traz · registra orçamento de 380 de pastilha">${esc(S.pedido || '')}</textarea>
            <button type="submit" class="cop-btn cop-btn-sim" ${S.carregando ? 'disabled' : ''}>Pedir</button>
          </form>
        </details>
        <label class="cop-auto"><input type="checkbox" data-acao="auto" ${auto() ? 'checked' : ''}> Atualizar quando o cliente escrever</label>
      </div>
      <div class="cop-saida" aria-live="polite">
        ${S.erro ? `<p class="cop-erro" role="alert">${esc(S.erro)}</p>` : ''}
        ${S.carregando && !r ? '<div class="cop-esqueleto" aria-hidden="true"><i></i><i></i><i></i></div>' : ''}
        ${r ? `
          <div class="cop-chips">
            ${tEmp ? `<span class="cop-chip temp-${esc(r.temperatura)}" title="${esc(r.motivo_classificacao || '')}"><span aria-hidden="true">${esc(tEmp[0])}</span> ${esc(tEmp[1])}</span>` : ''}
            ${r.intencao ? `<span class="cop-chip">${esc(INTENCAO[r.intencao] || r.intencao)}</span>` : ''}
            ${r.atualizadoEm ? `<span class="cop-hora">às ${esc(hora(r.atualizadoEm))}${r.auto ? ' · sozinho' : ''}</span>` : ''}
          </div>
          ${r.resumo ? `<p class="cop-resumo">${esc(r.resumo).replace(/\n/g, '<br>')}</p>` : ''}
          ${r.pendencias?.length ? `<ul class="cop-pend" aria-label="Pendências">${r.pendencias.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
          ${r.resposta_sugerida ? `
            <div class="cop-resposta">
              <p class="cop-rot">Resposta sugerida</p>
              <p class="cop-resposta-txt">${esc(r.resposta_sugerida).replace(/\n/g, '<br>')}</p>
              <div class="cop-acao-botoes">
                <button type="button" class="cop-btn cop-btn-sim" data-acao="usar">Usar no campo</button>
                <button type="button" class="cop-btn" data-acao="copiar">Copiar</button>
              </div>
            </div>` : ''}
          ${S.confirmacao ? `
            <div class="cop-resposta conf">
              <p class="cop-rot">Confirmação do horário</p>
              <p class="cop-resposta-txt">${esc(S.confirmacao).replace(/\n/g, '<br>')}</p>
              <div class="cop-acao-botoes"><button type="button" class="cop-btn cop-btn-sim" data-acao="usar-conf">Usar no campo</button></div>
            </div>` : ''}
          ${r.horarios_sugeridos?.length ? `
            <div class="cop-horarios">
              <p class="cop-rot">Horários livres</p>
              <div class="cop-chips">${r.horarios_sugeridos.map((h, i) => `<button type="button" class="cop-chip cop-horario" data-acao="horario" data-i="${i}" aria-label="Oferecer ${esc(h.rotulo)}">${esc(h.rotulo)}</button>`).join('')}
                ${r.horarios_sugeridos.length > 1 ? '<button type="button" class="cop-chip cop-horario" data-acao="horarios-ambos">As duas opções</button>' : ''}</div>
            </div>` : ''}
          ${r.acoes?.length ? `<ul class="cop-acoes" aria-label="Ações propostas">${r.acoes.map(a => cartaoAcao(a)).join('')}</ul>`
            : (r.resposta_sugerida || r.resumo ? '' : '<p class="cop-vazio">Nada a propor agora.</p>')}
        ` : (!S.carregando && !S.erro ? '<p class="cop-vazio">A IA lê a conversa, o CRM, a Agenda, os orçamentos e o Comunicar — e diz o que fazer.</p>' : '')}
      </div>
      ${hist.length ? `
        <details class="cop-hist"${S.histAberto ? ' open' : ''}>
          <summary>Histórico desta conversa (${hist.length})</summary>
          <ul class="cop-acoes">${hist.map(a => cartaoAcao({ ...a, resumo: a.resumo }, { compacto: true })).join('')}</ul>
        </details>` : ''}
    `;
  }

  /* ---------------- dados ---------------- */
  async function carregarUso() {
    try { const j = await pedir('GET', '/api/ia/uso'); S.uso = j; } catch { /* sem uso: segue */ }
  }
  async function carregarHistorico() {
    const id = S.conversa?.conversaId;
    if (!ehUuid(id)) return;
    try {
      const j = await pedir('GET', `/api/ia/acoes?conversaId=${encodeURIComponent(id)}&limite=40`);
      if (S.conversa?.conversaId === id) S.historico = j.acoes || [];
    } catch { /* histórico é extra */ }
  }

  async function rodar({ pedido = '', automatico = false } = {}) {
    const id = S.conversa?.conversaId;
    if (!ehUuid(id) || S.carregando) return;
    S.controlador?.abort();
    const ctrl = new AbortController();
    S.controlador = ctrl;
    S.carregando = true; S.erro = ''; S.confirmacao = null;
    desenhar();
    try {
      const j = await pedir('POST', '/api/ia/copiloto', { conversaId: id, pedido: pedido || undefined }, ctrl.signal);
      if (S.conversa?.conversaId !== id) return;          // trocou de conversa no meio: descarta
      S.resultado.set(id, { ...j, atualizadoEm: new Date().toISOString(), auto: automatico });
      if (j.uso && S.uso) { S.uso.chamadas = j.uso.chamadas; S.uso.restante = Math.max(0, (j.uso.limite || S.uso.limite) - j.uso.chamadas); }
      if (j.acoes?.some(a => a.automatica)) recarregar();
      carregarHistorico().then(desenhar);
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (S.conversa?.conversaId === id) S.erro = e.message || 'O copiloto não respondeu.';
    } finally {
      if (S.controlador === ctrl) { S.carregando = false; S.controlador = null; }
      if (S.conversa?.conversaId === id) desenhar();
    }
  }

  async function agir(tipo, idAcao) {
    if (!ehUuid(idAcao) || S.ocupado.has(idAcao)) return;
    S.ocupado.add(idAcao); desenhar();
    try {
      const j = await pedir('POST', `/api/ia/acoes/${encodeURIComponent(idAcao)}/${tipo}`, tipo === 'recusar' ? {} : undefined);
      const r = S.resultado.get(S.conversa?.conversaId);
      const a = r?.acoes?.find(x => x.id === idAcao);
      if (a) { a.status = tipo === 'executar' ? 'executada' : tipo === 'recusar' ? 'recusada' : 'desfeita'; a.erro = null; }
      if (tipo === 'executar' && j.texto_confirmacao) S.confirmacao = j.texto_confirmacao;
      avisar(j.mensagem || (tipo === 'recusar' ? 'Recusado.' : 'Feito.'), 'ok');
      if (tipo !== 'recusar') await recarregar();
      await Promise.all([carregarHistorico(), carregarUso()]);
    } catch (e) {
      avisar('⚠️ ' + (e.message || 'Não deu certo.'), 'erro');
      const r = S.resultado.get(S.conversa?.conversaId);
      const a = r?.acoes?.find(x => x.id === idAcao);
      if (a && e.status === 409) a.erro = e.message;
    } finally {
      S.ocupado.delete(idAcao);
      desenhar();
    }
  }

  /* ---------------- cliques e teclado ---------------- */
  document.addEventListener('click', async ev => {
    const b = ev.target.closest('.cop [data-acao]');
    if (!b || b.tagName === 'FORM' || b.tagName === 'INPUT') return;
    const acao = b.dataset.acao;
    const r = S.resultado.get(S.conversa?.conversaId);
    if (acao === 'rodar') return rodar();
    if (acao === 'executar' || acao === 'recusar' || acao === 'desfazer') return agir(acao, b.dataset.id);
    if (acao === 'usar' && r?.resposta_sugerida) {
      if (await noCampo(r.resposta_sugerida) && ehUuid(r.resposta_acao_id)) {
        // marca no log que a sugestão foi usada (não envia nada)
        pedir('POST', `/api/ia/acoes/${encodeURIComponent(r.resposta_acao_id)}/executar`).catch(() => {});
      }
      return;
    }
    if (acao === 'copiar' && r?.resposta_sugerida) {
      try { await navigator.clipboard.writeText(r.resposta_sugerida); avisar('Copiado.'); } catch { avisar('Não consegui copiar.'); }
      return;
    }
    if (acao === 'usar-conf' && S.confirmacao) return noCampo(S.confirmacao);
    if (acao === 'horario' && r?.horarios_sugeridos) {
      const h = r.horarios_sugeridos[Number(b.dataset.i)];
      if (h) noCampo(`Consigo ${h.rotulo}. Fica bom pra você? 😊`);
      return;
    }
    if (acao === 'horarios-ambos' && r?.horarios_sugeridos?.length > 1) {
      const [a, c] = r.horarios_sugeridos;
      noCampo(`Tenho ${a.rotulo} ou ${c.rotulo}. Qual fica melhor pra você? 🏎`);
    }
  });
  document.addEventListener('submit', ev => {
    const f = ev.target.closest('.cop form[data-acao="pedido"]');
    if (!f) return;
    ev.preventDefault();
    const t = f.querySelector('textarea')?.value.trim() || '';
    S.pedido = t; S.pedidoAberto = true;
    if (t) rodar({ pedido: t });
  });
  document.addEventListener('input', ev => {
    if (ev.target.id === 'copPedido') S.pedido = ev.target.value;
  });
  document.addEventListener('keydown', ev => {
    // Ctrl+Enter no pedido envia
    if (ev.target.id === 'copPedido' && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      ev.target.form?.requestSubmit();
    }
  });
  document.addEventListener('change', ev => {
    if (ev.target.matches('.cop [data-acao="auto"]')) {
      try { localStorage.setItem(CHAVE_AUTO, ev.target.checked ? '1' : '0'); } catch { /* sem armazenamento */ }
    }
  });
  document.addEventListener('toggle', ev => {
    if (ev.target.matches?.('.cop-hist')) S.histAberto = ev.target.open;
    if (ev.target.matches?.('.cop-mais')) S.pedidoAberto = ev.target.open;
  }, true);

  /* ---------------- eventos da tela ---------------- */
  function abrirConversa(det) {
    const id = det && ehUuid(det.conversaId) ? det.conversaId : null;
    if (S.conversa?.conversaId === id) return;
    S.controlador?.abort();
    clearTimeout(S.timer);
    S.carregando = false; S.erro = ''; S.confirmacao = null; S.historico = []; S.pedido = '';
    S.conversa = id ? { ...det } : null;
    desenhar();
    if (id) { carregarUso().then(desenhar); carregarHistorico().then(desenhar); }
  }

  window.addEventListener('indycar:conversa', e => abrirConversa(e.detail || {}));

  window.addEventListener('indycar:mensagem', e => {
    const d = e.detail || {};
    if (!S.conversa || d.conversaId !== S.conversa.conversaId) return;
    if (d.direcao !== 'entrada') { clearTimeout(S.timer); return; }   // o atendente respondeu: não gasta
    if (!auto() || document.visibilityState !== 'visible') return;
    const slot = document.getElementById('copilotoSlot');
    if (slot && slot.hidden) return;
    clearTimeout(S.timer);
    const id = S.conversa.conversaId;
    S.timer = setTimeout(() => {
      if (S.conversa?.conversaId !== id || S.carregando) return;
      if (Date.now() - (S.ultimaAuto.get(id) || 0) < INTERVALO_MIN_MS) return;
      S.ultimaAuto.set(id, Date.now());
      rodar({ automatico: true });
    }, DEBOUNCE_MS);
  });

  window.addEventListener('indycar:copiloto-abrir', e => {
    abrirConversa(e.detail || S.conversa);
    const id = S.conversa?.conversaId;
    if (id && !S.resultado.has(id) && !S.carregando) rodar();
    else alvo()?.querySelector('.cop-principal')?.focus();
  });

  // a tela já tinha uma conversa aberta antes de este arquivo carregar?
  function sincronizarComTela() {
    try {
      const c = API().conversa;
      if (c && ehUuid(c.conversaId)) abrirConversa(c);
    } catch { /* sem window.IndyCar */ }
  }
  window.addEventListener('indycar:pronto', sincronizarComTela);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sincronizarComTela);
  else sincronizarComTela();

  // exposto só para teste/depuração
  window.IndyCarCopiloto = { estado: S, rodar, abrirConversa, desenhar };
})();
