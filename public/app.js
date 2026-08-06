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

  const { data: { session } } = await sb.auth.getSession();
  if (session) await entrarNoApp(session.user);

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

$('#btnCriarConta').addEventListener('click', async () => {
  const email = $('#loginEmail').value.trim();
  const senha = $('#loginSenha').value;
  $('#loginErro').hidden = true;

  if (!email || !senha) {
    return mostrarErroLogin('Preencha e-mail e senha acima e clique de novo para criar a conta.');
  }
  if (senha.length < 6) return mostrarErroLogin('A senha precisa ter pelo menos 6 caracteres.');

  try {
    const { data, error } = await sb.auth.signUp({ email, password: senha });
    if (error) throw error;
    if (data.session) { await entrarNoApp(data.user); return; }
    toast('✅ Conta criada. Confirme o e-mail e depois entre.');
  } catch (err) {
    mostrarErroLogin(traduzErroAuth(err.message));
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

  await carregarConversas();
  ligarTempoReal();
  carregarEquipe();
  carregarWhatsappConfig();
  await carregarApoio();      // serviços e consultores (usados no agendamento)
  await carregarAtalhos();    // atalhos do "/"
  carregarCodeWords();
}

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
$$('.nav-item').forEach(b => b.addEventListener('click', () => {
  const aba = b.dataset.aba;
  $$('.nav-item').forEach(x => x.classList.toggle('ativo', x === b));
  $$('.aba').forEach(s => s.classList.toggle('ativa', s.id === `aba-${aba}`));
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
    renderConversas();
    atualizarBadge();
  } catch (err) {
    toast('⚠️ ' + err.message);
  }
}

function conversasFiltradas() {
  const t = termoBusca.trim().toLowerCase();
  if (!t) return CONVERSAS;
  const soDigitos = t.replace(/\D/g, '');
  return CONVERSAS.filter(c =>
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
          <span class="tag ${c.status}">${c.status}</span>
          ${c.ia_ativa ? '<span class="tag ia">✨ IA</span>' : ''}
          ${c.nao_lidas > 0 ? `<span class="nao-lidas">${c.nao_lidas}</span>` : ''}
        </div>
      </div>
    </div>`).join('');

  $$('.conversa', el).forEach(d =>
    d.addEventListener('click', () => abrirConversa(d.dataset.id)));
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

$$('.filtros-status .chip').forEach(c => c.addEventListener('click', () => {
  $$('.filtros-status .chip').forEach(x => x.classList.toggle('ativo', x === c));
  filtroStatus = c.dataset.status;
  carregarConversas();
}));

/* ---------------- Abrir uma conversa ---------------- */
async function abrirConversa(id) {
  const conv = CONVERSAS.find(c => c.id === id);
  if (!conv) return;
  conversaAtual = conv;

  $('#chatVazio').hidden = true;
  $('#chat').hidden = false;
  $('#chatNome').textContent = conv.nome || conv.telefone;
  $('#chatTelefone').textContent = conv.telefone;
  $('#chatAvatar').textContent = iniciais(conv.nome || conv.telefone);
  $('#chatStatus').value = conv.status;

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

$('#btnPainelCliente').addEventListener('click', () =>
  $('#colFicha').classList.toggle('aberta'));

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
        await carregarConversas();
      })
    .on('postgres_changes', { event:'*', schema:'public', table:'conversas' },
      () => carregarConversas())
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

async function carregarEquipe() {
  try {
    const { data } = await sb.from('perfis').select('*').order('created_at');
    const el = $('#listaEquipe');
    const lista = data || [];
    el.innerHTML = lista.length ? lista.map(p => `
      <div class="equipe-item">
        <span class="avatar">${esc(iniciais(p.nome))}</span>
        <div><strong>${esc(p.nome)}</strong><br><small>${esc(p.email)} ·
          ${p.papel === 'admin' ? 'Administrador' : 'Atendente'}</small></div>
      </div>`).join('')
      : '<div class="vazio">Só você por enquanto.</div>';
  } catch {
    $('#listaEquipe').innerHTML = '<div class="vazio">Você vê apenas o seu próprio perfil.</div>';
  }
}

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

/* ---------------- Fechar modais novos ---------------- */
$$('[data-fechar]').forEach(b => b.addEventListener('click', () =>
  $('#' + b.dataset.fechar).classList.remove('aberto')));
['modalAgendarBg','modalAtalhoBg'].forEach(id => {
  const el = $('#' + id);
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('aberto'); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !menuAberto) {
    $('#modalAgendarBg').classList.remove('aberto');
    $('#modalAtalhoBg').classList.remove('aberto');
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

iniciar();
