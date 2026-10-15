/* ============================================================
   IndyCar Atendimento — ajuda.js (rodada 4)
   - Tour de boas-vindas curto, POR PAPEL (atendente · gestor · admin), na
     primeira vez que a pessoa entra. Fica marcado em perfis.preferencias
     (vale em qualquer aparelho) e no aparelho (se o servidor estiver fora).
   - Ajuda curta: "Como faço…" com busca, atalhos de teclado e "rever o tour".
   Regras puras no topo (testadas em test/ajuda.test.js).
   ============================================================ */
(function (raiz) {
  'use strict';

  const VERSAO_TOUR = 1;

  /* Passos do tour. `alvo` = seletor do que acende; sem alvo (ou escondido) o
     cartão aparece no meio da tela. `papeis` limita quem vê o passo. */
  const PASSOS = [
    { id: 'boas-vindas', titulo: 'Bem-vindo ao Atendimento! 👋',
      texto: 'Aqui você conversa com os clientes da IndyCar pelo WhatsApp. São só alguns passos — dá para pular quando quiser.' },
    { id: 'lista', alvo: '#listaConversas', titulo: 'As conversas chegam aqui',
      texto: 'Quem tem bolinha vermelha mandou mensagem e ninguém leu. Use as abas em cima para filtrar (Não lidas, Aguardando, Agendadas…).' },
    { id: 'busca', alvo: '#buscaConversa', titulo: 'Achar um cliente',
      texto: 'Busque por nome, telefone (com ou sem +55) ou placa. Atalho: Ctrl+K.' },
    { id: 'responder', alvo: '#campoMensagem', titulo: 'Responder',
      texto: 'Enter envia, Shift+Enter quebra a linha. Digite / para as respostas prontas. O que você não enviou fica guardado como rascunho.' },
    { id: 'ia', alvo: '#btnCopiloto', titulo: 'A IA ajuda, você decide',
      texto: 'O ✨ lê a conversa e a ficha do cliente e sugere a resposta e o próximo passo. Nada vai para o cliente sem você clicar em enviar.' },
    { id: 'sino', alvo: '#btnSino', titulo: 'Avisos e tarefas',
      texto: 'O sino mostra conversa passada para você, cliente esperando e tarefas. Suas tarefas ficam na aba Tarefas.' },
    { id: 'gestor-dono', alvo: '.nav-item[data-aba="relatorios"]', papeis: ['gestor', 'admin'], titulo: 'Para o gestor',
      texto: 'Relatórios mostram o dia e a equipe. Na lista, o filtro "Sem dono" mostra quem ninguém pegou — dá para distribuir pelo rodízio.' },
    { id: 'admin-equipe', alvo: '#navEquipe', papeis: ['admin'], titulo: 'Equipe e acessos',
      texto: 'Aqui você convida pessoas (senha temporária na hora), muda papel e desativa acesso. Tudo fica na auditoria.' },
    { id: 'admin-integracoes', alvo: '.nav-item[data-aba="integracoes"]', papeis: ['admin'], titulo: 'WhatsApp e chaves',
      texto: 'Se a faixa laranja avisar que o WhatsApp parou, é aqui que você testa e troca a chave do CodeWords.' },
    { id: 'fim', titulo: 'Pronto! 🏁',
      texto: 'Precisou de ajuda? Aperte ? (fora do campo de texto) ou abra o menu do seu nome › Ajuda e atalhos. Quem conhece, Indyca! 🏎' },
  ];

  function passosDoPapel(papel) {
    const p = ['admin', 'gestor'].includes(papel) ? papel : 'atendente';
    return PASSOS.filter(x => !x.papeis || x.papeis.includes(p));
  }
  const marcaDoTour = papel => `v${VERSAO_TOUR}-${['admin', 'gestor'].includes(papel) ? papel : 'atendente'}`;
  /** Precisa mostrar? Não viu esta versão para este papel (promoção a gestor mostra os passos novos). */
  function precisaDoTour(preferencias, papel, vistoNoAparelho) {
    const marca = marcaDoTour(papel);
    return (preferencias?.tour_visto !== marca) && vistoNoAparelho !== marca;
  }

  /* "Como faço…" — curto, no vocabulário da oficina. */
  const COMO = [
    { p: 'Agendar um horário para o cliente', r: 'Na conversa, botão <b>Agendar</b> (ou peça ao ✨). Escolha serviço, dia e hora: o cliente, o lead do CRM e o horário na Agenda nascem juntos, e a mensagem de confirmação já fica pronta no campo.', k: 'agenda marcar horário' },
    { p: 'Passar a conversa para um colega', r: 'Menu <b>⋯</b> do chat › <b>Transferir</b>, escolha a pessoa e diga o motivo. Ela recebe o aviso no sino.', k: 'transferir passar dono colega' },
    { p: 'Pegar um cliente para mim', r: 'Clique em <b>👤 sem dono</b> no topo do chat (ou Alt+M). Os leads abertos do cliente vêm junto.', k: 'assumir meu dono' },
    { p: 'Deixar para responder depois', r: 'Botão <b>✉ Não lida</b> no chat (Alt+U): volta a contar como não lida e não se perde.', k: 'não lida depois lembrar' },
    { p: 'Usar uma resposta pronta', r: 'Digite <b>/</b> no campo e escolha (↑ ↓ e Enter). Os dados do cliente entram sozinhos. Para criar ou mudar: aba <b>Atalhos</b>.', k: 'atalho pronta modelo barra' },
    { p: 'Mandar foto, PDF ou áudio', r: 'Botão <b>📎</b> para arquivo (até 15 MB) e <b>🎤</b> para gravar áudio — chega como mensagem de voz.', k: 'arquivo foto pdf áudio audio anexo' },
    { p: 'Pedir ajuda à IA', r: 'Botão <b>✨</b> (Alt+I): resposta sugerida, horários livres e ações (agendar, mover etapa, tarefa). Você revisa: a IA nunca envia sozinha nem fala preço.', k: 'ia copiloto sugerir inteligência' },
    { p: 'Criar uma tarefa', r: 'Alt+T na conversa, ou aba <b>Tarefas</b> › Nova. Dá para ligar ao cliente, escolher responsável e prazo.', k: 'tarefa lembrete prazo' },
    { p: 'O sistema está "acordando"', r: 'O servidor gratuito às vezes dorme. A faixa amarela tenta de novo sozinha (até 3 min). Você pode continuar lendo e respondendo: o que enviar sai assim que ele acordar — não precisa reenviar.', k: 'acordando lento fora 503 erro servidor' },
    { p: 'Fiquei sem internet', r: 'A faixa de baixo avisa. O que você enviar vai para a fila e sai sozinho quando a conexão voltar.', k: 'internet offline fila' },
    { p: 'A faixa laranja diz que o WhatsApp parou', r: 'É o robô vigia avisando. Só o administrador resolve (Integrações › chave do CodeWords). Enquanto isso, nada entra nem sai pelo WhatsApp.', k: 'whatsapp parado chave codewords laranja' },
    { p: 'Não consigo apagar / não vejo uma aba', r: 'Apagar, Relatórios e Equipe são do gestor ou do administrador. Precisa? <b>Peça ao gestor</b> — ele muda seu papel em Equipe.', k: 'permissão apagar acesso gestor' },
    { p: 'Trocar minha senha ou ligar as duas etapas', r: 'Menu do seu nome (canto) › <b>Trocar senha</b> ou <b>Verificação em duas etapas</b>.', k: 'senha duas etapas segurança' },
  ];
  const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function filtrarComo(termo, lista = COMO) {
    const t = semAcento(termo).trim();
    if (!t) return lista;
    const partes = t.split(/\s+/);
    return lista.filter(x => { const alvo = semAcento(x.p + ' ' + x.k + ' ' + x.r.replace(/<[^>]+>/g, '')); return partes.every(p => alvo.includes(p)); });
  }

  const PURO = { VERSAO_TOUR, PASSOS, COMO, passosDoPapel, marcaDoTour, precisaDoTour, filtrarComo };
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = PURO;
    return;
  }

  /* ======================= navegador ======================= */
  const $ = (s, c = document) => c.querySelector(s);
  const CHAVE_APARELHO = 'indycar_tour_visto';
  const lerAparelho = () => { try { return localStorage.getItem(CHAVE_APARELHO); } catch { return null; } };

  /* ---------- ajuda ---------- */
  function pintarComo(termo = '') {
    const l = filtrarComo(termo);
    const box = $('#ajudaLista');
    if (!box) return;
    box.innerHTML = l.map((x, i) => `<details class="ajuda-item"${termo && i === 0 ? ' open' : ''}><summary>${x.p.replace(/</g, '&lt;')}</summary><p>${x.r}</p></details>`).join('');
    $('#ajudaNada').hidden = l.length > 0;
  }
  function trocarAba(qual) {
    document.querySelectorAll('[data-ajuda-aba]').forEach(b => {
      const ativa = b.dataset.ajudaAba === qual;
      b.classList.toggle('ativa', ativa); b.setAttribute('aria-selected', String(ativa)); b.tabIndex = ativa ? 0 : -1;
    });
    $('#ajudaComo').hidden = qual !== 'como';
    $('#ajudaTeclas').hidden = qual !== 'teclas';
  }
  function abrir(qual = 'como') {
    // atalhos: app.js preenche a lista (ele sabe as etapas do funil de agora)
    if (typeof raiz.abrirAjudaTeclado === 'function') {
      try { raiz.__preenchendoTeclas = true; raiz.abrirAjudaTeclado(); } finally { raiz.__preenchendoTeclas = false; }
    }
    pintarComo($('#ajudaBusca').value);
    trocarAba(qual);
    if (typeof raiz.abrirModal === 'function') raiz.abrirModal('modalAjudaBg', qual === 'como' ? '#ajudaBusca' : '[data-ajuda-aba="teclas"]');
    else $('#modalAjudaBg').classList.add('aberto');
    raiz.versaoDaCasca?.().then(v => { $('#ajudaVersao').textContent = v ? `Casca guardada: ${v.replace('indycar-atendimento-', '')}` : ''; });
  }
  function ligarAjuda() {
    $('#ajudaBusca')?.addEventListener('input', e => pintarComo(e.target.value));
    document.querySelectorAll('[data-ajuda-aba]').forEach(b => {
      b.addEventListener('click', () => trocarAba(b.dataset.ajudaAba));
      b.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const outra = b.dataset.ajudaAba === 'como' ? 'teclas' : 'como';
        trocarAba(outra); $(`[data-ajuda-aba="${outra}"]`).focus();
      });
    });
    $('#btnReverTour')?.addEventListener('click', () => {
      $('#modalAjudaBg').classList.remove('aberto');
      setTimeout(() => iniciarTour({ forcar: true }), 150);
    });
  }

  /* ---------- tour ---------- */
  let tour = null;      // { passos, i, el, buraco, voltarFoco }
  const visivel = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  function montar() {
    const fundo = document.createElement('div');
    fundo.className = 'tour-fundo';
    const buraco = document.createElement('div');
    buraco.className = 'tour-buraco';
    const card = document.createElement('div');
    card.className = 'tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'tourTitulo');
    card.setAttribute('aria-describedby', 'tourTexto');
    card.innerHTML = '<div class="tour-passo" id="tourPasso"></div><h4 id="tourTitulo"></h4><p id="tourTexto"></p>'
      + '<div class="tour-botoes"><button type="button" class="link" data-tour="pular">Pular o tour</button>'
      + '<span class="tour-dir"><button type="button" class="btn btn-ghost sm" data-tour="voltar">← Voltar</button>'
      + '<button type="button" class="btn btn-primary sm" data-tour="seguir">Próximo →</button></span></div>';
    fundo.addEventListener('click', () => {});   // clique fora não fecha (sem susto); Esc e "Pular" fecham
    card.addEventListener('click', e => {
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      if (b.dataset.tour === 'pular') return terminar();
      if (b.dataset.tour === 'voltar') return irPara(tour.i - 1);
      if (tour.i >= tour.passos.length - 1) return terminar();
      irPara(tour.i + 1);
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return terminar(); }
      if (e.key === 'ArrowRight' && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); return tour.i < tour.passos.length - 1 ? irPara(tour.i + 1) : terminar(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); return irPara(tour.i - 1); }
      if (e.key === 'Tab') {      // foco preso no cartão
        const f = [...card.querySelectorAll('button:not([hidden])')];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    document.body.append(fundo, buraco, card);
    return { fundo, buraco, card };
  }

  function posicionar() {
    if (!tour) return;
    const passo = tour.passos[tour.i];
    const alvo = passo.alvo ? document.querySelector(passo.alvo) : null;
    const { buraco, card, fundo } = tour.el;
    const largura = Math.min(340, innerWidth - 24);
    card.style.width = largura + 'px';
    if (alvo && visivel(alvo)) {
      alvo.scrollIntoView?.({ block: 'nearest' });
      const r = alvo.getBoundingClientRect();
      const m = 6;
      Object.assign(buraco.style, { display: 'block', left: (r.left - m) + 'px', top: (r.top - m) + 'px', width: (r.width + 2 * m) + 'px', height: (r.height + 2 * m) + 'px' });
      fundo.classList.add('com-buraco');
      // cartão embaixo do alvo; sem espaço, em cima; sempre dentro da tela
      const alturaCard = card.offsetHeight || 190;
      // alvo alto (a lista inteira): cartão AO LADO, se couber — senão ele tampa o que está mostrando
      if (r.height > innerHeight * 0.55) {
        const lado = r.right + 14 + largura <= innerWidth - 12 ? r.right + 14 : (r.left - 14 - largura >= 12 ? r.left - 14 - largura : null);
        if (lado !== null) {
          Object.assign(card.style, { left: lado + 'px', top: Math.max(12, Math.min(r.top + 40, innerHeight - alturaCard - 12)) + 'px', transform: 'none' });
          return;
        }
      }
      let top = r.bottom + 14;
      if (top + alturaCard > innerHeight - 10) top = Math.max(10, r.top - alturaCard - 14);
      if (top + alturaCard > innerHeight - 10) top = Math.max(10, innerHeight - alturaCard - 10);
      let left = Math.min(Math.max(12, r.left + r.width / 2 - largura / 2), innerWidth - largura - 12);
      Object.assign(card.style, { left: left + 'px', top: top + 'px', transform: 'none' });
    } else {
      buraco.style.display = 'none';
      fundo.classList.remove('com-buraco');
      Object.assign(card.style, { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' });
    }
  }

  function irPara(i) {
    if (!tour) return;
    tour.i = Math.max(0, Math.min(i, tour.passos.length - 1));
    const p = tour.passos[tour.i];
    const { card } = tour.el;
    card.querySelector('#tourPasso').textContent = `${tour.i + 1} de ${tour.passos.length}`;
    card.querySelector('#tourTitulo').textContent = p.titulo;
    card.querySelector('#tourTexto').textContent = p.texto;
    card.querySelector('[data-tour="voltar"]').hidden = tour.i === 0;
    const seguir = card.querySelector('[data-tour="seguir"]');
    seguir.textContent = tour.i === tour.passos.length - 1 ? 'Começar ✓' : 'Próximo →';
    posicionar();
    requestAnimationFrame(posicionar);
    seguir.focus({ preventScroll: true });
  }

  function iniciarTour({ forcar = false } = {}) {
    // perfil e sb são do app.js (let no escopo global dos scripts, não ficam em window)
    const perfil = typeof raiz.perfilAtual === 'function' ? raiz.perfilAtual() : null;
    const papel = perfil?.papel || 'atendente';
    if (tour) return;
    if (!forcar && !precisaDoTour(perfil?.preferencias, papel, lerAparelho())) return;
    // só sobre a tela de conversas (é onde estão os alvos) e sem modal aberto por cima
    document.querySelector('.nav-item[data-aba="conversas"]')?.click();
    tour = { passos: passosDoPapel(papel), i: 0, el: montar(), papel, voltarFoco: document.activeElement };
    addEventListener('resize', posicionar);
    irPara(0);
  }

  async function terminar() {
    if (!tour) return;
    const { el, papel, voltarFoco } = tour;
    tour = null;
    removeEventListener('resize', posicionar);
    el.fundo.remove(); el.buraco.remove(); el.card.remove();
    if (voltarFoco?.isConnected) voltarFoco.focus?.({ preventScroll: true });
    const marca = marcaDoTour(papel);
    try { localStorage.setItem(CHAVE_APARELHO, marca); } catch { /* ignora */ }
    // marca no perfil (vale em todo aparelho); falhou (servidor acordando)? o aparelho já lembra
    try {
      const cliente = typeof raiz.clienteSupabase === 'function' ? raiz.clienteSupabase() : null;
      const { data } = cliente ? await cliente.auth.getSession() : {};
      const t = data?.session?.access_token;
      if (t) {
        await fetch('/api/eu', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
          body: JSON.stringify({ preferencias: { tour_visto: marca } }), tetoMs: 30_000 });
      }
    } catch { /* ignora */ }
  }

  raiz.Ajuda = { ...PURO, abrir, iniciarTour, terminarTour: terminar, get tourAberto() { return !!tour; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligarAjuda); else ligarAjuda();
})(typeof window !== 'undefined' ? window : globalThis);
/* "ver o tour de novo" no estado vazio do chat (rodada 4) */
if (typeof document !== 'undefined') document.addEventListener('click', e => { if (e.target.closest?.('#btnVazioTour')) window.Ajuda?.iniciarTour({ forcar: true }); });
