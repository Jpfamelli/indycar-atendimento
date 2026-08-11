/* ============================================================
   IndyCar — App de Atendimento
   O navegador fala direto com o Supabase usando o login do
   atendente. O RLS do banco é quem garante o acesso.
   ============================================================ */
'use strict';

const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

/* Escapa texto antes de jogar no innerHTML — um cliente chamado
   "<img onerror=...>" não pode executar nada na tela do atendente. */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const brl = n => (Number(n) || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const iniciais = nome => String(nome || '?').trim().split(/\s+/).slice(0,2)
  .map(p => p[0]).join('').toUpperCase() || '?';

function horaCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso), hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  if (mesmoDia) return d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return 'ontem';
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
}
const dataLonga = iso => !iso ? '' :
  new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('mostra');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('mostra'), 3600);
}

/* ---------------- Estado ---------------- */
let sb = null;                 // cliente Supabase
let usuario = null;            // auth.user
let perfil = null;             // linha de public.perfis
let CONVERSAS = [];
let conversaAtual = null;
let MENSAGENS = [];
let filtroStatus = '';
let termoBusca = '';
let canalRealtime = null;

/* Cabeçalhos com o token do login — as rotas do servidor que gastam
   dinheiro (CodeWords, IA) exigem atendente logado. */
async function authCabecalhos() {
  const { data } = await sb.auth.getSession();
  const t = data?.session?.access_token;
  // Sem token não adianta chamar: falha aqui, com aviso claro, em vez de
  // mandar sem credencial e levar 401 do servidor.
  if (!t) throw new Error('Sua sessão expirou. Entre de novo para continuar.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` };
}

/* ============================================================
   BOOT — pega a configuração do servidor e conecta
   ============================================================ */
let CONFIG = null;   // guardada fora: o botão de copiar o webhook precisa da chave publicável

async function iniciar() {
  let cfg;
  try {
    cfg = CONFIG = await (await fetch('/api/config')).json();
  } catch {
    return mostrarErroLogin('Não consegui falar com o servidor. Ele está rodando?');
  }

  if (!cfg.configurado) {
    return mostrarErroLogin(
      'Falta configurar o Supabase. Preencha SUPABASE_URL e SUPABASE_ANON_KEY no arquivo .env e reinicie o servidor.');
  }

  if (!window.supabase?.createClient) {
    return mostrarErroLogin('A biblioteca do Supabase não carregou. Verifique sua conexão com a internet.');
  }

  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  // aba de IA fica desativada se não houver chave
  const selo = $('#seloIA');
  selo.textContent = cfg.iaConfigurada ? 'IA ativa' : 'sem chave';
  selo.className = 'selo ' + (cfg.iaConfigurada ? 'on' : 'off');
  mostrarCartaoIA(cfg);

  const { data: { session } } = await sb.auth.getSession();
  if (session) await entrarNoApp(session.user);
  else await verPrimeiroAcesso();   // sistema vazio? abre a criação do admin

  sb.auth.onAuthStateChange((evento, sessao) => {
    if (evento === 'SIGNED_OUT') location.reload();
  });
}

function mostrarErroLogin(msg) {
  const el = $('#loginErro');
  el.textContent = msg;
  el.hidden = false;
}

/* ============================================================
   LOGIN
   ============================================================ */
$('#formLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#loginEmail').value.trim();
  const senha = $('#loginSenha').value;
  const btn = $('#btnEntrar');
  $('#loginErro').hidden = true;

  if (!email || !senha) return mostrarErroLogin('Preencha e-mail e senha.');

  btn.disabled = true;
  btn.innerHTML = '<span class="girando"></span>Entrando…';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) throw error;
    await entrarNoApp(data.user);
  } catch (err) {
    mostrarErroLogin(traduzErroAuth(err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

/* PRIMEIRO ACESSO
   O botão só aparece enquanto o sistema não tem NINGUÉM. Quem criar a
   primeira conta vira administrador.

   Não usa sb.auth.signUp: ele exige confirmação por e-mail e recusa domínio
   que não seja de e-mail de verdade — o @indycartaubate.com era recusado com
   "Email address is invalid". O servidor cria a conta já valendo. */
async function verPrimeiroAcesso() {
  try {
    const r = await fetch('/api/primeiro-acesso');
    const j = await r.json();
    $('#btnCriarConta').hidden = !j.aberto;
    if (j.aberto) {
      $('#loginTitulo').textContent = 'Vamos começar!';
      $('#loginSub').textContent = 'Ninguém foi cadastrado ainda. Crie a sua conta de administrador.';
      mostrarFormPrimeiro(true);
    }
  } catch { /* servidor fora do ar: a tela de login normal já cobre */ }
}

function mostrarFormPrimeiro(mostrar) {
  $('#formLogin').hidden     = mostrar;
  $('#formPrimeiro').hidden  = !mostrar;
  $('#btnCriarConta').hidden = mostrar;
  $('#btnVoltarLogin').hidden = !mostrar;
  $('#loginTitulo').textContent = mostrar ? 'Vamos começar!' : 'Bem-vindo!';
  $('#loginSub').textContent = mostrar
    ? 'Ninguém foi cadastrado ainda. Crie a sua conta de administrador.'
    : 'Informe seu e-mail e senha para entrar:';
}

$('#btnCriarConta').addEventListener('click', () => mostrarFormPrimeiro(true));
$('#btnVoltarLogin').addEventListener('click', () => mostrarFormPrimeiro(false));

$('#formPrimeiro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erro = $('#pnErro');
  const btn  = $('#btnPrimeiro');
  erro.hidden = true;

  const nome  = $('#pnNome').value.trim();
  const email = $('#pnEmail').value.trim().toLowerCase();
  const senha = $('#pnSenha').value;

  const falha = (m) => { erro.hidden = false; erro.textContent = m; };
  if (!nome)  return falha('Informe seu nome.');
  if (senha.length < 8) return falha('A senha precisa ter pelo menos 8 caracteres.');
  if (senha !== $('#pnSenha2').value) return falha('As duas senhas não são iguais.');

  btn.disabled = true; btn.textContent = 'Criando…';
  try {
    const r = await fetch('/api/primeiro-acesso', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.erro || 'Não consegui criar a conta.');

    // já entra, sem obrigar a digitar tudo de novo
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) {
      mostrarFormPrimeiro(false);
      toast('✅ Conta criada! Entre com seu e-mail e senha.');
      return;
    }
    location.reload();
  } catch (err) {
    falha(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Criar minha conta de administrador';
  }
});

function traduzErroAuth(m = '') {
  const t = m.toLowerCase();
  if (t.includes('invalid login')) return 'E-mail ou senha incorretos.';
  if (t.includes('already registered')) return 'Esse e-mail já tem conta. Use "Entrar".';
  if (t.includes('email not confirmed')) return 'Confirme o e-mail antes de entrar.';
  if (t.includes('password')) return 'Senha muito curta (mínimo 6 caracteres).';
  return m || 'Não consegui entrar.';
}

$('#btnSair').addEventListener('click', async () => {
  if (canalRealtime) await sb.removeChannel(canalRealtime);
  await sb.auth.signOut();
});

async function entrarNoApp(user) {
  usuario = user;

  const { data: p } = await sb.from('perfis').select('*').eq('id', user.id).maybeSingle();
  perfil = p || { nome: user.email.split('@')[0], email: user.email, papel: 'atendente' };

  $('#telaLogin').hidden = true;
  $('#telaApp').hidden = false;

  $('#usuarioNome').textContent = perfil.nome;
  $('#usuarioPapel').textContent = perfil.papel === 'admin' ? 'Administrador' : 'Atendente';
  $('#usuarioAvatar').textContent = iniciais(perfil.nome);
  $('#perfilNome').value = perfil.nome;
  $('#perfilEmail').value = perfil.email;
  $('#perfilPapel').value = perfil.papel === 'admin' ? 'Administrador' : 'Atendente';
  aplicarPapelConfig();
  await carregarNomesDaEquipe();      // a plaquinha de dono precisa dos nomes
  $('#btnExcluirConversa').hidden = perfil.papel !== 'admin';
  $('#btnSoMinhas')?.classList.toggle('ativo', soMinhas);
  vigiarConexao();   // acende a tarja se o WhatsApp estiver fora do ar

  // as etapas vêm ANTES das conversas: são elas que desenham as plaquinhas
  await carregarEtapas();
  await carregarConfigFunil();
  await carregarConversas();
  ligarTempoReal();
  carregarEquipe();
  carregarWhatsappConfig();
  await carregarApoio();      // serviços e consultores (usados no agendamento)
  await carregarAtalhos();    // atalhos do "/"
  carregarCodeWords();
  carregarFluxos();
  prepararRelatorios();       // só acerta as datas; o relatório vem ao abrir a aba
}

/* Cartão da Claude na aba Integrações. A chave nunca vem para cá —
   o servidor só conta SE existe uma configurada e qual é o modelo. */
function mostrarCartaoIA(cfg) {
  const selo = $('#seloIAInt');
  selo.textContent = cfg.iaConfigurada ? 'ligada' : 'sem chave';
  selo.className = 'selo ' + (cfg.iaConfigurada ? 'on' : 'off');
  $('#iaChaveEstado').textContent = cfg.iaConfigurada
    ? 'Configurada no servidor' : 'Não configurada';
  $('#iaModelo').textContent = cfg.modeloIA || 'não informado';
}

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
$$('.nav-item').forEach(b => b.addEventListener('click', () => {
  const aba = b.dataset.aba;
  // CRM e Agenda são links que abrem noutra janela: não têm aba para mostrar
  if (!aba) return;
  $$('.nav-item').forEach(x => x.classList.toggle('ativo', x === b));
  $$('.aba').forEach(s => s.classList.toggle('ativa', s.id === `aba-${aba}`));
  fecharMenuEtapas();
  // relatório é caro de montar: só busca quando o atendente entra na aba
  if (aba === 'relatorios' && !RELATORIO) carregarRelatorios();
  if (aba === 'funil')  carregarFunil();
  if (aba === 'etapas') atualizarAbaEtapas();
}));

/* ============================================================
   CONVERSAS
   ============================================================ */
async function carregarConversas() {
  try {
    let q = sb.from('conversas')
      .select('*')
      .order('ultima_mensagem_em', { ascending: false, nullsFirst: false })
      .limit(200);
    if (filtroStatus) q = q.eq('status', filtroStatus);

    const { data, error } = await q;
    if (error) throw error;
    CONVERSAS = data || [];

    /* A conversa aberta é uma referência para o array antigo: sem repontar,
       a plaquinha e o status do chat ficariam parados no passado. */
    if (conversaAtual) {
      const nova = CONVERSAS.find(c => c.id === conversaAtual.id);
      if (nova) conversaAtual = nova;
    }

    renderConversas();
    atualizarBadge();
    renderEtapaDoChat();
  } catch (err) {
    toast('⚠️ ' + err.message);
  }
}

function conversasFiltradas() {
  let base = CONVERSAS;
  // "só as minhas": o atendente trabalha a fila dele sem o ruído da do outro
  if (soMinhas && perfil?.id) base = base.filter(c => c.atribuida_a === perfil.id);

  const t = termoBusca.trim().toLowerCase();
  if (!t) return base;
  const soDigitos = t.replace(/\D/g, '');
  return base.filter(c =>
    (c.nome || '').toLowerCase().includes(t) ||
    (c.telefone || '').toLowerCase().includes(t) ||
    (soDigitos && (c.telefone_e164 || '').includes(soDigitos)));
}

function renderConversas() {
  const lista = conversasFiltradas();
  const el = $('#listaConversas');

  if (!lista.length) {
    el.innerHTML = `<div class="vazio">
      ${CONVERSAS.length ? 'Nenhuma conversa com esse filtro.' : 'Nenhuma conversa ainda.'}
      <br><br><button class="btn btn-ghost sm" id="btnNovaVazio">+ Nova conversa</button></div>`;
    $('#btnNovaVazio')?.addEventListener('click', abrirModalNova);
    return;
  }

  el.innerHTML = lista.map(c => `
    <div class="conversa ${conversaAtual?.id === c.id ? 'ativa' : ''}" data-id="${c.id}">
      <span class="avatar">${esc(iniciais(c.nome || c.telefone))}</span>
      <div class="conversa-txt">
        <div class="conversa-topo">
          <span class="conversa-nome">${esc(c.nome || c.telefone)}</span>
          <span class="conversa-hora">${esc(horaCurta(c.ultima_mensagem_em))}</span>
        </div>
        <div class="conversa-previa">${esc(c.ultima_previa || 'sem mensagens')}</div>
        <div class="conversa-tags">
          ${donoHtml(c)}
          ${plaquinhaHtml(c)}
          <span class="tag ${c.status}">${c.status}</span>
          ${c.ia_ativa ? '<span class="tag ia">✨ IA</span>' : ''}
          ${c.nao_lidas > 0 ? `<span class="nao-lidas">${c.nao_lidas}</span>` : ''}
        </div>
      </div>
    </div>`).join('');

  $$('.conversa', el).forEach(d =>
    d.addEventListener('click', () => abrirConversa(d.dataset.id)));

  /* A plaquinha de dono abre o menu de quem responde — sem abrir a conversa */
  $$('[data-dono]', el).forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const conv = CONVERSAS.find(c => c.id === b.dataset.dono);
    if (conv) abrirMenuDono(b, conv);
  }));

  /* A plaquinha abre o menu de etapas — e NÃO abre a conversa junto */
  $$('.plaquinha', el).forEach(p => p.addEventListener('click', ev => {
    ev.stopPropagation();
    const id = p.closest('.conversa')?.dataset.id;
    const conv = CONVERSAS.find(c => c.id === id);
    if (conv) abrirMenuEtapas(p, conv);
  }));
}

function atualizarBadge() {
  const total = CONVERSAS.reduce((s, c) => s + (c.nao_lidas || 0), 0);
  const b = $('#badgeNaoLidas');
  b.textContent = total;
  b.hidden = total === 0;
}

$('#buscaConversa').addEventListener('input', e => {
  termoBusca = e.target.value;
  renderConversas();
});

/* Escopo preso à aba de conversas: os chips das outras abas (categorias
   dos atalhos, período dos relatórios) não podem mexer neste filtro. */
$$('#aba-conversas .filtros-status .chip').forEach(c => c.addEventListener('click', () => {
  $$('#aba-conversas .filtros-status .chip').forEach(x => x.classList.toggle('ativo', x === c));
  filtroStatus = c.dataset.status;
  carregarConversas();
}));

/* ---------------- Abrir uma conversa ---------------- */
async function abrirConversa(id) {
  let conv = CONVERSAS.find(c => c.id === id);
  // Veio do funil? A lista pode estar filtrada por status ou cortada em 200 —
  // nesse caso buscamos a conversa direto, em vez de o clique não fazer nada.
  if (!conv) {
    const { data } = await sb.from('conversas').select('*').eq('id', id).maybeSingle();
    if (!data) return toast('⚠️ Não encontrei essa conversa.');
    conv = data;
    CONVERSAS = [conv, ...CONVERSAS];
  }
  conversaAtual = conv;

  $('#chatVazio').hidden = true;
  $('#chat').hidden = false;
  $('#chatNome').textContent = conv.nome || conv.telefone;
  $('#chatTelefone').textContent = conv.telefone;
  $('#chatAvatar').textContent = iniciais(conv.nome || conv.telefone);
  $('#chatStatus').value = conv.status;
  renderEtapaDoChat();
  renderBotaoAssumir();

  // No celular, abrir a conversa troca a lista pelo chat
  $('.conversas-layout').classList.add('vendo-chat');

  renderConversas();
  await Promise.all([carregarMensagens(), carregarFicha(conv)]);

  // abriu = leu
  if (conv.nao_lidas > 0) {
    await sb.from('conversas').update({ nao_lidas: 0 }).eq('id', conv.id);
    conv.nao_lidas = 0;
    renderConversas();
    atualizarBadge();
  }

  /* As respostas do Carlos não passam pelo webhook — elas ficam no aparelho.
     Puxa o que falta ao abrir o chat, senão o atendente vê as perguntas do
     cliente e nenhuma resposta, e acha que a IA está muda.
     Sem await de propósito: a conversa já abriu, isto completa depois. */
    sincronizarConversaAberta(conv.id);
}

async function sincronizarConversaAberta(id) {
  try {
    const r = await (await fetch('/api/conversas/sincronizar', {
      method: 'POST', headers: await authCabecalhos(),
      body: JSON.stringify({ conversaId: id }),
    })).json();
    // só redesenha se veio coisa nova E o atendente ainda está nesta conversa
    if (r.novas > 0 && conversaAtual?.id === id) {
      await carregarMensagens();
      await carregarConversas();
    }
  } catch { /* sem rede: a sincronização periódica pega depois */ }
}

async function carregarMensagens() {
  if (!conversaAtual) return;
  try {
    const { data, error } = await sb.from('whatsapp_mensagens')
      .select('*').eq('conversa_id', conversaAtual.id)
      .order('created_at', { ascending: true }).limit(500);
    if (error) throw error;
    MENSAGENS = data || [];
    renderMensagens();
  } catch (err) { toast('⚠️ ' + err.message); }
}

function renderMensagens() {
  const el = $('#mensagens');
  if (!MENSAGENS.length) {
    el.innerHTML = '<div class="vazio">Nenhuma mensagem ainda. Escreva abaixo para começar.</div>';
    return;
  }
  let ultimoDia = '';
  el.innerHTML = MENSAGENS.map(m => {
    const dia = new Date(m.created_at).toDateString();
    let sep = '';
    if (dia !== ultimoDia) {
      ultimoDia = dia;
      sep = `<div class="dia-sep">${esc(dataLonga(m.created_at))}</div>`;
    }
    const hora = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    return sep + `<div class="msg ${m.direcao === 'entrada' ? 'entrada' : 'saida'}${m.gerada_por_ia ? ' ia-tag' : ''}">
      ${esc(m.corpo)}<span class="msg-hora">${esc(hora)}</span></div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

/* ---------------- Enviar ---------------- */
const campo = $('#campoMensagem');
campo.addEventListener('input', () => {
  campo.style.height = 'auto';
  campo.style.height = Math.min(campo.scrollHeight, 130) + 'px';
});
campo.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensagem(); }
});
$('#btnEnviar').addEventListener('click', enviarMensagem);

async function enviarMensagem() {
  const texto = campo.value.trim();
  if (!texto || !conversaAtual) return;

  const btn = $('#btnEnviar');
  btn.disabled = true;
  try {
    const { error } = await sb.from('whatsapp_mensagens').insert({
      conversa_id: conversaAtual.id,
      cliente_id:  conversaAtual.cliente_id,
      telefone:    conversaAtual.telefone,
      nome:        conversaAtual.nome,
      corpo:       texto,
      direcao:     'saida',
      status:      'pendente',
    });
    if (error) throw error;
    campo.value = '';
    campo.style.height = 'auto';
    fecharMenuAtalhos();
    await carregarMensagens();
    await carregarConversas();

    // Entrega de verdade no WhatsApp, via CodeWords.
    // Se estiver desligado, a mensagem fica registrada aqui mesmo assim.
    try {
      const r = await (await fetch('/api/enviar', {
        method: 'POST', headers: await authCabecalhos(),
        body: JSON.stringify({
          telefone: conversaAtual.telefone,
          corpo: texto,
          nome: conversaAtual.nome,
          conversaId: conversaAtual.id,
        }),
      })).json();
      if (!r.ok && !r.desligado) toast('⚠️ Registrado aqui, mas o envio falhou: ' + (r.erro || ''));
    } catch (err) {
      // A mensagem já está salva; o que falhou foi a entrega. Avisa, para
      // ninguém achar que o cliente recebeu.
      toast('⚠️ Registrado aqui, mas não saiu no WhatsApp: ' + (err.message || 'falha de rede'));
    }
  } catch (err) {
    toast('⚠️ ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- Status da conversa ---------------- */
$('#chatStatus').addEventListener('change', async e => {
  if (!conversaAtual) return;
  try {
    const { error } = await sb.from('conversas')
      .update({ status: e.target.value }).eq('id', conversaAtual.id);
    if (error) throw error;
    conversaAtual.status = e.target.value;
    toast('Conversa marcada como ' + e.target.value);
    await carregarConversas();
  } catch (err) { toast('⚠️ ' + err.message); }
});

/* Ficha: no desktop ela é uma coluna — o botão recolhe/expande a coluna,
   dando ainda mais espaço ao chat. No celular/tablet ela é uma gaveta
   sobreposta, aberta pela classe .aberta (comportamento antigo). */
$('#btnPainelCliente').addEventListener('click', () => {
  if (window.matchMedia('(max-width:1180px)').matches) {
    $('#colFicha').classList.toggle('aberta');
  } else {
    $('.conversas-layout').classList.toggle('ficha-fechada');
  }
});

/* Excluir a conversa. Apaga histórico e não tem desfazer, então a confirmação
   pede o NOME do cliente digitado — clicar em "ok" por reflexo é fácil demais
   para uma ação irreversível. O cadastro do cliente e o lead do CRM ficam. */
$('#btnExcluirConversa').addEventListener('click', async () => {
  if (!conversaAtual) return;
  const nome = conversaAtual.nome || conversaAtual.telefone;
  const digitado = prompt(
    `Excluir a conversa de ${nome}?\n\n`
  + `Isso apaga TODAS as mensagens deste chat, sem desfazer.\n`
  + `O cadastro do cliente e o lead do CRM continuam.\n\n`
  + `Para confirmar, digite o nome: ${nome}`);
  if (digitado === null) return;
  if (digitado.trim().toLowerCase() !== String(nome).trim().toLowerCase()) {
    return toast('Nome não confere — nada foi apagado.');
  }

  const btn = $('#btnExcluirConversa');
  btn.disabled = true;
  try {
    const r = await (await fetch('/api/conversas/excluir', {
      method: 'POST', headers: await authCabecalhos(),
      body: JSON.stringify({ conversaId: conversaAtual.id }),
    })).json();
    if (!r.ok) throw new Error(r.erro || 'não consegui excluir');

    toast(`🗑 Conversa de ${nome} excluída (${r.apagadas} mensagens)`);
    conversaAtual = null;
    $('#chat').hidden = true;
    $('#chatVazio').hidden = false;
    $('.conversas-layout').classList.remove('vendo-chat');
    await carregarConversas();
  } catch (err) {
    toast('⚠️ ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

/* ============================================================
   FICHA DO CLIENTE — aqui mora a integração com CRM e Agenda
   ============================================================ */
async function carregarFicha(conv) {
  const vazio = $('#fichaVazia'), alvo = $('#fichaConteudo');

  if (!conv.cliente_id) {
    fichaCache = null;
    vazio.hidden = false; alvo.hidden = true;
    vazio.innerHTML = `<p>Cliente ainda não cadastrado.</p>
      <p style="margin-top:10px;font-size:.82rem">Ao criar um lead no CRM com este telefone,
      a ficha aparece aqui automaticamente.</p>`;
    return;
  }

  vazio.hidden = true; alvo.hidden = false;
  alvo.innerHTML = '<div class="vazio"><span class="girando"></span>Carregando ficha…</div>';

  try {
    const [c360, leads, agend] = await Promise.all([
      sb.from('v_cliente_360').select('*').eq('id', conv.cliente_id).maybeSingle(),
      sb.from('leads').select('*').eq('cliente_id', conv.cliente_id)
        .order('created_at', { ascending:false }).limit(5),
      sb.from('agendamentos').select('*, consultores(nome)').eq('cliente_id', conv.cliente_id)
        .order('inicio_em', { ascending:false }).limit(5),
    ]);

    const f = c360.data || {};
    fichaCache = f;              // alimenta as variáveis dos atalhos ({carro}, {horario}…)
    const listaLeads = leads.data || [];
    const listaAgend = agend.data || [];

    alvo.innerHTML = `
      <div class="ficha-cab">
        <span class="avatar">${esc(iniciais(f.nome || conv.nome))}</span>
        <strong>${esc(f.nome || conv.nome || conv.telefone)}</strong>
        <small>${esc(conv.telefone)}</small>
      </div>

      <div class="ficha-stats">
        <div class="mini-kpi"><b>${brl(f.total_gasto)}</b><small>já gastou</small></div>
        <div class="mini-kpi"><b>${f.servicos_feitos ?? 0}</b><small>serviços</small></div>
        <div class="mini-kpi"><b>${f.total_leads ?? 0}</b><small>contatos</small></div>
        <div class="mini-kpi"><b>${f.faltas ?? 0}</b><small>faltas</small></div>
      </div>

      ${f.proximo_horario ? `
        <div class="ficha-bloco">
          <div class="ficha-titulo">Próximo horário</div>
          <div class="item-hist" style="border-color:rgba(37,211,102,.4)">
            <div class="ih-topo"><b>${esc(new Date(f.proximo_horario)
              .toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))}</b></div>
            <small>agendado</small>
          </div>
        </div>` : ''}

      <div class="ficha-bloco">
        <div class="ficha-titulo">Dados do veículo</div>
        <div class="ficha-linha"><span>Carro</span><b>${esc(f.carro_modelo) || '—'}</b></div>
        <div class="ficha-linha"><span>Placa</span><b>${esc(f.placa) || '—'}</b></div>
        <div class="ficha-linha"><span>Origem</span><b>${esc(f.origem) || '—'}</b></div>
        <div class="ficha-linha"><span>Cliente desde</span><b>${esc(
          f.cliente_desde ? new Date(f.cliente_desde).toLocaleDateString('pt-BR') : '—')}</b></div>
      </div>

      <div class="ficha-bloco">
        <div class="ficha-titulo">Funil (CRM)</div>
        ${listaLeads.length ? listaLeads.map(l => `
          <div class="item-hist">
            <div class="ih-topo"><b>${esc(l.servico || 'sem serviço')}</b>
              <span class="tag ${l.status === 'concluido' ? 'aberta' : 'pendente'}">${esc(l.status)}</span></div>
            <small>${esc(new Date(l.created_at).toLocaleDateString('pt-BR'))} ·
              ${l.status === 'concluido' ? brl(l.valor_pago) : brl(l.valor_orcado) + ' orçado'}</small>
          </div>`).join('') : '<div class="vazio" style="padding:14px">Sem leads no CRM.</div>'}
      </div>

      <div class="ficha-bloco">
        <div class="ficha-titulo">Agenda</div>
        ${listaAgend.length ? listaAgend.map(a => `
          <div class="item-hist">
            <div class="ih-topo"><b>${esc(a.servico)}</b>
              <span class="tag ${a.status === 'concluido' ? 'aberta' : 'pendente'}">${esc(a.status)}</span></div>
            <small>${esc(new Date(a.inicio_em).toLocaleString('pt-BR',
              {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))}
              ${a.consultores?.nome ? '· ' + esc(a.consultores.nome) : ''}
              ${a.valor > 0 ? '· ' + brl(a.valor) : ''}</small>
          </div>`).join('') : '<div class="vazio" style="padding:14px">Sem horários marcados.</div>'}
      </div>`;
  } catch (err) {
    alvo.innerHTML = `<div class="vazio">Não consegui carregar a ficha: ${esc(err.message)}</div>`;
  }
}

/* ============================================================
   TEMPO REAL — mensagem nova aparece sozinha
   ============================================================ */
function ligarTempoReal() {
  if (canalRealtime) sb.removeChannel(canalRealtime);
  canalRealtime = sb.channel('atendimento')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'whatsapp_mensagens' },
      async payload => {
        if (conversaAtual && payload.new.conversa_id === conversaAtual.id) {
          // o envio já recarrega a lista; sem esta checagem a mensagem
          // apareceria duas vezes (uma pelo reload, outra pelo tempo real)
          const jaTem = MENSAGENS.some(m => m.id === payload.new.id);
          if (!jaTem) { MENSAGENS.push(payload.new); renderMensagens(); }
          if (payload.new.direcao === 'entrada') {
            await sb.from('conversas').update({ nao_lidas: 0 }).eq('id', conversaAtual.id);
          }
        } else if (payload.new.direcao === 'entrada') {
          toast('💬 Nova mensagem de ' + (payload.new.nome || payload.new.telefone));
        }
        // Chegou mensagem do cliente: se a chavinha estiver ligada, a IA relê
        // a conversa e atualiza a plaquinha sozinha.
        if (payload.new.direcao === 'entrada' && payload.new.conversa_id) {
          agendarClassificacaoAutomatica(payload.new.conversa_id);
        }
        await carregarConversas();
      })
    .on('postgres_changes', { event:'*', schema:'public', table:'conversas' },
      () => carregarConversas())
    .on('postgres_changes', { event:'*', schema:'public', table:'etapas_funil' },
      async () => { await carregarEtapas(); renderConversas(); renderEtapaDoChat();
                    renderEtapasAdmin(); if (abaVisivel('funil')) carregarFunil(); })
    .subscribe();
}

/* ============================================================
   NOVA CONVERSA
   ============================================================ */
function abrirModalNova() { $('#modalNovaBg').classList.add('aberto'); }
$$('[data-fechar-modal]').forEach(b =>
  b.addEventListener('click', () => $('#modalNovaBg').classList.remove('aberto')));
$('#modalNovaBg').addEventListener('click', e => {
  if (e.target === $('#modalNovaBg')) $('#modalNovaBg').classList.remove('aberto');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $('#modalNovaBg').classList.remove('aberto');
});

$('#formNovaConversa').addEventListener('submit', async e => {
  e.preventDefault();
  const tel = $('#novaTelefone').value.trim();
  const nome = $('#novaNome').value.trim();
  if (!tel) return;

  try {
    const digitos = tel.replace(/\D/g, '');
    // já existe conversa com esse telefone?
    const { data: existente } = await sb.from('conversas').select('*')
      .eq('telefone_e164', digitos.length >= 12 && digitos.startsWith('55')
        ? digitos.slice(2) : digitos).maybeSingle();

    if (existente) {
      $('#modalNovaBg').classList.remove('aberto');
      await carregarConversas();
      return abrirConversa(existente.id);
    }

    const { data, error } = await sb.from('conversas')
      .insert({ telefone: tel, nome: nome || null }).select().single();
    if (error) throw error;

    $('#modalNovaBg').classList.remove('aberto');
    $('#formNovaConversa').reset();
    await carregarConversas();
    abrirConversa(data.id);
    toast('✅ Conversa criada');
  } catch (err) { toast('⚠️ ' + err.message); }
});

/* ============================================================
   IA
   ============================================================ */
async function pedirSugestao(contexto = '') {
  const cliente = conversaAtual?.cliente_id
    ? (await sb.from('v_cliente_360').select('*').eq('id', conversaAtual.cliente_id).maybeSingle()).data
    : null;

  const r = await (await fetch('/api/ia/sugerir', {
    method: 'POST', headers: await authCabecalhos(),
    body: JSON.stringify({ mensagens: MENSAGENS, cliente, contexto }),
  })).json();
  return r;
}

$('#btnSugerir').addEventListener('click', async () => {
  if (!conversaAtual) return toast('Abra uma conversa primeiro.');
  const btn = $('#btnSugerir');
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="girando"></span>Pensando…';
  try {
    const r = await pedirSugestao();
    if (!r.ok) { toast('⚠️ ' + (r.erro || 'IA indisponível')); return; }
    campo.value = r.sugestao;
    campo.dispatchEvent(new Event('input'));
    campo.focus();
    toast('✨ Sugestão pronta — revise antes de enviar');
  } catch (err) {
    toast('⚠️ ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
});

$('#btnTestarIA').addEventListener('click', async () => {
  const txt = $('#iaTeste').value.trim();
  if (!txt) return toast('Escreva uma mensagem de teste.');
  const btn = $('#btnTestarIA'), saida = $('#iaResultado');
  btn.disabled = true;
  saida.hidden = false;
  saida.innerHTML = '<span class="girando"></span>A IA está escrevendo…';
  try {
    const r = await (await fetch('/api/ia/sugerir', {
      method:'POST', headers: await authCabecalhos(),
      body: JSON.stringify({ mensagens: [{ direcao:'entrada', corpo: txt }], cliente: null }),
    })).json();
    saida.textContent = r.ok ? r.sugestao : ('⚠️ ' + (r.erro || 'falhou') +
      (r.instrucao ? '\n\n' + r.instrucao : ''));
  } catch (err) {
    saida.textContent = '⚠️ ' + err.message;
  } finally { btn.disabled = false; }
});

/* ============================================================
   CONFIGURAÇÕES
   ============================================================ */
$('#formPerfil').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('#perfilNome').value.trim();
  if (!nome) return;
  try {
    const { error } = await sb.from('perfis').update({ nome }).eq('id', usuario.id);
    if (error) throw error;
    perfil.nome = nome;
    $('#usuarioNome').textContent = nome;
    $('#usuarioAvatar').textContent = iniciais(nome);
    toast('✅ Perfil salvo');
  } catch (err) { toast('⚠️ ' + err.message); }
});

/* Seletor interno das Configurações: "Minha conta" x "Equipe e sistema" */
$$('#configTabs .config-pilula').forEach(b => b.addEventListener('click', () => {
  const secao = b.dataset.secao;
  $$('#configTabs .config-pilula').forEach(x => x.classList.toggle('ativo', x === b));
  $$('.config-secao').forEach(s => s.classList.toggle('ativa', s.id === `config-${secao}`));
}));

/* Trocar a própria senha — direto no cliente, via Supabase Auth.
   Regras: mínimo 8 caracteres e as duas iguais. */
$('#formSenha').addEventListener('submit', async e => {
  e.preventDefault();
  const s1 = $('#senhaNova').value, s2 = $('#senhaNova2').value;
  const msg = $('#senhaMsg'), btn = $('#btnTrocarSenha');
  const mostrar = (texto, ok) => {
    msg.textContent = texto;
    msg.className = 'form-msg ' + (ok ? 'ok' : 'erro');
    msg.hidden = false;
  };
  if (s1.length < 8) return mostrar('A senha precisa ter pelo menos 8 caracteres.', false);
  if (s1 !== s2)     return mostrar('As duas senhas não são iguais. Confira e tente de novo.', false);

  btn.disabled = true; btn.textContent = 'Trocando…';
  try {
    const { error } = await sb.auth.updateUser({ password: s1 });
    if (error) throw error;
    $('#formSenha').reset();
    mostrar('✅ Senha trocada. Use a nova da próxima vez que entrar.', true);
    toast('✅ Senha alterada com sucesso');
  } catch (err) {
    mostrar('⚠️ Não consegui trocar: ' + (err.message || 'erro desconhecido'), false);
  } finally {
    btn.disabled = false; btn.textContent = 'Trocar senha';
  }
});

/* A seção "Equipe e sistema" (WhatsApp Cloud API + equipe) é só para admin.
   Para atendente, escondemos o seletor e deixamos apenas "Minha conta".
   Só mexe na apresentação — a lógica de permissão de cada card continua igual. */
function aplicarPapelConfig() {
  const ehAdmin = perfil?.papel === 'admin';
  const tabs = $('#configTabs');
  if (tabs) tabs.style.display = ehAdmin ? '' : 'none';
  if (!ehAdmin) {
    $$('.config-secao').forEach(s => s.classList.toggle('ativa', s.id === 'config-conta'));
    $$('#configTabs .config-pilula').forEach(p => p.classList.toggle('ativo', p.dataset.secao === 'conta'));
  }
}

async function carregarEquipe() {
  const ehAdmin = perfil?.papel === 'admin';
  $('#blocoCadastro').hidden  = !ehAdmin;   // só o dono cadastra
  $('#avisoCadastro').hidden  = ehAdmin;
  try {
    const { data } = await sb.from('perfis').select('*').order('created_at');
    const el = $('#listaEquipe');
    const lista = data || [];
    el.innerHTML = lista.length ? lista.map(p => `
      <div class="equipe-item${p.ativo ? '' : ' inativo'}">
        <span class="avatar">${esc(iniciais(p.nome))}</span>
        <div class="equipe-txt">
          <strong>${esc(p.nome)}</strong>${p.id === perfil.id ? ' <em class="voce">(você)</em>' : ''}
          <br><small>${esc(p.email)}${p.ativo ? '' : ' · sem acesso'}</small>
        </div>
        ${ehAdmin ? `
          <label class="equipe-rodizio" title="Recebe clientes novos pelo rodízio">
            <input type="checkbox" data-rodizio="${esc(p.id)}" ${p.recebe_leads ? 'checked' : ''} />
            <span>recebe</span>
          </label>
          <select class="equipe-papel" data-papel="${esc(p.id)}" title="O que esta pessoa pode fazer">
            <option value="atendente"${p.papel === 'admin' ? '' : ' selected'}>Atendente</option>
            <option value="admin"${p.papel === 'admin' ? ' selected' : ''}>Administrador</option>
          </select>` : `<span class="equipe-papel-txt">${p.papel === 'admin' ? 'Administrador' : 'Atendente'}</span>`}
        ${ehAdmin && p.id !== perfil.id ? `<button class="btn btn-ghost sm" data-membro="${esc(p.id)}"
            data-ativar="${p.ativo ? '0' : '1'}">${p.ativo ? 'Tirar acesso' : 'Devolver acesso'}</button>` : ''}
      </div>`).join('')
      : '<div class="vazio">Só você por enquanto.</div>';

    /* Entrar ou sair do rodízio de clientes novos. Serve para férias e para
       quem só administra, sem precisar tirar o acesso da pessoa. */
    $$('#listaEquipe [data-rodizio]').forEach(cx => cx.addEventListener('change', async () => {
      cx.disabled = true;
      try {
        const r = await (await fetch('/api/equipe/rodizio', {
          method: 'POST', headers: await authCabecalhos(),
          body: JSON.stringify({ id: cx.dataset.rodizio, recebe: cx.checked }),
        })).json();
        if (!r.ok) throw new Error(r.erro || 'não consegui alterar');
        toast(cx.checked ? '✅ Volta a receber clientes novos' : '⏸ Fora do rodízio');
        await carregarNomesDaEquipe();
      } catch (err) {
        cx.checked = !cx.checked;   // desfaz o visual: o banco não mudou
        toast('⚠️ ' + err.message);
      } finally { cx.disabled = false; }
    }));

    /* Troca de função. O servidor recusa rebaixar o último administrador —
       sem isso dá para se trancar para fora do próprio sistema. */
    $$('#listaEquipe [data-papel]').forEach(s => s.addEventListener('change', async () => {
      const antes = s.dataset.antes || (s.querySelector('option[selected]')?.value ?? 'atendente');
      s.disabled = true;
      try {
        const r = await (await fetch('/api/equipe/papel', {
          method: 'POST', headers: await authCabecalhos(),
          body: JSON.stringify({ id: s.dataset.papel, papel: s.value }),
        })).json();
        if (!r.ok) throw new Error(r.erro || 'não consegui mudar');
        toast(s.value === 'admin' ? '✅ Agora é administrador' : '✅ Agora é atendente');
        // mudar o próprio papel muda o que você enxerga: recarrega o perfil
        if (s.dataset.papel === perfil.id) { location.reload(); return; }
        await carregarEquipe();
      } catch (err) {
        toast('⚠️ ' + err.message);
        s.value = antes;
        s.disabled = false;
      }
    }));

    // ligar/desligar o acesso de alguém
    $$('#listaEquipe [data-membro]').forEach(b => b.addEventListener('click', async () => {
      const ativar = b.dataset.ativar === '1';
      if (!ativar && !confirm('Tirar o acesso desta pessoa? Ela não conseguirá mais entrar.')) return;
      b.disabled = true;
      try {
        const r = await (await fetch('/api/equipe/ativo', {
          method: 'POST', headers: await authCabecalhos(),
          body: JSON.stringify({ id: b.dataset.membro, ativo: ativar }),
        })).json();
        if (!r.ok) throw new Error(r.erro || 'não consegui alterar');
        toast(ativar ? '✅ Acesso devolvido' : '🔒 Acesso removido');
        await carregarEquipe();
      } catch (err) { toast('⚠️ ' + err.message); b.disabled = false; }
    }));
  } catch {
    $('#listaEquipe').innerHTML = '<div class="vazio">Você vê apenas o seu próprio perfil.</div>';
  }
}

/* Cadastro feito pelo servidor: no plano free o Supabase limita o e-mail de
   confirmação, então signUp pela tela trava. E cadastro aberto num sistema com
   dado de cliente seria porta destrancada — quem entra é quem o dono cadastrou. */
$('#formNovoMembro').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('#btnNovoMembro');
  btn.disabled = true; btn.textContent = 'Cadastrando…';
  try {
    const r = await (await fetch('/api/equipe', {
      method: 'POST', headers: await authCabecalhos(),
      body: JSON.stringify({
        nome:  f.nome.value.trim(),
        email: f.email.value.trim(),
        senha: f.senha.value,
        papel: f.papel.value,
      }),
    })).json();
    if (!r.ok) throw new Error(r.erro || 'não consegui cadastrar');
    toast(`✅ ${r.nome} cadastrado — entregue o e-mail e a senha para a pessoa`);
    f.reset();
    await carregarEquipe();
  } catch (err) {
    toast('⚠️ ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Cadastrar';
  }
});

const MASCARA = '•';
async function carregarWhatsappConfig() {
  const ehAdmin = perfil?.papel === 'admin';
  $('#avisoAdmin').hidden = ehAdmin;
  $$('#formWhatsapp input, #formWhatsapp button').forEach(i => i.disabled = !ehAdmin);
  if (!ehAdmin) return;

  try {
    const { data } = await sb.from('whatsapp_config').select('*').maybeSingle();
    if (!data) return;
    const f = $('#formWhatsapp');
    f.numero_exibicao.value     = data.numero_exibicao || '';
    f.phone_number_id.value     = data.phone_number_id || '';
    f.business_account_id.value = data.business_account_id || '';
    f.ativo.checked             = !!data.ativo;
    $('#maskToken').textContent = data.access_token
      ? `Salvo: ${MASCARA.repeat(8)}${String(data.access_token).slice(-4)} — deixe em branco para manter.`
      : '';
  } catch { /* sem permissão: já avisado acima */ }
}

$('#formWhatsapp').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const dados = {
    id: true,
    numero_exibicao:     f.numero_exibicao.value.trim() || null,
    phone_number_id:     f.phone_number_id.value.trim() || null,
    business_account_id: f.business_account_id.value.trim() || null,
    ativo:               f.ativo.checked,
  };
  // segredo em branco = não mexi nele
  const tok = f.access_token.value.trim();
  if (tok && !tok.startsWith(MASCARA)) dados.access_token = tok;

  try {
    const { error } = await sb.from('whatsapp_config').upsert(dados);
    if (error) throw error;
    f.access_token.value = '';
    await carregarWhatsappConfig();
    toast('✅ Configuração salva');
  } catch (err) { toast('⚠️ ' + err.message); }
});

/* ============================================================
   ATALHOS  —  digite "/" no chat
   ============================================================ */
let ATALHOS = [];
let SERVICOS = [];
let CONSULTORES = [];
let atalhoEditando = null;
let filtroCategoria = '';
let menuAberto = false, menuIndice = 0, menuFiltrados = [];

const VARIAVEIS = ['{nome}','{primeiro_nome}','{carro}','{placa}','{servico}','{horario}','{consultor}','{atendente}'];

async function carregarAtalhos() {
  try {
    const { data, error } = await sb.from('atalhos_mensagem').select('*').order('ordem');
    if (error) throw error;
    ATALHOS = data || [];
    renderAtalhos();
  } catch (err) { toast('⚠️ ' + err.message); }
}

async function carregarApoio() {
  const [s, c] = await Promise.all([
    sb.from('servicos').select('id,nome,preco,duracao_min').eq('ativo', true).order('nome'),
    sb.from('consultores').select('id,nome').eq('ativo', true).order('nome'),
  ]);
  SERVICOS = s.data || [];
  CONSULTORES = c.data || [];

  const opServ = SERVICOS.map(x => `<option value="${x.id}" data-preco="${x.preco}">${esc(x.nome)}</option>`).join('');
  const opCons = CONSULTORES.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  $('#agendarServico').innerHTML = '<option value="">Selecione…</option>' + opServ;
  $('#agendarConsultor').innerHTML = '<option value="">Qualquer um</option>' + opCons;
  $('#atalhoConsultor').innerHTML = '<option value="">Qualquer um</option>' + opCons;
}

/* Troca {variaveis} pelos dados reais do cliente da conversa aberta */
function aplicarVariaveis(texto, extra = {}) {
  const nome = conversaAtual?.nome || '';
  const dados = {
    nome,
    primeiro_nome: (nome.trim().split(/\s+/)[0]) || 'tudo bem',
    carro: fichaCache?.carro_modelo || 'seu carro',
    placa: fichaCache?.placa || '',
    servico: extra.servico || '',
    horario: extra.horario || (fichaCache?.proximo_horario
      ? new Date(fichaCache.proximo_horario).toLocaleString('pt-BR',
          { weekday:'long', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
      : ''),
    consultor: extra.consultor || '',
    atendente: perfil?.nome || '',
  };
  return String(texto).replace(/\{(\w+)\}/g, (m, k) =>
    dados[k] !== undefined && dados[k] !== '' ? dados[k] : m);
}

let fichaCache = null;   // dados do cliente da conversa aberta (para as variáveis)

/* ---------- Menu do "/" ---------- */
function fecharMenuAtalhos() {
  menuAberto = false;
  $('#atalhoMenu').hidden = true;
}

function abrirMenuAtalhos(termo = '') {
  const t = termo.toLowerCase();
  menuFiltrados = ATALHOS.filter(a => a.ativo &&
    (a.comando.includes(t) || a.titulo.toLowerCase().includes(t)));

  if (!menuFiltrados.length) return fecharMenuAtalhos();

  menuAberto = true;
  menuIndice = 0;
  $('#atalhoMenu').hidden = false;
  renderMenuAtalhos();
}

function renderMenuAtalhos() {
  $('#atalhoLista').innerHTML = menuFiltrados.map((a, i) => `
    <div class="atalho-op ${i === menuIndice ? 'marcado' : ''}" data-i="${i}">
      <span class="atalho-op-cmd">/${esc(a.comando)}</span>
      <span class="atalho-op-txt">
        <strong>${esc(a.titulo)}</strong>
        <small>${esc(a.corpo.replace(/\n/g, ' ').slice(0, 70))}</small>
      </span>
    </div>`).join('');
  $$('.atalho-op', $('#atalhoLista')).forEach(el =>
    el.addEventListener('click', () => usarAtalho(menuFiltrados[+el.dataset.i])));
  $('.atalho-op.marcado')?.scrollIntoView({ block: 'nearest' });
}

async function usarAtalho(a) {
  if (!a) return;
  campo.value = aplicarVariaveis(a.corpo);
  campo.dispatchEvent(new Event('input'));
  fecharMenuAtalhos();
  campo.focus();
  // conta o uso, para saber quais atalhos valem a pena
  sb.from('atalhos_mensagem').update({ usos: (a.usos || 0) + 1 }).eq('id', a.id).then(() => {});
}

/* Detecta "/" no começo da mensagem */
campo.addEventListener('input', () => {
  const v = campo.value;
  const m = v.match(/^\/(\w*)$/);      // só quando a barra abre a mensagem
  if (m) abrirMenuAtalhos(m[1]);
  else fecharMenuAtalhos();
});

/* Teclado dentro do menu (adicionado ANTES do handler de envio existente) */
campo.addEventListener('keydown', e => {
  if (!menuAberto) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault(); e.stopImmediatePropagation();
    menuIndice = (menuIndice + 1) % menuFiltrados.length; renderMenuAtalhos();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); e.stopImmediatePropagation();
    menuIndice = (menuIndice - 1 + menuFiltrados.length) % menuFiltrados.length; renderMenuAtalhos();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault(); e.stopImmediatePropagation();
    usarAtalho(menuFiltrados[menuIndice]);
  } else if (e.key === 'Escape') {
    e.preventDefault(); e.stopImmediatePropagation();
    fecharMenuAtalhos();
  }
}, true);   // captura: roda antes do "Enter envia"

/* ---------- Aba de atalhos ---------- */
function renderAtalhos() {
  const lista = filtroCategoria ? ATALHOS.filter(a => a.categoria === filtroCategoria) : ATALHOS;
  const el = $('#atalhosGrade');
  if (!lista.length) {
    el.innerHTML = '<div class="vazio">Nenhum atalho nesta categoria.</div>';
    return;
  }
  el.innerHTML = lista.map(a => `
    <div class="atalho-cartao ${a.ativo ? '' : 'inativo'}" data-id="${a.id}">
      <div class="ac-topo">
        <span class="ac-cmd">/${esc(a.comando)}</span>
        <span class="ac-cat">${esc(a.categoria || 'geral')}</span>
      </div>
      <h4>${esc(a.titulo)}</h4>
      <div class="ac-corpo">${esc(a.corpo)}</div>
      <div class="ac-rodape">${a.usos || 0} usos${a.ativo ? '' : ' · desativado'}</div>
    </div>`).join('');
  $$('.atalho-cartao', el).forEach(c =>
    c.addEventListener('click', () => abrirModalAtalho(ATALHOS.find(a => a.id === c.dataset.id))));
}

$$('#filtrosCategoria .chip').forEach(c => c.addEventListener('click', () => {
  $$('#filtrosCategoria .chip').forEach(x => x.classList.toggle('ativo', x === c));
  filtroCategoria = c.dataset.cat;
  renderAtalhos();
}));

function abrirModalAtalho(a = null) {
  atalhoEditando = a;
  const f = $('#formAtalho');
  $('#tituloModalAtalho').textContent = a ? 'Editar atalho' : 'Novo atalho';
  $('#btnExcluirAtalho').hidden = !a;
  f.comando.value      = a?.comando ?? '';
  f.titulo.value       = a?.titulo ?? '';
  f.corpo.value        = a?.corpo ?? '';
  f.categoria.value    = a?.categoria ?? 'geral';
  f.consultor_id.value = a?.consultor_id ?? '';
  f.ativo.checked      = a ? a.ativo : true;
  $('#modalAtalhoBg').classList.add('aberto');
}

$('#btnNovoAtalho').addEventListener('click', () => abrirModalAtalho(null));

// clicar numa variável insere no texto
$('#varsAtalho').innerHTML = VARIAVEIS.map(v => `<code>${v}</code>`).join('');
$$('#varsAtalho code').forEach(c => c.addEventListener('click', () => {
  const ta = $('#formAtalho').corpo;
  const p = ta.selectionStart ?? ta.value.length;
  ta.value = ta.value.slice(0, p) + c.textContent + ta.value.slice(ta.selectionEnd ?? p);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = p + c.textContent.length;
}));

$('#formAtalho').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const dados = {
    comando:      f.comando.value.trim().replace(/^\//, ''),
    titulo:       f.titulo.value.trim(),
    corpo:        f.corpo.value,
    categoria:    f.categoria.value,
    consultor_id: f.consultor_id.value || null,
    ativo:        f.ativo.checked,
  };
  if (!dados.comando || !dados.titulo || !dados.corpo) return toast('Preencha comando, título e mensagem.');

  try {
    const { error } = atalhoEditando
      ? await sb.from('atalhos_mensagem').update(dados).eq('id', atalhoEditando.id)
      : await sb.from('atalhos_mensagem').insert(dados);
    if (error) throw error;
    $('#modalAtalhoBg').classList.remove('aberto');
    await carregarAtalhos();
    toast(atalhoEditando ? '✅ Atalho atualizado' : '✅ Atalho criado');
  } catch (err) {
    toast(/duplicate|unique/i.test(err.message)
      ? '⚠️ Já existe um atalho com esse comando.' : '⚠️ ' + err.message);
  }
});

$('#btnExcluirAtalho').addEventListener('click', async () => {
  if (!atalhoEditando || !confirm(`Excluir o atalho /${atalhoEditando.comando}?`)) return;
  try {
    const { error } = await sb.from('atalhos_mensagem').delete().eq('id', atalhoEditando.id);
    if (error) throw error;
    $('#modalAtalhoBg').classList.remove('aberto');
    await carregarAtalhos();
    toast('🗑️ Atalho excluído');
  } catch (err) { toast('⚠️ ' + err.message); }
});

/* Voltar do chat para a lista (celular) */
$('#btnVoltarLista').addEventListener('click', () => {
  $('.conversas-layout').classList.remove('vendo-chat');
});

/* ============================================================
   AGENDAR  —  cria cliente + lead (CRM) + horário (Agenda)
   ============================================================ */
/* ============================================================
   ASSUMIR O ATENDIMENTO
   Ao assumir, o Carlos para de responder ESTE cliente (/stop-ai no
   fluxo dele) e a conversa vai para "Em atendimento" no funil.
   Ao devolver, ele volta a atender (/start-ai).
   ============================================================ */
function renderBotaoAssumir() {
  const b = $('#btnAssumir');
  if (!b || !conversaAtual) return;
  const minha  = conversaAtual.atribuida_a === perfil?.id;
  const deOutro = conversaAtual.atribuida_a && !minha;

  if (minha) {
    b.textContent = '↩️ Devolver para a IA';
    b.title = 'Devolver este cliente para o Carlos atender';
    b.classList.add('assumido');
  } else if (deOutro) {
    b.textContent = '🙋 Assumir';
    b.title = 'Esta conversa já está com outro atendente';
    b.classList.remove('assumido');
  } else {
    b.textContent = '🙋 Assumir';
    b.title = 'Assumir este atendimento — o Carlos para de responder este cliente';
    b.classList.remove('assumido');
  }
}

async function assumirAtendimento(assumir, forcar = false) {
  const b = $('#btnAssumir');
  const original = b.textContent;
  b.disabled = true;
  b.innerHTML = '<span class="girando"></span>' + (assumir ? 'Assumindo…' : 'Devolvendo…');
  try {
    const r = await (await fetch('/api/conversas/assumir', {
      method: 'POST', headers: await authCabecalhos(),
      body: JSON.stringify({ conversaId: conversaAtual.id, assumir, forcar }),
    })).json();

    // já é de outra pessoa: pergunta antes de tomar
    if (r.precisaConfirmar) {
      if (confirm(`${r.erro}\n\nAssumir mesmo assim?`)) {
        b.disabled = false; b.textContent = original;
        return assumirAtendimento(assumir, true);
      }
      return;
    }
    if (!r.ok) throw new Error(r.erro || 'não consegui alterar');

    // devolver ao Carlos não tira o dono — só assumir muda de responsável
    if (assumir) conversaAtual.atribuida_a = perfil.id;
    conversaAtual.ia_ativa    = !assumir;
    await carregarConversas();
    if (abaVisivel('funil')) await carregarFunil();
    const atual = CONVERSAS.find(c => c.id === conversaAtual.id);
    if (atual) { conversaAtual = atual; renderEtapaDoChat(); }

    if (r.aviso) toast('⚠️ ' + r.aviso);
    else toast(assumir
      ? '🙋 Atendimento assumido — o Carlos parou de responder este cliente'
      : '↩️ Devolvido — o Carlos voltou a atender este cliente');
  } catch (err) {
    toast('⚠️ ' + err.message);
  } finally {
    b.disabled = false;
    renderBotaoAssumir();
  }
}

$('#btnAssumir').addEventListener('click', () => {
  if (!conversaAtual) return toast('Abra uma conversa primeiro.');
  assumirAtendimento(conversaAtual.atribuida_a !== perfil?.id);
});

$('#btnAgendar').addEventListener('click', () => {
  if (!conversaAtual) return;
  $('#agendarQuem').textContent =
    `${conversaAtual.nome || conversaAtual.telefone} · ${conversaAtual.telefone}`;
  const f = $('#formAgendar');
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
  f.data.value = amanha.toISOString().slice(0, 10);
  f.veiculo.value = fichaCache?.carro_modelo || '';
  f.placa.value   = fichaCache?.placa || '';
  f.origem.value  = fichaCache?.origem || 'whatsapp';
  $('#modalAgendarBg').classList.add('aberto');
});

$('#agendarServico').addEventListener('change', e => {
  const op = e.target.selectedOptions[0];
  const f = $('#formAgendar');
  if (op?.dataset.preco && !f.valor.value) f.valor.value = op.dataset.preco;
});

$('#formAgendar').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const servNome = $('#agendarServico').selectedOptions[0]?.textContent || '';
  if (!f.servico_id.value) return toast('Escolha o serviço.');

  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="girando"></span>Agendando…';

  try {
    const valor = Number(f.valor.value) || 0;
    // guarda antes do reset() — senão a mensagem de confirmação sai com "Invalid Date"
    const dataEsc = f.data.value, horaEsc = f.hora.value;
    const consultorNome = $('#agendarConsultor').selectedOptions[0]?.textContent || '';

    // 1) LEAD no CRM — registra origem, serviço e valor previsto
    const { data: lead, error: e1 } = await sb.from('leads').insert({
      nome:         conversaAtual.nome || conversaAtual.telefone,
      telefone:     conversaAtual.telefone,
      carro_modelo: f.veiculo.value.trim() || null,
      placa:        f.placa.value.trim().toUpperCase() || null,
      servico:      servNome,
      servico_id:   f.servico_id.value,
      valor_orcado: valor,
      origem:       f.origem.value,
      status:       'agendado',
      observacoes:  f.observacoes.value.trim() || null,
    }).select().single();
    if (e1) throw e1;

    // 2) AGENDAMENTO na Agenda, amarrado ao lead (a ponte)
    const { error: e2 } = await sb.from('agendamentos').insert({
      lead_id:      lead.id,
      cliente_id:   lead.cliente_id,
      cliente_nome: lead.nome,
      telefone:     lead.telefone,
      veiculo:      lead.carro_modelo,
      placa:        lead.placa,
      servico:      servNome,
      servico_id:   f.servico_id.value,
      data:         f.data.value,
      hora:         f.hora.value,
      consultor_id: f.consultor_id.value || null,
      origem:       f.origem.value,
      valor,
      status:       'confirmado',
      observacoes:  f.observacoes.value.trim() || null,
    });
    if (e2) throw e2;

    // 3) liga a conversa ao cadastro, se ainda não estava
    if (!conversaAtual.cliente_id && lead.cliente_id) {
      await sb.from('conversas').update({ cliente_id: lead.cliente_id }).eq('id', conversaAtual.id);
      conversaAtual.cliente_id = lead.cliente_id;
    }

    $('#modalAgendarBg').classList.remove('aberto');
    f.reset();

    // 4) já oferece a mensagem de confirmação pronta
    const quando = new Date(`${dataEsc}T${horaEsc}`)
      .toLocaleString('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const conf = ATALHOS.find(a => a.comando === 'confirmar');
    if (conf) {
      campo.value = aplicarVariaveis(conf.corpo,
        { horario: quando, servico: servNome, consultor: consultorNome });
      campo.dispatchEvent(new Event('input'));
    }

    await carregarFicha(conversaAtual);
    toast('📅 Agendado! Lead criado no CRM e horário na Agenda.');
  } catch (err) {
    toast('⚠️ ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar agendamento';
  }
});

/* ============================================================
   FUNIL — as plaquinhas de etapa
   A etapa mora em conversas.etapa_id. Um gatilho no banco carimba
   etapa_em, grava o histórico e empurra o lead do CRM sozinho —
   aqui só precisamos gravar o etapa_id certo.
   ============================================================ */
let ETAPAS = [];                    // todas (inclusive inativas), em ordem
let FUNIL_CFG = { ia_classifica: false, confianca_minima: 0.6, tabelaExiste: false };
let CONTAGEM_ETAPAS = new Map();    // etapa_id -> nº de conversas
let CONVERSAS_FUNIL = [];           // o que o quadro está mostrando agora
let etapaEditando = null;

const etapaPorId   = id => ETAPAS.find(e => e.id === id) || null;
const etapasAtivas = () => ETAPAS.filter(e => e.ativa);
const abaVisivel   = nome => !!$(`#aba-${nome}`)?.classList.contains('ativa');
const ehAdminAqui  = () => perfil?.papel === 'admin';

/* Cor que veio do banco NUNCA entra crua no style: ou é #rrggbb, ou vira cinza. */
const corSegura = hex =>
  (/^#[0-9a-f]{6}$/i.test(String(hex ?? '').trim()) ? String(hex).trim().toLowerCase() : '#8b8b96');

/** A mesma cor, translúcida — o fundo da plaquinha no tema escuro. */
function corComAlfa(hex, alfa) {
  const n = parseInt(corSegura(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
}

/** Há quanto tempo a conversa está parada nesta etapa. */
function tempoParado(iso) {
  if (!iso) return { texto: 'sem registro de quando entrou', dias: 0 };
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return { texto: 'agora há pouco', dias: 0 };
  const min = Math.floor(ms / 60000);
  if (min < 60)  return { texto: min <= 1 ? 'agora há pouco' : `há ${min} min`, dias: 0 };
  const h = Math.floor(min / 60);
  if (h < 24)    return { texto: h === 1 ? 'há 1 hora' : `há ${h} horas`, dias: 0 };
  const d = Math.floor(h / 24);
  return { texto: d === 1 ? 'há 1 dia' : `há ${d} dias`, dias: d };
}
const PARADO_DEMAIS = 3;    // dias

async function carregarEtapas() {
  try {
    const { data, error } = await sb.from('etapas_funil')
      .select('*').order('ordem').order('nome');
    if (error) throw error;
    ETAPAS = data || [];
  } catch (err) {
    ETAPAS = [];
    toast('⚠️ Não consegui ler as etapas do funil: ' + err.message);
  }
}

async function carregarConfigFunil() {
  try {
    const { data, error } = await sb.from('funil_config').select('*').maybeSingle();
    if (error) throw error;
    const c = Number(data?.confianca_minima);
    FUNIL_CFG = {
      ia_classifica: !!data?.ia_classifica,
      confianca_minima: Number.isFinite(c) && c >= 0 && c <= 1 ? c : 0.6,
      tabelaExiste: true,
    };
  } catch {
    // Tabela ainda não criada (migração 23) ou sem permissão: segue sem a
    // classificação automática, em vez de derrubar o resto do app.
    FUNIL_CFG = { ia_classifica: false, confianca_minima: 0.6, tabelaExiste: false };
  }
}

async function carregarContagemEtapas() {
  try {
    const { data, error } = await sb.from('conversas').select('etapa_id').limit(2000);
    if (error) throw error;
    const m = new Map();
    for (const c of (data || [])) {
      if (!c.etapa_id) continue;
      m.set(c.etapa_id, (m.get(c.etapa_id) || 0) + 1);
    }
    CONTAGEM_ETAPAS = m;
  } catch { CONTAGEM_ETAPAS = new Map(); }
}

/* ---------------- A plaquinha ---------------- */
document.getElementById('btnSoMinhas')?.addEventListener('click', (ev) => {
  soMinhas = !soMinhas;
  localStorage.setItem('indycar_so_minhas', soMinhas ? '1' : '0');
  ev.currentTarget.classList.toggle('ativo', soMinhas);
  renderConversas();
});

/* ============================================================
   DE QUEM É O CLIENTE
   Cada conversa nova cai com dono, escolhido pelo rodízio no banco. A
   plaquinha existe porque, sem ela, os dois olhavam a mesma fila achando
   que o outro ia responder — e o cliente ficava esperando.
   ============================================================ */
let EQUIPE = new Map();          // id -> {nome, papel}
let soMinhas = localStorage.getItem('indycar_so_minhas') === '1';

/* Vem do servidor, não do Supabase direto: o RLS de `perfis` só deixa admin
   ler todo mundo, então um atendente lendo do navegador enxergaria só a si
   mesmo — e a plaquinha do colega ficaria sem nome. */
async function carregarNomesDaEquipe() {
  try {
    const r = await (await fetch('/api/equipe/nomes', { headers: await authCabecalhos() })).json();
    if (!r.ok || !Array.isArray(r.equipe)) throw new Error(r.erro || 'resposta inesperada');
    EQUIPE = new Map(r.equipe.map(p => [p.id, p]));
  } catch (err) {
    /* Falha passageira não apaga a lista que já estava boa. Só avisa quando
       a tela ficaria realmente cega. */
    if (!EQUIPE.size) toast('⚠️ Não consegui ler a equipe: ' + err.message);
  }
}

/* Cor estável por pessoa: a mesma pessoa fica sempre da mesma cor, sem
   precisar guardar cor nenhuma. Tons escolhidos para não colidir com o
   vermelho da marca nem com o verde/âmbar das etapas. */
const CORES_DONO = ['#3b82f6', '#a855f7', '#0ea5e9', '#14b8a6', '#f97316', '#ec4899'];
function corDoDono(id = '') {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return CORES_DONO[n % CORES_DONO.length];
}

function donoHtml(conv) {
  const id = conv?.atribuida_a;
  if (!id) {
    return `<button type="button" class="dono sem-dono" data-dono="${esc(conv.id)}"
      title="Ninguém responsável — clique para assumir">👤 sem dono</button>`;
  }
  const p = EQUIPE.get(id);
  const nome = p?.nome || '';
  const eu = id === perfil?.id;
  const cor = corDoDono(id);
  /* Sem nome na lista, mostra "?" em vez de cortar um rótulo genérico na
     primeira palavra — "outro atendente" virava só "outro" e parecia nome. */
  const rotulo = eu ? '★ meu' : (nome ? primeiroNome(nome) : '?');
  const dica = eu ? 'Este cliente é seu'
             : nome ? `Responsável: ${nome}` : 'Responsável fora da sua lista';
  return `<button type="button" class="dono${eu ? ' eu' : ''}" data-dono="${esc(conv.id)}"
    style="--dn-cor:${cor};--dn-fundo:${corComAlfa(cor, .16)}"
    title="${esc(dica)} — clique para passar para outra pessoa">
    ${esc(rotulo)}</button>`;
}

const primeiroNome = (n = '') => String(n).trim().split(/\s+/)[0] || n;

function plaquinhaHtml(conv) {
  const e = etapaPorId(conv?.etapa_id);
  const cor = corSegura(e?.cor);
  const rotulo = e ? `${e.emoji ? e.emoji + ' ' : ''}${e.nome}` : 'Sem etapa';
  const marcaIa = (e && conv?.etapa_por_ia)
    ? '<i class="pl-ia" title="Etapa carimbada pela IA">✨</i>' : '';
  const classes = ['plaquinha'];
  if (!e) classes.push('neutra');
  if (e && !e.ativa) classes.push('inativa');
  return `<button type="button" class="${classes.join(' ')}"
    style="--pl-cor:${cor};--pl-fundo:${corComAlfa(cor, .15)}"
    title="Etapa do funil — clique para trocar">${esc(rotulo)}${marcaIa}</button>`;
}

function renderEtapaDoChat() {
  const el = $('#chatEtapa');
  if (!el) return;
  if (!conversaAtual) { el.innerHTML = ''; return; }
  el.innerHTML = plaquinhaHtml(conversaAtual);
  const p = $('.plaquinha', el);
  p?.addEventListener('click', ev => { ev.stopPropagation(); abrirMenuEtapas(p, conversaAtual); });
}

/* ---------------- Menu de troca de etapa ---------------- */
let convDoMenu = null;

function fecharMenuEtapas() {
  const el = $('#menuEtapas');
  if (el) el.hidden = true;
  convDoMenu = null;
}

function abrirMenuEtapas(ancora, conv) {
  if (!conv) return;
  const el = $('#menuEtapas');
  // clicar de novo na mesma plaquinha fecha
  if (!el.hidden && convDoMenu?.id === conv.id) return fecharMenuEtapas();
  convDoMenu = conv;

  const ativas = etapasAtivas();
  const opcoes = ativas.map(e => {
    const cor = corSegura(e.cor);
    const atual = e.id === conv.etapa_id;
    return `<button type="button" class="menu-etapa-op${atual ? ' atual' : ''}" data-etapa="${esc(e.id)}">
      <i style="background:${cor}"></i>
      <span>${esc(`${e.emoji ? e.emoji + ' ' : ''}${e.nome}`)}</span>
      ${atual ? '<b>atual</b>' : ''}
    </button>`;
  }).join('');

  $('#menuEtapasLista').innerHTML =
    (ativas.length ? opcoes
      : '<div class="menu-etapas-vazio">Nenhuma etapa ativa. Cadastre na aba <b>Etapas</b>.</div>')
    + (conv.etapa_id
        ? '<button type="button" class="menu-etapa-op limpar" data-etapa="">Tirar a etapa</button>' : '');

  $$('#menuEtapasLista .menu-etapa-op').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const alvo = convDoMenu;
    fecharMenuEtapas();
    trocarEtapa(alvo, b.dataset.etapa || null);
  }));

  // mede escondido: sem isto o menu pisca no lugar antigo antes de se acertar
  el.style.visibility = 'hidden';
  el.hidden = false;
  posicionarMenu(el, ancora);
  el.style.visibility = '';
}

/* Passar o cliente para outra pessoa. Mesmo desenho do menu de etapas:
   ancorado na plaquinha, sem modal, um clique só. */
let convDoMenuDono = null;

function fecharMenuDono() {
  const el = $('#menuDono');
  if (el) el.hidden = true;
  convDoMenuDono = null;
}

function abrirMenuDono(ancora, conv) {
  if (!conv) return;
  const el = $('#menuDono');
  if (!el.hidden && convDoMenuDono?.id === conv.id) return fecharMenuDono();
  fecharMenuEtapas();
  convDoMenuDono = conv;

  const gente = [...EQUIPE.values()].filter(p => p.ativo)
    .sort((a, b) => (a.id === perfil?.id ? -1 : b.id === perfil?.id ? 1 : a.nome.localeCompare(b.nome)));

  const opcoes = gente.map(p => {
    const atual = p.id === conv.atribuida_a;
    return `<button type="button" class="menu-etapa-op${atual ? ' atual' : ''}" data-novo="${esc(p.id)}">
      <i style="background:${corDoDono(p.id)}"></i>
      <span>${esc(p.nome)}${p.id === perfil?.id ? ' (você)' : ''}</span>
      ${atual ? '<b>atual</b>' : ''}
    </button>`;
  }).join('');

  $('#menuDonoLista').innerHTML = (gente.length ? opcoes
      : '<div class="menu-etapas-vazio">Ninguém cadastrado ainda.</div>')
    + (conv.atribuida_a
        ? '<button type="button" class="menu-etapa-op limpar" data-novo="">Deixar sem dono</button>' : '');

  $$('#menuDonoLista .menu-etapa-op').forEach(b => b.addEventListener('click', async ev => {
    ev.stopPropagation();
    const alvo = convDoMenuDono;
    fecharMenuDono();
    await trocarDono(alvo, b.dataset.novo || null);
  }));

  el.style.visibility = 'hidden';
  el.hidden = false;
  posicionarMenu(el, ancora);
  el.style.visibility = '';
}

async function trocarDono(conv, novoId) {
  if (!conv) return;
  const antes = conv.atribuida_a;
  conv.atribuida_a = novoId;           // pinta na hora; desfaz se o banco recusar
  renderConversas();
  try {
    const { error } = await sb.from('conversas')
      .update({ atribuida_a: novoId }).eq('id', conv.id);
    if (error) throw error;
    const nome = novoId ? (EQUIPE.get(novoId)?.nome || 'outra pessoa') : null;
    toast(novoId
      ? (novoId === perfil?.id ? '★ Cliente é seu agora' : `👤 Passou para ${nome}`)
      : 'Cliente ficou sem dono');
    await carregarConversas();
  } catch (err) {
    conv.atribuida_a = antes;
    renderConversas();
    toast('⚠️ ' + err.message);
  }
}

function posicionarMenu(el, ancora) {
  const r = ancora.getBoundingClientRect();
  const larg = el.offsetWidth, alt = el.offsetHeight;
  let x = r.left;
  let y = r.bottom + 6;
  if (x + larg > window.innerWidth - 8)  x = window.innerWidth - larg - 8;
  if (x < 8) x = 8;
  if (y + alt > window.innerHeight - 8)  y = Math.max(8, r.top - alt - 6);
  el.style.left = `${Math.round(x)}px`;
  el.style.top  = `${Math.round(y)}px`;
}

document.addEventListener('click', e => {
  if ($('#menuEtapas').hidden) return;
  if (!e.target.closest('#menuEtapas')) fecharMenuEtapas();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharMenuEtapas(); });
window.addEventListener('resize', fecharMenuEtapas);
window.addEventListener('scroll', ev => {
  // rolar DENTRO do próprio menu não pode fechá-lo
  if (ev.target?.closest?.('#menuEtapas')) return;
  fecharMenuEtapas();
}, true);

/* ---------------- Gravar a troca ---------------- */
async function trocarEtapa(conv, etapaId) {
  if (!conv) return;
  const alvo = etapaId || null;
  if ((conv.etapa_id || null) === alvo) return;

  // A escolha do atendente manda: cancela a classificação automática pendente,
  // senão a IA responderia segundos depois e desfaria o que a pessoa acabou de fazer.
  clearTimeout(timersClassificacao.get(conv.id));
  timersClassificacao.delete(conv.id);

  const antes = etapaPorId(conv.etapa_id);
  try {
    // etapa_por_ia = false: foi gente que mexeu, e a plaquinha perde o ✨
    const { error } = await sb.from('conversas')
      .update({ etapa_id: alvo, etapa_por_ia: false }).eq('id', conv.id);
    if (error) throw error;

    // atualiza na hora, sem esperar o tempo real
    conv.etapa_id = alvo;
    conv.etapa_em = new Date().toISOString();
    conv.etapa_por_ia = false;
    const daFunil = CONVERSAS_FUNIL.find(c => c.id === conv.id);
    if (daFunil && daFunil !== conv) {
      daFunil.etapa_id = alvo; daFunil.etapa_em = conv.etapa_em; daFunil.etapa_por_ia = false;
    }

    renderConversas();
    renderEtapaDoChat();
    if (abaVisivel('funil')) renderFunil();

    const depois = etapaPorId(alvo);
    toast(depois
      ? `🏷️ ${depois.emoji ? depois.emoji + ' ' : ''}${depois.nome}${antes ? ` (antes: ${antes.nome})` : ''}`
      : '🏷️ Etapa removida desta conversa');
  } catch (err) {
    toast('⚠️ Não consegui trocar a etapa: ' + err.message);
  }
}

/* ============================================================
   ABA FUNIL — o quadro
   ============================================================ */
async function carregarFunil() {
  const quadro = $('#funilQuadro');
  quadro.innerHTML = '<div class="vazio"><span class="girando"></span>Montando o funil…</div>';
  try {
    const { data, error } = await sb.from('conversas')
      .select('id,nome,telefone,cliente_id,etapa_id,etapa_em,etapa_por_ia,ultima_previa,'
            + 'ultima_mensagem_em,status,clientes(carro_modelo,placa)')
      .order('etapa_em', { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) throw error;
    CONVERSAS_FUNIL = data || [];
    renderFunil();
  } catch (err) {
    CONVERSAS_FUNIL = [];
    $('#funilResumo').innerHTML = '';
    quadro.innerHTML = `<div class="vazio">Não consegui montar o funil: ${esc(err.message)}</div>`;
  }
}

function renderFunil() {
  const quadro = $('#funilQuadro');
  const resumo = $('#funilResumo');
  const ativas = etapasAtivas();

  if (!ativas.length) {
    resumo.innerHTML = '';
    quadro.innerHTML = `<div class="vazio">Nenhuma etapa ativa cadastrada.<br><br>
      Vá em <b>Etapas</b> e crie pelo menos uma para o funil ter colunas.</div>`;
    return;
  }

  const porEtapa = new Map(ativas.map(e => [e.id, []]));
  const semEtapa = [];
  let ganhos = 0, perdidos = 0, abertos = 0;

  for (const c of CONVERSAS_FUNIL) {
    const e = c.etapa_id ? etapaPorId(c.etapa_id) : null;
    if (!e || !e.ativa) { semEtapa.push(c); continue; }
    porEtapa.get(e.id).push(c);
    if (e.ganho) ganhos++;
    else if (e.perda) perdidos++;
    else abertos++;
  }
  const noFunil = ganhos + perdidos + abertos;

  if (!CONVERSAS_FUNIL.length) {
    resumo.innerHTML = '';
    quadro.innerHTML = `<div class="vazio">Ainda não há nenhuma conversa no sistema.<br><br>
      Assim que o primeiro cliente mandar mensagem no WhatsApp — ou você abrir uma conversa
      na aba <b>Conversas</b> — ela aparece aqui para ser encaixada numa etapa.</div>`;
    return;
  }
  // Nenhuma conversa encaixada ainda: em vez de um resumo só de zeros, explica
  // o que fazer — e mostra o quadro mesmo assim, para já dar para arrastar.
  resumo.innerHTML = !noFunil ? `<p class="funil-nota">Existem
      <b>${esc(String(CONVERSAS_FUNIL.length))}</b> ${CONVERSAS_FUNIL.length === 1 ? 'conversa' : 'conversas'},
      mas nenhuma foi encaixada numa etapa ainda. Arraste os cartões da coluna
      <b>Sem etapa</b> para a etapa certa — ou abra a conversa e use o botão
      <b>✨ Classificar</b>.</p>` : `
    <div class="kpi"><b>${esc(String(noFunil))}</b><span>no funil</span>
      <small>de ${esc(String(CONVERSAS_FUNIL.length))} conversas</small></div>
    <div class="kpi roxa"><b>${esc(String(abertos))}</b><span>em andamento</span>
      <small>ainda dá para ganhar</small></div>
    <div class="kpi verde"><b>${esc(String(ganhos))}</b><span>ganhos</span>
      <small>etapas marcadas como venda ganha</small></div>
    <div class="kpi vermelha"><b>${esc(String(perdidos))}</b><span>perdidos</span>
      <small>etapas marcadas como venda perdida</small></div>`;

  const colunas = ativas.map(e => colunaHtml(e, porEtapa.get(e.id)));
  if (semEtapa.length) colunas.unshift(colunaHtml(null, semEtapa));
  quadro.innerHTML = colunas.join('');

  ligarArrastar();
}

function colunaHtml(etapa, lista) {
  const cor = etapa ? corSegura(etapa.cor) : '#8b8b96';
  const titulo = etapa ? `${etapa.emoji ? etapa.emoji + ' ' : ''}${etapa.nome}` : '⚪ Sem etapa';
  const marca = etapa ? '' : '<small class="col-nota">arraste para dentro de uma etapa</small>';
  return `<section class="funil-coluna" data-etapa="${esc(etapa?.id ?? '')}"
      style="--col-cor:${cor};--col-fundo:${corComAlfa(cor, .12)}">
    <header class="col-topo">
      <span class="col-nome">${esc(titulo)}</span>
      <b class="col-conta">${esc(String(lista.length))}</b>
    </header>
    ${marca}
    <div class="funil-cartoes">
      ${lista.length ? lista.map(cartaoHtml).join('')
        : '<p class="col-vazia">Nenhum cliente nesta etapa.</p>'}
    </div>
  </section>`;
}

function cartaoHtml(c) {
  const parado = tempoParado(c.etapa_em);
  const atrasado = parado.dias >= PARADO_DEMAIS;
  const carro = [c.clientes?.carro_modelo, c.clientes?.placa].filter(Boolean).join(' · ');
  return `<article class="funil-cartao${atrasado ? ' atrasado' : ''}" draggable="true" data-id="${esc(c.id)}">
    <div class="fc-topo">
      <strong>${esc(c.nome || c.telefone)}</strong>
      ${c.etapa_por_ia ? '<i class="pl-ia" title="Etapa carimbada pela IA">✨</i>' : ''}
    </div>
    <small class="fc-tel">${esc(c.telefone || '')}</small>
    ${carro ? `<small class="fc-carro">${esc(carro)}</small>` : ''}
    <p class="fc-previa">${esc(c.ultima_previa || 'sem mensagens')}</p>
    <div class="fc-rodape">
      <span class="fc-tempo${atrasado ? ' alerta' : ''}">${atrasado ? '● ' : ''}${esc(parado.texto)}</span>
      <button type="button" class="fc-mover" title="Mover para outra etapa">⇄ Mover</button>
    </div>
  </article>`;
}

/* ---------------- Arrastar e soltar (e o botão Mover, para o celular) ---------------- */
function ligarArrastar() {
  const quadro = $('#funilQuadro');

  $$('.funil-cartao', quadro).forEach(cart => {
    cart.addEventListener('dragstart', ev => {
      ev.dataTransfer.setData('text/plain', cart.dataset.id);
      ev.dataTransfer.effectAllowed = 'move';
      cart.classList.add('arrastando');
      fecharMenuEtapas();
    });
    cart.addEventListener('dragend', () => cart.classList.remove('arrastando'));

    // clique no cartão abre a conversa…
    cart.addEventListener('click', () => irParaConversa(cart.dataset.id));

    // …menos no botão Mover, que abre o menu de etapas (o caminho do celular)
    $('.fc-mover', cart)?.addEventListener('click', ev => {
      ev.stopPropagation();
      const conv = CONVERSAS_FUNIL.find(c => c.id === cart.dataset.id);
      if (conv) abrirMenuEtapas(ev.currentTarget, conv);
    });
  });

  $$('.funil-coluna', quadro).forEach(col => {
    col.addEventListener('dragover', ev => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      col.classList.add('sobre');
    });
    col.addEventListener('dragleave', ev => {
      // só apaga o destaque quando o ponteiro sai da coluna de verdade
      if (!col.contains(ev.relatedTarget)) col.classList.remove('sobre');
    });
    col.addEventListener('drop', async ev => {
      ev.preventDefault();
      col.classList.remove('sobre');
      const id = ev.dataTransfer.getData('text/plain');
      const conv = CONVERSAS_FUNIL.find(c => c.id === id);
      if (!conv) return;
      await trocarEtapa(conv, col.dataset.etapa || null);
    });
  });
}

/** Vai para a aba Conversas já com a conversa aberta. */
function irParaConversa(id) {
  if (!id) return;
  $$('.nav-item').find(b => b.dataset.aba === 'conversas')?.click();
  abrirConversa(id);
}

$('#btnRecarregarFunil').addEventListener('click', async () => {
  await carregarEtapas();
  await carregarFunil();
  toast('🔄 Funil atualizado');
});

/* ============================================================
   ABA ETAPAS — personalização (edição só para admin)
   ============================================================ */
async function atualizarAbaEtapas() {
  await carregarContagemEtapas();
  renderEtapasAdmin();
}

function renderEtapasAdmin() {
  const el = $('#listaEtapas');
  if (!el) return;
  const admin = ehAdminAqui();

  /* --- a chavinha da IA --- */
  const chave = $('#chaveIaClassifica');
  const aviso = $('#avisoIaFunil');
  chave.checked = !!FUNIL_CFG.ia_classifica;
  chave.disabled = !admin || !FUNIL_CFG.tabelaExiste;
  if (!FUNIL_CFG.tabelaExiste) {
    aviso.innerHTML = 'A tabela <code>funil_config</code> ainda não existe no banco. '
      + 'Rode o arquivo <code>supabase/migracoes/23_funil_config.sql</code> no SQL Editor do '
      + 'Supabase para esta chavinha funcionar. Até lá, a classificação automática fica '
      + 'desligada — o botão <b>✨ Classificar</b> do chat continua funcionando normalmente.';
  } else if (!admin) {
    aviso.textContent = 'Só o administrador liga ou desliga a classificação automática.';
  } else {
    aviso.innerHTML = `A IA só grava quando tem pelo menos
      <b>${esc(String(Math.round(FUNIL_CFG.confianca_minima * 100)))}%</b> de confiança.
      Abaixo disso ela mantém a etapa como está — e você continua podendo trocar na mão.`;
  }

  $('#btnNovaEtapa').hidden = !admin;

  if (!ETAPAS.length) {
    el.innerHTML = `<div class="vazio">Nenhuma etapa cadastrada.${
      admin ? '<br><br>Clique em <b>+ Nova etapa</b> para criar a primeira.'
            : '<br><br>Peça ao administrador para cadastrar as etapas.'}</div>`;
    return;
  }

  el.innerHTML = (admin ? '' : '<p class="aviso" style="margin:0 0 12px">Você está vendo as etapas '
      + 'em modo leitura. Só o administrador pode criar, editar ou reordenar.</p>')
    + ETAPAS.map((e, i) => {
    const cor = corSegura(e.cor);
    const quantas = CONTAGEM_ETAPAS.get(e.id) || 0;
    const gatilhos = Array.isArray(e.gatilhos) ? e.gatilhos : [];
    return `<article class="etapa-linha${e.ativa ? '' : ' inativa'}" data-id="${esc(e.id)}"
        style="--et-cor:${cor};--et-fundo:${corComAlfa(cor, .15)}">
      <span class="etapa-barra"></span>
      <div class="etapa-corpo">
        <div class="etapa-topo">
          <span class="plaquinha" style="--pl-cor:${cor};--pl-fundo:${corComAlfa(cor, .15)}"
            >${esc(`${e.emoji ? e.emoji + ' ' : ''}${e.nome}`)}</span>
          <span class="selo">ordem ${esc(String(e.ordem ?? 0))}</span>
          ${e.ganho ? '<span class="selo on">ganho</span>' : ''}
          ${e.perda ? '<span class="selo off">perda</span>' : ''}
          ${e.ativa ? '' : '<span class="selo">inativa</span>'}
        </div>
        <p class="etapa-desc">${esc(e.descricao || 'Sem descrição — a IA fica sem essa pista.')}</p>
        <div class="etapa-gatilhos">
          ${gatilhos.length ? gatilhos.map(g => `<code>${esc(g)}</code>`).join('')
            : '<small class="etapa-sem">sem gatilhos cadastrados</small>'}
        </div>
        <div class="etapa-meta">
          CRM: <b>${esc(e.status_lead || 'não mexe')}</b> ·
          <b>${esc(String(quantas))}</b> ${quantas === 1 ? 'conversa aqui' : 'conversas aqui'}
        </div>
      </div>
      ${admin ? `<div class="etapa-acoes">
        <button type="button" class="btn btn-ghost sm" data-acao="subir"  ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
        <button type="button" class="btn btn-ghost sm" data-acao="descer" ${i === ETAPAS.length - 1 ? 'disabled' : ''} title="Descer">↓</button>
        <button type="button" class="btn btn-ghost sm" data-acao="ligar">${e.ativa ? 'Desativar' : 'Ativar'}</button>
        <button type="button" class="btn btn-primary sm" data-acao="editar">Editar</button>
      </div>` : ''}
    </article>`;
  }).join('');

  if (!admin) return;
  $$('.etapa-linha [data-acao]', el).forEach(b => b.addEventListener('click', () => {
    const id = b.closest('.etapa-linha')?.dataset.id;
    const etapa = etapaPorId(id);
    if (!etapa) return;
    if (b.dataset.acao === 'editar') return abrirModalEtapa(etapa);
    if (b.dataset.acao === 'ligar')  return alternarEtapa(etapa);
    reordenarEtapa(etapa, b.dataset.acao === 'subir' ? -1 : 1);
  }));
}

/** Troca a ordem com a etapa vizinha. Como `ordem` não é única, basta trocar os números. */
async function reordenarEtapa(etapa, passo) {
  const i = ETAPAS.findIndex(e => e.id === etapa.id);
  const j = i + passo;
  if (i < 0 || j < 0 || j >= ETAPAS.length) return;
  const outra = ETAPAS[j];
  // se as duas têm a mesma ordem, trocar os números não move nada:
  // reescreve a lista inteira com a posição nova
  const nova = ETAPAS.slice();
  nova.splice(i, 1);
  nova.splice(j, 0, etapa);
  try {
    for (let k = 0; k < nova.length; k++) {
      if (nova[k].ordem === k + 1) continue;
      const { error } = await sb.from('etapas_funil').update({ ordem: k + 1 }).eq('id', nova[k].id);
      if (error) throw error;
    }
    await carregarEtapas();
    renderEtapasAdmin();
    renderConversas();
    if (abaVisivel('funil')) renderFunil();
    toast(`↕️ ${etapa.nome} agora vem ${passo < 0 ? 'antes de' : 'depois de'} ${outra.nome}`);
  } catch (err) { toast('⚠️ ' + err.message); }
}

async function alternarEtapa(etapa) {
  try {
    const { error } = await sb.from('etapas_funil').update({ ativa: !etapa.ativa }).eq('id', etapa.id);
    if (error) throw error;
    await carregarEtapas();
    renderEtapasAdmin();
    renderConversas();
    renderEtapaDoChat();
    if (abaVisivel('funil')) renderFunil();
    toast(etapa.ativa ? `🚫 "${etapa.nome}" desativada` : `✅ "${etapa.nome}" ativada`);
  } catch (err) { toast('⚠️ ' + err.message); }
}

/* ---------------- Modal da etapa ---------------- */
function abrirModalEtapa(etapa = null) {
  if (!ehAdminAqui()) return toast('Só o administrador pode mexer nas etapas.');
  etapaEditando = etapa;
  const f = $('#formEtapa');
  $('#tituloModalEtapa').textContent = etapa ? 'Editar etapa' : 'Nova etapa';
  $('#btnExcluirEtapa').hidden = !etapa;
  f.nome.value        = etapa?.nome ?? '';
  f.emoji.value       = etapa?.emoji ?? '';
  f.cor.value         = corSegura(etapa?.cor);
  f.ordem.value       = etapa?.ordem ?? (ETAPAS.length ? Math.max(...ETAPAS.map(e => e.ordem || 0)) + 1 : 1);
  f.status_lead.value = etapa?.status_lead ?? '';
  f.descricao.value   = etapa?.descricao ?? '';
  f.gatilhos.value    = Array.isArray(etapa?.gatilhos) ? etapa.gatilhos.join(', ') : '';
  f.ganho.checked     = !!etapa?.ganho;
  f.perda.checked     = !!etapa?.perda;
  f.ativa.checked     = etapa ? !!etapa.ativa : true;
  $('#modalEtapaBg').classList.add('aberto');
}

$('#btnNovaEtapa').addEventListener('click', () => abrirModalEtapa(null));

/** "quanto custa, preço , , preço" -> ["quanto custa","preço"] */
function listaDeGatilhos(texto) {
  const vistos = new Set();
  return String(texto || '').split(',')
    .map(g => g.trim().slice(0, 80))
    .filter(g => {
      if (!g) return false;
      const k = g.toLowerCase();
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .slice(0, 40);
}

$('#formEtapa').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const nome = f.nome.value.trim();
  if (!nome) return toast('Dê um nome para a etapa.');
  if (f.ganho.checked && f.perda.checked) {
    return toast('Uma etapa não pode ser ganho e perda ao mesmo tempo.');
  }

  const dados = {
    nome,
    emoji:       f.emoji.value.trim() || null,
    cor:         corSegura(f.cor.value),
    ordem:       Number.parseInt(f.ordem.value, 10) || 0,
    status_lead: f.status_lead.value || null,
    descricao:   f.descricao.value.trim() || null,
    gatilhos:    listaDeGatilhos(f.gatilhos.value),
    ganho:       f.ganho.checked,
    perda:       f.perda.checked,
    ativa:       f.ativa.checked,
  };

  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { error } = etapaEditando
      ? await sb.from('etapas_funil').update(dados).eq('id', etapaEditando.id)
      : await sb.from('etapas_funil').insert(dados);
    if (error) throw error;

    $('#modalEtapaBg').classList.remove('aberto');
    await carregarEtapas();
    await atualizarAbaEtapas();
    renderConversas();
    renderEtapaDoChat();
    if (abaVisivel('funil')) renderFunil();
    toast(etapaEditando ? '✅ Etapa atualizada' : '✅ Etapa criada');
  } catch (err) {
    toast(/duplicate|unique/i.test(err.message)
      ? '⚠️ Já existe uma etapa com esse nome.'
      : '⚠️ ' + err.message);
  } finally { btn.disabled = false; }
});

$('#btnExcluirEtapa').addEventListener('click', async () => {
  if (!etapaEditando) return;
  const alvo = etapaEditando;
  try {
    // NUNCA apagar uma etapa que ainda tem conversa: a chave estrangeira é
    // ON DELETE SET NULL — as conversas ficariam órfãs, sem plaquinha e sem aviso.
    const { count, error: erroConta } = await sb.from('conversas')
      .select('id', { count: 'exact', head: true }).eq('etapa_id', alvo.id);
    if (erroConta) throw erroConta;

    if (count > 0) {
      const quer = confirm(
        `Não dá para excluir "${alvo.nome}": ${count} ${count === 1 ? 'conversa está' : 'conversas estão'} `
        + `nesta etapa e ${count === 1 ? 'ficaria' : 'ficariam'} sem plaquinha.\n\n`
        + 'Quer DESATIVAR a etapa? Ela some do funil e dos menus, mas o histórico continua inteiro.');
      if (quer) {
        $('#modalEtapaBg').classList.remove('aberto');
        await alternarEtapa({ ...alvo, ativa: true });   // força para inativa
        await atualizarAbaEtapas();
      }
      return;
    }

    if (!confirm(`Excluir a etapa "${alvo.nome}"? Isso não dá para desfazer.`)) return;
    const { error } = await sb.from('etapas_funil').delete().eq('id', alvo.id);
    if (error) throw error;

    $('#modalEtapaBg').classList.remove('aberto');
    await carregarEtapas();
    await atualizarAbaEtapas();
    renderConversas();
    if (abaVisivel('funil')) renderFunil();
    toast('🗑️ Etapa excluída');
  } catch (err) { toast('⚠️ ' + err.message); }
});

/* ---------------- Chavinha: a IA classifica sozinha ---------------- */
$('#chaveIaClassifica').addEventListener('change', async e => {
  const ligada = e.target.checked;
  if (!ehAdminAqui()) { e.target.checked = !ligada; return toast('Só o administrador muda isto.'); }
  if (!FUNIL_CFG.tabelaExiste) {
    e.target.checked = false;
    return toast('⚠️ Rode a migração 23_funil_config.sql antes de ligar isto.');
  }
  try {
    const { error } = await sb.from('funil_config')
      .upsert({ id: true, ia_classifica: ligada });
    if (error) throw error;
    FUNIL_CFG.ia_classifica = ligada;
    toast(ligada
      ? '✨ A IA vai atualizar as plaquinhas sozinha quando o cliente escrever'
      : '🛑 A IA parou de classificar sozinha — só no botão ✨ Classificar');
  } catch (err) {
    e.target.checked = !ligada;
    toast('⚠️ ' + err.message);
  }
});

/* ============================================================
   IA — classificar a etapa de uma conversa
   ============================================================ */
const timersClassificacao = new Map();   // conversaId -> timeout
const classificandoAgora  = new Set();   // não pede duas vezes a mesma conversa

/** Mensagem nova do cliente: espera o cliente terminar de digitar (as pessoas
    mandam 3 mensagens seguidas) e só então gasta uma chamada de IA. */
function agendarClassificacaoAutomatica(conversaId) {
  if (!FUNIL_CFG.ia_classifica || !conversaId) return;
  clearTimeout(timersClassificacao.get(conversaId));
  timersClassificacao.set(conversaId, setTimeout(() => {
    timersClassificacao.delete(conversaId);
    classificarConversa(conversaId, { silencioso: true });
  }, 6000));
}

async function classificarConversa(conversaId, { silencioso = false } = {}) {
  if (!conversaId || classificandoAgora.has(conversaId)) return null;
  classificandoAgora.add(conversaId);
  try {
    const r = await (await fetch('/api/ia/classificar', {
      method: 'POST', headers: await authCabecalhos(),
      // clique do atendente fura a espera do servidor; automático respeita,
      // para várias abas abertas não pagarem a mesma classificação
      body: JSON.stringify({ conversaId, forcar: !silencioso }),
    })).json();

    if (!r.ok) {
      if (!silencioso) toast('⚠️ ' + (r.erro || 'a IA não conseguiu classificar'));
      return r;
    }

    await carregarConversas();
    if (abaVisivel('funil')) await carregarFunil();

    if (r.mudou) {
      toast(`✨ ${r.etapaDepois}${r.motivo ? ' — ' + r.motivo : ''}`);
    } else if (!silencioso) {
      toast('✨ ' + (r.aviso || 'A IA manteve a etapa atual.') + (r.motivo ? ' ' + r.motivo : ''));
    }
    return r;
  } catch (err) {
    if (!silencioso) toast('⚠️ ' + err.message);
    return null;
  } finally {
    classificandoAgora.delete(conversaId);
  }
}

$('#btnClassificar').addEventListener('click', async () => {
  if (!conversaAtual) return toast('Abra uma conversa primeiro.');
  const btn = $('#btnClassificar');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="girando"></span>Lendo…';
  try { await classificarConversa(conversaAtual.id); }
  finally { btn.disabled = false; btn.innerHTML = original; }
});

/* ============================================================
   CODEWORDS
   ============================================================ */
async function carregarCodeWords() {
  const ehAdmin = perfil?.papel === 'admin';
  // O botão Copiar fica FORA do formulário: precisa ser travado à parte
  $$('#formCodeWords input, #formCodeWords button, #btnCopiarWebhook')
    .forEach(i => i.disabled = !ehAdmin);
  if (!ehAdmin) {
    // Nada de mostrar endereço para quem não configura — evita copiarem o errado
    $('#urlWebhook').textContent = '—';
    $('#avisoWebhook').textContent = '';
    $('#cwStatus').textContent = 'Só quem é admin pode configurar esta parte.';
    return;
  }
  try {
    const { data } = await sb.from('codewords_config').select('*').maybeSingle();
    // O webhook mora no Supabase (Edge Function) — funciona 24h, sem depender deste PC.
    // Só mostra o endereço quando ele veio do banco; nunca inventa localhost.
    $('#urlWebhook').textContent = data?.url_webhook_publica
      || 'Ainda não configurado — salve as configurações abaixo.';
    if (!data) return;
    const f = $('#formCodeWords');
    f.url_envio.value      = data.url_envio || '';
    f.service_id.value     = data.service_id || '';
    f.token_webhook.value  = data.token_webhook || '';
    f.ativo.checked        = !!data.ativo;
    f.responder_auto.checked = !!data.responder_auto;
    $('#maskCW').textContent = data.api_key
      ? `Salva: ${MASCARA.repeat(8)}${String(data.api_key).slice(-4)} — deixe em branco para manter.` : '';

    const selo = $('#seloCW');
    selo.textContent = data.ativo ? 'ligado' : 'desligado';
    selo.className = 'selo ' + (data.ativo ? 'on' : '');

    $('#cwStatus').className = 'cw-status' + (data.ultimo_erro ? ' erro' : '');
    $('#cwStatus').innerHTML = data.ultimo_erro
      ? `Último erro: <b>${esc(data.ultimo_erro)}</b>`
      : (data.ultimo_evento_em
          ? `Última troca de mensagem: <b>${new Date(data.ultimo_evento_em).toLocaleString('pt-BR')}</b>`
          : 'Ainda não houve nenhuma troca de mensagem.');
  } catch { /* sem permissão */ }
}

$('#formCodeWords').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const dados = {
    id: true,
    url_envio:      f.url_envio.value.trim() || null,
    service_id:     f.service_id.value.trim() || null,
    token_webhook:  f.token_webhook.value.trim() || null,
    ativo:          f.ativo.checked,
    responder_auto: f.responder_auto.checked,
  };
  const k = f.api_key.value.trim();
  if (k && !k.startsWith(MASCARA)) dados.api_key = k;

  try {
    const { error } = await sb.from('codewords_config').upsert(dados);
    if (error) throw error;
    f.api_key.value = '';
    await carregarCodeWords();
    await carregarFluxos();     // o Service ID novo pode ter trocado qual fluxo é o de envio
    toast('✅ CodeWords configurado');
  } catch (err) { toast('⚠️ ' + err.message); }
});

$('#btnTestarCW').addEventListener('click', async () => {
  const btn = $('#btnTestarCW');
  btn.disabled = true;
  btn.innerHTML = '<span class="girando"></span>Testando…';
  try {
    const r = await (await fetch('/api/codewords/testar', {
      method:'POST', headers: await authCabecalhos(),
      body: JSON.stringify({ telefone: conversaAtual?.telefone }),
    })).json();
    toast(r.ok ? '✅ O CodeWords respondeu — conexão funcionando'
               : '⚠️ ' + (r.erro || 'não consegui falar com o CodeWords'));
    await carregarCodeWords();
  } catch (err) { toast('⚠️ ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Testar conexão'; }
});

/* Lista dos fluxos cadastrados no CodeWords. O de envio é o que
   bate com o service_id da configuração. Só admin enxerga (RLS). */
async function carregarFluxos() {
  const el = $('#listaFluxos');
  if (perfil?.papel !== 'admin') {
    el.innerHTML = '<div class="vazio">Só quem é admin vê os fluxos.</div>';
    return;
  }
  try {
    const [fluxos, cfg] = await Promise.all([
      sb.from('codewords_fluxos').select('*').order('nome'),
      sb.from('codewords_config').select('service_id').maybeSingle(),
    ]);
    const lista = fluxos.data || [];
    const idDeEnvio = cfg.data?.service_id || null;

    el.innerHTML = lista.length ? lista.map(f => {
      const ehEnvio = idDeEnvio && f.service_id === idDeEnvio;
      return `<div class="fluxo-item ${ehEnvio ? 'envio' : ''}">
        <div class="fluxo-topo">
          <strong>${esc(f.nome || 'sem nome')}</strong>
          ${ehEnvio ? '<span class="selo on mini">envio</span>'
                    : '<span class="selo mini">referência</span>'}
        </div>
        <code class="fluxo-id">${esc(f.service_id || '—')}</code>
        ${f.papel ? `<p class="fluxo-papel">${esc(f.papel)}</p>` : ''}
      </div>`;
    }).join('')
      : '<div class="vazio">Nenhum fluxo cadastrado na tabela <code>codewords_fluxos</code>.</div>';

    if (lista.length && !idDeEnvio) {
      el.insertAdjacentHTML('beforeend',
        '<p class="aviso">Nenhum fluxo está marcado como o de envio — preencha o Service ID acima.</p>');
    }
  } catch (err) {
    el.innerHTML = `<div class="vazio">Não consegui ler os fluxos: ${esc(err.message)}</div>`;
  }
}

$('#btnCopiarWebhook').addEventListener('click', async () => {
  // Copia o endereço COM os cabeçalhos: só a URL não basta — sem o apikey o
  // Supabase barra a requisição antes de ela chegar no nosso código.
  const f = $('#formCodeWords');
  const receita = [
    'POST ' + $('#urlWebhook').textContent,
    'Content-Type: application/json',
    'apikey: ' + (CONFIG?.supabaseAnonKey || '(a chave publicável do Supabase)'),
    'x-codewords-token: ' + (f.token_webhook.value || '(o token do webhook)'),
    '',
    'Corpo: {"telefone":"55129...","mensagem":"texto do cliente","nome":"nome no WhatsApp"}',
  ].join('\n');
  try {
    await navigator.clipboard.writeText(receita);
    toast('📋 Endereço e cabeçalhos copiados');
  } catch { toast('Copie manualmente os dados acima.'); }
});

/* ============================================================
   RELATÓRIOS
   Os números vêm prontos de /api/relatorios. Aqui só desenhamos:
   SVG escrito à mão, sem biblioteca nenhuma.
   ============================================================ */
const COR = { verde:'#22c55e', vermelho:'#e50914', laranja:'#f59e0b',
              roxo:'#6366f1', azul:'#3b82f6' };
/* Cores de eixo / grade / base / texto dos gráficos: mudam com o tema.
   São relidas do CSS a cada desenho (ver lerCoresRelatorio), por isso são let.
   As cores de DADO (verde, vermelho, laranja…) ficam iguais nos dois temas. */
let COR_EIXO   = '#8b8b93';
let COR_GRADE  = 'rgba(255,255,255,.08)';
let COR_BASE   = 'rgba(255,255,255,.2)';
let COR_ROTULO = '#d5d5da';
let COR_TOTAL  = '#f5f5f7';
function lerCoresRelatorio() {
  const s = getComputedStyle(document.documentElement);
  const g = (nome, alt) => (s.getPropertyValue(nome).trim() || alt);
  COR_EIXO   = g('--rel-eixo',   '#8b8b93');
  COR_GRADE  = g('--rel-grade',  'rgba(255,255,255,.08)');
  COR_BASE   = g('--rel-base',   'rgba(255,255,255,.2)');
  COR_ROTULO = g('--rel-rotulo', '#d5d5da');
  COR_TOTAL  = g('--rel-total',  '#f5f5f7');
}
const DIA_SEMANA       = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const DIA_SEMANA_CURTO = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

let RELATORIO = null;

const num = n => (Number(n) || 0).toLocaleString('pt-BR');
const pct = v => (v === null || v === undefined ? '—'
  : Number(v).toLocaleString('pt-BR', { minimumFractionDigits:1, maximumFractionDigits:1 }) + '%');
function minutosTexto(v) {
  if (v === null || v === undefined) return '—';
  if (v < 1) return 'menos de 1 min';
  if (v < 90) return `${Math.round(v)} min`;
  const h = Math.floor(v / 60), m = Math.round(v % 60);
  return m ? `${h}h ${m}min` : `${h}h`;
}
const ddmm = dia => `${dia.slice(8,10)}/${dia.slice(5,7)}`;
const cortar = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

/** Escala com números redondos (1, 2, 5, 10…) para o eixo não ficar feio. */
function escalaBonita(max, alvo = 4) {
  if (!(max > 0)) return { topo: 1, passo: 1 };
  const bruto = max / alvo;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const n = bruto / mag;
  const passo = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  return { topo: Math.ceil(max / passo) * passo, passo };
}

const semDados = msg => `<div class="grafico-vazio">${esc(msg)}</div>`;
const legenda = itens => `<div class="legenda">${itens.map(i =>
  `<span><i class="${i.linha ? 'linha' : ''}" style="background:${i.cor}"></i>${esc(i.nome)}</span>`).join('')}</div>`;

/* ---------- Barras agrupadas (+ linha opcional no eixo da direita) ---------- */
function graficoBarras({ rotulos, series, linha = null, altura = 300, unidadeBarra = '' }) {
  const W = 900, H = altura, ME = 50, MD = linha ? 56 : 18, MT = 14, MB = 42;
  const larg = W - ME - MD, alt = H - MT - MB;
  const n = Math.max(1, rotulos.length);

  const maior = Math.max(0, ...series.flatMap(s => s.valores.map(v => Number(v) || 0)));
  const esq = escalaBonita(maior);
  const y = v => MT + alt - (v / esq.topo) * alt;
  const faixa = larg / n;
  const largBarra = Math.max(2, Math.min(22, (faixa * 0.68) / series.length));
  const p = [];

  for (let i = 0, passos = Math.round(esq.topo / esq.passo); i <= passos; i++) {
    const v = i * esq.passo, py = y(v).toFixed(1);
    p.push(`<line x1="${ME}" y1="${py}" x2="${ME + larg}" y2="${py}" stroke="${COR_GRADE}" stroke-width="1"/>`);
    p.push(`<text x="${ME - 8}" y="${(+py + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${COR_EIXO}">${esc(num(v))}</text>`);
  }

  series.forEach((s, si) => s.valores.forEach((bruto, i) => {
    const v = Number(bruto) || 0;
    if (v <= 0) return;
    const x = ME + faixa * i + (faixa - largBarra * series.length) / 2 + si * largBarra;
    const topo = y(v);
    // a folga entre barras é proporcional: em 90 dias elas ficam finas,
    // mas nunca somem (o <title> continua entregando o valor exato)
    p.push(`<rect x="${x.toFixed(1)}" y="${topo.toFixed(1)}" width="${Math.max(1.2, largBarra * 0.86).toFixed(1)}" `
      + `height="${Math.max(1, MT + alt - topo).toFixed(1)}" rx="2" fill="${s.cor}">`
      + `<title>${esc(rotulos[i])} · ${esc(s.nome)}: ${esc(num(v))}${esc(unidadeBarra)}</title></rect>`);
  }));

  if (linha) {
    const valores = linha.valores.map(v => (v === null || v === undefined ? null : Number(v)));
    const maiorLinha = Math.max(0, ...valores.filter(v => v !== null));
    const dir = linha.formato === '%' ? { topo: 100, passo: 25 } : escalaBonita(maiorLinha);
    const y2 = v => MT + alt - (v / dir.topo) * alt;
    for (let i = 0, passos = Math.round(dir.topo / dir.passo); i <= passos; i++) {
      const v = i * dir.passo;
      p.push(`<text x="${ME + larg + 8}" y="${(y2(v) + 4).toFixed(1)}" font-size="12" fill="${linha.cor}" opacity=".8">`
        + `${esc(linha.formato === '%' ? v + '%' : num(v))}</text>`);
    }
    let d = '', ligado = false;
    valores.forEach((v, i) => {
      if (v === null) { ligado = false; return; }
      d += `${ligado ? 'L' : 'M'}${(ME + faixa * i + faixa / 2).toFixed(1)} ${y2(v).toFixed(1)} `;
      ligado = true;
    });
    if (d) p.push(`<path d="${d.trim()}" fill="none" stroke="${linha.cor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
    valores.forEach((v, i) => {
      if (v === null) return;
      p.push(`<circle cx="${(ME + faixa * i + faixa / 2).toFixed(1)}" cy="${y2(v).toFixed(1)}" r="3.4" fill="${linha.cor}">`
        + `<title>${esc(rotulos[i])} · ${esc(linha.nome)}: ${esc(linha.formato === '%' ? pct(v) : num(v))}</title></circle>`);
    });
  }

  p.push(`<line x1="${ME}" y1="${MT + alt}" x2="${ME + larg}" y2="${MT + alt}" stroke="${COR_BASE}"/>`);
  const salto = Math.ceil(n / 14);
  rotulos.forEach((r, i) => {
    if (i % salto) return;
    p.push(`<text x="${(ME + faixa * i + faixa / 2).toFixed(1)}" y="${H - MB + 20}" text-anchor="middle" `
      + `font-size="12" fill="${COR_EIXO}">${esc(cortar(r, 16))}</text>`);
  });

  return `<div class="grafico${n > 16 ? ' rolagem' : ''}">
    <svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">${p.join('')}</svg></div>`;
}

/* ---------- Linha simples (tempos médios por dia) ---------- */
function graficoLinha({ rotulos, valores, amostras = [], cor, nome, altura = 250 }) {
  const W = 900, H = altura, ME = 58, MD = 18, MT = 14, MB = 42;
  const larg = W - ME - MD, alt = H - MT - MB;
  const n = Math.max(1, rotulos.length);
  const limpos = valores.map(v => (v === null || v === undefined ? null : Number(v)));
  const esq = escalaBonita(Math.max(0, ...limpos.filter(v => v !== null)));
  const y = v => MT + alt - (v / esq.topo) * alt;
  const x = i => ME + (n === 1 ? larg / 2 : (larg / (n - 1)) * i);
  const p = [];

  for (let i = 0, passos = Math.round(esq.topo / esq.passo); i <= passos; i++) {
    const v = i * esq.passo, py = y(v).toFixed(1);
    p.push(`<line x1="${ME}" y1="${py}" x2="${ME + larg}" y2="${py}" stroke="${COR_GRADE}"/>`);
    p.push(`<text x="${ME - 8}" y="${(+py + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${COR_EIXO}">${esc(num(Math.round(v)))}</text>`);
  }
  p.push(`<text x="12" y="${MT + alt / 2}" font-size="12" fill="${COR_EIXO}" transform="rotate(-90 12 ${MT + alt / 2})" text-anchor="middle">minutos</text>`);

  let d = '', ligado = false;
  limpos.forEach((v, i) => {
    if (v === null) { ligado = false; return; }
    d += `${ligado ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    ligado = true;
  });
  if (d) p.push(`<path d="${d.trim()}" fill="none" stroke="${cor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
  limpos.forEach((v, i) => {
    if (v === null) return;
    const quantas = amostras[i] || 0;
    p.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.6" fill="${cor}">`
      + `<title>${esc(rotulos[i])} · ${esc(nome)}: ${esc(minutosTexto(v))}`
      + `${quantas ? ` (${esc(num(quantas))} ${quantas === 1 ? 'conversa' : 'conversas'})` : ''}</title></circle>`);
  });

  p.push(`<line x1="${ME}" y1="${MT + alt}" x2="${ME + larg}" y2="${MT + alt}" stroke="${COR_BASE}"/>`);
  const salto = Math.ceil(n / 14);
  rotulos.forEach((r, i) => {
    if (i % salto) return;
    p.push(`<text x="${x(i).toFixed(1)}" y="${H - MB + 20}" text-anchor="middle" font-size="12" fill="${COR_EIXO}">${esc(r)}</text>`);
  });

  return `<div class="grafico${n > 16 ? ' rolagem' : ''}">
    <svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">${p.join('')}</svg></div>`;
}

/* ---------- Barras horizontais (etiquetas) ---------- */
function graficoBarrasH({ itens, cor = COR.roxo }) {
  const W = 900, ME = 200, MD = 70, MT = 6, altLinha = 32;
  const H = MT + itens.length * altLinha + 6;
  const max = Math.max(1, ...itens.map(i => Number(i.valor) || 0));
  const larg = W - ME - MD;
  const p = itens.map((it, i) => {
    const v = Number(it.valor) || 0;
    const y = MT + i * altLinha;
    const c = it.cor || cor;
    return `<text x="${ME - 10}" y="${y + 20}" text-anchor="end" font-size="13" fill="${COR_ROTULO}">${esc(cortar(it.rotulo, 26))}</text>`
      + `<rect x="${ME}" y="${y + 6}" width="${Math.max(2, (v / max) * larg).toFixed(1)}" height="19" rx="4" fill="${c}">`
      + `<title>${esc(it.rotulo)}: ${esc(num(v))}</title></rect>`
      + `<text x="${(ME + Math.max(2, (v / max) * larg) + 9).toFixed(1)}" y="${y + 20}" font-size="13" fill="${COR_EIXO}">${esc(num(v))}</text>`;
  }).join('');
  return `<div class="grafico"><svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">${p}</svg></div>`;
}

/* ---------- Rosca (atendimentos por canal) ---------- */
function graficoRosca({ fatias }) {
  const total = fatias.reduce((s, f) => s + (Number(f.valor) || 0), 0);
  const R = 68, C = 100, volta = 2 * Math.PI * R;
  let acumulado = 0;
  const arcos = fatias.filter(f => Number(f.valor) > 0).map(f => {
    const parte = Number(f.valor) / total;
    const el = `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${f.cor}" stroke-width="28"
        stroke-dasharray="${(parte * volta).toFixed(2)} ${volta.toFixed(2)}"
        stroke-dashoffset="${(-acumulado * volta).toFixed(2)}" transform="rotate(-90 ${C} ${C})">
        <title>${esc(f.rotulo)}: ${esc(num(f.valor))} (${esc(pct(parte * 100))})</title></circle>`;
    acumulado += parte;
    return el;
  }).join('');

  return `<div class="rosca-linha">
    <div class="grafico"><svg viewBox="0 0 200 200" role="img" preserveAspectRatio="xMidYMid meet">${arcos}
      <text x="100" y="98" text-anchor="middle" font-size="34" font-weight="700" fill="${COR_TOTAL}">${esc(num(total))}</text>
      <text x="100" y="120" text-anchor="middle" font-size="12" fill="${COR_EIXO}">no período</text>
    </svg></div>
    <div class="rosca-legenda">${fatias.map(f => `<div><i style="background:${f.cor}"></i>${esc(f.rotulo)}
      <b>${esc(num(f.valor))}</b></div>`).join('')}</div>
  </div>`;
}

/* ---------- Mapa de calor: hora x dia da semana ---------- */
function mapaCalorSvg({ matriz }) {
  const ME = 46, MT = 24, cel = 32, W = ME + 24 * cel + 12, H = MT + 7 * cel + 8;
  const max = Math.max(1, ...matriz.flat());
  const p = [];
  for (let h = 0; h < 24; h += 2) {
    p.push(`<text x="${ME + h * cel + cel / 2}" y="14" text-anchor="middle" font-size="12" fill="${COR_EIXO}">${h}h</text>`);
  }
  for (let s = 0; s < 7; s++) {
    p.push(`<text x="${ME - 10}" y="${MT + s * cel + cel / 2 + 4}" text-anchor="end" font-size="12" fill="${COR_EIXO}">${esc(DIA_SEMANA_CURTO[s])}</text>`);
    for (let h = 0; h < 24; h++) {
      const v = matriz[s][h];
      const opacidade = v ? (0.18 + 0.82 * (v / max)).toFixed(3) : '0.05';
      p.push(`<rect x="${ME + h * cel}" y="${MT + s * cel}" width="${cel - 3}" height="${cel - 3}" rx="4" `
        + `fill="${COR.azul}" fill-opacity="${opacidade}">`
        + `<title>${esc(DIA_SEMANA[s])}, ${esc(String(h).padStart(2,'0'))}h — ${esc(num(v))} `
        + `${v === 1 ? 'mensagem' : 'mensagens'}</title></rect>`);
    }
  }
  return `<div class="grafico rolagem"><svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">${p.join('')}</svg></div>`;
}

/* ---------- Tabelas e CSV ---------- */
function tabelaHtml({ colunas, linhas, rodape = null }) {
  return `<div class="tabela-caixa"><table class="tabela">
    <thead><tr>${colunas.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${rodape ? `<tfoot><tr>${rodape.map(c => `<td>${esc(c)}</td>`).join('')}</tr></tfoot>` : ''}
  </table></div>`;
}

const celulaCsv = v => {
  const t = String(v ?? '');
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
/** CSV com ';' e BOM: é assim que o Excel brasileiro abre certo. */
function baixarCsv(nomeArquivo, linhas) {
  const texto = linhas.map(l => l.map(celulaCsv).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- Período ---------- */
const diaTexto = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function prepararRelatorios(dias = 30) {
  const hoje = new Date();
  const antes = new Date(hoje.getTime() - (dias - 1) * 86400000);
  $('#relDe').value  = diaTexto(antes);
  $('#relAte').value = diaTexto(hoje);
}

$('#btnRelAplicar').addEventListener('click', () => {
  $$('#relAtalhos .chip').forEach(c => c.classList.remove('ativo'));
  carregarRelatorios();
});

$$('#relAtalhos .chip').forEach(c => c.addEventListener('click', () => {
  $$('#relAtalhos .chip').forEach(x => x.classList.toggle('ativo', x === c));
  prepararRelatorios(Number(c.dataset.dias) || 30);
  carregarRelatorios();
}));

async function carregarRelatorios() {
  const corpo = $('#relCorpo');
  const de = $('#relDe').value, ate = $('#relAte').value;
  if (!de || !ate) { corpo.innerHTML = semDados('Escolha as duas datas do período.'); return; }

  corpo.innerHTML = '<div class="vazio"><span class="girando"></span>Montando os relatórios…</div>';
  try {
    const resposta = await fetch(`/api/relatorios?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`,
      { headers: await authCabecalhos() });
    const r = await resposta.json();
    if (!r.ok) throw new Error(r.erro || 'não consegui montar os relatórios');
    RELATORIO = r;
    desenharRelatorios(r);
  } catch (err) {
    corpo.innerHTML = `<div class="grafico-vazio">⚠️ ${esc(err.message)}</div>`;
  }
}

function desenharRelatorios(r) {
  lerCoresRelatorio();               // pega eixo/grade/texto do tema atual
  const dias = r.periodo.dias.map(ddmm);
  const bloco = (titulo, sub, conteudo, extra = '') => `
    <section class="bloco-rel">
      <div class="bloco-cab">
        <div><h2>${esc(titulo)}</h2><p class="bloco-sub">${esc(sub)}</p></div>${extra}
      </div>${conteudo}
    </section>`;
  const botaoCsv = id => `<button class="btn btn-ghost sm" id="${id}">Baixar CSV</button>`;
  const partes = [];

  if (r.avisos?.length) {
    partes.push(`<div class="grafico-vazio" style="margin-bottom:16px;text-align:left">⚠️ ${
      r.avisos.map(a => esc(a)).join('<br>')}</div>`);
  }

  /* (a) cartões */
  partes.push(`<div class="kpis">
    <div class="kpi roxa"><span>Volume de leads</span><b>${esc(num(r.resumo.leads))}</b>
      <small>criados no período</small></div>
    <div class="kpi laranja"><span>Taxa de conversão</span><b>${esc(pct(r.resumo.conversao))}</b>
      <small>${r.resumo.ganhos + r.resumo.perdidos
        ? esc(`${num(r.resumo.ganhos)} de ${num(r.resumo.ganhos + r.resumo.perdidos)} leads decididos`)
        : 'nenhum lead decidido ainda'}</small></div>
    <div class="kpi verde"><span>Clientes ganhos</span><b>${esc(num(r.resumo.ganhos))}</b>
      <small>leads concluídos</small></div>
    <div class="kpi vermelha"><span>Clientes perdidos</span><b>${esc(num(r.resumo.perdidos))}</b>
      <small>leads perdidos</small></div>
  </div>`);

  /* (b) volume por período */
  partes.push(bloco('Volume de leads por período',
    'Barras: leads criados e leads ganhos por dia. Linha: conversão do dia (ganhos ÷ decididos).',
    r.resumo.leads
      ? legenda([{ nome:'Leads', cor:COR.roxo }, { nome:'Ganhos', cor:COR.verde },
                 { nome:'Conversão %', cor:COR.laranja, linha:true }])
        + graficoBarras({
            rotulos: dias,
            series: [{ nome:'Leads', cor:COR.roxo, valores: r.porDia.map(d => d.leads) },
                     { nome:'Ganhos', cor:COR.verde, valores: r.porDia.map(d => d.ganhos) }],
            linha: { nome:'Conversão', cor:COR.laranja, formato:'%', valores: r.porDia.map(d => d.conversao) },
          })
      : semDados('Sem dados no período — nenhum lead foi criado entre essas datas.')));

  /* (c) origem do lead */
  partes.push(bloco('Origem do lead', 'De onde vieram os leads e quantos viraram serviço.',
    r.origens.length
      ? legenda([{ nome:'Volume', cor:COR.roxo }, { nome:'Ganhos', cor:COR.verde }])
        + graficoBarras({
            rotulos: r.origens.map(o => o.rotulo),
            series: [{ nome:'Volume', cor:COR.roxo, valores: r.origens.map(o => o.volume) },
                     { nome:'Ganhos', cor:COR.verde, valores: r.origens.map(o => o.ganhos) }],
            altura: 280,
          })
        + tabelaHtml({
            colunas: ['Origem', 'Volume', 'Ganhos', 'Perdidos', 'Conversão'],
            linhas: r.origens.map(o => [o.rotulo, num(o.volume), num(o.ganhos), num(o.perdidos), pct(o.conversao)]),
          })
      : semDados('Sem dados no período — nenhum lead com origem registrada.')));

  /* (d) leads por atendente */
  partes.push(bloco('Leads por atendente',
    'O atendente vem da conversa atribuída a ele. Lead sem conversa atribuída fica em "Sem atendente".',
    r.leadsPorAtendente.length
      ? tabelaHtml({
          colunas: ['Atendente', 'Volume', 'Ganhos', 'Perdidos', 'Conversão'],
          linhas: r.leadsPorAtendente.map(a => [a.atendente, num(a.volume), num(a.ganhos), num(a.perdidos), pct(a.conversao)]),
          rodape: ['Total', num(r.resumo.leads), num(r.resumo.ganhos), num(r.resumo.perdidos), pct(r.resumo.conversao)],
        })
      : semDados('Sem dados no período — nenhum lead criado.'),
    r.leadsPorAtendente.length ? botaoCsv('csvLeadsAtendente') : ''));

  /* (e) capacidade de atendimento */
  const temCapacidade = r.capacidade.novos || r.capacidade.concluidos || r.capacidade.backlogInicial;
  partes.push(bloco('Capacidade de atendimento',
    'Conversas que entraram e conversas que foram resolvidas, dia a dia. A linha é a fila acumulada.',
    temCapacidade
      ? `<div class="kpis">
          <div class="kpi roxa"><span>Novos</span><b>${esc(num(r.capacidade.novos))}</b><small>conversas abertas</small></div>
          <div class="kpi verde"><span>Concluídos</span><b>${esc(num(r.capacidade.concluidos))}</b><small>conversas resolvidas</small></div>
          <div class="kpi laranja"><span>Desempenho</span><b>${esc(pct(r.capacidade.desempenho))}</b><small>concluídos ÷ novos</small></div>
        </div>`
        + legenda([{ nome:'Novas', cor:COR.roxo }, { nome:'Resolvidas', cor:COR.verde },
                   { nome:'Pendentes acumuladas', cor:COR.laranja, linha:true }])
        + graficoBarras({
            rotulos: dias,
            series: [{ nome:'Novas', cor:COR.roxo, valores: r.capacidade.porDia.map(d => d.novas) },
                     { nome:'Resolvidas', cor:COR.verde, valores: r.capacidade.porDia.map(d => d.resolvidas) }],
            linha: { nome:'Pendentes', cor:COR.laranja, valores: r.capacidade.porDia.map(d => d.pendentes) },
          })
      : semDados('Sem dados no período — nenhuma conversa aberta ou resolvida entre essas datas.')));

  /* (f) tempo de espera */
  partes.push(bloco('Tempo de espera',
    'Média diária entre a conversa abrir e o primeiro atendente responder.',
    r.espera.amostras
      ? `<p class="bloco-sub">Média do período: <b>${esc(minutosTexto(r.espera.media))}</b>
          em ${esc(num(r.espera.amostras))} ${r.espera.amostras === 1 ? 'conversa' : 'conversas'}.</p>`
        + graficoLinha({ rotulos: dias, cor: COR.laranja, nome: 'espera média',
            valores: r.espera.porDia.map(d => d.minutos), amostras: r.espera.porDia.map(d => d.amostras) })
      : semDados('Sem dados no período — nenhuma conversa teve a primeira resposta registrada.')));

  /* (g) duração do atendimento */
  partes.push(bloco('Duração do atendimento',
    'Média diária entre a conversa abrir e ser marcada como resolvida.',
    r.duracao.amostras
      ? `<p class="bloco-sub">Média do período: <b>${esc(minutosTexto(r.duracao.media))}</b>
          em ${esc(num(r.duracao.amostras))} ${r.duracao.amostras === 1 ? 'conversa' : 'conversas'}.</p>`
        + graficoLinha({ rotulos: dias, cor: COR.laranja, nome: 'duração média',
            valores: r.duracao.porDia.map(d => d.minutos), amostras: r.duracao.porDia.map(d => d.amostras) })
      : semDados('Sem dados no período — nenhuma conversa foi marcada como resolvida.')));

  /* (h) atendimentos por canal */
  const totalCanais = r.canais.reduce((s, c) => s + c.total, 0);
  const PALETA_CANAL = [COR.verde, COR.azul, COR.roxo, COR.laranja, COR.vermelho];
  partes.push(bloco('Atendimentos por canal',
    'Hoje só entra WhatsApp. Quando outro canal começar a chegar, ele aparece aqui sozinho.',
    totalCanais
      ? graficoRosca({ fatias: r.canais.map((c, i) => ({ rotulo: c.canal, valor: c.total,
          cor: PALETA_CANAL[i % PALETA_CANAL.length] })) })
      : semDados('Sem dados no período — nenhuma conversa aberta entre essas datas.')));

  /* (i) etiquetas */
  partes.push(bloco('Etiquetas', 'Quantas conversas do período receberam cada etiqueta.',
    r.etiquetas.length
      ? graficoBarrasH({ itens: r.etiquetas.map(e => ({ rotulo: e.nome, valor: e.total, cor: e.cor || COR.roxo })) })
      : semDados('Sem dados no período — nenhuma conversa recebeu etiqueta.')));

  /* (j) atendentes */
  partes.push(bloco('Atendentes', 'Fila e tempo médio de cada pessoa no período.',
    r.atendentes.length
      ? tabelaHtml({
          colunas: ['Atendente', 'Novas', 'Resolvidas', 'Backlog', '1ª resposta média', 'Resolução média'],
          linhas: r.atendentes.map(a => [a.nome, num(a.novas), num(a.resolvidas), num(a.backlog),
            minutosTexto(a.primeiraResposta), minutosTexto(a.resolucao)]),
        })
      : semDados('Sem dados no período — nenhuma conversa movimentada.'),
    r.atendentes.length ? botaoCsv('csvAtendentes') : ''));

  /* (k) equipes */
  partes.push(bloco('Equipes', 'Os mesmos números somados por equipe.',
    r.equipes.length
      ? tabelaHtml({
          colunas: ['Equipe', 'Novas', 'Resolvidas', 'Backlog', '1ª resposta média', 'Resolução média'],
          linhas: r.equipes.map(e => [e.nome, num(e.novas), num(e.resolvidas), num(e.backlog),
            minutosTexto(e.primeiraResposta), minutosTexto(e.resolucao)]),
        })
      : semDados('Sem dados no período — nenhuma conversa movimentada.'),
    r.equipes.length ? botaoCsv('csvEquipes') : ''));

  /* (l) volume diário */
  const pico = r.mapaCalor.pico;
  partes.push(bloco('Volume diário',
    'Mensagens recebidas por hora e dia da semana. Quanto mais claro, mais movimento.',
    r.mapaCalor.total
      ? mapaCalorSvg({ matriz: r.mapaCalor.matriz })
        + `<p class="pico">Horário de pico: <b>${esc(DIA_SEMANA[pico.semana])} às
           ${esc(String(pico.hora).padStart(2, '0'))}h</b> — ${esc(num(pico.total))}
           ${pico.total === 1 ? 'mensagem' : 'mensagens'}. Total no período:
           <b>${esc(num(r.mapaCalor.total))}</b>.</p>`
      : semDados('Sem dados no período — nenhuma mensagem recebida entre essas datas.')));

  $('#relCorpo').innerHTML = partes.join('');

  /* ---- botões de CSV ---- */
  $('#csvLeadsAtendente')?.addEventListener('click', () => baixarCsv(
    `leads-por-atendente_${r.periodo.de}_a_${r.periodo.ate}.csv`,
    [['Atendente', 'Volume', 'Ganhos', 'Perdidos', 'Conversão'],
     ...r.leadsPorAtendente.map(a => [a.atendente, a.volume, a.ganhos, a.perdidos,
       a.conversao === null ? '' : pct(a.conversao)])]));

  const linhasEquipe = lista => lista.map(x => [x.nome, x.novas, x.resolvidas, x.backlog,
    x.primeiraResposta === null ? '' : Math.round(x.primeiraResposta),
    x.resolucao === null ? '' : Math.round(x.resolucao)]);

  $('#csvAtendentes')?.addEventListener('click', () => baixarCsv(
    `atendentes_${r.periodo.de}_a_${r.periodo.ate}.csv`,
    [['Atendente', 'Novas', 'Resolvidas', 'Backlog', '1a resposta media (min)', 'Resolucao media (min)'],
     ...linhasEquipe(r.atendentes)]));

  $('#csvEquipes')?.addEventListener('click', () => baixarCsv(
    `equipes_${r.periodo.de}_a_${r.periodo.ate}.csv`,
    [['Equipe', 'Novas', 'Resolvidas', 'Backlog', '1a resposta media (min)', 'Resolucao media (min)'],
     ...linhasEquipe(r.equipes)]));
}

/* ---------------- Fechar modais novos ---------------- */
$$('[data-fechar]').forEach(b => b.addEventListener('click', () =>
  $('#' + b.dataset.fechar).classList.remove('aberto')));
['modalAgendarBg','modalAtalhoBg','modalEtapaBg'].forEach(id => {
  const el = $('#' + id);
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('aberto'); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !menuAberto) {
    $('#modalAgendarBg').classList.remove('aberto');
    $('#modalAtalhoBg').classList.remove('aberto');
    $('#modalEtapaBg').classList.remove('aberto');
  }
});

/* ---------------- Botão flutuante: nova conversa ---------------- */
const btnNova = document.createElement('button');
btnNova.className = 'btn btn-primary sm';
btnNova.textContent = '+ Nova';
btnNova.style.cssText = 'position:absolute;top:14px;right:14px;z-index:5';
btnNova.addEventListener('click', abrirModalNova);
$('.lista-topo').style.position = 'relative';
$('.lista-topo').appendChild(btnNova);

/* ============================================================
   TEMA CLARO / ESCURO
   O <html data-tema> já foi definido pelo script inline do <head>
   (para não piscar). Aqui só sincronizamos o botão, o meta e a
   persistência, e redesenhamos os relatórios se estiverem na tela.
   ============================================================ */
const TEMA_KEY = 'indycar_tema';
const temaAtual = () =>
  document.documentElement.getAttribute('data-tema') === 'claro' ? 'claro' : 'escuro';

function aplicarTema(tema) {
  const claro = tema === 'claro';
  document.documentElement.setAttribute('data-tema', claro ? 'claro' : 'escuro');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', claro ? '#eaecf0' : '#0a0a0b');

  const ico = $('#temaIco'), txt = $('#temaTxt');
  if (ico) ico.textContent = claro ? '☀️' : '🌙';
  if (txt) txt.textContent = claro ? 'Tema claro' : 'Tema escuro';

  try { localStorage.setItem(TEMA_KEY, claro ? 'claro' : 'escuro'); } catch { /* ignora */ }

  // Os SVG dos relatórios são pintados com cores lidas na hora do desenho:
  // se já houver relatório montado, redesenha para o eixo/texto acompanhar.
  if (RELATORIO) desenharRelatorios(RELATORIO);
}

$('#btnTema')?.addEventListener('click', () =>
  aplicarTema(temaAtual() === 'claro' ? 'escuro' : 'claro'));

// Deixa o botão e o meta coerentes com o que o script do <head> já aplicou.
aplicarTema(temaAtual());

iniciar();

/* ============================================================
   CONEXÃO DO WHATSAPP
   O aparelho da oficina cai sozinho (sessão expira, celular
   desliga, alguém desconecta na mão). Até hoje só se descobria
   quando o envio falhava com "erro 500" — ou seja, depois que o
   cliente já tinha ficado sem resposta. Aqui isso vira alarme.
   ============================================================ */
/* `var` de propósito: iniciar() roda antes deste trecho do arquivo e chama
   vigiarConexao(). Com `let` isso fica na mão do acaso — basta alguém tirar
   um await do caminho para virar "Cannot access before initialization". */
var conexaoTimer = null;
var pareamentoTimer = null;

/* A sessão acabou por baixo dos panos: sai limpo e avisa.
   Sem isto o atendente fica num painel que parece funcionar e não salva nada
   — o pior jeito de descobrir é o cliente esperando resposta. */
let jaAvisouSessao = false;
async function sessaoMorreu() {
  if (jaAvisouSessao) return;
  jaAvisouSessao = true;
  clearInterval(conexaoTimer);
  try { await sb.auth.signOut(); } catch { /* já estava fora */ }
  const t = document.getElementById('tarjaConexao');
  if (t) t.hidden = true;
  document.getElementById('telaApp').hidden = true;
  const login = document.getElementById('telaLogin');
  if (login) {
    login.hidden = false;
    const aviso = document.getElementById('loginErro');
    if (aviso) {
      aviso.hidden = false;
      aviso.textContent = 'Sua sessão expirou. Entre de novo para continuar.';
    }
  }
}

/* Empurra o app exatamente a altura da tarja — nem um pixel a mais. */
function reservarEspacoDaTarja() {
  const tarja = document.getElementById('tarjaConexao');
  const app   = document.getElementById('telaApp');
  if (!tarja || !app) return;
  app.style.paddingTop = tarja.hidden ? '' : `${Math.ceil(tarja.getBoundingClientRect().height)}px`;
}
// Redimensionar a janela faz o texto quebrar e a tarja mudar de altura.
if (typeof ResizeObserver === 'function') {
  const alvo = () => document.getElementById('tarjaConexao');
  const obs = new ResizeObserver(() => reservarEspacoDaTarja());
  const t0 = alvo(); if (t0) obs.observe(t0);
}

async function verConexao({ silencioso = true } = {}) {
  const bolinha = document.getElementById('conexaoBolinha');
  const texto   = document.getElementById('conexaoTexto');
  const tarja   = document.getElementById('tarjaConexao');
  const app     = document.getElementById('telaApp');
  if (!tarja) return;

  let est;
  try {
    const r = await fetch('/api/whatsapp/status', { headers: await authCabecalhos() });
    /* 401 aqui quase sempre é sessão órfã: o token ainda não venceu, mas o
       Supabase já apagou a sessão. O painel abria inteiro, bonito, e nenhuma
       ação funcionava — sem dizer o porquê. Como esta função roda no login e
       a cada 2 min, ela serve de vigia: derruba e manda logar de novo. */
    if (r.status === 401) { await sessaoMorreu(); return; }
    est = await r.json();
  } catch (e) {
    // Rede caiu no navegador. Isso não prova que o WhatsApp caiu — não
    // vale acender o alarme e assustar quem está atendendo.
    if (!silencioso && texto) {
      texto.textContent = 'Não deu para verificar agora.';
      if (bolinha) bolinha.className = 'conexao-bolinha';
    }
    return;
  }

  const caiu = est.conectado === false;
  const meio = est.conectado === true && est.inscrito === false;

  tarja.hidden = !(caiu || meio);
  app?.classList.toggle('com-tarja', caiu || meio);
  const tt = document.getElementById('tarjaTexto');
  /* O espaço reservado tem que sair da altura real da tarja. Um valor fixo
     no CSS erra assim que o texto quebra em duas linhas — e aí ela come o
     topo da lateral.
     Chamada direta, não em requestAnimationFrame: em aba de fundo o rAF não
     roda, e a tarja acabava aparecendo sobreposta ao voltar para a aba. */
  reservarEspacoDaTarja();
  if (tt) {
    tt.textContent = meio
      ? 'O WhatsApp está conectado, mas as mensagens não estão chegando no painel.'
      : 'O WhatsApp da oficina está desconectado — nenhuma mensagem entra nem sai.';
  }

  if (bolinha && texto) {
    bolinha.className = 'conexao-bolinha ' + (caiu ? 'ruim' : meio ? 'meio' : est.conectado ? 'ok' : '');
    texto.textContent = est.conectado === true && est.inscrito
      ? `Conectado no ${est.numero || 'número da oficina'}`
      : (est.motivo || 'Situação desconhecida.');
  }
}

async function pedirPareamento() {
  const bloco = document.getElementById('blocoPareamento');
  const cod   = document.getElementById('pareamentoCodigo');
  const prazo = document.getElementById('pareamentoPrazo');
  const msg   = document.getElementById('pareamentoMsg');
  const btn   = document.getElementById('btnParear');
  if (!bloco) return;

  btn && (btn.disabled = true, btn.textContent = 'Gerando…');
  if (msg) msg.hidden = true;

  try {
    const r = await fetch('/api/whatsapp/parear', {
      method: 'POST', headers: await authCabecalhos(), body: '{}',
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.erro || 'Não deu para gerar o código.');

    bloco.hidden = false;
    if (cod) cod.textContent = j.codigo || '(sem código)';

    /* O código vale pouco tempo. Sem o relógio, a pessoa acha que
       digitou errado quando na verdade só demorou. */
    let resta = 60;
    clearInterval(pareamentoTimer);
    const tique = () => {
      if (!prazo) return;
      prazo.textContent = resta > 0
        ? `Vale por mais ${resta}s — se expirar, é só pedir outro.`
        : 'Este código expirou. Toque em “Reconectar WhatsApp” para gerar outro.';
      if (resta <= 0) clearInterval(pareamentoTimer);
      resta--;
    };
    tique(); pareamentoTimer = setInterval(tique, 1000);

    /* Depois que a pessoa digita o código, o aparelho fica pareado mas
       SEM inscrição — as mensagens chegariam no celular e não cairiam
       aqui. Fica vigiando e religa a rota sozinho. */
    let tentativas = 0;
    clearInterval(conexaoTimer);
    const vigiar = setInterval(async () => {
      tentativas++;
      let est = {};
      try {
        est = await (await fetch('/api/whatsapp/status', { headers: await authCabecalhos() })).json();
      } catch { /* tenta de novo no próximo tique */ }

      if (est.conectado === true) {
        clearInterval(vigiar); clearInterval(pareamentoTimer);
        if (!est.inscrito) {
          if (msg) { msg.hidden = false; msg.className = 'form-msg'; msg.textContent = 'Pareado! Religando o atendimento…'; }
          try {
            const rr = await fetch('/api/whatsapp/reinscrever', {
              method: 'POST', headers: await authCabecalhos(), body: '{}',
            });
            const jj = await rr.json();
            if (msg) {
              msg.className = 'form-msg ' + (jj.ok ? 'ok' : 'erro');
              msg.textContent = jj.ok
                ? '✅ Conectado e recebendo mensagens. Pode atender.'
                : `Pareou, mas falhou ao religar: ${jj.erro}`;
            }
          } catch (e) {
            if (msg) { msg.className = 'form-msg erro'; msg.textContent = `Pareou, mas falhou ao religar: ${e.message}`; }
          }
        } else if (msg) {
          msg.hidden = false; msg.className = 'form-msg ok';
          msg.textContent = '✅ Conectado e recebendo mensagens. Pode atender.';
        }
        verConexao({ silencioso: false });
        setTimeout(() => { bloco.hidden = true; }, 6000);
      }
      if (tentativas > 40) clearInterval(vigiar);   // ~2 min e desiste
    }, 3000);

  } catch (e) {
    if (msg) { msg.hidden = false; msg.className = 'form-msg erro'; msg.textContent = e.message; }
  } finally {
    btn && (btn.disabled = false, btn.textContent = 'Reconectar WhatsApp');
  }
}

document.getElementById('btnParear')?.addEventListener('click', pedirPareamento);
document.getElementById('btnVerConexao')?.addEventListener('click', () => verConexao({ silencioso: false }));
document.getElementById('tarjaBtn')?.addEventListener('click', () => {
  document.querySelector('[data-aba="config"]')?.click();
  document.querySelector('[data-secao="sistema"]')?.click();
  document.getElementById('cartaoConexao')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/* De 2 em 2 minutos. Só com a aba visível: se o painel ficou aberto a
   noite toda numa TV, não faz sentido bater no CodeWords o tempo todo. */
function vigiarConexao() {
  verConexao();
  clearInterval(conexaoTimer);
  conexaoTimer = setInterval(() => {
    if (document.visibilityState === 'visible') verConexao();
  }, 120000);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') verConexao();
});
