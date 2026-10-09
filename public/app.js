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
function toast(msg, tipo = '') {
  const t = $('#toast');
  const texto = String(msg ?? '');
  t.textContent = texto;
  // cor da borda pelo tipo (o copiloto manda 'erro'/'ok'); sem tipo, deduz do ⚠️/✅
  const classe = tipo === 'erro' || /^⚠/.test(texto) ? 'erro' : tipo === 'ok' || /^✅/.test(texto) ? 'ok' : '';
  t.classList.remove('erro', 'ok');
  if (classe) t.classList.add(classe);
  t.classList.add('mostra');
  clearTimeout(toastT);
  // texto longo fica mais tempo na tela (dá para ler até o fim)
  toastT = setTimeout(() => t.classList.remove('mostra'), Math.min(9000, 3200 + texto.length * 35));
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
  const soAdmin = perfil.papel !== 'admin';
  $('#btnExcluirConversa').hidden = soAdmin;
  $('#btnSelecionarMsgs').hidden  = soAdmin;
  $('#btnSoMinhas')?.classList.toggle('ativo', soMinhas);
  vigiarConexao();   // acende a tarja se o WhatsApp estiver fora do ar

  // as etapas vêm ANTES das conversas: são elas que desenham as plaquinhas
  await carregarEtapas();
  await carregarConfigFunil();
  restaurarPreferenciasDaLista();     // filtro, dono e ordem da última vez (ou ?filtro= do link)
  await carregarConversas();
  ligarTempoReal();
  abrirPeloEndereco();                // ?conversa=<uuid> ou ?tel=<telefone> (links da Agenda, CRM, Comunicar)
  publicarApiIndyCar();
  filaOfflineProcessar();
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
/* Data de hoje no fuso da OFICINA (toISOString é UTC e vira amanhã às 21h). */
const hojeSP = () => new Intl.DateTimeFormat('en-CA',
  { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
const chegouHoje = (ts) => !!ts && new Intl.DateTimeFormat('en-CA',
  { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(ts)) === hojeSP();

/* Placa, carro, aniversário e opt-out dos clientes das conversas carregadas.
   Serve para a busca por placa e para as plaquinhas, sem uma ida ao banco por
   conversa: uma consulta `in` para os ids que ainda não conhecemos. */
const CLIENTES_INFO = new Map();   // cliente_id -> { placa, carro_modelo, nascimento, aceita_mensagens }
async function carregarInfoClientes() {
  const ids = [...new Set(CONVERSAS.map(c => c.cliente_id).filter(id => id && !CLIENTES_INFO.has(id)))];
  if (!ids.length) return false;
  try {
    const { data } = await sb.from('clientes')
      .select('id,placa,carro_modelo,nascimento,aceita_mensagens').in('id', ids.slice(0, 200));
    (data || []).forEach(c => CLIENTES_INFO.set(c.id, c));
    // quem não veio (apagado) entra como vazio, para não consultar de novo
    ids.forEach(id => { if (!CLIENTES_INFO.has(id)) CLIENTES_INFO.set(id, {}); });
    return (data || []).length > 0;
  } catch { return false; }
}

/** Esqueleto da lista enquanto a primeira carga não chega (nada de tela em branco). */
let jaCarregouConversas = false;
function esqueletoConversas(n = 7) {
  return Array.from({ length: n }, () => `
    <div class="conversa esqueleto" aria-hidden="true">
      <span class="avatar sk"></span>
      <div class="conversa-txt">
        <div class="sk-linha" style="width:55%"></div>
        <div class="sk-linha fina" style="width:85%"></div>
        <div class="sk-linha fina" style="width:40%"></div>
      </div>
    </div>`).join('');
}

/* Caixa de entrada com 2.400+ conversas: carrega de 150 em 150 (rolagem
   infinita) em vez de cortar em 200 e esconder o resto. Cada carga leva um
   número de "geração": se outra carga começou depois (filtro trocado no meio,
   tempo real em rajada), a resposta velha é jogada fora em vez de pintar a
   lista errada por cima da certa. */
const PASSO_LISTA = 150;
let limiteLista = PASSO_LISTA;
let geracaoLista = 0;
let temMaisConversas = false;
let carregandoMais = false;

/** Filtros comuns a toda consulta da lista (tipo, desfecho, dono, aba). */
function aplicarFiltrosBase(q, { incluirDono = true } = {}) {
  /* Disparo (aniversário, promoção) tem aba própria: fora dela, some da
     lista. Sem isso, mandar parabéns para 30 pessoas empurrava para baixo
     quem está pedindo orçamento. */
  if (filtroStatus === 'disparo') q = q.eq('tipo', 'disparo');
  else q = q.eq('tipo', 'atendimento');
  /* Fechou / não fechou tem aba própria; a fila principal ("Todas") é só
     quem está EM ANDAMENTO. Cliente encerrado que escrever de novo pedindo
     algo volta sozinho (gatilho do banco). */
  if (filtroStatus === 'aguardando') q = q.eq('aguardando_consultor', true);
  else if (filtroStatus === 'fechou' || filtroStatus === 'nao_fechou') q = q.eq('desfecho', filtroStatus);
  else if (filtroStatus !== 'disparo') q = q.is('desfecho', null);
  // agora no banco (antes filtrava só as 200 carregadas e "sumia" gente)
  if (filtroStatus === 'nao_lidas') q = q.gt('nao_lidas', 0);
  if (filtroStatus === 'hoje') q = q.gte('created_at', new Date(hojeSP() + 'T00:00:00-03:00').toISOString());
  if (incluirDono && filtroDono === 'meus' && perfil?.id) q = q.eq('atribuida_a', perfil.id);
  if (incluirDono && filtroDono === 'sem') q = q.is('atribuida_a', null);
  return q;
}

async function carregarConversas() {
  const minha = ++geracaoLista;
  if (!jaCarregouConversas) $('#listaConversas').innerHTML = esqueletoConversas();
  try {
    let q = sb.from('conversas').select('*');
    // fila de espera: mais antigo primeiro — é quem está esperando há mais tempo
    if (filtroStatus === 'aguardando') q = q.order('aguardando_desde', { ascending: true });
    q = aplicarFiltrosBase(q.order('ultima_mensagem_em', { ascending: false, nullsFirst: false })
      .limit(limiteLista));

    let data, error;
    if (FILTROS_ESPECIAIS[filtroStatus]) {
      // Quentes, Amanhã, Revisão, Aniversário: o banco diz QUEM, a lista traz as conversas
      ({ data, error } = await FILTROS_ESPECIAIS[filtroStatus](q));
    } else {
      ({ data, error } = await q);
      // "esperando há mais tempo": garante que quem espera entre, mesmo fora da página
      if (!error && ordemLista === 'espera') {
        const r2 = await aplicarFiltrosBase(sb.from('conversas').select('*'))
          .or('nao_lidas.gt.0,aguardando_consultor.eq.true')
          .order('ultima_mensagem_em', { ascending: true }).limit(200);
        if (!r2.error) {
          const ids = new Set((data || []).map(c => c.id));
          data = [...(data || []), ...(r2.data || []).filter(c => !ids.has(c.id))];
        }
      }
    }
    if (minha !== geracaoLista) return;      // chegou depois de uma carga mais nova: descarta
    if (error) throw error;
    CONVERSAS = data || [];
    temMaisConversas = !FILTROS_ESPECIAIS[filtroStatus] && CONVERSAS.length >= limiteLista;
    jaCarregouConversas = true;
    // placa/carro chegam depois e só redesenham se trouxeram algo novo
    carregarInfoClientes().then(trouxe => { if (trouxe) renderConversas(); });

    /* A conversa aberta é uma referência para o array antigo: sem repontar,
       a plaquinha e o status do chat ficariam parados no passado. */
    if (conversaAtual) {
      const nova = CONVERSAS.find(c => c.id === conversaAtual.id);
      if (nova) conversaAtual = nova;
    }

    renderConversas();
    atualizarBadge();
    renderEtapaDoChat();
    if (conversaAtual) { renderDonoDoChat(); renderBotaoAssumir(); }
  } catch (err) {
    if (minha !== geracaoLista) return;
    // primeira carga falhou: em vez do esqueleto eterno, diz o que houve e oferece tentar de novo
    if (!jaCarregouConversas || !CONVERSAS.length) {
      $('#listaConversas').innerHTML = `<div class="vazio">⚠️ Não consegui carregar as conversas.<br>
        <small>${esc(err.message || 'sem resposta do banco')}</small><br><br>
        <button type="button" class="btn btn-ghost sm" data-acao="recarregar-lista">Tentar de novo</button></div>`;
    } else toast('⚠️ ' + err.message);
  } finally {
    if (minha === geracaoLista) carregandoMais = false;
  }
}

/* Conversa "agendada": a plaquinha está em Agendado ou Em serviço — o
   trabalho com ela agora é da agenda, não da fila de conversa. */
function estaAgendada(c) {
  const e = etapaPorId(c.etapa_id);
  return !!e && (e.nome === 'Agendado' || e.nome === 'Em serviço');
}

function conversasFiltradas() {
  let base = CONVERSAS;
  // aba "Novos hoje": só quem CHEGOU hoje (conversa criada hoje, fuso da oficina)
  if (filtroStatus === 'hoje') base = base.filter(c => chegouHoje(c.created_at));
  // aba "Agendadas" mostra só elas; a fila principal as esconde
  if (filtroStatus === 'agendada') base = base.filter(estaAgendada);
  else if (!['disparo', 'fechou', 'nao_fechou', 'aguardando', 'nao_lidas', ...Object.keys(FILTROS_ESPECIAIS)].includes(filtroStatus))
    base = base.filter(c => !estaAgendada(c));
  // aba "Não lidas": só quem tem mensagem sem ler, de qualquer etapa
  if (filtroStatus === 'nao_lidas') base = base.filter(c => (c.nao_lidas || 0) > 0);
  // dono: "meus" trabalha a própria fila; "sem dono" é quem ninguém pegou ainda
  if (filtroDono === 'meus' && perfil?.id) base = base.filter(c => c.atribuida_a === perfil.id);
  if (filtroDono === 'sem') base = base.filter(c => !c.atribuida_a);
  base = ordenarLista(base);

  const t = semAcentoBusca(termoBusca);
  if (!t) return base;
  /* Telefone: compara só dígitos e sem o 55 dos dois lados — "+55 12 99683"
     e "12996830272" acham a mesma conversa. Placa: sem hífen e sem espaço,
     "abc-1d23" acha "ABC1D23". */
  const digitos = normalizarDigitos(t);
  const placaBusca = t.replace(/[\s-]/g, '');
  const locais = base.filter(c => {
    if (semAcentoBusca(c.nome).includes(t)) return true;
    if (digitos.length >= 3) {
      const tel = normalizarDigitos(c.telefone_e164 || c.telefone);
      if (tel.includes(digitos)) return true;
      // termo parcial que começa com o DDI ("+55 12 98888"): tenta sem o 55 também
      if (digitos.startsWith('55') && digitos.length >= 5 && tel.includes(digitos.slice(2))) return true;
    }
    const info = CLIENTES_INFO.get(c.cliente_id);
    if (!info) return false;
    const placa = semAcentoBusca(info.placa).replace(/[\s-]/g, '');
    if (placaBusca.length >= 3 && placa && placa.includes(placaBusca)) return true;
    return !!info.carro_modelo && semAcentoBusca(info.carro_modelo).includes(t);
  });
  /* O que a busca no BANCO achou fora das conversas carregadas entra no fim
     (marcado), para ninguém concluir "não existe" só porque não estava na página. */
  if (BUSCA_REMOTA.termo === t && BUSCA_REMOTA.lista.length) {
    const ja = new Set(locais.map(c => c.id));
    return [...locais, ...BUSCA_REMOTA.lista.filter(c => !ja.has(c.id)).map(c => ({ ...c, _doBanco: true }))];
  }
  return locais;
}

/** Busca sem acento e sem caixa: "jose" acha "José". */
function semAcentoBusca(v) {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
/** Só dígitos, sem o DDI 55 quando ele é DDI (sobram 10 ou 11 dígitos). */
function normalizarDigitos(v) {
  return String(v ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
}

/* Rascunho por conversa: o que foi digitado e não enviado fica guardado
   neste navegador e volta quando a conversa é reaberta. */
const RASCUNHO_KEY = id => `indycar_rascunho_${id}`;
function lerRascunho(id) { try { return localStorage.getItem(RASCUNHO_KEY(id)) || ''; } catch { return ''; } }
function guardarRascunho(id, texto) {
  try {
    if (texto && texto.trim()) localStorage.setItem(RASCUNHO_KEY(id), texto);
    else localStorage.removeItem(RASCUNHO_KEY(id));
  } catch { /* armazenamento cheio ou bloqueado: o rascunho só não persiste */ }
}

/** "DD/MM" ou "DD/MM/AAAA"; ano 1904 é o combinado para "só dia e mês". */
function aniversarioTexto(nasc) {
  if (!nasc) return '';
  const [a, m, d] = String(nasc).slice(0, 10).split('-');
  if (!a || !m || !d) return '';
  return a === '1904' ? `${d}/${m}` : `${d}/${m}/${a}`;
}
/** Quantos dias faltam para o aniversário (0 = hoje). null sem data. */
function diasParaAniversario(nasc, hoje = new Date()) {
  if (!nasc) return null;
  const [, m, d] = String(nasc).slice(0, 10).split('-').map(Number);
  if (!m || !d) return null;
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  let prox = new Date(hoje.getFullYear(), m - 1, d);
  if (prox < base) prox = new Date(hoje.getFullYear() + 1, m - 1, d);
  return Math.round((prox - base) / 86400000);
}
/** Idade em anos; null quando só há dia/mês (1904). */
function idadeDe(nasc, hoje = new Date()) {
  if (!nasc) return null;
  const [a, m, d] = String(nasc).slice(0, 10).split('-').map(Number);
  if (!a || a <= 1904) return null;
  let idade = hoje.getFullYear() - a;
  if (hoje.getMonth() + 1 < m || (hoje.getMonth() + 1 === m && hoje.getDate() < d)) idade--;
  return idade;
}

/* Sem nome cadastrado, o painel mostra o TELEFONE legível — reconhecer
   "(12) 98842-7728" é bem melhor que "Cliente 7728" ou um monte de dígitos. */
function telefoneBonito(t) {
  const d = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(t || '');
}
const tituloDaConversa = (c) => c.nome || telefoneBonito(c.telefone);

/** Há quanto tempo o cliente espera resposta — e de que cor pintar o selo.
    Conta quem a IA passou para consultor (aguardando_desde) e quem mandou
    mensagem que ninguém leu ainda (nao_lidas). Verde até 15 min, âmbar até
    1 hora, vermelho depois disso. */
function esperaDe(c) {
  if (!c || c.tipo === 'disparo' || c.desfecho) return null;
  const desde = c.aguardando_consultor ? (c.aguardando_desde || c.ultima_mensagem_em)
    : (c.nao_lidas > 0 ? c.ultima_mensagem_em : null);
  if (!desde) return null;
  const min = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000));
  if (!Number.isFinite(min)) return null;
  return { min, desde, nivel: min < 15 ? 'ok' : min < 60 ? 'medio' : 'alto', texto: tempoDeEspera(desde) };
}

/** Ordem escolhida no seletor (guardada neste navegador). */
function ordenarLista(lista) {
  if (ordemLista === 'espera') {
    return [...lista].sort((a, b) => {
      const ea = esperaDe(a), eb = esperaDe(b);
      if (ea && !eb) return -1;
      if (!ea && eb) return 1;
      if (ea && eb) return eb.min - ea.min;            // quem espera há mais tempo primeiro
      return String(b.ultima_mensagem_em || '').localeCompare(String(a.ultima_mensagem_em || ''));
    });
  }
  if (ordemLista === 'naolidas') {
    return [...lista].sort((a, b) => ((b.nao_lidas > 0) - (a.nao_lidas > 0))
      || String(b.ultima_mensagem_em || '').localeCompare(String(a.ultima_mensagem_em || '')));
  }
  return lista;
}

const TEXTO_VAZIO_FILTRO = {
  hoje: 'Nenhum lead novo chegou hoje ainda. 🆕',
  disparo: 'Nenhuma mensagem em massa por aqui. 📢',
  aguardando: 'Ninguém esperando resposta de consultor. 👏',
  agendada: 'Ninguém com horário marcado agora. Quando o Carlos (ou vocês) agendar, o cliente vem para cá sozinho. 📅',
  fechou: 'Nenhum fechado ainda. Marque <b>Concluído</b> na agenda (ou a plaquinha "Serviço concluído") que o cliente vem para cá sozinho. ✅',
  nao_fechou: 'Ninguém marcado como "não fechou". ❌',
  nao_lidas: 'Tudo lido por aqui. ✉',
  quentes: 'Nenhum orçamento quente agora. Quando alguém pedir preço e conversar nos últimos 3 dias, aparece aqui. 🔥',
  amanha: 'Ninguém com horário marcado para amanhã. 📅',
  revisao: 'Nenhum cliente com revisão vencida e sem horário. 🔧',
  aniversario: 'Nenhum aniversário nos próximos 7 dias. 🎂',
};

let ultimoHtmlLista = '';
function renderConversas() {
  const lista = conversasFiltradas();
  const el = $('#listaConversas');
  atualizarRodapeLista(lista.length);

  if (!lista.length) {
    const html = `<div class="vazio estado-vazio">
      <span class="vazio-ico" aria-hidden="true">💬</span>
      <p>${termoBusca.trim()
        ? (BUSCA_REMOTA.buscando ? 'Procurando no banco inteiro…' : `Nada encontrado para “${esc(termoBusca.trim())}”.`)
        : filtroDono === 'meus' && !TEXTO_VAZIO_FILTRO[filtroStatus] ? 'Nenhum cliente seu nesta fila. ★'
        : filtroDono === 'sem' && !TEXTO_VAZIO_FILTRO[filtroStatus] ? 'Todo mundo tem dono. 👏'
        : TEXTO_VAZIO_FILTRO[filtroStatus]
          || (CONVERSAS.length ? 'Nenhuma conversa com esse filtro.' : 'Nenhuma conversa ainda.')}</p>
      <button type="button" class="btn btn-ghost sm" data-acao="nova-conversa">+ Nova conversa</button></div>`;
    if (html !== ultimoHtmlLista) { el.innerHTML = html; ultimoHtmlLista = html; }
    return;
  }

  /* Recado da aba de disparos: sem isso, "por que essa gente está aqui?" */
  const aviso = filtroStatus === 'aguardando'
    ? `<div class="aviso-espera">⏳ A IA passou estes clientes para um <b>consultor humano</b> e eles
       ainda não receberam resposta. Os que esperam há mais tempo vêm primeiro. Respondeu? O cliente
       sai daqui sozinho.</div>`
    : filtroStatus === 'disparo'
    ? `<div class="aviso-disparo">📢 Quem recebeu <b>aniversário ou promoção</b> e ainda não pediu
       nada. Assim que a pessoa perguntar alguma coisa, ela volta sozinha para a fila de atendimento.</div>`
    : '';

  /* Foco "itinerante": só UMA linha entra no Tab (a aberta ou a primeira); as
     setas andam entre elas. Sem isto, 150 conversas = 150 paradas de Tab. */
  const idFoco = lista.some(c => c.id === conversaAtual?.id) ? conversaAtual.id : lista[0].id;
  const html = aviso + lista.map(c => {
    const info = CLIENTES_INFO.get(c.cliente_id) || {};
    const carro = [info.carro_modelo, info.placa].filter(Boolean).join(' · ');
    const rascunho = lerRascunho(c.id);
    const dias = diasParaAniversario(info.nascimento);
    const espera = esperaDe(c);
    const ativa = conversaAtual?.id === c.id;
    const titulo = tituloDaConversa(c);
    const rotuloA11y = `${titulo}${c.nao_lidas > 0 ? `, ${c.nao_lidas} não lida${c.nao_lidas > 1 ? 's' : ''}` : ''}${
      espera ? `, esperando há ${espera.texto}` : ''}`;
    return `
    <div class="conversa${ativa ? ' ativa' : ''}${c.nao_lidas > 0 ? ' tem-nao-lida' : ''}${c._doBanco ? ' do-banco' : ''}"
         data-id="${esc(c.id)}" role="listitem" tabindex="${c.id === idFoco ? 0 : -1}"
         ${ativa ? 'aria-current="true"' : ''} aria-label="${esc(rotuloA11y)}">
      <span class="avatar" aria-hidden="true">${esc(iniciais(c.nome) || "#")}</span>
      <div class="conversa-txt">
        <div class="conversa-topo">
          <span class="conversa-nome">${esc(titulo)}</span>
          ${espera ? `<span class="selo-espera espera-${espera.nivel}" title="Esperando resposta desde ${esc(
            new Date(espera.desde).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}">⏱ ${esc(espera.texto)}</span>`
            : `<span class="conversa-hora">${esc(horaCurta(c.ultima_mensagem_em))}</span>`}
        </div>
        <div class="conversa-previa">${rascunho
          ? `<span class="previa-rascunho">✎ ${esc(rascunho.slice(0, 60))}</span>`
          : esc(c.ultima_previa || 'sem mensagens')}</div>
        ${carro ? `<div class="conversa-carro">🚗 ${esc(carro)}</div>` : ''}
        <div class="conversa-tags">
          ${c._doBanco ? '<span class="tag do-banco" title="Achado no banco, fora da lista carregada">🔎 no banco</span>' : ''}
          ${dias === 0 ? '<span class="tag niver" title="Aniversário hoje">🎂 hoje</span>'
            : dias !== null && dias <= 7 && filtroStatus === 'aniversario' ? `<span class="tag niver">🎂 em ${dias}d</span>` : ''}
          ${info.aceita_mensagens === false ? '<span class="tag mudo" title="Não quer mensagens automáticas">🔕</span>' : ''}
          ${c.aguardando_consultor ? '<span class="tag esperando">⏳ consultor</span>' : ''}
          ${c.tipo === 'disparo' && c.respondeu_disparo_em
            ? '<span class="tag respondeu">💬 respondeu</span>' : ''}
          ${chegouHoje(c.created_at) && c.tipo !== 'disparo' ? '<span class="tag novo-hoje">🆕 novo</span>' : ''}
          ${c.atribuida_a ? donoHtml(c)
            : `<button type="button" class="dono pegar" data-pegar="${esc(c.id)}"
                 title="Ninguém responsável — um clique e o cliente é seu">★ Pegar</button>`}
          ${plaquinhaHtml(c)}
          <span class="tag ${esc(c.status)}">${esc(c.status)}</span>
          ${c.ia_ativa ? '<span class="tag ia">✨ IA</span>' : ''}
          ${c.nao_lidas > 0 ? `<span class="nao-lidas" aria-hidden="true">${esc(String(c.nao_lidas))}</span>` : ''}
        </div>
      </div>
    </div>`; }).join('')
    + (temMaisConversas && !termoBusca.trim()
      ? `<div class="lista-mais" id="listaMais"><button type="button" class="btn btn-ghost sm" data-acao="carregar-mais">
           ${carregandoMais ? '<span class="girando"></span>Carregando…' : 'Carregar mais conversas'}</button></div>` : '');

  /* Mesma lista, mesmo HTML: não mexe no DOM (não perde foco, rolagem nem hover). */
  if (html === ultimoHtmlLista) return;
  const focoEra = document.activeElement?.closest?.('.conversa')?.dataset.id;
  el.innerHTML = html;
  ultimoHtmlLista = html;
  if (focoEra) el.querySelector(`.conversa[data-id="${CSS.escape(focoEra)}"]`)?.focus({ preventScroll: true });
  vigiarFimDaLista();
}

function atualizarBadge() {
  /* Enquanto a contagem do banco não chega, mostra a soma do que está na tela;
     depois quem manda é o banco (conversas com mensagem sem ler, todas). */
  if (naoLidasBanco === null) {
    const total = CONVERSAS.filter(c => c.nao_lidas > 0).length;
    const b = $('#badgeNaoLidas');
    b.textContent = total;
    b.hidden = total === 0;
    atualizarTituloDaAba(total);
  }
  agendarContadores();
}

/* Contador da aba "Novos hoje" — conta no BANCO, não na lista carregada:
   com outro filtro de status ativo, a lista local não tem todos os de hoje. */
async function atualizarBadgeHoje() {
  const b = $('#badgeHoje');
  if (!b) return;
  try {
    // meia-noite de hoje no fuso da oficina (SP é UTC-3 fixo)
    const inicio = new Date(hojeSP() + 'T00:00:00-03:00').toISOString();
    const { count } = await sb.from('conversas')
      .select('id', { count: 'exact', head: true })
      .eq('tipo', 'atendimento')          // disparo não conta como lead novo
      .gte('created_at', inicio);
    b.textContent = count ?? 0;
    b.hidden = !count;
  } catch { /* sem contador não é motivo de erro na tela */ }
  atualizarBadgeDisparos();
  atualizarBadgeEspera();
}

/* Contador de quem espera consultor — conta no BANCO, não na lista
   carregada: com outro filtro ativo a lista local não tem todos. */
async function atualizarBadgeEspera() {
  const b = $('#badgeEspera');
  if (!b) return;
  try {
    const { count } = await sb.from('conversas')
      .select('id', { count: 'exact', head: true }).eq('aguardando_consultor', true);
    b.textContent = count ?? 0;
    b.hidden = !count;
  } catch { /* sem contador não é motivo de erro na tela */ }
}

/** "há 3 dias" / "há 2h" — o quanto o cliente já esperou. */
function tempoDeEspera(desde) {
  if (!desde) return '';
  const min = Math.floor((Date.now() - new Date(desde).getTime()) / 60000);
  if (min < 60) return `${Math.max(1, min)}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 dia' : `${d} dias`;
}

/* Contador da aba de disparos — mostra só quem RESPONDEU, que é o que pede
   olhada. A lista inteira de parabéns enviados não é tarefa de ninguém. */
async function atualizarBadgeDisparos() {
  const b = $('#badgeDisparos');
  if (!b) return;
  try {
    const { count } = await sb.from('conversas')
      .select('id', { count: 'exact', head: true })
      .eq('tipo', 'disparo').not('respondeu_disparo_em', 'is', null);
    b.textContent = count ?? 0;
    b.hidden = !count;
  } catch { /* sem contador não é motivo de erro na tela */ }
}

/* Busca: a lista local responde na hora (com um respiro de 120 ms para não
   redesenhar a cada tecla) e, se o termo tiver 3+ letras, o BANCO inteiro é
   consultado em seguida — quem não estava entre as carregadas aparece
   marcado "🔎 no banco". Resposta velha (o atendente continuou digitando) é
   descartada. */
const BUSCA_REMOTA = { termo: '', lista: [], buscando: false, geracao: 0 };
let buscaTimer = null, buscaRemotaTimer = null;
$('#buscaConversa').addEventListener('input', e => {
  termoBusca = e.target.value;
  clearTimeout(buscaTimer);
  buscaTimer = setTimeout(renderConversas, 120);
  clearTimeout(buscaRemotaTimer);
  const t = semAcentoBusca(termoBusca);
  if (t.length < 3) { BUSCA_REMOTA.termo = ''; BUSCA_REMOTA.lista = []; BUSCA_REMOTA.buscando = false; return; }
  BUSCA_REMOTA.buscando = true;
  buscaRemotaTimer = setTimeout(() => buscarNoBanco(t), 400);
});

async function buscarNoBanco(t) {
  const minha = ++BUSCA_REMOTA.geracao;
  try {
    const digitos = normalizarDigitos(t);
    const termo = termoBusca.trim().replace(/[%,()*]/g, ' ').slice(0, 60);
    const ors = [`nome.ilike.%${termo}%`];
    if (digitos.length >= 4) ors.push(`telefone_e164.ilike.%${digitos}%`, `telefone.ilike.%${digitos}%`);
    const { data } = await sb.from('conversas').select('*').or(ors.join(','))
      .order('ultima_mensagem_em', { ascending: false, nullsFirst: false }).limit(30);
    let achadas = data || [];
    // placa/carro moram em clientes: acha o cliente e traz a conversa dele
    const placa = termo.replace(/[\s-]/g, '').toUpperCase();
    if (placa.length >= 3) {
      const { data: cli } = await sb.from('clientes').select('id')
        .or(`placa.ilike.%${placa}%,carro_modelo.ilike.%${termo}%`).limit(30);
      const ids = (cli || []).map(c => c.id);
      if (ids.length) {
        const { data: porCliente } = await sb.from('conversas').select('*').in('cliente_id', ids).limit(30);
        const ja = new Set(achadas.map(c => c.id));
        achadas = [...achadas, ...(porCliente || []).filter(c => !ja.has(c.id))];
      }
    }
    if (minha !== BUSCA_REMOTA.geracao || semAcentoBusca(termoBusca) !== t) return;
    BUSCA_REMOTA.termo = t;
    BUSCA_REMOTA.lista = achadas;
  } catch { /* busca extra: se falhar, a local continua valendo */ }
  finally {
    if (minha === BUSCA_REMOTA.geracao) { BUSCA_REMOTA.buscando = false; renderConversas(); }
  }
}

/* Escopo preso à aba de conversas: os chips das outras abas (categorias
   dos atalhos, período dos relatórios) não podem mexer neste filtro. */
$$('#aba-conversas .filtros-status .chip').forEach(c => c.addEventListener('click', () => {
  trocarFiltroStatus(c.dataset.status);
}));
function trocarFiltroStatus(status) {
  filtroStatus = status || '';
  $$('#aba-conversas .filtros-status .chip').forEach(x => {
    const ativo = (x.dataset.status || '') === filtroStatus;
    x.classList.toggle('ativo', ativo);
    x.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
  limiteLista = PASSO_LISTA;               // filtro novo começa da primeira página
  $('#listaConversas').scrollTop = 0;
  carregarConversas();
}

/* ---------------- Abrir uma conversa ---------------- */
async function abrirConversa(id, { focarCampo = false } = {}) {
  if (!id) return;
  let conv = CONVERSAS.find(c => c.id === id) || BUSCA_REMOTA.lista.find(c => c.id === id);
  // Veio do funil, de um link ou da busca no banco? A lista pode estar filtrada
  // ou paginada — nesse caso buscamos a conversa direto, em vez de o clique não fazer nada.
  if (!conv) {
    const { data } = await sb.from('conversas').select('*').eq('id', id).maybeSingle();
    if (!data) return toast('⚠️ Não encontrei essa conversa.');
    conv = data;
  }
  if (!CONVERSAS.includes(conv)) CONVERSAS = [conv, ...CONVERSAS.filter(c => c.id !== conv.id)];
  const trocou = conversaAtual?.id !== conv.id;
  conversaAtual = conv;

  $('#chatVazio').hidden = true;
  $('#chat').hidden = false;
  $('#chatNome').textContent = tituloDaConversa(conv);
  $('#chatTelefone').textContent = telefoneBonito(conv.telefone);
  $('#chatTelefone').title = 'Clique para copiar o telefone';
  $('#chatAvatar').textContent = iniciais(conv.nome) || '#';
  $('#chatStatus').value = conv.status;
  renderEtapaDoChat();
  renderDonoDoChat();
  renderBotaoAssumir();
  $('#copilotoSlot').hidden = false;          // contrato com o copiloto: sempre presente com conversa aberta

  // No celular, abrir a conversa troca a lista pelo chat
  $('.conversas-layout').classList.add('vendo-chat');

  // rascunho desta conversa volta para o campo (e o da anterior já ficou guardado)
  if (campo.value.trim() === '' || campo.dataset.conversa !== conv.id) {
    campo.value = lerRascunho(conv.id);
    campo.dataset.conversa = conv.id;
    campo.dispatchEvent(new Event('input'));
  }
  if (trocou) {
    conversaRenderizada = null;          // conversa nova: a rolagem vai para o fim
    fecharBuscaNaConversa();
    MENSAGENS = [];
    $('#mensagens').innerHTML = esqueletoMensagens();
    avisarConversaAberta(conv);           // evento indycar:conversa + endereço da página
  }
  $('#pillNovas').hidden = true;
  $('#chatAvisos').hidden = true;

  renderConversas();
  if (focarCampo) campo.focus();
  await Promise.all([carregarMensagens(), carregarFicha(conv)]);

  // abriu = leu (pinta na hora; o banco vem atrás)
  if (conv.nao_lidas > 0 && conversaAtual?.id === conv.id) {
    conv.nao_lidas = 0;
    ajustarNaoLidas(-1);
    renderConversas();
    atualizarBadge();
    await sb.from('conversas').update({ nao_lidas: 0 }).eq('id', conv.id);
  }

  /* As respostas do Carlos não passam pelo webhook — elas ficam no aparelho.
     Puxa o que falta ao abrir o chat, senão o atendente vê as perguntas do
     cliente e nenhuma resposta, e acha que a IA está muda.
     Sem await de propósito: a conversa já abriu, isto completa depois. */
  sincronizarConversaAberta(conv.id);

  /* Enquanto ESTA conversa estiver aberta, busca o que chegou a cada 15s —
     é o que deixa a resposta aparecer quase na hora, sem esperar o relógio
     geral. Aba escondida não busca (economiza chamada à toa). */
  clearInterval(syncAbertaTimer);
  syncAbertaTimer = setInterval(() => {
    if (!document.hidden && navigator.onLine !== false && conversaAtual?.id === conv.id) sincronizarConversaAberta(conv.id);
  }, 15_000);
}

let syncAbertaTimer = null;

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

/* Mensagens: as MAIS NOVAS primeiro do banco (300), viradas para a ordem do
   chat. Antes vinham as 500 mais ANTIGAS — numa conversa longa o fim (o que
   o cliente acabou de dizer) simplesmente não aparecia. "Carregar anteriores"
   busca mais 300 para trás sem pular a leitura. */
const PAGINA_MSGS = 300;
let limiteMsgs = PAGINA_MSGS;
let temMsgsAnteriores = false;
let geracaoMsgs = 0;
let marcaNaoLidas = { conv: null, n: 0 };     // "— 3 não lidas —" ao abrir

async function carregarMensagens({ anteriores = false } = {}) {
  if (!conversaAtual) return;
  const convId = conversaAtual.id, minha = ++geracaoMsgs;
  if (anteriores) limiteMsgs += PAGINA_MSGS;
  else if (conversaRenderizada !== convId) limiteMsgs = PAGINA_MSGS;
  try {
    const { data, error } = await sb.from('whatsapp_mensagens')
      .select('*').eq('conversa_id', convId)
      .order('created_at', { ascending: false }).limit(limiteMsgs);
    if (error) throw error;
    if (minha !== geracaoMsgs || conversaAtual?.id !== convId) return;   // trocou de conversa no meio
    temMsgsAnteriores = (data || []).length >= limiteMsgs;
    MENSAGENS = (data || []).slice().reverse();
    renderMensagens({ manterTopo: anteriores });
  } catch (err) {
    if (minha !== geracaoMsgs) return;
    if (!MENSAGENS.length) {
      $('#mensagens').innerHTML = `<div class="vazio">⚠️ Não consegui carregar as mensagens.<br>
        <small>${esc(err.message || '')}</small><br><br>
        <button type="button" class="btn btn-ghost sm" data-acao="recarregar-msgs">Tentar de novo</button></div>`;
    } else toast('⚠️ ' + err.message);
  }
}

/** Esqueleto do chat enquanto as mensagens não chegam. */
function esqueletoMensagens() {
  return ['entrada', 'saida', 'entrada', 'saida'].map((d, i) =>
    `<div class="msg ${d} msg-sk" aria-hidden="true"><div class="sk-linha" style="width:${[180, 240, 130, 200][i]}px"></div>
      <div class="sk-linha fina" style="width:${[120, 160, 90, 140][i]}px"></div></div>`).join('');
}

/** "Hoje", "Ontem", "Terça-feira" (esta semana), "12/09" ou "12/09/2025". */
function rotuloDoDia(iso, agora = new Date()) {
  const d = new Date(iso);
  const zero = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((zero(agora) - zero(d)) / 86400000);
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Ontem';
  if (dias > 1 && dias < 7) {
    const s = d.toLocaleDateString('pt-BR', { weekday: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return d.getFullYear() === agora.getFullYear()
    ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* Link clicável COM SEGURANÇA: só http/https, abre em outra aba sem dar acesso
   à nossa janela (noopener) nem dizer de onde veio (noreferrer). O texto em volta
   continua escapado; "javascript:" e afins viram texto puro. */
const RE_LINK = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
function linkSeguro(bruto) {
  let url = bruto, sobra = '';
  // pontuação colada no fim ("veja www.x.com.") não faz parte do link
  const m = /[).,;:!?]+$/.exec(url);
  if (m) { sobra = m[0]; url = url.slice(0, -sobra.length); }
  try {
    const u = new URL(/^www\./i.test(url) ? 'https://' + url : url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocolo');
    return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer nofollow" class="msg-link">${esc(url)}</a>${esc(sobra)}`;
  } catch { return esc(bruto); }
}
/** Texto da mensagem → HTML: escapa tudo, liga os links e marca a busca. */
function corpoHtml(texto, termo = '') {
  const s = String(texto ?? '');
  let html = '', i = 0;
  const marcar = trecho => {
    const e = esc(trecho);
    if (!termo) return e;
    const t = esc(termo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return e.replace(new RegExp(t, 'gi'), x => `<mark class="achado">${x}</mark>`);
  };
  s.replace(RE_LINK, (link, _g, pos) => {
    html += marcar(s.slice(i, pos)) + linkSeguro(link);
    i = pos + link.length;
    return link;
  });
  return html + marcar(s.slice(i));
}

/** Situação de uma mensagem de saída, do jeito que o atendente entende. */
function statusDaMensagem(m) {
  if (m.direcao === 'entrada') return '';
  const st = m._local || m.status;
  if (st === 'enviando') return '<span class="msg-st st-enviando" title="Enviando…">⏳</span>';
  if (st === 'na_fila') return '<span class="msg-st st-fila" title="Sem internet — sai sozinha quando a conexão voltar">🕓 na fila</span>';
  if (st === 'enviado') return '<span class="msg-st st-ok" title="Entregue ao WhatsApp">✓</span>';
  if (st === 'falhou') {
    return `<span class="msg-st st-falhou" title="${esc(m.erro || 'Não saiu no WhatsApp')}">⚠ não saiu</span>
      <button type="button" class="msg-reenviar" data-reenviar="${esc(m.id || m._idLocal)}">Tentar de novo</button>`;
  }
  // 'pendente': recém-enviada ainda está a caminho; antiga ficou sem confirmação
  const idade = Date.now() - new Date(m.created_at).getTime();
  return idade < 120_000 ? '<span class="msg-st st-enviando" title="Enviando…">⏳</span>'
    : '<span class="msg-st st-sem" title="Registrada aqui, sem confirmação de entrega">•</span>';
}

/* URLs assinadas dos anexos ficam guardadas por 50 min: redesenhar o chat
   (toda mensagem nova redesenha) não pede um link novo por foto. */
const URL_ASSINADA = new Map();
async function urlAssinada(caminho) {
  const c = URL_ASSINADA.get(caminho);
  if (c && c.ate > Date.now()) return c.url;
  const { data, error } = await sb.storage.from('anexos').createSignedUrl(caminho, 3600);
  if (error) throw error;
  if (data?.signedUrl) URL_ASSINADA.set(caminho, { url: data.signedUrl, ate: Date.now() + 50 * 60_000 });
  return data?.signedUrl || '';
}

/* Rolagem: só vai para o fim quando a conversa acabou de abrir, quando o
   atendente já estava perto do fim, ou quando ELE mandou a mensagem. Se ele
   subiu para reler algo e chega mensagem nova, a tela fica onde está e a
   pílula "↓ Novas mensagens" avisa. */
let conversaRenderizada = null;
const PERTO_DO_FIM = 90;   // px
function pertoDoFim(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM; }

/** O que aparece no chat: as do banco + as que ainda estão saindo daqui. */
function mensagensParaMostrar() {
  const locais = (ENVIOS_LOCAIS.get(conversaAtual?.id) || []);
  return locais.length ? [...MENSAGENS, ...locais] : MENSAGENS;
}

function renderMensagens({ forcarFim = false, manterTopo = false } = {}) {
  const el = $('#mensagens');
  const trocouConversa = conversaRenderizada !== conversaAtual?.id;
  const estavaNoFim = !manterTopo && (trocouConversa || forcarFim || pertoDoFim(el));
  const alturaAntes = el.scrollHeight, topoAntes = el.scrollTop;
  conversaRenderizada = conversaAtual?.id || null;
  const todas = mensagensParaMostrar();
  if (!todas.length) {
    el.innerHTML = `<div class="vazio estado-vazio"><span class="vazio-ico" aria-hidden="true">👋</span>
      <p>Nenhuma mensagem ainda. Escreva abaixo para começar.</p></div>`;
    $('#pillNovas').hidden = true;
    return;
  }
  const termo = BUSCA_MSG.termo;
  // onde entra a marca "não lidas": antes da N-ésima mensagem do cliente, contando do fim
  let idNaoLida = null;
  if (marcaNaoLidas.conv === conversaAtual?.id && marcaNaoLidas.n > 0) {
    const entradas = todas.filter(m => m.direcao === 'entrada');
    idNaoLida = entradas[Math.max(0, entradas.length - marcaNaoLidas.n)]?.id || null;
  }
  let ultimoDia = '', anterior = null;
  const partes = [];
  if (temMsgsAnteriores) {
    partes.push('<div class="msgs-anteriores"><button type="button" class="btn btn-ghost sm" data-acao="msgs-anteriores">↑ Carregar mensagens anteriores</button></div>');
  }
  for (const m of todas) {
    const dia = new Date(m.created_at).toDateString();
    if (dia !== ultimoDia) {
      ultimoDia = dia;
      anterior = null;
      partes.push(`<div class="dia-sep" role="separator">${esc(rotuloDoDia(m.created_at))}</div>`);
    }
    if (idNaoLida && m.id === idNaoLida) {
      partes.push(`<div class="naolidas-sep" role="separator">${esc(String(marcaNaoLidas.n))} não lida${marcaNaoLidas.n > 1 ? 's' : ''}</div>`);
    }
    const hora = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const marcada = selecionadas.has(m.id);
    // mesma pessoa, menos de 5 min depois: cola na anterior (lê como um bloco só)
    const seguida = anterior && anterior.direcao === m.direcao
      && (new Date(m.created_at) - new Date(anterior.created_at)) < 5 * 60_000;
    anterior = m;
    /* Documento/foto enviado tem cópia guardada: vira cartão que ABRE.
       Foto ganha miniatura (carregada depois, com link assinado). */
    let anexoHtml = '';
    if (m.anexo) {
      const nomeArq = String(m.anexo).split('/').pop().replace(/^\d+-/, '');
      // áudio toca ali mesmo; foto amplia; o resto abre em nova aba
      anexoHtml = /^audio\//i.test(m.anexo_mime || '')
        ? `<audio class="msg-audio" controls preload="none" data-anexo-audio="${esc(m.anexo)}"></audio>`
        : /^image\//i.test(m.anexo_mime || '')
        ? `<img class="msg-imagem" data-anexo-img="${esc(m.anexo)}" alt="${esc(nomeArq)}" title="Abrir a foto" loading="lazy">`
        : `<button type="button" class="msg-anexo" data-anexo="${esc(m.anexo)}"
               title="Abrir o documento">📄 <span>${esc(nomeArq)}</span> ⤢</button>`;
    }
    const idMsg = m.id || m._idLocal;
    const st = m._local || m.status;
    partes.push(`<div class="msg ${m.direcao === 'entrada' ? 'entrada' : 'saida'}${m.gerada_por_ia ? ' ia-tag' : ''}${
        seguida ? ' seguida' : ''}${st === 'falhou' ? ' falhou' : ''}${m._local ? ' local' : ''}${
        modoSelecao && m.id ? ' selecionavel' : ''}${marcada ? ' marcada' : ''}" data-msg="${esc(idMsg)}">
      ${modoSelecao && m.id ? `<span class="msg-marca">${marcada ? '✓' : ''}</span>` : ''}
      ${anexoHtml}<span class="msg-texto">${corpoHtml(m.corpo, termo)}</span>
      <span class="msg-hora">${esc(hora)} ${statusDaMensagem(m)}</span>
      ${!modoSelecao && m.corpo ? `<button type="button" class="msg-copiar" data-copiar="${esc(idMsg)}" title="Copiar o texto" aria-label="Copiar o texto da mensagem">⧉</button>` : ''}
    </div>`);
  }
  el.innerHTML = partes.join('');

  if (modoSelecao) {
    // no modo de seleção a rolagem fica onde está, senão pula a cada clique
    el.scrollTop = topoAntes;
  } else if (manterTopo) {
    // carregou as anteriores: o que estava na tela continua no mesmo lugar
    el.scrollTop = el.scrollHeight - alturaAntes + topoAntes;
  } else if (estavaNoFim) {
    el.scrollTop = el.scrollHeight;
    $('#pillNovas').hidden = true;
  } else {
    // mantém a posição de leitura (o que mudou está abaixo) e avisa que chegou coisa nova
    el.scrollTop = topoAntes;
    if (el.scrollHeight > alturaAntes) $('#pillNovas').hidden = false;
  }

  /* miniaturas e áudios: link assinado (1h, guardado) — só quem está logado consegue gerar */
  $$('#mensagens [data-anexo-audio]').forEach(async (au) => {
    try { const u = await urlAssinada(au.dataset.anexoAudio); if (u && au.src !== u) au.src = u; }
    catch { /* sem link: o player fica vazio, mas nada quebra */ }
  });
  $$('#mensagens [data-anexo-img]').forEach(async (img) => {
    try { const u = await urlAssinada(img.dataset.anexoImg); if (u && img.src !== u) img.src = u; }
    catch { /* fica sem miniatura; o clique ainda tenta abrir */ }
  });
  if (BUSCA_MSG.termo) atualizarResultadosBusca({ manterIndice: true });
}

/* Cliques dentro do chat: UM ouvinte só, ligado uma vez (antes eram vários
   por mensagem, recriados a cada mensagem nova). */
async function abrirAnexo(caminho) {
  try { window.open(await urlAssinada(caminho), '_blank', 'noopener'); }
  catch (e) { toast('⚠️ Não consegui abrir o anexo: ' + (e.message || e)); }
}
$('#mensagens').addEventListener('click', (ev) => {
  const alvo = ev.target;
  const anexo = alvo.closest('[data-anexo]');
  if (anexo) { ev.stopPropagation(); return abrirAnexo(anexo.dataset.anexo); }
  const img = alvo.closest('[data-anexo-img]');
  if (img) { ev.stopPropagation(); return abrirAnexo(img.dataset.anexoImg); }
  if (alvo.closest('audio')) return;
  const copiar = alvo.closest('[data-copiar]');
  if (copiar) {
    const m = mensagensParaMostrar().find(x => (x.id || x._idLocal) === copiar.dataset.copiar);
    if (m) copiarTexto(m.corpo, '📋 Texto copiado');
    return;
  }
  const reenviar = alvo.closest('[data-reenviar]');
  if (reenviar) return tentarDeNovo(reenviar.dataset.reenviar);
  const acao = alvo.closest('[data-acao]')?.dataset.acao;
  if (acao === 'msgs-anteriores') return carregarMensagens({ anteriores: true });
  if (acao === 'recarregar-msgs') return carregarMensagens();
  if (alvo.closest('a')) return;
  if (modoSelecao) {
    const d = alvo.closest('[data-msg]');
    const id = d?.dataset.msg;
    if (!id || !MENSAGENS.some(m => m.id === id)) return;
    selecionadas.has(id) ? selecionadas.delete(id) : selecionadas.add(id);
    renderMensagens();
    atualizarBarraSelecao();
  }
});

/* ============================================================
   APAGAR MENSAGENS
   Serve para tirar do chat o que não é atendimento: teste, engano,
   duplicada. Some do painel — NÃO some do celular do cliente, e o aviso
   deixa isso claro para ninguém apagar achando que "desfez" o envio.
   ============================================================ */
let modoSelecao = false;
const selecionadas = new Set();

function alternarSelecao(ligar) {
  modoSelecao = ligar ?? !modoSelecao;
  if (!modoSelecao) selecionadas.clear();
  $('#barraSelecao').hidden = !modoSelecao;
  $('#btnSelecionarMsgs')?.classList.toggle('ativo', modoSelecao);
  renderMensagens();
  atualizarBarraSelecao();
}

function atualizarBarraSelecao() {
  const n = selecionadas.size;
  const t = $('#selecaoTexto');
  if (t) t.textContent = n ? `${n} mensagem${n > 1 ? 's' : ''} marcada${n > 1 ? 's' : ''}` : 'Toque nas mensagens';
  const b = $('#btnApagarMsgs');
  if (b) b.disabled = !n;
}

$('#btnSelecionarMsgs')?.addEventListener('click', () => alternarSelecao());
$('#btnCancelarSelecao')?.addEventListener('click', () => alternarSelecao(false));

$('#btnApagarMsgs')?.addEventListener('click', async () => {
  const ids = [...selecionadas];
  if (!ids.length) return;
  if (!confirm(
      `Apagar ${ids.length} mensagem(ns) do painel?\n\n`
    + `Elas somem daqui e do histórico da oficina, sem desfazer.\n`
    + `No celular do cliente as mensagens CONTINUAM — isso não apaga o WhatsApp dele.`)) return;

  const b = $('#btnApagarMsgs');
  b.disabled = true;
  try {
    const r = await (await fetch('/api/mensagens/excluir', {
      method: 'POST', headers: await authCabecalhos(), body: JSON.stringify({ ids }),
    })).json();
    if (!r.ok) throw new Error(r.erro || 'não consegui apagar');
    toast(`🗑 ${r.apagadas} mensagem(ns) apagada(s)`);
    alternarSelecao(false);
    await carregarMensagens();
    await carregarConversas();
  } catch (err) {
    toast('⚠️ ' + err.message);
    b.disabled = false;
  }
});

/* ---------------- Enviar ---------------- */
const campo = $('#campoMensagem');
const LIMITE_MENSAGEM = 4000;   // o mesmo teto do servidor (/api/enviar corta em 4000)
/** Contador discreto: só aparece a partir de 500 caracteres; fica vermelho perto do teto. */
function atualizarContador() {
  const n = campo.value.length, el = $('#contadorChars');
  if (!el) return;
  el.hidden = n < 500;
  el.textContent = `${n.toLocaleString('pt-BR')}/${LIMITE_MENSAGEM.toLocaleString('pt-BR')}`;
  el.classList.toggle('perto', n >= LIMITE_MENSAGEM - 200);
}
campo.addEventListener('input', () => {
  campo.style.height = 'auto';
  campo.style.height = Math.min(campo.scrollHeight, 130) + 'px';
  atualizarContador();
  if (conversaAtual) guardarRascunho(conversaAtual.id, campo.value);
});
campo.addEventListener('keydown', e => {
  // Enter envia; Shift+Enter quebra linha; Ctrl+Enter envia sempre (mesmo com Shift)
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); enviarMensagem(); }
});
$('#btnEnviar').addEventListener('click', enviarMensagem);

/* "↓ Novas mensagens": desce até o fim e some */
$('#pillNovas').addEventListener('click', () => {
  const el = $('#mensagens');
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  // aba em segundo plano não anima a rolagem: garante o fim por tempo
  setTimeout(() => { if (!pertoDoFim(el)) el.scrollTop = el.scrollHeight; }, 500);
  $('#pillNovas').hidden = true;
});
$('#mensagens').addEventListener('scroll', () => {
  if (pertoDoFim($('#mensagens'))) $('#pillNovas').hidden = true;
});

/* Marcar como NÃO lida: a conversa volta a contar no badge e, no celular,
   a tela volta para a lista — é o jeito de "deixar para depois" sem perder. */
$('#btnNaoLida').addEventListener('click', async () => {
  if (!conversaAtual) return;
  const conv = conversaAtual;
  try {
    const { error } = await sb.from('conversas').update({ nao_lidas: Math.max(1, conv.nao_lidas || 0) }).eq('id', conv.id);
    if (error) throw error;
    if (!(conv.nao_lidas > 0)) ajustarNaoLidas(+1);
    conv.nao_lidas = Math.max(1, conv.nao_lidas || 0);
    fecharConversa();
    renderConversas();
    atualizarBadge();
    toast('✉ Marcada como não lida');
  } catch (err) { toast('⚠️ ' + err.message); }
});

/* ---------------- Enviar documento / foto ----------------
   O arquivo sobe em base64 para o servidor, que repassa ao WhatsApp da
   empresa. O que estiver escrito no campo vira a LEGENDA do arquivo. */
$('#btnAnexo').addEventListener('click', () => {
  if (!conversaAtual) return toast('Abra uma conversa primeiro.');
  $('#arquivoInput').click();
});

/* ---------------- Mensagem de voz ----------------
   Um toque começa a gravar, outro envia. O áudio é convertido para WAV
   16 kHz mono aqui no navegador: é o formato que o WhatsApp da empresa
   aceita com certeza (testado), sem depender do que cada navegador grava. */
let gravador = null, pedacos = [], relogioAudio = null, comecouEm = 0;
const MAX_AUDIO_S = 180;   // 3 minutos: passa disso vira arquivo grande demais

function pintarStatusAudio(texto, gravando) {
  const el = $('#audioStatus');
  el.textContent = texto || '';
  el.hidden = !texto;
  $('#btnAudio').classList.toggle('gravando', !!gravando);
  $('#btnAudio').textContent = gravando ? '⏹' : '🎤';
}

/** Áudio gravado (qualquer formato) → WAV 16 kHz mono. */
async function paraWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const taxa = 16000;
  const quadros = Math.round(audio.duration * taxa);
  const off = new OfflineAudioContext(1, quadros, taxa);
  const fonte = off.createBufferSource();
  fonte.buffer = audio;
  fonte.connect(off.destination);
  fonte.start();
  const pronto = await off.startRendering();
  ctx.close();

  const amostras = pronto.getChannelData(0);
  const buf = new ArrayBuffer(44 + amostras.length * 2);
  const v = new DataView(buf);
  const escrever = (pos, txt) => { for (let i = 0; i < txt.length; i++) v.setUint8(pos + i, txt.charCodeAt(i)); };
  escrever(0, 'RIFF'); v.setUint32(4, 36 + amostras.length * 2, true); escrever(8, 'WAVE');
  escrever(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, taxa, true); v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  escrever(36, 'data'); v.setUint32(40, amostras.length * 2, true);
  for (let i = 0; i < amostras.length; i++) {
    const s = Math.max(-1, Math.min(1, amostras[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

$('#btnAudio').addEventListener('click', async () => {
  if (!conversaAtual) return toast('Abra uma conversa primeiro.');

  // já está gravando: para e envia
  if (gravador && gravador.state === 'recording') { gravador.stop(); return; }

  try {
    const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
    pedacos = [];
    gravador = new MediaRecorder(fluxo);
    gravador.ondataavailable = (e) => { if (e.data.size) pedacos.push(e.data); };

    gravador.onstop = async () => {
      clearInterval(relogioAudio);
      fluxo.getTracks().forEach(t => t.stop());
      pintarStatusAudio('convertendo…', false);
      $('#btnAudio').disabled = true;
      try {
        const bruto = new Blob(pedacos, { type: gravador.mimeType || 'audio/webm' });
        if (bruto.size < 1000) throw new Error('gravação muito curta');
        const wav = await paraWav(bruto);
        const base64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(',')[1] || '');
          r.onerror = () => rej(new Error('não consegui ler a gravação'));
          r.readAsDataURL(wav);
        });
        pintarStatusAudio('enviando…', false);
        const legenda = campo.value.trim();
        const resp = await fetch('/api/mensagens/enviar-arquivo', {
          method: 'POST', headers: await authCabecalhos(),
          body: JSON.stringify({
            telefone: conversaAtual.telefone, conversaId: conversaAtual.id,
            nome_arquivo: 'audio.wav', mime: 'audio/wav', base64, legenda,
          }),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(j.erro || 'falha no envio');
        if (legenda) campo.value = '';
        toast('🎤 Áudio enviado');
        await carregarMensagens();
        await carregarConversas();
      } catch (err) { toast('⚠️ ' + err.message); }
      finally { pintarStatusAudio('', false); $('#btnAudio').disabled = false; gravador = null; }
    };

    gravador.start();
    comecouEm = Date.now();
    pintarStatusAudio('● 0:00 — toque para enviar', true);
    relogioAudio = setInterval(() => {
      const s = Math.floor((Date.now() - comecouEm) / 1000);
      if (s >= MAX_AUDIO_S) { gravador.stop(); return; }
      pintarStatusAudio(`● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} — toque para enviar`, true);
    }, 500);
  } catch (err) {
    toast(err.name === 'NotAllowedError'
      ? '⚠️ Libere o microfone para o navegador e tente de novo.'
      : '⚠️ Não consegui gravar: ' + err.message);
    pintarStatusAudio('', false);
  }
});

$('#arquivoInput').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';                       // permite reescolher o mesmo arquivo
  if (f) prepararAnexo(f);
});

/* ---------------- Prévia antes de mandar ----------------
   Clipe, colar imagem (Ctrl+V) ou arrastar para o chat caem todos aqui:
   mostra a miniatura (ou o nome e o tamanho), deixa escrever a legenda e
   só então manda. O texto que já estava no campo vira a legenda. */
const MAX_ANEXO = 15 * 1024 * 1024;
const TIPOS_ANEXO = /^(image\/|audio\/|application\/pdf|application\/msword|application\/vnd\.openxmlformats|application\/vnd\.ms-excel|text\/plain|text\/csv|application\/zip)/i;
let anexoPendente = null;
const tamanhoLegivel = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;

function prepararAnexo(f) {
  if (!conversaAtual) return toast('Abra uma conversa primeiro.');
  if (f.size > MAX_ANEXO) return toast(`⚠️ ${f.name} tem ${tamanhoLegivel(f.size)} — o máximo é 15 MB.`);
  if (!f.size) return toast('⚠️ Esse arquivo está vazio.');
  if (f.type && !TIPOS_ANEXO.test(f.type) && !/\.(pdf|docx?|xlsx?|txt|csv|zip)$/i.test(f.name)) {
    return toast('⚠️ Esse tipo de arquivo não vai pelo WhatsApp. Mande foto, PDF, Word, Excel, texto ou zip.');
  }
  if (anexoPendente?.url) URL.revokeObjectURL(anexoPendente.url);
  const ehImagem = /^image\//i.test(f.type);
  anexoPendente = { arquivo: f, conv: conversaAtual, url: ehImagem ? URL.createObjectURL(f) : null };
  $('#anexoPrevia').innerHTML = ehImagem
    ? `<img src="${esc(anexoPendente.url)}" alt="Prévia de ${esc(f.name)}"><small>${esc(f.name)} · ${esc(tamanhoLegivel(f.size))}</small>`
    : `<div class="anexo-doc"><span aria-hidden="true">📄</span><div><b>${esc(f.name)}</b><small>${esc(tamanhoLegivel(f.size))}</small></div></div>`;
  $('#anexoLegenda').value = campo.value.trim();
  abrirModal('modalAnexoBg', '#btnEnviarAnexo');
}

$('#formAnexo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!anexoPendente) return;
  const { arquivo: f, conv } = anexoPendente;
  const legenda = $('#anexoLegenda').value.trim();
  const btn = $('#btnEnviarAnexo');
  btn.disabled = true; btn.innerHTML = '<span class="girando"></span>Enviando…';
  try {
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1] || '');
      r.onerror = () => rej(new Error('não consegui ler o arquivo'));
      r.readAsDataURL(f);
    });
    const resp = await fetch('/api/mensagens/enviar-arquivo', {
      method: 'POST', headers: await authCabecalhos(),
      body: JSON.stringify({
        telefone: conv.telefone, conversaId: conv.id,
        nome_arquivo: f.name || 'arquivo', mime: f.type || 'application/octet-stream',
        base64, legenda,
      }),
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(j.erro || 'falha no envio');
    // a legenda saiu junto: o que estava no campo não precisa ficar lá
    if (legenda && conversaAtual?.id === conv.id && campo.value.trim() === legenda) {
      campo.value = ''; guardarRascunho(conv.id, ''); campo.dispatchEvent(new Event('input'));
    }
    fecharModal('modalAnexoBg');
    toast('📎 Enviado: ' + (f.name || 'arquivo'));
    avisarMensagem(conv.id, 'saida', null);
    if (conversaAtual?.id === conv.id) await carregarMensagens();
    agendarRecargaLista();
  } catch (err) { toast('⚠️ ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Enviar'; }
});

// Ctrl+V de uma imagem (print, foto copiada) direto no campo de mensagem
campo.addEventListener('paste', (ev) => {
  const item = [...(ev.clipboardData?.items || [])].find(i => i.kind === 'file');
  const f = item?.getAsFile();
  if (!f) return;                         // texto normal: cola como sempre
  ev.preventDefault();
  const nome = f.name && f.name !== 'image.png' ? f.name : `imagem-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  prepararAnexo(new File([f], nome, { type: f.type || 'image/png' }));
});

// Arrastar arquivo para cima do chat
(() => {
  const zona = $('#chat'), aviso = $('#soltarAqui');
  let profundidade = 0;
  const temArquivo = ev => [...(ev.dataTransfer?.types || [])].includes('Files');
  zona.addEventListener('dragenter', ev => { if (!temArquivo(ev)) return; ev.preventDefault(); profundidade++; aviso.hidden = false; });
  zona.addEventListener('dragover', ev => { if (!temArquivo(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
  zona.addEventListener('dragleave', ev => { if (!temArquivo(ev)) return; if (--profundidade <= 0) { profundidade = 0; aviso.hidden = true; } });
  zona.addEventListener('drop', ev => {
    if (!temArquivo(ev)) return;
    ev.preventDefault();
    profundidade = 0; aviso.hidden = true;
    const f = ev.dataTransfer.files?.[0];
    if (f) prepararAnexo(f);
    if ((ev.dataTransfer.files?.length || 0) > 1) toast('Um arquivo por vez — mandei a prévia do primeiro.');
  });
})();

/* ---------------- Enviar (otimista, com situação e "tentar de novo") ----------------
   A mensagem aparece NA HORA com ⏳; ao gravar no banco vira a linha de
   verdade; o CodeWords responde e ela vira ✓ (entregue) ou ⚠ não saiu, com o
   botão "Tentar de novo". A situação fica gravada em whatsapp_mensagens.status
   (e o motivo em .erro) — antes TODA mensagem do painel ficava "pendente" para
   sempre, entregue ou não. Sem internet, vai para a fila e sai sozinha depois. */
const ENVIOS_LOCAIS = new Map();      // conversaId -> [mensagens ainda sem linha no banco]
function locaisDe(convId) {
  if (!ENVIOS_LOCAIS.has(convId)) ENVIOS_LOCAIS.set(convId, []);
  return ENVIOS_LOCAIS.get(convId);
}
function tirarLocal(convId, idLocal) {
  const l = ENVIOS_LOCAIS.get(convId);
  if (!l) return;
  const i = l.findIndex(x => x._idLocal === idLocal);
  if (i >= 0) l.splice(i, 1);
}
const avisarMensagem = (conversaId, direcao, id) => {
  try { window.dispatchEvent(new CustomEvent('indycar:mensagem', { detail: { conversaId, direcao, id } })); } catch { /* ignora */ }
};

async function enviarMensagem() {
  const texto = campo.value.trim();
  if (!texto || !conversaAtual) return;
  const conv = conversaAtual;
  campo.value = '';
  campo.style.height = 'auto';
  guardarRascunho(conv.id, '');
  atualizarContador();
  fecharMenuAtalhos();
  campo.focus();

  // sem internet: fila local, sai sozinha quando voltar
  if (navigator.onLine === false) {
    filaOfflineAdicionar({ conversaId: conv.id, telefone: conv.telefone, nome: conv.nome, clienteId: conv.cliente_id, corpo: texto });
    renderMensagens({ forcarFim: true });
    toast('🕓 Sem internet — a mensagem ficou na fila e sai sozinha quando a conexão voltar.');
    return;
  }
  await entregarMensagem(conv, texto);
}

/** Grava no banco e entrega pelo CodeWords. Serve ao envio normal, à fila e ao "tentar de novo". */
async function entregarMensagem(conv, texto, { linhaExistente = null } = {}) {
  const local = linhaExistente ? null : {
    _idLocal: 'l' + Date.now() + Math.random().toString(16).slice(2, 6), _local: 'enviando',
    conversa_id: conv.id, corpo: texto, direcao: 'saida', created_at: new Date().toISOString(),
  };
  if (local) {
    locaisDe(conv.id).push(local);
    if (conversaAtual?.id === conv.id) renderMensagens({ forcarFim: true });
  }
  let linha = linhaExistente;
  try {
    if (!linha) {
      const { data, error } = await sb.from('whatsapp_mensagens').insert({
        conversa_id: conv.id,
        cliente_id:  conv.cliente_id,
        telefone:    conv.telefone,
        nome:        conv.nome,
        corpo:       texto,
        direcao:     'saida',
        status:      'pendente',
      }).select('*').single();
      if (error) throw error;
      linha = data;
      tirarLocal(conv.id, local._idLocal);
      if (linha && conversaAtual?.id === conv.id && !MENSAGENS.some(m => m.id === linha.id)) MENSAGENS.push(linha);
      avisarMensagem(conv.id, 'saida', linha?.id);
    } else {
      linha.status = 'pendente'; linha._local = 'enviando';
    }
    if (conversaAtual?.id === conv.id) renderMensagens({ forcarFim: true });
  } catch (err) {
    // nem chegou ao banco: fica na tela como "não saiu", com o texto para tentar de novo
    if (local) { local._local = 'falhou'; local.erro = err.message; }
    if (conversaAtual?.id === conv.id) renderMensagens({ forcarFim: true });
    toast('⚠️ Não consegui registrar a mensagem: ' + err.message);
    return false;
  }

  // Entrega de verdade no WhatsApp, via CodeWords.
  let ok = false, erro = '';
  try {
    const r = await (await fetch('/api/enviar', {
      method: 'POST', headers: await authCabecalhos(),
      body: JSON.stringify({ telefone: conv.telefone, corpo: texto, nome: conv.nome, conversaId: conv.id }),
    })).json();
    ok = !!r.ok;
    if (!ok) {
      erro = r.erro || 'o WhatsApp não confirmou';
      toast('⚠️ Registrado aqui, mas não saiu no WhatsApp: ' + erro);
      // chave recusada: a faixa de saúde acende na hora, sem esperar o vigia
      if (r.codigo === 'codewords-401') mostrarSaude({ problema: 'codewords-fora', texto: r.erro, desde: null });
    }
  } catch (err) {
    // A mensagem já está salva; o que falhou foi a entrega. Avisa, para
    // ninguém achar que o cliente recebeu.
    erro = err.message || 'falha de rede';
    toast('⚠️ Registrado aqui, mas não saiu no WhatsApp: ' + erro);
  }
  const status = ok ? 'enviado' : 'falhou';
  linha.status = status; linha.erro = ok ? null : erro; delete linha._local;
  const daLista = MENSAGENS.find(m => m.id === linha.id);
  if (daLista && daLista !== linha) { daLista.status = status; daLista.erro = linha.erro; delete daLista._local; }
  if (conversaAtual?.id === conv.id) renderMensagens();
  // grava a situação (só a coluna status/erro; nenhum gatilho do banco roda em update)
  sb.from('whatsapp_mensagens').update({ status, erro: ok ? null : String(erro).slice(0, 300) })
    .eq('id', linha.id).then(() => {}, () => {});
  agendarRecargaLista();
  return ok;
}

/** "Tentar de novo" de uma mensagem que não saiu. */
async function tentarDeNovo(id) {
  if (!conversaAtual) return;
  const conv = conversaAtual;
  const local = (ENVIOS_LOCAIS.get(conv.id) || []).find(x => x._idLocal === id);
  if (local) {
    tirarLocal(conv.id, id);
    renderMensagens();
    return entregarMensagem(conv, local.corpo);
  }
  const linha = MENSAGENS.find(m => m.id === id);
  if (!linha) return;
  renderMensagens();
  const ok = await entregarMensagem(conv, linha.corpo, { linhaExistente: linha });
  if (ok) toast('✅ Agora foi');
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
    fecharConversa();
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
/* ============================================================
   FICHA EDITÁVEL
   Dá para mexer no cliente, no serviço e no valor sem sair do atendimento.
   Antes era só leitura e mandava a pessoa abrir o CRM no meio da conversa —
   ninguém faz isso com o cliente esperando resposta, e o dado ficava sem
   registrar.
   ============================================================ */
const ROTULO_LEAD = {
  novo: 'Novo', contato: 'Em contato', orcamento: 'Orçamento',
  agendado: 'Agendado', em_servico: 'Em serviço',
  concluido: 'Concluído', perdido: 'Perdido',
};

/* Dinheiro como a oficina digita: "1.234,56", "1234,56", "R$ 90" ou "90".
   parseFloat sozinho lê "1.234,56" como 1.234 — trocaria mil e duzentos por
   um e vinte e três. */
function lerDinheiro(txt) {
  const s = String(txt ?? '').trim();
  if (!s) return null;
  const limpo = s.replace(/[^\d,.-]/g, '');
  if (!limpo) return null;
  // se tem vírgula, ela é o decimal e o ponto é separador de milhar
  const normal = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Catálogo da oficina, para o campo de serviço sugerir em vez de exigir digitar
let CATALOGO = [];
async function carregarCatalogo() {
  if (CATALOGO.length) return;
  /* As colunas são `servico` e `fazemos` — não `nome`/`ativo`. Escrevi errado
     na primeira versão e o catch engoliu: o campo ficou sem sugestão nenhuma
     e nada avisou. O erro agora vai para o console; a tela não trava por
     isso, porque o campo aceita texto livre de qualquer jeito. */
  const { data, error } = await sb.from('catalogo_servicos')
    .select('servico').eq('fazemos', true).order('servico').limit(400);
  if (error) { console.error('catálogo de serviços:', error.message); return; }
  CATALOGO = (data || []).map(s => s.servico).filter(Boolean);
}

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
  alvo.innerHTML = esqueletoFicha();

  try {
    /* O catálogo entra no Promise.all: fora dele, o datalist era montado
       antes das sugestões chegarem e o campo de serviço abria vazio na
       primeira conversa. É cache, então só custa na primeira vez.
       A parte do Comunicar (aniversário, opt-out, revisão, fila) vem do
       servidor: essas tabelas não têm leitura pelo navegador. */
    const [, c360, leads, agend, fx] = await Promise.all([
      carregarCatalogo(),
      sb.from('v_cliente_360').select('*').eq('id', conv.cliente_id).maybeSingle(),
      sb.from('leads').select('*').eq('cliente_id', conv.cliente_id)
        .order('created_at', { ascending:false }).limit(5),
      sb.from('agendamentos').select('*, consultores(nome)').eq('cliente_id', conv.cliente_id)
        .order('inicio_em', { ascending:false }).limit(5),
      fichaDoServidor(conv.cliente_id),
    ]);
    if (conversaAtual?.id !== conv.id) return;   // o atendente já abriu outra conversa

    const f = c360?.data || {};
    const cli = fx?.ok ? fx.cliente : {};
    const rev = fx?.ok ? fx.revisao : null;
    const ultimo = fx?.ok ? fx.ultimoServico : null;
    const envios = fx?.ok ? (fx.envios || []) : [];
    const aceita = cli.aceita_mensagens !== false;
    const diasNiver = diasParaAniversario(cli.nascimento);
    const idade = idadeDe(cli.nascimento);
    const revAtrasada = !!rev && new Date(rev.prevista) < new Date();
    // alimenta as variáveis dos atalhos ({carro}, {horario}, {proxima_revisao}…)
    fichaCache = { ...f, nascimento: cli.nascimento, aceita_mensagens: aceita,
                   proxima_revisao: rev?.prevista || null, ultimo_servico: ultimo?.servico || null };
    CLIENTES_INFO.set(conv.cliente_id, { ...(CLIENTES_INFO.get(conv.cliente_id) || {}),
      placa: f.placa, carro_modelo: f.carro_modelo, nascimento: cli.nascimento, aceita_mensagens: aceita });
    const listaLeads = leads.data || [];
    const listaAgend = agend.data || [];
    const dataCurta = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

    renderAvisosDoChat({ diasNiver, aceita, rev, revAtrasada });

    alvo.innerHTML = `
      <div class="ficha-cab">
        <span class="avatar">${esc(iniciais(f.nome || conv.nome))}</span>
        <strong>${esc(f.nome || conv.nome || conv.telefone)}</strong>
        <small>${esc(telefoneBonito(conv.telefone))}</small>
        <div class="ficha-selos">
          ${diasNiver === 0 ? '<span class="tag niver">🎂 aniversário hoje</span>'
            : diasNiver !== null && diasNiver <= 7 ? `<span class="tag niver">🎂 em ${diasNiver} dia${diasNiver > 1 ? 's' : ''}</span>` : ''}
          ${!aceita ? '<span class="tag mudo">🔕 sem mensagens automáticas</span>' : ''}
          ${revAtrasada ? '<span class="tag atrasada">🔧 revisão atrasada</span>' : ''}
        </div>
        ${linksDoClienteHtml(conv, fx?.comunicarUrl)}
      </div>

      <div class="ficha-stats">
        <div class="mini-kpi"><b>${brl(f.total_gasto)}</b><small>já gastou</small></div>
        <div class="mini-kpi"><b>${f.servicos_feitos ?? 0}</b><small>serviços</small></div>
        <div class="mini-kpi"><b>${f.total_leads ?? 0}</b><small>contatos</small></div>
        <div class="mini-kpi${(f.faltas ?? 0) > 0 ? ' alerta' : ''}"><b>${f.faltas ?? 0}</b><small>faltas</small></div>
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
        <div class="ficha-titulo">Revisão</div>
        ${fx && !fx.ok ? `<div class="vazio" style="padding:10px">${esc(fx.erro || 'Não consegui ler o Comunicar.')}</div>`
        : ultimo ? `
          <div class="ficha-linha"><span>Último serviço</span>
            <b>${esc(ultimo.servico || 'serviço')}<small class="ficha-sub">${esc(dataCurta(ultimo.inicio_em))} · ${esc(tempoRelativo(ultimo.inicio_em))}</small></b></div>
          <div class="ficha-linha"><span>Próxima revisão</span>
            <b class="${revAtrasada ? 'rev-atrasada' : 'rev-ok'}">${esc(dataCurta(rev?.prevista))}
              <small class="ficha-sub">${esc(rev?.rotulo || 'Revisão geral')} · ${esc(String(rev?.meses || 6))} meses${rev?.padrao ? ' (padrão)' : ''}
              ${revAtrasada ? ' · atrasada' : rev ? ' · ' + esc(tempoRelativo(rev.prevista)) : ''}</small></b></div>`
        : '<div class="vazio" style="padding:10px">Nenhum serviço concluído ainda — a revisão aparece depois do primeiro.</div>'}
      </div>

      <div class="ficha-bloco">
        <div class="ficha-titulo">
          Cliente e carro
          <button type="button" class="ficha-editar" id="btnEditarCliente">✎ Editar</button>
        </div>
        <div id="clienteVer">
          ${linhaInline('nome', 'Nome', f.nome)}
          ${linhaInline('carro_modelo', 'Carro', f.carro_modelo, 'Ex.: Onix 2019')}
          ${linhaInline('placa', 'Placa', f.placa, 'ABC1D23')}
          <div class="ficha-linha"><span>Aniversário</span><b>${cli.nascimento
            ? esc(aniversarioTexto(cli.nascimento)) + (idade !== null ? `<small class="ficha-sub">${idade} anos</small>` : '')
            : '<span class="ficha-faltando">não informado</span>'}</b></div>
          <div class="ficha-linha"><span>Origem</span><b>${esc(f.origem) || '—'}</b></div>
          <div class="ficha-linha"><span>Cliente desde</span><b>${esc(
            f.cliente_desde ? new Date(f.cliente_desde).toLocaleDateString('pt-BR') : '—')}</b></div>
        </div>
        <form id="clienteEditar" class="ficha-form" hidden>
          <label>Nome<input id="fcNome" maxlength="120" value="${esc(f.nome || '')}" /></label>
          <label>Carro<input id="fcCarro" maxlength="80" placeholder="Ex.: Onix 2019"
                 value="${esc(f.carro_modelo || '')}" /></label>
          <label>Placa<input id="fcPlaca" maxlength="10" placeholder="ABC-1D23"
                 value="${esc(f.placa || '')}" /></label>
          <div class="ficha-campo">
            <span>Aniversário</span>
            <div class="ficha-form-lado">
              <input id="fcNascimento" type="date" min="1920-01-01" max="${esc(hojeSP())}"
                     value="${esc(valorDataParaInput(cli.nascimento))}" aria-label="Data de nascimento" />
              <label class="switch mini"><input type="checkbox" id="fcSemAno" ${cli.nascimento && String(cli.nascimento).startsWith('1904') ? 'checked' : ''} />
                <span>só dia e mês</span></label>
            </div>
          </div>
          <label>E-mail<input id="fcEmail" type="email" maxlength="160" value="${esc(f.email || '')}" /></label>
          <label>Observações<textarea id="fcObs" rows="2" maxlength="600"
                 placeholder="O que é bom lembrar deste cliente">${esc(f.observacoes || '')}</textarea></label>
          <div class="ficha-form-acoes">
            <button type="button" class="btn btn-ghost sm" id="btnCancelarCliente">Cancelar</button>
            <button type="submit" class="btn btn-primary sm">Salvar</button>
          </div>
        </form>
      </div>

      <div class="ficha-bloco">
        <div class="ficha-titulo">
          Serviços e valores
          <button type="button" class="ficha-editar destaque" id="btnNovoServico">+ Serviço</button>
        </div>
        <form id="servicoNovo" class="ficha-form" hidden>
          <label>Serviço
            <input id="fsServico" list="listaServicos" maxlength="120"
                   placeholder="Ex.: Troca de óleo" />
          </label>
          <div class="ficha-form-lado">
            <label>Orçado<input id="fsOrcado" type="text" inputmode="decimal" placeholder="0,00" /></label>
            <label>Pago<input id="fsPago" type="text" inputmode="decimal" placeholder="0,00" /></label>
          </div>
          <label>Situação
            <select id="fsStatus">
              ${['novo','contato','orcamento','agendado','em_servico','concluido','perdido']
                .map(s => `<option value="${s}"${s === 'orcamento' ? ' selected' : ''}>${esc(ROTULO_LEAD[s])}</option>`).join('')}
            </select>
          </label>
          <div class="ficha-form-acoes">
            <button type="button" class="btn btn-ghost sm" id="btnCancelarServico">Cancelar</button>
            <button type="submit" class="btn btn-primary sm">Adicionar</button>
          </div>
        </form>

        ${listaLeads.length ? listaLeads.map(l => `
          <div class="item-hist item-lead" data-lead="${esc(l.id)}">
            <div class="ih-topo">
              <b>${esc(l.servico || 'sem serviço')}</b>
              <span class="tag ${l.status === 'concluido' ? 'aberta' : 'pendente'}">${esc(ROTULO_LEAD[l.status] || l.status)}</span>
            </div>
            <div class="item-rodape">
              <small>${esc(new Date(l.created_at).toLocaleDateString('pt-BR'))} ·
                ${l.status === 'concluido' ? brl(l.valor_pago) : brl(l.valor_orcado) + ' orçado'}</small>
              <button type="button" class="btn-editar-item" data-editar-lead="${esc(l.id)}">
                ✎ Editar
              </button>
            </div>
          </div>`).join('') : '<div class="vazio" style="padding:14px">Nenhum serviço registrado.</div>'}
      </div>

      <div class="ficha-bloco">
        <div class="ficha-titulo">
          Mensagens automáticas
          <a class="ficha-link" href="${esc(fx?.comunicarUrl || 'https://indycar-posvenda.onrender.com')}"
             target="_blank" rel="noopener" title="Abrir o IndyCar Comunicar">Abrir no Comunicar ↗</a>
        </div>
        <label class="switch aceita${aceita ? '' : ' desligado'}">
          <input type="checkbox" id="fcAceita" ${aceita ? 'checked' : ''} ${fx?.ok ? '' : 'disabled'} />
          <span>Aceita mensagens automáticas</span>
        </label>
        ${!aceita ? `<small class="aceita-motivo">Desligado${cli.aceita_mensagens_em ? ' em ' + esc(dataCurta(cli.aceita_mensagens_em)) : ''}${
            cli.aceita_mensagens_motivo ? ' · ' + esc(cli.aceita_mensagens_motivo) : ''}</small>` : ''}
        ${envios.length ? `<div class="envios">${envios.map(e => `
          <div class="envio-linha">
            <span class="envio-tipo">${esc(e.rotulo)}</span>
            <span class="tag envio-${esc(e.status || 'pendente')}">${esc(ROTULO_ENVIO[e.status] || e.status || '—')}</span>
            <small>${esc(dataCurta(e.enviado_em || e.enviar_em))}</small>
            ${e.resposta_tipo ? `<span class="resp resp-${esc(e.resposta_tipo)}" title="Resposta: ${esc(ROTULO_RESPOSTA[e.resposta_tipo] || e.resposta_tipo)}">${esc(ICONE_RESPOSTA[e.resposta_tipo] || '💬')}</span>` : ''}
          </div>`).join('')}</div>`
        : fx?.ok ? '<div class="vazio" style="padding:10px">Nenhuma mensagem automática para este cliente ainda.</div>' : ''}
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
      </div>

      <datalist id="listaServicos">
        ${CATALOGO.map(n => `<option value="${esc(n)}"></option>`).join('')}
      </datalist>`;

    ligarEdicaoDaFicha(conv, f, listaLeads, cli);
  } catch (err) {
    alvo.innerHTML = `<div class="vazio">Não consegui carregar a ficha: ${esc(err.message)}</div>`;
  }
}

/* Parte da ficha que o navegador não enxerga (fila do Comunicar, regras de
   revisão): vem do servidor, com o login do atendente. */
async function fichaDoServidor(clienteId) {
  try {
    const r = await fetch(`/api/clientes/${encodeURIComponent(clienteId)}/ficha`, { headers: await authCabecalhos() });
    if (r.status === 401) { await sessaoMorreu(); return null; }
    const j = await r.json();
    return j.ok ? j : { ok: false, erro: j.erro || 'não consegui ler o Comunicar' };
  } catch (e) { return { ok: false, erro: e.message || 'sem resposta do servidor' }; }
}

const ROTULO_ENVIO = { pendente: 'na fila', enviado: 'enviada', falhou: 'falhou', cancelado: 'cancelada', pulado: 'pulada' };
const ROTULO_ENVIO_TIPO = { aniversario: 'Aniversário', posvenda: 'Pós-venda', retorno: 'Retorno de revisão',
  campanha: 'Campanha', avulsa: 'Avulsa', lembrete: 'Lembrete de horário', orcamento: 'Orçamento',
  nao_fechou: 'Não fechou', reativacao: 'Reativação', avaliacao: 'Avaliação' };
const ROTULO_RESPOSTA = { positiva: 'positiva', negativa: 'negativa', parar: 'pediu para parar', neutra: 'neutra' };
const ICONE_RESPOSTA = { positiva: '👍', negativa: '👎', parar: '🔕', neutra: '💬' };

/** Esqueleto da ficha enquanto as consultas não voltam. */
function esqueletoFicha() {
  return `<div class="ficha-esqueleto" aria-hidden="true">
    <span class="avatar sk grande"></span>
    <div class="sk-linha" style="width:60%;margin:10px auto 6px"></div>
    <div class="sk-linha fina" style="width:40%;margin:0 auto 18px"></div>
    <div class="ficha-stats"><div class="mini-kpi sk"></div><div class="mini-kpi sk"></div><div class="mini-kpi sk"></div><div class="mini-kpi sk"></div></div>
    <div class="sk-linha" style="width:35%;margin-top:18px"></div>
    <div class="sk-linha fina"></div><div class="sk-linha fina"></div><div class="sk-linha fina" style="width:70%"></div>
  </div>`;
}

/** "há 4 meses", "em 12 dias", "hoje" — para datas de serviço e revisão. */
function tempoRelativo(iso, agora = new Date()) {
  if (!iso) return '';
  const dias = Math.round((new Date(iso) - agora) / 86400000);
  const abs = Math.abs(dias);
  const txt = abs === 0 ? 'hoje'
    : abs < 30 ? `${abs} dia${abs > 1 ? 's' : ''}`
    : abs < 365 ? `${Math.round(abs / 30)} ${Math.round(abs / 30) > 1 ? 'meses' : 'mês'}`
    : `${Math.floor(abs / 365)} ano${Math.floor(abs / 365) > 1 ? 's' : ''}`;
  if (abs === 0) return txt;
  return dias < 0 ? `há ${txt}` : `em ${txt}`;
}

/** O <input type=date> precisa de um ano de verdade: 1904 ("só dia e mês") vira 2000 na tela. */
function valorDataParaInput(nasc) {
  if (!nasc) return '';
  const v = String(nasc).slice(0, 10);
  return v.startsWith('1904') ? '2000' + v.slice(4) : v;
}

/* Plaquinhas no topo do chat: aniversário, opt-out e revisão — o que o
   atendente precisa saber ANTES de escrever, sem abrir a ficha. */
function renderAvisosDoChat({ diasNiver, aceita, rev, revAtrasada }) {
  const el = $('#chatAvisos');
  if (!el) return;
  const avisos = [];
  if (diasNiver === 0) avisos.push('<span class="tag niver">🎂 Aniversário hoje!</span>');
  else if (diasNiver !== null && diasNiver <= 7) avisos.push(`<span class="tag niver">🎂 aniversário em ${diasNiver} dia${diasNiver > 1 ? 's' : ''}</span>`);
  if (!aceita) avisos.push('<span class="tag mudo" title="Pediu para não receber mensagens automáticas">🔕 sem mensagens automáticas</span>');
  if (rev) {
    const d = new Date(rev.prevista).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    avisos.push(revAtrasada
      ? `<span class="tag atrasada" title="${esc(rev.rotulo)}">🔧 revisão atrasada desde ${esc(d)}</span>`
      : `<span class="tag revisao" title="${esc(rev.rotulo)}">🔧 revisão prevista ${esc(d)}</span>`);
  }
  el.innerHTML = avisos.join('');
  el.hidden = !avisos.length;
}

/* Liga os botões da ficha. Fica separado do HTML para o template acima
   continuar legível e para poder religar tudo depois de cada recarga. */
function ligarEdicaoDaFicha(conv, f, leads, cli = {}) {
  const ver = $('#clienteVer'), form = $('#clienteEditar');
  ligarEdicaoInline(conv, f);

  /* Chave "Aceita mensagens automáticas": grava em clientes (o atendente tem
     permissão) com data e motivo, para o Comunicar saber por que pulou. */
  $('#fcAceita')?.addEventListener('change', async (ev) => {
    const ligar = ev.target.checked;
    ev.target.disabled = true;
    try {
      const { error } = await sb.from('clientes').update({
        aceita_mensagens: ligar,
        aceita_mensagens_em: new Date().toISOString(),
        aceita_mensagens_motivo: ligar ? null : `Desligado no Atendimento por ${perfil?.nome || 'atendente'}`,
      }).eq('id', conv.cliente_id);
      if (error) throw error;
      toast(ligar ? '🔔 Mensagens automáticas ligadas para este cliente'
                  : '🔕 Este cliente não recebe mais mensagens automáticas');
      await carregarFicha(conv);
      renderConversas();
    } catch (err) {
      ev.target.checked = !ligar;
      ev.target.disabled = false;
      toast('⚠️ ' + err.message);
    }
  });

  $('#btnEditarCliente')?.addEventListener('click', () => {
    const abrindo = form.hidden;
    form.hidden = !abrindo; ver.hidden = abrindo;
    $('#btnEditarCliente').textContent = abrindo ? '✕ Cancelar' : '✎ Editar';
    if (abrindo) $('#fcNome').focus();
  });
  $('#btnCancelarCliente')?.addEventListener('click', () => {
    form.hidden = true; ver.hidden = false;
    $('#btnEditarCliente').textContent = '✎ Editar';
  });

  form?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = $('#fcNome').value.trim();
    if (!nome) return toast('⚠️ O nome não pode ficar vazio.');
    const botao = form.querySelector('[type="submit"]');
    botao.disabled = true;
    try {
      /* Aniversário: com "só dia e mês" marcado, o ano gravado é 1904 — o
         combinado do ecossistema para "ano desconhecido". */
      let nascimento = $('#fcNascimento').value || null;
      if (nascimento && $('#fcSemAno').checked) nascimento = '1904' + nascimento.slice(4);
      const campos = {
        nome,
        carro_modelo: $('#fcCarro').value.trim() || null,
        placa:        $('#fcPlaca').value.trim().toUpperCase() || null,
        email:        $('#fcEmail').value.trim() || null,
        observacoes:  $('#fcObs').value.trim() || null,
        nascimento,
      };
      const { error } = await sb.from('clientes').update(campos).eq('id', conv.cliente_id);
      if (error) throw error;

      /* O nome da conversa é o que aparece na lista e no topo do chat.
         Sem acertar aqui, a ficha diria "Maria Silva" e a lista continuaria
         com o apelido do WhatsApp. */
      if (nome !== conv.nome) {
        await sb.from('conversas').update({ nome }).eq('id', conv.id);
        conv.nome = nome;
        $('#chatNome').textContent = nome;
        await carregarConversas();
      }
      toast('✅ Ficha atualizada');
      await carregarFicha(conv);
    } catch (err) {
      toast('⚠️ ' + err.message);
    } finally { botao.disabled = false; }
  });

  // ---- novo serviço ----
  const novo = $('#servicoNovo');
  $('#btnNovoServico')?.addEventListener('click', () => {
    const abrindo = novo.hidden;
    novo.hidden = !abrindo;
    $('#btnNovoServico').textContent = abrindo ? '✕ Cancelar' : '+ Serviço';
    if (abrindo) $('#fsServico').focus();
  });
  $('#btnCancelarServico')?.addEventListener('click', () => {
    novo.hidden = true; $('#btnNovoServico').textContent = '+ Serviço';
  });

  novo?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const servico = $('#fsServico').value.trim();
    if (!servico) return toast('⚠️ Diga qual é o serviço.');
    const orcado = lerDinheiro($('#fsOrcado').value);
    const pago   = lerDinheiro($('#fsPago').value);
    const status = $('#fsStatus').value;
    const botao = novo.querySelector('[type="submit"]');
    botao.disabled = true;
    try {
      /* valor_orcado e valor_pago são NOT NULL no banco: campo em branco
         vira 0, não nulo. "Ainda não tem valor" e "custou zero" dão no
         mesmo para a conta da oficina, e o insert não quebra. */
      const { error } = await sb.from('leads').insert({
        cliente_id: conv.cliente_id, nome: f.nome || conv.nome, telefone: conv.telefone,
        carro_modelo: f.carro_modelo || null, placa: f.placa || null,
        servico, valor_orcado: orcado ?? 0, valor_pago: pago ?? 0,
        status, origem: 'whatsapp',
        observacoes: 'Registrado pelo painel de atendimento.',
      });
      if (error) throw error;
      toast('✅ Serviço registrado');
      await carregarFicha(conv);
    } catch (err) {
      toast('⚠️ ' + err.message);
    } finally { botao.disabled = false; }
  });

  // ---- editar um serviço já registrado ----
  $$('[data-editar-lead]').forEach(b => b.addEventListener('click', () => {
    const lead = leads.find(l => l.id === b.dataset.editarLead);
    if (lead) abrirEdicaoDeLead(conv, lead);
  }));
}

/* Edição de um serviço já registrado. Guarda a conversa e o lead num
   fechamento para o formulário saber o que salvar. */
let leadEmEdicao = null;

function abrirEdicaoDeLead(conv, lead) {
  leadEmEdicao = { conv, lead };
  $('#mlServico').value = lead.servico || '';
  $('#mlOrcado').value  = lead.valor_orcado != null ? String(lead.valor_orcado).replace('.', ',') : '';
  $('#mlPago').value    = lead.valor_pago   != null ? String(lead.valor_pago).replace('.', ',') : '';
  $('#mlStatus').value  = lead.status || 'novo';
  $('#mlObs').value     = lead.observacoes || '';
  $('#modalLeadBg').classList.add('aberto');
  setTimeout(() => $('#mlServico').focus(), 60);
}

$('#formLead')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!leadEmEdicao) return;
  const { conv, lead } = leadEmEdicao;
  const botao = ev.currentTarget.querySelector('[type="submit"]');
  botao.disabled = true;
  try {
    const { error } = await sb.from('leads').update({
      servico: $('#mlServico').value.trim() || null,
      valor_orcado: lerDinheiro($('#mlOrcado').value) ?? 0,   // colunas NOT NULL
      valor_pago:   lerDinheiro($('#mlPago').value)   ?? 0,
      status:       $('#mlStatus').value,
      observacoes:  $('#mlObs').value.trim() || null,
    }).eq('id', lead.id);
    if (error) throw error;
    $('#modalLeadBg').classList.remove('aberto');
    toast('✅ Serviço atualizado');
    await carregarFicha(conv);
  } catch (err) {
    toast('⚠️ ' + err.message);
  } finally { botao.disabled = false; }
});

$('#btnApagarLead')?.addEventListener('click', async () => {
  if (!leadEmEdicao) return;
  const { conv, lead } = leadEmEdicao;
  if (!confirm(`Apagar o registro "${lead.servico || 'sem serviço'}"?\n\nIsso sai do histórico do cliente e do CRM.`)) return;
  try {
    const { error } = await sb.from('leads').delete().eq('id', lead.id);
    if (error) throw error;
    $('#modalLeadBg').classList.remove('aberto');
    toast('🗑 Registro apagado');
    await carregarFicha(conv);
  } catch (err) { toast('⚠️ ' + err.message); }
});

/* ============================================================
   TEMPO REAL — mensagem nova aparece sozinha
   ============================================================ */
/* Tempo real caiu (rede oscilou, aba dormiu, token renovou): avisa com uma
   pílula discreta e religa sozinho, esperando cada vez um pouco mais
   (5s, 10s, 20s… até 60s). Ao voltar, recarrega a lista e a conversa aberta,
   porque pode ter chegado mensagem enquanto estava fora. */
let realtimeTentativa = 0, realtimeTimer = null, realtimeCaiu = false;
function statusDoTempoReal(status) {
  const pill = $('#pillRealtime');
  if (status === 'SUBSCRIBED') {
    realtimeTentativa = 0;
    if (realtimeCaiu) {
      realtimeCaiu = false;
      carregarConversas();
      if (conversaAtual) carregarMensagens();
      toast('✅ Tempo real de volta');
    }
    if (pill) pill.hidden = true;
    return;
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    realtimeCaiu = true;
    if (pill) pill.hidden = false;
    clearTimeout(realtimeTimer);
    const espera = Math.min(60_000, 5_000 * 2 ** Math.min(realtimeTentativa++, 4));
    realtimeTimer = setTimeout(() => { if (sb) ligarTempoReal(); }, espera);
  }
}

function ligarTempoReal() {
  clearTimeout(realtimeTimer);
  if (canalRealtime) sb.removeChannel(canalRealtime);
  canalRealtime = sb.channel('atendimento')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'whatsapp_mensagens' },
      async payload => {
        const m = payload.new || {};
        const aberta = conversaAtual && m.conversa_id === conversaAtual.id;
        const olhando = aberta && document.visibilityState === 'visible';
        if (aberta) {
          // o envio já põe a própria mensagem na tela; sem esta checagem ela
          // apareceria duas vezes (uma pelo envio, outra pelo tempo real)
          const jaTem = MENSAGENS.some(x => x.id === m.id);
          if (!jaTem) { MENSAGENS.push(m); renderMensagens(); }
          // contrato com o copiloto: chegou/saiu mensagem na conversa aberta
          if (!jaTem) avisarMensagem(m.conversa_id, m.direcao, m.id);
          /* Só conta como lida se o atendente está OLHANDO: com a aba em
             segundo plano a conversa aberta continua "não lida" até ele voltar. */
          if (m.direcao === 'entrada' && olhando) {
            sb.from('conversas').update({ nao_lidas: 0 }).eq('id', conversaAtual.id).then(() => {}, () => {});
          }
        } else if (m.direcao === 'entrada') {
          toast('💬 Nova mensagem de ' + (m.nome || telefoneBonito(m.telefone)));
        }
        if (m.direcao === 'entrada' && !olhando) avisarMensagemNova(m);
        // Chegou mensagem do cliente: se a chavinha estiver ligada, a IA relê
        // a conversa e atualiza a plaquinha sozinha.
        if (m.direcao === 'entrada' && m.conversa_id) {
          agendarClassificacaoAutomatica(m.conversa_id);
        }
        agendarRecargaLista();
      })
    // situação de entrega mudou (✓ / ⚠): atualiza só a mensagem, sem recarregar o chat
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'whatsapp_mensagens' },
      payload => {
        const m = payload.new || {};
        if (!conversaAtual || m.conversa_id !== conversaAtual.id) return;
        const daLista = MENSAGENS.find(x => x.id === m.id);
        if (daLista && !daLista._local && (daLista.status !== m.status || daLista.corpo !== m.corpo)) {
          Object.assign(daLista, m);
          renderMensagens();
        }
      })
    .on('postgres_changes', { event:'*', schema:'public', table:'conversas' },
      () => agendarRecargaLista())
    .on('postgres_changes', { event:'*', schema:'public', table:'etapas_funil' },
      async () => { await carregarEtapas(); renderConversas(); renderEtapaDoChat();
                    renderEtapasAdmin(); if (abaVisivel('funil')) carregarFunil(); })
    .subscribe(status => statusDoTempoReal(status));
}

/* Rajada de eventos (importação, cliente mandando 5 mensagens seguidas, o
   Carlos respondendo junto): UMA recarga da lista a cada 600 ms, no máximo. */
let recargaListaTimer = null;
function agendarRecargaLista() {
  clearTimeout(recargaListaTimer);
  recargaListaTimer = setTimeout(() => carregarConversas(), 600);
}
// Voltou a ter rede: não espera o próximo intervalo, religa já.
window.addEventListener('online', () => { if (sb && realtimeCaiu) ligarTempoReal(); });

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
          <span class="equipe-carga" data-carga="${esc(p.id)}" aria-live="polite"></span>
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
    pintarCargaDaEquipe();
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

const VARIAVEIS = ['{nome}','{primeiro_nome}','{carro}','{placa}','{servico}','{horario}','{consultor}','{atendente}',
                   '{ultimo_servico}','{proxima_revisao}'];

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
    // vêm da ficha do Comunicar: "sua troca de óleo" / "revisão prevista para 10/04"
    ultimo_servico: fichaCache?.ultimo_servico || '',
    proxima_revisao: fichaCache?.proxima_revisao
      ? new Date(fichaCache.proxima_revisao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '',
  };
  return String(texto).replace(/\{(\w+)\}/g, (m, k) =>
    dados[k] !== undefined && dados[k] !== '' ? dados[k] : m);
}

let fichaCache = null;   // dados do cliente da conversa aberta (para as variáveis)

/* ---------- Menu do "/" ---------- */
function fecharMenuAtalhos() {
  menuAberto = false;
  $('#atalhoMenu').hidden = true;
  campo.removeAttribute('aria-activedescendant');
  $('#btnRespostas')?.setAttribute('aria-expanded', 'false');
}

function abrirMenuAtalhos(termo = '') {
  /* Sem acento e sem caixa, também pelo texto da mensagem; favoritos (★)
     primeiro, depois os mais usados — o que o atendente usa todo dia sobe. */
  const t = semAcentoBusca(termo);
  const fav = favoritosAtalhos();
  menuFiltrados = ATALHOS.filter(a => a.ativo && (!t
      || semAcentoBusca(a.comando).includes(t) || semAcentoBusca(a.titulo).includes(t)
      || (t.length >= 3 && semAcentoBusca(a.corpo).includes(t))))
    .sort((a, b) => (fav.has(b.id) - fav.has(a.id))
      || ((semAcentoBusca(b.comando).startsWith(t)) - (semAcentoBusca(a.comando).startsWith(t)))
      || ((b.usos || 0) - (a.usos || 0)));

  if (!menuFiltrados.length) return fecharMenuAtalhos();

  menuAberto = true;
  menuIndice = 0;
  $('#atalhoMenu').hidden = false;
  renderMenuAtalhos();
}

function renderMenuAtalhos() {
  /* A prévia já vem com as variáveis trocadas ("Oi, Camila! Seu Corolla…"):
     o atendente vê o que vai sair, não o molde. Variável sem valor fica
     marcada em amarelo para ele completar antes de enviar. */
  const fav = favoritosAtalhos();
  $('#atalhoLista').innerHTML = menuFiltrados.map((a, i) => {
    const previa = aplicarVariaveis(a.corpo).replace(/\n/g, ' ').slice(0, 90);
    const comMarcas = esc(previa).replace(/\{(\w+)\}/g, '<mark class="var-vazia" title="Sem valor para esta variável">{$1}</mark>');
    const ehFav = fav.has(a.id);
    return `
    <div class="atalho-op ${i === menuIndice ? 'marcado' : ''}" data-i="${i}" role="option" id="atalho-op-${i}"
         aria-selected="${i === menuIndice}">
      <span class="atalho-op-cmd">/${esc(a.comando)}</span>
      <span class="atalho-op-txt">
        <strong>${esc(a.titulo)}${a.usos ? ` <small class="atalho-usos">${esc(String(a.usos))}×</small>` : ''}</strong>
        <small>${comMarcas}</small>
      </span>
      <button type="button" class="atalho-fav${ehFav ? ' ligado' : ''}" data-fav="${esc(a.id)}"
              aria-pressed="${ehFav}" title="${ehFav ? 'Tirar dos favoritos' : 'Favoritar (fica no topo)'}"
              aria-label="${ehFav ? 'Tirar dos favoritos' : 'Favoritar'} /${esc(a.comando)}">${ehFav ? '★' : '☆'}</button>
    </div>`; }).join('');
  campo.setAttribute('aria-activedescendant', `atalho-op-${menuIndice}`);
  $('.atalho-op.marcado')?.scrollIntoView({ block: 'nearest' });
}
// um ouvinte só para o menu: usar o atalho ou (na estrela) favoritar
$('#atalhoLista').addEventListener('mousedown', ev => ev.preventDefault());   // não tira o foco do campo
$('#atalhoLista').addEventListener('click', ev => {
  const fav = ev.target.closest('[data-fav]');
  if (fav) {
    ev.stopPropagation();
    alternarFavorito(fav.dataset.fav);
    abrirMenuAtalhos((/^\/(\w*)$/.exec(campo.value) || [])[1] || '');   // reordena: favorito sobe
    return;
  }
  const op = ev.target.closest('.atalho-op');
  if (op) usarAtalho(menuFiltrados[+op.dataset.i]);
});

async function usarAtalho(a) {
  if (!a) return;
  const texto = aplicarVariaveis(a.corpo);
  /* Veio do "/" (o campo é só o comando): troca tudo. Veio do ⚡ com texto já
     escrito: encaixa onde está o cursor, sem apagar o que o atendente digitou. */
  if (/^\/\w*$/.test(campo.value) || !campo.value.trim()) campo.value = texto;
  else {
    const p = campo.selectionStart ?? campo.value.length, f = campo.selectionEnd ?? p;
    const antes = campo.value.slice(0, p), depois = campo.value.slice(f);
    const sep = antes && !/\s$/.test(antes) ? ' ' : '';
    campo.value = antes + sep + texto + depois;
    campo.selectionStart = campo.selectionEnd = (antes + sep + texto).length;
  }
  campo.dispatchEvent(new Event('input'));
  fecharMenuAtalhos();
  campo.focus();
  // conta o uso, para saber quais atalhos valem a pena (e subir os mais usados no menu)
  a.usos = (a.usos || 0) + 1;
  sb.from('atalhos_mensagem').update({ usos: a.usos }).eq('id', a.id).then(() => {}, () => {});
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
  const fav = favoritosAtalhos();
  const lista = (filtroCategoria ? ATALHOS.filter(a => a.categoria === filtroCategoria) : ATALHOS).slice()
    // favoritos primeiro, depois os mais usados — a mesma ordem do menu do "/"
    .sort((a, b) => (fav.has(b.id) - fav.has(a.id)) || ((b.usos || 0) - (a.usos || 0)));
  const el = $('#atalhosGrade');
  if (!lista.length) {
    el.innerHTML = `<div class="vazio estado-vazio"><span class="vazio-ico" aria-hidden="true">⚡</span>
      <p>${ATALHOS.length ? 'Nenhum atalho nesta categoria.' : 'Nenhum atalho ainda. Crie o primeiro e use digitando / no chat.'}</p>
      <button type="button" class="btn btn-primary sm" onclick="abrirModalAtalho(null)">+ Novo atalho</button></div>`;
    return;
  }
  const maisUsado = Math.max(0, ...lista.map(a => a.usos || 0));
  el.innerHTML = lista.map(a => `
    <div class="atalho-cartao ${a.ativo ? '' : 'inativo'}" data-id="${esc(a.id)}" tabindex="0" role="button"
         aria-label="Editar o atalho /${esc(a.comando)}">
      <div class="ac-topo">
        <span class="ac-cmd">/${esc(a.comando)}</span>
        <span class="ac-cat">${esc(a.categoria || 'geral')}</span>
        <button type="button" class="atalho-fav${fav.has(a.id) ? ' ligado' : ''}" data-fav="${esc(a.id)}"
                aria-pressed="${fav.has(a.id)}" aria-label="${fav.has(a.id) ? 'Tirar dos favoritos' : 'Favoritar'}"
                title="Favoritos aparecem primeiro no menu do /">${fav.has(a.id) ? '★' : '☆'}</button>
      </div>
      <h4>${esc(a.titulo)}</h4>
      <div class="ac-corpo">${esc(a.corpo)}</div>
      <div class="ac-rodape">${esc(String(a.usos || 0))} usos${a.ativo ? '' : ' · desativado'}${
        maisUsado > 0 && (a.usos || 0) === maisUsado ? ' · <b class="ac-top">🏆 mais usado</b>' : ''}</div>
    </div>`).join('');
}
// um ouvinte para a grade: estrela favorita, o resto abre a edição (clique ou Enter)
$('#atalhosGrade').addEventListener('click', ev => {
  const fav = ev.target.closest('[data-fav]');
  if (fav) { ev.stopPropagation(); alternarFavorito(fav.dataset.fav); renderAtalhos(); return; }
  const c = ev.target.closest('.atalho-cartao');
  if (c) abrirModalAtalho(ATALHOS.find(a => a.id === c.dataset.id));
});
$('#atalhosGrade').addEventListener('keydown', ev => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList?.contains('atalho-cartao')) {
    ev.preventDefault();
    abrirModalAtalho(ATALHOS.find(a => a.id === ev.target.dataset.id));
  }
});

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
$('#btnVoltarLista').addEventListener('click', () => fecharConversa({ focarLista: true }));

/* ============================================================
   AGENDAR  —  cria cliente + lead (CRM) + horário (Agenda)
   ============================================================ */
/* ============================================================
   ASSUMIR O ATENDIMENTO
   Ao assumir, o Carlos para de responder ESTE cliente (/stop-ai no
   fluxo dele) e a conversa vai para "Em atendimento" no funil.
   Ao devolver, ele volta a atender (/start-ai).
   ============================================================ */
/* O botão fala sobre a IA, não sobre quem é o dono do cliente.
   Eram a mesma coisa antes do rodízio: só quem assumia virava dono. Agora
   TODA conversa nasce com dono, e decidir por `atribuida_a` fazia o botão
   já aparecer como "Devolver para a IA" — o atendente clicava achando que
   assumia e reativava o Carlos. Agora quem manda é `ia_ativa`. */
function renderBotaoAssumir() {
  const b = $('#btnAssumir');
  if (!b || !conversaAtual) return;
  const iaRespondendo = conversaAtual.ia_ativa !== false;
  const minha   = conversaAtual.atribuida_a === perfil?.id;
  const deOutro = conversaAtual.atribuida_a && !minha;

  if (iaRespondendo) {
    b.textContent = '🙋 Assumir';
    b.title = deOutro
      ? 'O Carlos está respondendo. Assumir também passa o cliente para você.'
      : 'Assumir este atendimento — o Carlos para de responder este cliente';
    b.classList.remove('assumido');
  } else {
    b.innerHTML = '↩️ Devolver<span class="so-largo"> para a IA</span>';
    b.title = 'O Carlos está parado neste cliente. Clique para ele voltar a responder.';
    b.classList.add('assumido');
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
    /* Só diz que a IA parou se ela parou mesmo. Se o CodeWords recusou, o
       botão tem que continuar em "Assumir" para dar para tentar de novo. */
    conversaAtual.ia_ativa = assumir ? !r.carlosPausado : true;
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
  // pelo estado da IA, igual ao rótulo do botão — não por quem é o dono
  assumirAtendimento(conversaAtual.ia_ativa !== false);
});

$('#btnAgendar').addEventListener('click', () => {
  if (!conversaAtual) return;
  $('#agendarQuem').textContent =
    `${conversaAtual.nome || conversaAtual.telefone} · ${conversaAtual.telefone}`;
  const f = $('#formAgendar');
  // próximo dia de oficina (domingo não abre); data no fuso de SP, não em UTC
  const prox = new Date(hojeSP() + 'T12:00:00');
  do { prox.setDate(prox.getDate() + 1); } while (prox.getDay() === 0);
  f.data.value = diaTexto(prox);
  f.data.min = hojeSP();
  f.veiculo.value = fichaCache?.carro_modelo || '';
  f.placa.value   = fichaCache?.placa || '';
  f.origem.value  = fichaCache?.origem || 'whatsapp';
  conferirDataAgendar();
  abrirModal('modalAgendarBg', '#agendarServico');
  carregarHorariosSugeridos(conversaAtual.id);
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
  if (conversaAtual?.id === conv.id) { conversaAtual.atribuida_a = novoId; renderDonoDoChat(); }
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
    if (conversaAtual?.id === conv.id) { conversaAtual.atribuida_a = antes; renderDonoDoChat(); }
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
  if (!CONVERSAS_FUNIL.length) quadro.innerHTML = esqueletoFunil();
  try {
    const { data, error } = await sb.from('conversas')
      .select('id,nome,telefone,cliente_id,etapa_id,etapa_em,etapa_por_ia,ultima_previa,'
            + 'ultima_mensagem_em,status,atribuida_a,clientes(carro_modelo,placa)')
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

  for (const c of CONVERSAS_FUNIL.filter(passaNoFiltroDoFunil)) {
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
  const dono = c.atribuida_a ? EQUIPE.get(c.atribuida_a) : null;
  return `<article class="funil-cartao${atrasado ? ' atrasado' : ''}" draggable="true" data-id="${esc(c.id)}"
    tabindex="0" role="button" aria-label="${esc(`${c.nome || c.telefone}, ${parado.texto}. Enter abre a conversa; setas para os lados mudam a etapa`)}">
    <div class="fc-topo">
      <strong>${esc(c.nome || c.telefone)}</strong>
      ${c.etapa_por_ia ? '<i class="pl-ia" title="Etapa carimbada pela IA">✨</i>' : ''}
      ${dono ? `<span class="fc-dono" style="--dn-cor:${corDoDono(c.atribuida_a)}" title="Responsável: ${esc(dono.nome)}">${
        esc(c.atribuida_a === perfil?.id ? '★ meu' : primeiroNome(dono.nome))}</span>` : ''}
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
  ligarFunilPorToqueETeclado(quadro);
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
  carregarChaveCW();   // trava ou carrega o bloco da chave conforme o papel
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
    /* Colunas nomeadas de propósito: a chave de API (api_key) NÃO vem para o
       navegador — a máscara dela chega pelo servidor (/api/codewords/chave). */
    const { data } = await sb.from('codewords_config')
      .select('url_envio,service_id,token_webhook,ativo,responder_auto,ultimo_erro,ultimo_evento_em,url_webhook_publica,modo_envio')
      .maybeSingle();
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
  // a chave de API tem bloco próprio (teste + troca nas duas tabelas), não entra aqui

  try {
    const { error } = await sb.from('codewords_config').upsert(dados);
    if (error) throw error;
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

/* ============================================================
   CHAVE DO CODEWORDS
   Desde 01/10 a chave está sendo recusada (401) e nada sai nem entra. O
   dono precisa trocar sem chamar ninguém: ver a máscara, testar (sem
   gastar cota) e colar a nova — que vai para as duas tabelas que a leem.
   ============================================================ */
async function carregarChaveCW() {
  const ehAdmin = perfil?.papel === 'admin';
  $$('#chaveBox input, #chaveBox button').forEach(i => i.disabled = !ehAdmin);
  if (!ehAdmin) { $('#chaveMascara').textContent = 'só admin'; return; }
  try {
    const r = await (await fetch('/api/codewords/chave', { headers: await authCabecalhos() })).json();
    const selo = $('#chaveSelo');
    if (!r.ok) { $('#chaveMascara').textContent = '—'; selo.textContent = r.erro || 'erro'; selo.className = 'selo mini off'; return; }
    $('#chaveMascara').textContent = r.mascara || 'nenhuma chave salva';
    if (!r.mascara) { selo.textContent = 'sem chave'; selo.className = 'selo mini off'; }
    else if (r.ultimoErro && /recusad|401/i.test(r.ultimoErro)) { selo.textContent = 'recusada (401)'; selo.className = 'selo mini off'; }
    else if (!r.iguais) { selo.textContent = 'Agenda com chave diferente'; selo.className = 'selo mini'; }
    else { selo.textContent = 'salva nos dois sistemas'; selo.className = 'selo mini on'; }
  } catch { $('#chaveMascara').textContent = '—'; }
}

function mostrarResultadoChave(r) {
  const el = $('#chaveResultado');
  el.hidden = false;
  el.className = 'chave-resultado ' + (r.resultado === 'ok' ? 'ok' : r.resultado === 'recusada' ? 'erro' : 'aviso');
  const ico = r.resultado === 'ok' ? '✅' : r.resultado === 'recusada' ? '⛔' : '⚠️';
  el.textContent = `${ico} ${r.mensagem || r.erro || ''}`;
}

$('#btnTestarChave').addEventListener('click', async () => {
  const btn = $('#btnTestarChave');
  btn.disabled = true; btn.innerHTML = '<span class="girando"></span>Testando…';
  try {
    const r = await (await fetch('/api/codewords/testar-chave', {
      method: 'POST', headers: await authCabecalhos(), body: JSON.stringify({}),
    })).json();
    mostrarResultadoChave(r);
    if (r.resultado === 'ok') verSaude();   // se o vigia ainda acusa, a faixa reavalia
  } catch (err) { mostrarResultadoChave({ resultado: 'outro', mensagem: err.message }); }
  finally { btn.disabled = false; btn.textContent = 'Testar chave'; }
});

$('#formChave').addEventListener('submit', async (e) => {
  e.preventDefault();
  const campoChave = $('#chaveNova'), btn = $('#btnSalvarChave');
  const chave = campoChave.value.trim();
  if (chave.length < 20) return mostrarResultadoChave({ resultado: 'outro', mensagem: 'Cole a chave inteira (ela é longa, começa com cwk-).' });
  btn.disabled = true; btn.innerHTML = '<span class="girando"></span>Testando e salvando…';
  try {
    const r = await (await fetch('/api/codewords/chave', {
      method: 'POST', headers: await authCabecalhos(), body: JSON.stringify({ chave }),
    })).json();
    if (r.ok) {
      campoChave.value = '';
      mostrarResultadoChave({ resultado: 'ok',
        mensagem: `Chave ${r.mascara} salva em ${r.salvoEm.length} sistema${r.salvoEm.length > 1 ? 's' : ''}${
          r.avisos?.length ? ' — ' + r.avisos.join(' ') : ''}. ${r.teste?.mensagem || ''}` });
      toast('✅ Chave do CodeWords trocada');
      await carregarChaveCW();
      await carregarCodeWords();
      verSaude();
    } else {
      mostrarResultadoChave({ resultado: r.teste?.resultado || 'outro', mensagem: r.erro });
    }
  } catch (err) { mostrarResultadoChave({ resultado: 'outro', mensagem: err.message }); }
  finally { btn.disabled = false; btn.textContent = 'Testar e salvar'; }
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
  if (c.dataset.periodo) prepararPeriodoNomeado(c.dataset.periodo);
  else prepararRelatorios(Number(c.dataset.dias) || 30);
  carregarRelatorios();
}));

/** "Hoje", "Este mês" e "Mês passado" — os que a oficina mais pergunta. */
function prepararPeriodoNomeado(nome) {
  const hoje = new Date(hojeSP() + 'T12:00:00');
  let de = hoje, ate = hoje;
  if (nome === 'mes') de = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 12);
  if (nome === 'mes-passado') {
    de = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1, 12);
    ate = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 12);
  }
  $('#relDe').value = diaTexto(de);
  $('#relAte').value = diaTexto(ate);
}

let geracaoRelatorio = 0;
async function carregarRelatorios() {
  const corpo = $('#relCorpo');
  const de = $('#relDe').value, ate = $('#relAte').value;
  if (!de || !ate) { corpo.innerHTML = semDados('Escolha as duas datas do período.'); return; }
  if (de > ate) { corpo.innerHTML = semDados('A data inicial está depois da final — troque as duas.'); return; }
  const minha = ++geracaoRelatorio;     // trocou o período no meio: a resposta velha não pinta por cima

  corpo.innerHTML = esqueletoRelatorios();
  try {
    const resposta = await fetch(`/api/relatorios?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`,
      { headers: await authCabecalhos() });
    const r = await resposta.json();
    if (minha !== geracaoRelatorio) return;
    if (!r.ok) throw new Error(r.erro || 'não consegui montar os relatórios');
    RELATORIO = r;
    desenharRelatorios(r);
    compararComPeriodoAnterior(de, ate, minha);
  } catch (err) {
    if (minha !== geracaoRelatorio) return;
    corpo.innerHTML = `<div class="grafico-vazio">⚠️ ${esc(err.message)}<br><br>
      <button type="button" class="btn btn-ghost sm" onclick="carregarRelatorios()">Tentar de novo</button></div>`;
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
    <div class="kpi roxa" data-kpi="leads"><span>Volume de leads</span><b>${esc(num(r.resumo.leads))}</b>
      <small>criados no período</small></div>
    <div class="kpi laranja" data-kpi="conversao"><span>Taxa de conversão</span><b>${esc(pct(r.resumo.conversao))}</b>
      <small>${r.resumo.ganhos + r.resumo.perdidos
        ? esc(`${num(r.resumo.ganhos)} de ${num(r.resumo.ganhos + r.resumo.perdidos)} leads decididos`)
        : 'nenhum lead decidido ainda'}</small></div>
    <div class="kpi verde" data-kpi="ganhos"><span>Clientes ganhos</span><b>${esc(num(r.resumo.ganhos))}</b>
      <small>leads concluídos</small></div>
    <div class="kpi vermelha" data-kpi="perdidos" data-kpi-inverso="1"><span>Clientes perdidos</span><b>${esc(num(r.resumo.perdidos))}</b>
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

  /* (z) mensagens automáticas do Comunicar — só números, sem texto de cliente */
  if (r.comunicar) {
    const c = r.comunicar;
    partes.push(bloco('Mensagens automáticas (Comunicar)',
      'Aniversário, pós-venda, retorno de revisão e campanhas programadas no período.',
      c.total
        ? `<div class="kpis kpis-mini">
            <div class="kpi verde"><span>Enviadas</span><b>${esc(num(c.enviadas))}</b><small>de ${esc(num(c.total))} programadas</small></div>
            <div class="kpi roxa"><span>Responderam</span><b>${esc(num(c.respondidas))}</b><small>${esc(num(c.positivas))} positivas · ${esc(num(c.agendaram))} agendaram</small></div>
            <div class="kpi laranja"><span>Pediram para parar</span><b>${esc(num(c.pararam))}</b><small>viram opt-out</small></div>
            <div class="kpi vermelha"><span>Falharam</span><b>${esc(num(c.falharam))}</b><small>${esc(num(c.pendentes))} ainda na fila</small></div>
          </div>`
          + (Object.keys(c.porTipo || {}).length
            ? tabelaHtml({ colunas: ['Tipo', 'Programadas'],
                linhas: Object.entries(c.porTipo).sort((a, b) => b[1] - a[1])
                  .map(([t, n]) => [ROTULO_ENVIO_TIPO[t] || t, num(n)]) })
            : '')
        : semDados('Nenhuma mensagem automática programada no período.'),
      `<a class="btn btn-ghost sm" href="https://indycar-posvenda.onrender.com" target="_blank" rel="noopener">Abrir o Comunicar ↗</a>`));
  }

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
  pintarDeltas();       // comparação com o período anterior (se já chegou)
}

/* ---------------- Fechar modais novos ---------------- */
$$('[data-fechar]').forEach(b => b.addEventListener('click', () =>
  $('#' + b.dataset.fechar).classList.remove('aberto')));
['modalAgendarBg','modalAtalhoBg','modalEtapaBg','modalLeadBg'].forEach(id => {
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

function aplicarTema(tema, { salvar = true } = {}) {
  const claro = tema === 'claro';
  const html = document.documentElement;
  /* Regra da casa: na troca de tema, NENHUMA transição roda por um quadro.
     Sem isso, cada componente com transition de cor atravessa um estado
     "meio claro, meio escuro" e a tela pisca em retalhos. */
  const trocando = html.getAttribute('data-tema') !== (claro ? 'claro' : 'escuro');
  if (trocando) html.setAttribute('data-trocando-tema', '');
  html.setAttribute('data-tema', claro ? 'claro' : 'escuro');
  if (trocando) {
    const soltar = () => html.removeAttribute('data-trocando-tema');
    requestAnimationFrame(() => requestAnimationFrame(soltar));
    setTimeout(soltar, 120);   // aba em segundo plano não roda rAF: solta por tempo também
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', claro ? '#eaecf0' : '#0a0a0b');

  const ico = $('#temaIco'), txt = $('#temaTxt');
  if (ico) ico.textContent = claro ? '☀️' : '🌙';
  if (txt) txt.textContent = claro ? 'Tema claro' : 'Tema escuro';

  if (salvar) { try { localStorage.setItem(TEMA_KEY, claro ? 'claro' : 'escuro'); } catch { /* ignora */ } }

  // Os SVG dos relatórios são pintados com cores lidas na hora do desenho:
  // se já houver relatório montado, redesenha para o eixo/texto acompanhar.
  if (RELATORIO) desenharRelatorios(RELATORIO);
}

$('#btnTema')?.addEventListener('click', () =>
  aplicarTema(temaAtual() === 'claro' ? 'escuro' : 'claro'));

// Deixa o botão e o meta coerentes com o que o script do <head> já aplicou.
aplicarTema(temaAtual(), { salvar: false });   // sem escolha salva, continua seguindo o sistema

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

/* Empurra o app exatamente a altura das faixas visíveis (tarja vermelha do
   WhatsApp + faixa de saúde, empilhadas) — nem um pixel a mais. */
function reservarEspacoDaTarja() {
  const tarja = document.getElementById('tarjaConexao');
  const faixa = document.getElementById('faixaSaude');
  const app   = document.getElementById('telaApp');
  if (!tarja || !app) return;
  const hTarja = tarja.hidden ? 0 : Math.ceil(tarja.getBoundingClientRect().height);
  if (faixa) faixa.style.top = `${hTarja}px`;      // a faixa fica logo abaixo da tarja
  const hFaixa = (!faixa || faixa.hidden) ? 0 : Math.ceil(faixa.getBoundingClientRect().height);
  const total = hTarja + hFaixa;
  app.style.paddingTop = total ? `${total}px` : '';
  // a gaveta da ficha (celular) começa logo abaixo das faixas, não por baixo delas
  document.documentElement.style.setProperty('--topo-faixas', `${total}px`);
}
// Redimensionar a janela faz o texto quebrar e a tarja mudar de altura.
if (typeof ResizeObserver === 'function') {
  const obs = new ResizeObserver(() => reservarEspacoDaTarja());
  ['tarjaConexao', 'faixaSaude'].forEach(id => { const t = document.getElementById(id); if (t) obs.observe(t); });
}

/* ============================================================
   FAIXA DE SAÚDE DO ECOSSISTEMA
   O vigia grava em vigia_estado o que está quebrado (hoje: a chave do
   CodeWords recusada desde 01/10). Aqui vira uma faixa discreta com o que
   fazer e um botão que leva direto para Integrações. Dá para dispensar
   por uma hora — mas volta se o problema continuar.
   ============================================================ */
var SAUDE_ATUAL = null;
const SAUDE_DISPENSA_KEY = 'indycar_saude_dispensada';
function saudeDispensada(problema) {
  try {
    const v = JSON.parse(sessionStorage.getItem(SAUDE_DISPENSA_KEY) || 'null');
    return !!v && v.problema === problema && v.ate > Date.now();
  } catch { return false; }
}
function mostrarSaude(s) {
  const faixa = document.getElementById('faixaSaude');
  if (!faixa) return;
  SAUDE_ATUAL = s;
  const temProblema = !!s?.problema;
  if (!temProblema || saudeDispensada(s.problema)) {
    faixa.hidden = true;
    reservarEspacoDaTarja();
    return;
  }
  document.getElementById('faixaTexto').textContent = s.texto || `Atenção: ${s.resumo || s.problema}`;
  const desde = document.getElementById('faixaDesde');
  desde.textContent = s.desde ? `desde ${new Date(s.desde).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : '';
  const btn = document.getElementById('faixaBtn');
  // só quem pode trocar a chave vê o atalho para Integrações
  btn.hidden = !(perfil?.papel === 'admin' && /codewords/.test(s.problema));
  faixa.hidden = false;
  reservarEspacoDaTarja();
}
async function verSaude() {
  try {
    const r = await fetch('/api/saude', { headers: await authCabecalhos() });
    if (r.status === 401) { await sessaoMorreu(); return; }
    const s = await r.json();
    mostrarSaude(s);
  } catch { /* sem rede: não inventa problema nem apaga o que já está na tela */ }
}
document.getElementById('faixaBtn')?.addEventListener('click', () => {
  document.querySelector('[data-aba="integracoes"]')?.click();
  document.getElementById('chaveBox')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
document.getElementById('faixaFechar')?.addEventListener('click', () => {
  try { sessionStorage.setItem(SAUDE_DISPENSA_KEY, JSON.stringify({ problema: SAUDE_ATUAL?.problema, ate: Date.now() + 3_600_000 })); } catch { /* ignora */ }
  document.getElementById('faixaSaude').hidden = true;
  reservarEspacoDaTarja();
});

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
  verSaude();
  clearInterval(conexaoTimer);
  conexaoTimer = setInterval(() => {
    if (document.visibilityState === 'visible') { verConexao(); verSaude(); }
  }, 120000);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { verConexao(); verSaude(); }
});

/* ============================================================
   ECOSSISTEMA INDYCAR — o seletor da barra lateral
   Escolheu outro sistema: abre em nova aba e o seletor volta a marcar
   "Atendimento", que é onde a pessoa continua.
   ============================================================ */
(() => {
  const sel = document.getElementById('ecoSeletor');
  if (!sel) return;
  const atual = sel.querySelector('[data-atual]')?.value;
  sel.addEventListener('change', () => {
    const url = sel.value;
    if (url && url !== atual) window.open(url, '_blank', 'noopener');
    if (atual) sel.value = atual;
  });
})();

/* Esc: fecha o que estiver aberto por cima do chat — a gaveta da ficha no
   celular, ou o próprio chat (volta para a lista) quando a tela é estreita. */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || menuAberto) return;
  if (document.querySelector('.modal-bg.aberto')) return;   // modais já cuidam do Esc
  const ficha = document.getElementById('colFicha');
  if (ficha?.classList.contains('aberta')) { ficha.classList.remove('aberta'); return; }
  if (window.matchMedia('(max-width:900px)').matches && document.querySelector('.conversas-layout.vendo-chat')) {
    fecharConversa({ focarLista: true });
  }
});

/* ============================================================
   RODADA 2 (09/10/2026) — a tela do dia a dia
   Caixa de entrada rápida, filtros que cruzam com Agenda/CRM/Comunicar,
   contrato com o copiloto da IA, atalhos de teclado, avisos, modo foco,
   fila offline e acessibilidade. Tudo que é novo nesta rodada mora daqui
   para baixo; as funções antigas só ganharam ganchos para cá.
   ============================================================ */

/* ---------------- Estado da lista: dono e ordem ---------------- */
let filtroDono = (() => {
  try { return localStorage.getItem('indycar_dono') ?? (localStorage.getItem('indycar_so_minhas') === '1' ? 'meus' : ''); }
  catch { return ''; }
})();
let ordemLista = (() => { try { return localStorage.getItem('indycar_ordem') || 'recentes'; } catch { return 'recentes'; } })();
const FILTROS_URL = ['', 'nao_lidas', 'hoje', 'aguardando', 'agendada', 'fechou', 'nao_fechou', 'disparo',
  'quentes', 'amanha', 'revisao', 'aniversario'];

function restaurarPreferenciasDaLista() {
  // ?filtro=nao_lidas (atalho do app instalado, links de outros sistemas)
  const doLink = new URLSearchParams(location.search).get('filtro');
  if (doLink && FILTROS_URL.includes(doLink)) filtroStatus = doLink;
  $$('#aba-conversas .filtros-status .chip').forEach(x => {
    const ativo = (x.dataset.status || '') === filtroStatus;
    x.classList.toggle('ativo', ativo);
    x.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
  if (!['', 'meus', 'sem'].includes(filtroDono)) filtroDono = '';
  pintarSegmentoDono();
  const sel = $('#ordemLista');
  if (sel) sel.value = ['recentes', 'espera', 'naolidas'].includes(ordemLista) ? ordemLista : 'recentes';
}

function pintarSegmentoDono() {
  $$('[data-dono-filtro]').forEach(b => {
    const ativo = (b.dataset.donoFiltro || '') === filtroDono;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
}

$$('[data-dono-filtro]').forEach(b => b.addEventListener('click', () => {
  filtroDono = b.dataset.donoFiltro || '';
  try {
    localStorage.setItem('indycar_dono', filtroDono);
    localStorage.setItem('indycar_so_minhas', filtroDono === 'meus' ? '1' : '0');   // compatível com a versão anterior
  } catch { /* ignora */ }
  pintarSegmentoDono();
  limiteLista = PASSO_LISTA;
  carregarConversas();
}));

$('#ordemLista')?.addEventListener('change', (ev) => {
  ordemLista = ev.target.value;
  try { localStorage.setItem('indycar_ordem', ordemLista); } catch { /* ignora */ }
  carregarConversas();
});

/* ---------------- Filtros que cruzam com Agenda, CRM e Comunicar ----------------
   O banco diz QUEM (clientes com horário amanhã, com revisão vencida, com
   aniversário) e a lista traz as conversas dessas pessoas. */
const consultaBaseDaLista = () => aplicarFiltrosBase(sb.from('conversas').select('*'))
  .order('ultima_mensagem_em', { ascending: false, nullsFirst: false });

async function conversasDosClientes(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return { data: [], error: null };
  const lotes = [];
  for (let i = 0; i < unicos.length && i < 1200; i += 150) lotes.push(unicos.slice(i, i + 150));
  const rs = await Promise.all(lotes.map(l => consultaBaseDaLista().in('cliente_id', l).limit(300)));
  const erro = rs.find(r => r.error)?.error;
  if (erro) return { data: null, error: erro };
  const data = rs.flatMap(r => r.data || [])
    .sort((a, b) => String(b.ultima_mensagem_em || '').localeCompare(String(a.ultima_mensagem_em || '')));
  return { data, error: null };
}

const amanhaSP = () => { const d = new Date(hojeSP() + 'T12:00:00'); d.setDate(d.getDate() + 1); return diaTexto(d); };
let cacheAniversarios = { ate: 0, ids: [] };

const FILTROS_ESPECIAIS = {
  /* 🔥 Quentes: quem espera consultor + orçamento na mesa com conversa nos últimos 3 dias */
  async quentes() {
    const etapasOrc = ETAPAS.filter(e => e.ativa && (e.status_lead === 'orcamento' || /or[cç]amento/i.test(e.nome))).map(e => e.id);
    const desde = new Date(Date.now() - 72 * 3600_000).toISOString();
    const pedidos = [consultaBaseDaLista().eq('aguardando_consultor', true).limit(150)];
    if (etapasOrc.length) pedidos.push(consultaBaseDaLista().in('etapa_id', etapasOrc).gte('ultima_mensagem_em', desde).limit(250));
    const rs = await Promise.all(pedidos);
    const erro = rs.find(r => r.error)?.error;
    if (erro) return { data: null, error: erro };
    const vistos = new Set();
    const data = rs.flatMap(r => r.data || []).filter(c => !vistos.has(c.id) && vistos.add(c.id));
    return { data, error: null };
  },
  /* 📅 Amanhã: horário marcado na Agenda para amanhã (não cancelado) */
  async amanha() {
    const { data, error } = await sb.from('agendamentos').select('cliente_id')
      .eq('data', amanhaSP()).in('status', ['aguardando', 'confirmado', 'em_atendimento']).limit(500);
    if (error) return { data: null, error };
    return conversasDosClientes((data || []).map(a => a.cliente_id));
  },
  /* 🔧 Revisão vencida: último serviço há 6+ meses e nada marcado (regra padrão do Comunicar) */
  async revisao() {
    const corte = new Date(); corte.setMonth(corte.getMonth() - 6);
    const { data, error } = await sb.from('v_cliente_360').select('id')
      .lt('ultimo_servico_em', corte.toISOString()).is('proximo_horario', null).limit(1200);
    if (error) return { data: null, error };
    return conversasDosClientes((data || []).map(c => c.id));
  },
  /* 🎂 Aniversário hoje ou nos próximos 7 dias (ano 1904 = só dia e mês, vale igual) */
  async aniversario() {
    if (cacheAniversarios.ate < Date.now()) {
      const { data, error } = await sb.from('clientes').select('id,nascimento').not('nascimento', 'is', null).limit(8000);
      if (error) return { data: null, error };
      cacheAniversarios = { ate: Date.now() + 10 * 60_000,
        ids: (data || []).filter(c => { const d = diasParaAniversario(c.nascimento); return d !== null && d <= 7; }).map(c => c.id) };
    }
    return conversasDosClientes(cacheAniversarios.ids);
  },
};

/* ---------------- Contadores das abas (no banco, com respiro) ----------------
   Antes: 3 contagens a CADA evento do tempo real. Agora: no máximo uma rodada
   a cada 15 s (e logo depois de quem pediu por último). */
let contadoresTimer = null, contadoresUltimo = 0;
let naoLidasBanco = null;      // última contagem do banco (null = ainda não veio)
function agendarContadores({ ja = false } = {}) {
  clearTimeout(contadoresTimer);
  const espera = ja ? 0 : Math.max(1200, 15_000 - (Date.now() - contadoresUltimo));
  contadoresTimer = setTimeout(atualizarContadores, espera);
}
async function contar(montar) {
  try {
    const { count, error } = await montar(sb.from('conversas').select('id', { count: 'exact', head: true }));
    return error ? null : (count ?? 0);
  } catch { return null; }
}
function pintarContador(id, n, { mostrarZero = false } = {}) {
  const el = document.getElementById(id);
  if (!el || n === null) return;
  el.textContent = n > 999 ? '999+' : String(n);
  el.hidden = !n && !mostrarZero;
}
async function atualizarContadores() {
  if (!sb || !perfil) return;
  contadoresUltimo = Date.now();
  const aberto = q => q.eq('tipo', 'atendimento').is('desfecho', null);
  const [naoLidas, meus, semDono] = await Promise.all([
    contar(q => aberto(q).gt('nao_lidas', 0)),
    contar(q => aberto(q).eq('atribuida_a', perfil.id)),
    contar(q => aberto(q).is('atribuida_a', null)),
  ]);
  pintarContador('cntNaoLidas', naoLidas);
  pintarContador('cntMeus', meus);
  pintarContador('cntSemDono', semDono);
  // o número da barra lateral e do título: conversas esperando leitura (no banco, não só as carregadas)
  if (naoLidas !== null) {
    naoLidasBanco = naoLidas;
    const b = $('#badgeNaoLidas');
    b.textContent = naoLidas > 99 ? '99+' : naoLidas;
    b.hidden = !naoLidas;
    atualizarTituloDaAba(naoLidas);
  }
  atualizarBadgeHoje();       // Novos hoje + Aguardando consultor + Disparos (já existiam)
}

/* ---------------- Título da aba e selo do app instalado ---------------- */
const TITULO_BASE = 'IndyCar · Atendimento';
function atualizarTituloDaAba(n) {
  document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${TITULO_BASE}` : TITULO_BASE;
  try {
    if (n > 0) navigator.setAppBadge?.(n).catch(() => {});
    else navigator.clearAppBadge?.().catch(() => {});
  } catch { /* navegador sem selo */ }
}

/* ---------------- Rodapé e rolagem infinita ---------------- */
function atualizarRodapeLista(n) {
  const el = $('#listaRodape');
  if (!el) return;
  const t = termoBusca.trim();
  el.textContent = !jaCarregouConversas ? ''
    : t ? `${n} resultado${n === 1 ? '' : 's'} para “${t}”${BUSCA_REMOTA.buscando ? ' · procurando no banco…' : ''}`
    : temMaisConversas ? `${n} conversas na tela · role para ver mais`
    : `${n} conversa${n === 1 ? '' : 's'}`;
}

let observadorFim = null;
function vigiarFimDaLista() {
  const alvo = $('#listaMais');
  if (!alvo || typeof IntersectionObserver !== 'function') return;
  observadorFim?.disconnect();
  observadorFim = new IntersectionObserver(entradas => {
    if (entradas.some(e => e.isIntersecting)) carregarMaisConversas();
  }, { root: $('#listaConversas'), rootMargin: '0px 0px 300px 0px' });
  observadorFim.observe(alvo);
}
function carregarMaisConversas() {
  if (!temMaisConversas || carregandoMais || limiteLista >= 3000) return;
  carregandoMais = true;
  limiteLista += PASSO_LISTA;
  const b = $('#listaMais button');
  if (b) b.innerHTML = '<span class="girando"></span>Carregando…';
  carregarConversas();
}

/* ---------------- Cliques e teclado na lista (um ouvinte só) ---------------- */
const acharConversa = id => CONVERSAS.find(c => c.id === id) || BUSCA_REMOTA.lista.find(c => c.id === id)
  || (conversaAtual?.id === id ? conversaAtual : null);

$('#listaConversas').addEventListener('click', async (ev) => {
  const t = ev.target;
  const acao = t.closest('[data-acao]')?.dataset.acao;
  if (acao === 'nova-conversa') return abrirModalNova();
  if (acao === 'carregar-mais') return carregarMaisConversas();
  if (acao === 'recarregar-lista') return carregarConversas();
  const pegar = t.closest('[data-pegar]');
  if (pegar) {
    ev.stopPropagation();
    const conv = acharConversa(pegar.dataset.pegar);
    if (conv && perfil?.id) await trocarDono(conv, perfil.id);
    return;
  }
  /* A plaquinha de dono abre o menu de quem responde — sem abrir a conversa */
  const dono = t.closest('[data-dono]');
  if (dono) {
    ev.stopPropagation();
    const conv = acharConversa(dono.dataset.dono);
    if (conv) abrirMenuDono(dono, conv);
    return;
  }
  /* A plaquinha abre o menu de etapas — e NÃO abre a conversa junto */
  const pl = t.closest('.plaquinha');
  if (pl) {
    ev.stopPropagation();
    const conv = acharConversa(pl.closest('.conversa')?.dataset.id);
    if (conv) abrirMenuEtapas(pl, conv);
    return;
  }
  const linha = t.closest('.conversa');
  if (linha && !linha.classList.contains('esqueleto')) abrirConversa(linha.dataset.id);
});

/* ↑ ↓ (ou J K) andam entre as conversas; Enter abre e já põe o cursor no campo. */
$('#listaConversas').addEventListener('keydown', (ev) => {
  const linhas = $$('#listaConversas .conversa:not(.esqueleto)');
  const atual = ev.target.closest?.('.conversa');
  if (!linhas.length || !atual || ev.target !== atual) return;
  const i = linhas.indexOf(atual);
  let destino = null;
  if (ev.key === 'ArrowDown' || ev.key === 'j') destino = linhas[Math.min(linhas.length - 1, i + 1)];
  else if (ev.key === 'ArrowUp' || ev.key === 'k') destino = linhas[Math.max(0, i - 1)];
  else if (ev.key === 'Home') destino = linhas[0];
  else if (ev.key === 'End') destino = linhas[linhas.length - 1];
  else if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    abrirConversa(atual.dataset.id, { focarCampo: !window.matchMedia('(max-width:900px)').matches });
    return;
  }
  if (destino) {
    ev.preventDefault();
    linhas.forEach(l => l.setAttribute('tabindex', l === destino ? '0' : '-1'));
    destino.focus();
    if (destino === linhas[linhas.length - 1]) carregarMaisConversas();
  }
});

/* ---------------- Dono no topo do chat ---------------- */
function renderDonoDoChat() {
  const el = $('#chatDono');
  if (!el) return;
  if (!conversaAtual) { el.innerHTML = ''; return; }
  el.innerHTML = conversaAtual.atribuida_a ? donoHtml(conversaAtual)
    : `<button type="button" class="dono pegar" data-pegar="${esc(conversaAtual.id)}"
         title="Ninguém responsável — um clique e o cliente é seu (Alt+M)">★ Pegar para mim</button>`;
}
$('#chatDono')?.addEventListener('click', async (ev) => {
  if (!conversaAtual) return;
  ev.stopPropagation();
  if (ev.target.closest('[data-pegar]')) return trocarDono(conversaAtual, perfil.id);
  const b = ev.target.closest('[data-dono]');
  if (b) abrirMenuDono(b, conversaAtual);
});

/* O menu de dono não fechava ao clicar fora nem com Esc (o de etapas fechava). */
document.addEventListener('click', e => {
  const el = $('#menuDono');
  if (el && !el.hidden && !e.target.closest('#menuDono')) fecharMenuDono();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharMenuDono(); });
window.addEventListener('resize', () => fecharMenuDono());

/* ---------------- Contrato com o copiloto (public/copiloto.js) ---------------- */
function detalheDaConversa(conv) {
  return conv ? { conversaId: conv.id, clienteId: conv.cliente_id || null, telefone: conv.telefone || null, nome: conv.nome || null }
    : { conversaId: null };
}
function avisarConversaAberta(conv) {
  try { window.dispatchEvent(new CustomEvent('indycar:conversa', { detail: detalheDaConversa(conv) })); } catch { /* ignora */ }
  // o endereço da página acompanha a conversa: dá para copiar, favoritar e voltar
  try {
    const u = new URL(location.href);
    u.searchParams.delete('tel');
    if (conv) u.searchParams.set('conversa', conv.id); else u.searchParams.delete('conversa');
    history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : '') + u.hash);
  } catch { /* ignora */ }
}

/** Fecha a conversa (voltar para a lista, não lida, excluída). */
function fecharConversa({ focarLista = false } = {}) {
  const tinha = conversaAtual;
  conversaAtual = null;
  conversaRenderizada = null;
  MENSAGENS = [];
  clearInterval(syncAbertaTimer);
  fecharBuscaNaConversa();
  $('#chat').hidden = true;
  $('#chatVazio').hidden = false;
  $('.conversas-layout').classList.remove('vendo-chat');
  $('#colFicha').classList.remove('aberta');
  $('#copilotoSlot').hidden = true;
  $('#fichaConteudo').hidden = true;
  const vazio = $('#fichaVazia');
  vazio.hidden = false;
  vazio.innerHTML = '<p>Sem conversa selecionada.</p>';
  fichaCache = null;
  if (tinha) avisarConversaAberta(null);
  renderConversas();
  if (focarLista && tinha) {
    const linha = $(`#listaConversas .conversa[data-id="${CSS.escape(tinha.id)}"]`);
    (linha || $('#buscaConversa'))?.focus({ preventScroll: false });
  }
}

/** Põe o texto no campo de mensagem, foca e NÃO envia (Ctrl+Z desfaz). */
function inserirNoCampo(texto) {
  if (!conversaAtual) { toast('Abra uma conversa primeiro.'); return false; }
  const t = String(texto ?? '');
  campo.focus();
  campo.select();
  // execCommand mantém o desfazer do navegador; se não existir, troca direto
  let foi = false;
  try { foi = document.execCommand && document.execCommand('insertText', false, t); } catch { foi = false; }
  if (!foi || campo.value !== t) { campo.value = t; }
  campo.dispatchEvent(new Event('input'));
  campo.selectionStart = campo.selectionEnd = campo.value.length;
  return true;
}

/* window.IndyCar: a porta que o copiloto (e qualquer extensão da tela) usa.
   Fica disponível desde o carregamento; "papel" e "conversa" são lidos na hora. */
window.IndyCar = {
  versao: 2,
  authCabecalhos: () => authCabecalhos(),
  toast: (msg, tipo) => toast(msg, tipo),
  inserirNoCampo,
  recarregarFicha: () => (conversaAtual ? carregarFicha(conversaAtual) : Promise.resolve()),
  recarregarConversa: async () => {
    if (!conversaAtual) return;
    await Promise.all([carregarMensagens(), carregarConversas()]);
    renderEtapaDoChat(); renderDonoDoChat(); renderBotaoAssumir();
  },
  abrirConversa: (id) => abrirConversa(id),
  get papel() { return perfil?.papel || null; },
  get conversa() { return detalheDaConversa(conversaAtual); },
};
function publicarApiIndyCar() {
  // avisa quem carregou antes do login que agora tem perfil (e a conversa, se já abriu)
  try { window.dispatchEvent(new CustomEvent('indycar:pronto', { detail: { papel: perfil?.papel || null } })); } catch { /* ignora */ }
}

/* ✨ no topo do chat: abre a ficha (gaveta no celular) já no copiloto */
function abrirCopiloto() {
  if (!conversaAtual) return;
  const ficha = $('#colFicha');
  if (window.matchMedia('(max-width:1180px)').matches) ficha.classList.add('aberta');
  else $('.conversas-layout').classList.remove('ficha-fechada');
  ficha.scrollTop = 0;
  const slot = $('#copilotoSlot');
  slot.hidden = false;
  slot.setAttribute('tabindex', '-1');
  slot.focus({ preventScroll: true });
  try { window.dispatchEvent(new CustomEvent('indycar:copiloto-abrir', { detail: detalheDaConversa(conversaAtual) })); } catch { /* ignora */ }
}
$('#btnCopiloto')?.addEventListener('click', abrirCopiloto);
$('#btnFecharFicha')?.addEventListener('click', () => { $('#colFicha').classList.remove('aberta'); $('#btnPainelCliente')?.focus(); });
// gaveta aberta no celular/tablet: tocar fora fecha
document.addEventListener('click', (ev) => {
  const ficha = $('#colFicha');
  if (!ficha?.classList.contains('aberta')) return;
  if (ev.target.closest('#colFicha, #btnPainelCliente, #btnCopiloto, .menu-etapas, .modal-bg')) return;
  ficha.classList.remove('aberta');
});

/* ---------------- Abrir pelo endereço: ?conversa= e ?tel= ----------------
   É assim que Agenda, CRM e Comunicar mandam o atendente direto para a
   conversa certa. */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function abrirPeloEndereco() {
  const p = new URLSearchParams(location.search);
  const id = p.get('conversa'), tel = p.get('tel');
  if (id && RE_UUID.test(id)) return abrirConversa(id);
  if (!tel) return;
  const digitos = normalizarDigitos(tel);
  if (digitos.length < 10) return toast('⚠️ O telefone do link está incompleto.');
  let conversaId = null;
  try {
    const r = await fetch(`/api/conversa-por-telefone?t=${encodeURIComponent(digitos)}`, { headers: await authCabecalhos() });
    if (r.ok) conversaId = (await r.json())?.conversaId || null;
  } catch { /* servidor sem a rota ainda: tenta direto no banco */ }
  if (!conversaId) {
    const { data } = await sb.from('conversas').select('id').eq('telefone_e164', digitos)
      .order('ultima_mensagem_em', { ascending: false, nullsFirst: false }).limit(1);
    conversaId = data?.[0]?.id || null;
  }
  if (conversaId) return abrirConversa(conversaId);
  // ninguém com esse número ainda: já deixa a "Nova conversa" preenchida
  $('#novaTelefone').value = telefoneBonito(digitos);
  abrirModalNova();
  toast('Nenhuma conversa com ' + telefoneBonito(digitos) + ' ainda — confira e abra uma nova.');
}

/* ---------------- Copiar (link da conversa, telefone, mensagem) ---------------- */
async function copiarTexto(texto, aviso = '📋 Copiado') {
  try { await navigator.clipboard.writeText(String(texto ?? '')); toast(aviso); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = String(texto ?? ''); ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(aviso); } catch { toast('⚠️ Não consegui copiar.'); }
    ta.remove();
  }
}
$('#btnCopiarLink')?.addEventListener('click', () => {
  if (!conversaAtual) return;
  copiarTexto(`${location.origin}/?conversa=${conversaAtual.id}`, '🔗 Link da conversa copiado');
});
$('#chatTelefone')?.addEventListener('click', () => {
  if (conversaAtual) copiarTexto(telefoneBonito(conversaAtual.telefone), '📋 Telefone copiado');
});

/* ---------------- Ficha: links do cliente e edição na hora ---------------- */
const URL_AGENDA = 'https://indycar-agendamentos.onrender.com';
const URL_CRM = 'https://indycar-crm.onrender.com';
const URL_COMUNICAR = 'https://indycar-posvenda.onrender.com';
function linkComTelefone(base, tel) {
  try { const u = new URL(base); if (tel) u.searchParams.set('tel', tel); return u.href; } catch { return base; }
}
function linksDoClienteHtml(conv, comunicarUrl) {
  const tel = normalizarDigitos(conv.telefone_e164 || conv.telefone);
  return `<nav class="ficha-links" aria-label="Este cliente nos outros sistemas">
    <a href="${esc(linkComTelefone(URL_AGENDA, tel))}" target="_blank" rel="noopener" title="Abrir este cliente na Agenda">📅 Agenda</a>
    <a href="${esc(linkComTelefone(URL_CRM, tel))}" target="_blank" rel="noopener" title="Abrir este cliente no CRM">📈 CRM</a>
    <a href="${esc(linkComTelefone(comunicarUrl || URL_COMUNICAR, tel))}" target="_blank" rel="noopener" title="Abrir este cliente no Comunicar">📣 Comunicar</a>
    <button type="button" data-copiar-tel title="Copiar o telefone">📋 Tel.</button>
  </nav>`;
}
$('#colFicha')?.addEventListener('click', ev => {
  if (ev.target.closest('[data-copiar-tel]') && conversaAtual) copiarTexto(telefoneBonito(conversaAtual.telefone), '📋 Telefone copiado');
});

function linhaInline(campoBanco, rotulo, valor, dica = '') {
  return `<div class="ficha-linha"><span>${esc(rotulo)}</span>
    <button type="button" class="inline-valor" data-inline="${esc(campoBanco)}" data-dica="${esc(dica)}"
            title="Clique para editar" aria-label="${esc(rotulo)}: ${esc(valor || 'vazio')}. Editar">
      ${valor ? esc(valor) : '<span class="ficha-faltando">adicionar</span>'}<i aria-hidden="true">✎</i></button></div>`;
}
/** Placa: tira espaço/hífen e põe em maiúsculas; aceita a antiga (ABC1234) e a Mercosul (ABC1D23). */
function normalizarPlaca(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
const placaValida = p => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p);

function ligarEdicaoInline(conv, f) {
  $$('#clienteVer [data-inline]').forEach(btn => btn.addEventListener('click', () => {
    const campoBanco = btn.dataset.inline;
    const atual = f[campoBanco] || '';
    const input = document.createElement('input');
    input.className = 'inline-input';
    input.value = atual;
    input.placeholder = btn.dataset.dica || '';
    input.maxLength = campoBanco === 'placa' ? 8 : campoBanco === 'nome' ? 120 : 80;
    input.setAttribute('aria-label', btn.getAttribute('aria-label')?.split(':')[0] || campoBanco);
    if (campoBanco === 'placa') input.style.textTransform = 'uppercase';
    btn.replaceWith(input);
    input.focus(); input.select();
    let feito = false;
    const voltar = () => { if (input.isConnected) input.replaceWith(btn); btn.focus(); };
    const salvar = async () => {
      if (feito) return; feito = true;
      let novo = input.value.trim();
      if (campoBanco === 'placa') novo = normalizarPlaca(novo);
      if (novo === (atual || '')) return voltar();
      if (campoBanco === 'nome' && !novo) { toast('⚠️ O nome não pode ficar vazio.'); return voltar(); }
      if (campoBanco === 'placa' && novo && !placaValida(novo)) { toast('⚠️ Placa fora do padrão (ABC1234 ou ABC1D23).'); feito = false; input.focus(); return; }
      input.disabled = true;
      try {
        const { error } = await sb.from('clientes').update({ [campoBanco]: novo || null }).eq('id', conv.cliente_id);
        if (error) throw error;
        if (campoBanco === 'nome' && novo !== conv.nome) {
          await sb.from('conversas').update({ nome: novo }).eq('id', conv.id);
          conv.nome = novo;
          if (conversaAtual?.id === conv.id) { $('#chatNome').textContent = novo; $('#chatAvatar').textContent = iniciais(novo); }
        }
        CLIENTES_INFO.set(conv.cliente_id, { ...(CLIENTES_INFO.get(conv.cliente_id) || {}), [campoBanco]: novo || null });
        toast('✅ Salvo');
        renderConversas();
        if (conversaAtual?.id === conv.id) await carregarFicha(conv);
      } catch (err) { toast('⚠️ ' + err.message); voltar(); }
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); salvar(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); feito = true; voltar(); }
    });
    input.addEventListener('blur', () => { if (!feito) salvar(); });
  }));
}

/* ---------------- Agendar: data conferida e horários livres ---------------- */
function conferirDataAgendar() {
  const f = $('#formAgendar'), aviso = $('#agendarAvisoData');
  const v = f?.data.value;
  if (!aviso) return;
  if (!v) { aviso.hidden = true; return; }
  const d = new Date(v + 'T12:00:00');
  const msg = v < hojeSP() ? '⚠️ Essa data já passou.'
    : d.getDay() === 0 ? '⚠️ Domingo a oficina não abre (seg–sáb, 8h às 17h30).' : '';
  aviso.textContent = msg;
  aviso.hidden = !msg;
}
$('#formAgendar')?.data?.addEventListener('change', conferirDataAgendar);

/* Se o servidor expuser horários livres no contexto do copiloto, viram botões:
   um toque preenche data e hora. Sem isso, o formulário segue como sempre. */
async function carregarHorariosSugeridos(convId) {
  const caixa = $('#agendarHorarios'), lista = $('#agendarHorariosLista');
  caixa.hidden = true; lista.innerHTML = '';
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 5000);
  try {
    /* 1º: a rota de horários livres da Agenda (/api/ia/horarios), já filtrada
       pelo serviço escolhido; 2º: o contexto do copiloto, se ela não existir. */
    const servico = $('#agendarServico')?.selectedOptions[0]?.value ? $('#agendarServico').selectedOptions[0].textContent : '';
    const cab = await authCabecalhos();
    let brutos = [];
    const r = await fetch(`/api/ia/horarios?dias=7&servico=${encodeURIComponent(servico)}`, { headers: cab, signal: ctrl.signal });
    if (r.ok) {
      const j = await r.json();
      const sugeridos = j.sugeridos || [];
      const chave = h => `${h.data} ${h.hora}`;
      const ja = new Set(sugeridos.map(chave));
      // as duas sugestões da IA primeiro; depois um de cada período por dia
      const vistos = new Set();
      const resto = (j.livres || []).filter(h => !ja.has(chave(h)) && !vistos.has(h.data + h.periodo) && vistos.add(h.data + h.periodo));
      brutos = [...sugeridos.map(h => ({ ...h, sugerido: true })), ...resto];
    } else {
      const r2 = await fetch(`/api/ia/contexto/${encodeURIComponent(convId)}`, { headers: cab, signal: ctrl.signal });
      if (!r2.ok) return;
      const j = await r2.json();
      brutos = j.ficha?.horariosSugeridos || j.horarios_sugeridos || [];
    }
    if (conversaAtual?.id !== convId) return;
    const horarios = brutos.map(h => {
      const s = typeof h === 'string' ? h : (h.inicio || (h.data && h.hora ? `${h.data} ${h.hora}` : ''));
      const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s));
      return m ? { data: m[1], hora: m[2], sugerido: !!h.sugerido } : null;
    }).filter(Boolean).filter(h => h.data >= hojeSP()).slice(0, 10);
    if (!horarios.length) return;
    lista.innerHTML = horarios.map(h => {
      const d = new Date(`${h.data}T12:00:00`);
      const dia = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
      return `<button type="button" class="chip horario${h.sugerido ? ' sugerido' : ''}" data-data="${esc(h.data)}" data-hora="${esc(h.hora)}"
        ${h.sugerido ? 'title="Sugestão da IA"' : ''}>${h.sugerido ? '✨ ' : ''}${esc(dia)} · ${esc(h.hora)}</button>`;
    }).join('');
    caixa.hidden = false;
  } catch { /* sem contexto: o formulário normal resolve */ }
  finally { clearTimeout(limite); }
}
$('#agendarHorariosLista')?.addEventListener('click', ev => {
  const b = ev.target.closest('[data-data]');
  if (!b) return;
  const f = $('#formAgendar');
  f.data.value = b.dataset.data;
  f.hora.value = b.dataset.hora;
  $$('#agendarHorariosLista .chip').forEach(x => x.classList.toggle('ativo', x === b));
  conferirDataAgendar();
});

/* ---------------- Funil: filtro, esqueleto, toque e teclado ---------------- */
function esqueletoFunil() {
  const coluna = `<section class="funil-coluna sk-coluna" aria-hidden="true"><header class="col-topo">
      <span class="sk-linha" style="width:55%"></span></header><div class="funil-cartoes">
      ${'<div class="funil-cartao sk-cartao"><div class="sk-linha" style="width:70%"></div><div class="sk-linha fina"></div><div class="sk-linha fina" style="width:50%"></div></div>'.repeat(3)}
    </div></section>`;
  return coluna.repeat(4);
}
function passaNoFiltroDoFunil(c) {
  if ($('#funilSoMeus')?.checked && c.atribuida_a !== perfil?.id) return false;
  const t = semAcentoBusca($('#funilBusca')?.value || '');
  if (!t) return true;
  const dig = normalizarDigitos(t);
  const placa = semAcentoBusca(c.clientes?.placa).replace(/[\s-]/g, '');
  return semAcentoBusca(c.nome).includes(t)
    || (dig.length >= 3 && normalizarDigitos(c.telefone).includes(dig))
    || (placa && placa.includes(t.replace(/[\s-]/g, '')))
    || semAcentoBusca(c.clientes?.carro_modelo).includes(t);
}
let funilFiltroTimer = null;
$('#funilBusca')?.addEventListener('input', () => { clearTimeout(funilFiltroTimer); funilFiltroTimer = setTimeout(renderFunil, 150); });
$('#funilSoMeus')?.addEventListener('change', renderFunil);

function moverCartaoPorTeclado(id, passo) {
  const conv = CONVERSAS_FUNIL.find(c => c.id === id);
  if (!conv) return;
  const ativas = etapasAtivas();
  const i = ativas.findIndex(e => e.id === conv.etapa_id);
  const j = i < 0 ? (passo > 0 ? 0 : -1) : i + passo;
  if (j < 0 || j >= ativas.length) return;
  trocarEtapa(conv, ativas[j].id).then(() => {
    $(`#funilQuadro .funil-cartao[data-id="${CSS.escape(id)}"]`)?.focus();
  });
}

function ligarFunilPorToqueETeclado(quadro) {
  if (quadro.dataset.ligado) return;          // ouvintes no quadro: ligados uma vez só
  quadro.dataset.ligado = '1';

  quadro.addEventListener('keydown', ev => {
    const cart = ev.target.closest?.('.funil-cartao');
    if (!cart || ev.target !== cart) return;
    if (ev.key === 'Enter') { ev.preventDefault(); irParaConversa(cart.dataset.id); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); moverCartaoPorTeclado(cart.dataset.id, +1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); moverCartaoPorTeclado(cart.dataset.id, -1); }
    else if (ev.key === ' ') {
      ev.preventDefault();
      const conv = CONVERSAS_FUNIL.find(c => c.id === cart.dataset.id);
      if (conv) abrirMenuEtapas(cart, conv);
    }
  });

  /* Arrastar no celular: segure o cartão (~0,35 s), ele "descola" e acompanha
     o dedo; solte sobre a coluna. Toque rápido continua abrindo a conversa e
     deslizar sem segurar continua rolando o quadro. */
  let toque = null, ignorarClique = false;
  const limpar = () => {
    if (!toque) return;
    clearTimeout(toque.timer);
    toque.fantasma?.remove();
    toque.cart.classList.remove('arrastando');
    $$('.funil-coluna.sobre', quadro).forEach(c => c.classList.remove('sobre'));
    toque = null;
  };
  quadro.addEventListener('touchstart', ev => {
    const cart = ev.target.closest('.funil-cartao');
    if (!cart || ev.touches.length !== 1 || ev.target.closest('.fc-mover')) return;
    const t = ev.touches[0];
    toque = { cart, x0: t.clientX, y0: t.clientY, arrastando: false, col: null };
    toque.timer = setTimeout(() => {
      if (!toque) return;
      toque.arrastando = true;
      cart.classList.add('arrastando');
      const r = cart.getBoundingClientRect();
      const f = cart.cloneNode(true);
      f.className = 'funil-cartao fantasma-toque';
      f.style.width = r.width + 'px';
      f.style.left = (toque.x0 - r.width / 2) + 'px';
      f.style.top = (toque.y0 - 30) + 'px';
      document.body.appendChild(f);
      toque.fantasma = f;
      try { navigator.vibrate?.(15); } catch { /* sem vibração */ }
    }, 350);
  }, { passive: true });
  quadro.addEventListener('touchmove', ev => {
    if (!toque) return;
    const t = ev.touches[0];
    if (!toque.arrastando) {
      if (Math.hypot(t.clientX - toque.x0, t.clientY - toque.y0) > 10) limpar();   // é rolagem
      return;
    }
    ev.preventDefault();
    toque.fantasma.style.left = (t.clientX - toque.fantasma.offsetWidth / 2) + 'px';
    toque.fantasma.style.top = (t.clientY - 30) + 'px';
    toque.fantasma.style.visibility = 'hidden';
    const col = document.elementFromPoint(t.clientX, t.clientY)?.closest('.funil-coluna');
    toque.fantasma.style.visibility = '';
    $$('.funil-coluna', quadro).forEach(c => c.classList.toggle('sobre', c === col));
    toque.col = col || null;
    // perto da borda: o quadro rola sozinho para a próxima coluna
    const r = quadro.getBoundingClientRect();
    if (t.clientX > r.right - 40) quadro.scrollLeft += 18;
    else if (t.clientX < r.left + 40) quadro.scrollLeft -= 18;
  }, { passive: false });
  quadro.addEventListener('touchend', () => {
    if (!toque) return;
    const { arrastando, col, cart } = toque;
    limpar();
    if (!arrastando) return;
    ignorarClique = true; setTimeout(() => { ignorarClique = false; }, 450);
    const conv = CONVERSAS_FUNIL.find(c => c.id === cart.dataset.id);
    if (conv && col) trocarEtapa(conv, col.dataset.etapa || null);
  });
  quadro.addEventListener('touchcancel', limpar);
  // depois de arrastar, o "clique" que o celular solta não abre a conversa
  quadro.addEventListener('click', ev => { if (ignorarClique) { ev.stopPropagation(); ev.preventDefault(); } }, true);
}

/* ---------------- Relatórios: esqueleto e comparação ---------------- */
function esqueletoRelatorios() {
  return `<div class="kpis" aria-hidden="true">${'<div class="kpi sk-kpi"><div class="sk-linha" style="width:50%"></div><div class="sk-linha grossa" style="width:35%"></div><div class="sk-linha fina" style="width:70%"></div></div>'.repeat(4)}</div>
    <section class="bloco-rel sk-bloco" aria-hidden="true"><div class="sk-linha" style="width:30%"></div><div class="sk-grafico"></div></section>
    <p class="vazio" role="status"><span class="girando"></span>Montando os relatórios…</p>`;
}
let RELATORIO_ANTERIOR = null;
async function compararComPeriodoAnterior(de, ate, geracao) {
  RELATORIO_ANTERIOR = null;
  const d0 = new Date(de + 'T12:00:00'), d1 = new Date(ate + 'T12:00:00');
  const dias = Math.round((d1 - d0) / 86400000) + 1;
  const antAte = new Date(d0); antAte.setDate(antAte.getDate() - 1);
  const antDe = new Date(antAte); antDe.setDate(antDe.getDate() - (dias - 1));
  try {
    const r = await (await fetch(`/api/relatorios?de=${diaTexto(antDe)}&ate=${diaTexto(antAte)}`, { headers: await authCabecalhos() })).json();
    if (geracao !== geracaoRelatorio || !r.ok) return;
    RELATORIO_ANTERIOR = { chave: `${de}|${ate}`, resumo: r.resumo, de: diaTexto(antDe), ate: diaTexto(antAte) };
    pintarDeltas();
  } catch { /* sem comparação: os números do período continuam valendo */ }
}
function pintarDeltas() {
  if (!RELATORIO || !RELATORIO_ANTERIOR) return;
  if (RELATORIO_ANTERIOR.chave !== `${$('#relDe').value}|${$('#relAte').value}`) return;
  const ant = RELATORIO_ANTERIOR.resumo || {};
  $$('#relCorpo [data-kpi]').forEach(k => {
    k.querySelector('.delta')?.remove();
    const chave = k.dataset.kpi;
    const a = Number(RELATORIO.resumo?.[chave]), b = Number(ant[chave]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    let texto, sobe;
    if (chave === 'conversao') {
      const pp = Math.round((a - b) * 10) / 10;
      if (pp === 0) texto = '= igual ao período anterior';
      else texto = `${pp > 0 ? '▲' : '▼'} ${Math.abs(pp).toLocaleString('pt-BR')} pontos`;
      sobe = pp > 0;
    } else if (b === 0) {
      texto = a ? '▲ antes era zero' : '= igual ao período anterior'; sobe = a > 0;
    } else {
      const pc = Math.round(((a - b) / b) * 100);
      texto = pc === 0 ? '= igual ao período anterior' : `${pc > 0 ? '▲' : '▼'} ${Math.abs(pc)}%`;
      sobe = pc > 0;
    }
    const bom = k.dataset.kpiInverso ? !sobe : sobe;
    const neutro = texto.startsWith('=');
    const el = document.createElement('small');
    el.className = 'delta ' + (neutro ? 'neutro' : bom ? 'bom' : 'ruim');
    el.textContent = neutro ? texto : `${texto} vs ${ddmm(RELATORIO_ANTERIOR.de)}–${ddmm(RELATORIO_ANTERIOR.ate)}`;
    el.title = `Período anterior (${ddmm(RELATORIO_ANTERIOR.de)} a ${ddmm(RELATORIO_ANTERIOR.ate)}): ${chave === 'conversao' ? pct(b) : num(b)}`;
    k.appendChild(el);
  });
}

/* ---------------- Equipe: quem está com quantos clientes ---------------- */
async function pintarCargaDaEquipe() {
  const alvos = $$('#listaEquipe [data-carga]');
  if (!alvos.length) return;
  try {
    const { data, error } = await sb.from('conversas').select('atribuida_a,nao_lidas,aguardando_consultor')
      .eq('tipo', 'atendimento').is('desfecho', null).not('atribuida_a', 'is', null).limit(5000);
    if (error) throw error;
    const por = new Map();
    for (const c of data || []) {
      const p = por.get(c.atribuida_a) || { total: 0, naoLidas: 0, espera: 0 };
      p.total++; if (c.nao_lidas > 0) p.naoLidas++; if (c.aguardando_consultor) p.espera++;
      por.set(c.atribuida_a, p);
    }
    alvos.forEach(el => {
      const p = por.get(el.dataset.carga);
      el.innerHTML = !p ? '<span class="carga-zero">nenhum cliente em aberto</span>'
        : `<b>${esc(String(p.total))}</b> cliente${p.total > 1 ? 's' : ''} em aberto${
            p.naoLidas ? ` · <b class="carga-alerta">${esc(String(p.naoLidas))}</b> sem ler` : ''}${
            p.espera ? ` · <b class="carga-alerta">${esc(String(p.espera))}</b> esperando consultor` : ''}`;
    });
  } catch { alvos.forEach(el => { el.textContent = ''; }); }
}

/* ---------------- Atalhos favoritos (por pessoa, neste navegador) ---------------- */
const chaveFavoritos = () => `indycar_atalhos_fav_${perfil?.id || 'anon'}`;
function favoritosAtalhos() {
  try { return new Set(JSON.parse(localStorage.getItem(chaveFavoritos()) || '[]')); } catch { return new Set(); }
}
function alternarFavorito(id) {
  const s = favoritosAtalhos();
  s.has(id) ? s.delete(id) : s.add(id);
  try { localStorage.setItem(chaveFavoritos(), JSON.stringify([...s])); } catch { /* ignora */ }
  toast(s.has(id) ? '★ Favorito — aparece primeiro no menu' : '☆ Saiu dos favoritos');
}
/* ⚡ abre as respostas rápidas sem digitar "/" */
$('#btnRespostas')?.addEventListener('click', () => {
  if (!conversaAtual) return toast('Abra uma conversa primeiro.');
  if (menuAberto) return fecharMenuAtalhos();
  abrirMenuAtalhos('');
  if (!menuAberto) return toast('Nenhum atalho ativo. Crie na aba Atalhos.');
  $('#btnRespostas').setAttribute('aria-expanded', 'true');
  campo.focus();
});
$('#btnRespostas')?.setAttribute('aria-haspopup', 'listbox');
$('#atalhoLista')?.setAttribute('role', 'listbox');

/* ---------------- Busca dentro da conversa ---------------- */
const BUSCA_MSG = { termo: '', indice: 0, total: 0 };
let buscaMsgTimer = null;
function abrirBuscaNaConversa() {
  if (!conversaAtual) return;
  $('#buscaMsgBar').hidden = false;
  const c = $('#buscaMsgCampo');
  c.focus(); c.select();
}
function fecharBuscaNaConversa() {
  const bar = $('#buscaMsgBar');
  if (!bar || bar.hidden) return;
  bar.hidden = true;
  $('#buscaMsgCampo').value = '';
  const tinha = !!BUSCA_MSG.termo;
  Object.assign(BUSCA_MSG, { termo: '', indice: 0, total: 0 });
  $('#buscaMsgConta').textContent = '';
  if (tinha && conversaAtual) renderMensagens();
}
function atualizarResultadosBusca({ manterIndice = false, rolar = !manterIndice } = {}) {
  const marcas = $$('#mensagens mark.achado');
  BUSCA_MSG.total = marcas.length;
  if (!manterIndice) BUSCA_MSG.indice = marcas.length - 1;            // começa da mais recente
  BUSCA_MSG.indice = Math.min(Math.max(0, BUSCA_MSG.indice), Math.max(0, marcas.length - 1));
  marcas.forEach((m, i) => m.classList.toggle('atual', i === BUSCA_MSG.indice));
  $('#buscaMsgConta').textContent = !BUSCA_MSG.termo ? ''
    : marcas.length ? `${BUSCA_MSG.indice + 1} de ${marcas.length}` : 'nada encontrado';
  if (rolar && marcas[BUSCA_MSG.indice]) marcas[BUSCA_MSG.indice].scrollIntoView({ block: 'center' });
}
function andarNaBusca(passo) {
  if (!BUSCA_MSG.total) return;
  BUSCA_MSG.indice = (BUSCA_MSG.indice + passo + BUSCA_MSG.total) % BUSCA_MSG.total;
  atualizarResultadosBusca({ manterIndice: true, rolar: true });
}
$('#btnBuscarNaConversa')?.addEventListener('click', () => ($('#buscaMsgBar').hidden ? abrirBuscaNaConversa() : fecharBuscaNaConversa()));
$('#buscaMsgCampo')?.addEventListener('input', ev => {
  clearTimeout(buscaMsgTimer);
  buscaMsgTimer = setTimeout(() => {
    BUSCA_MSG.termo = ev.target.value.trim().length >= 2 ? ev.target.value.trim() : '';
    renderMensagens({ manterTopo: false });
    atualizarResultadosBusca();
  }, 150);
});
$('#buscaMsgCampo')?.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') { ev.preventDefault(); andarNaBusca(ev.shiftKey ? +1 : -1); }   // Enter = mais antiga
  else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fecharBuscaNaConversa(); campo.focus(); }
});
$('#buscaMsgAnt')?.addEventListener('click', () => andarNaBusca(-1));
$('#buscaMsgProx')?.addEventListener('click', () => andarNaBusca(+1));
$('#buscaMsgFechar')?.addEventListener('click', () => { fecharBuscaNaConversa(); campo.focus(); });

/* ---------------- Avisos: notificação e som (só em segundo plano) ---------------- */
function lerAvisos() {
  try { return { notificacao: false, som: false, ...JSON.parse(localStorage.getItem('indycar_avisos') || '{}') }; }
  catch { return { notificacao: false, som: false }; }
}
function gravarAvisos(a) { try { localStorage.setItem('indycar_avisos', JSON.stringify(a)); } catch { /* ignora */ } pintarAvisos(); }
function pintarAvisos() {
  const a = lerAvisos();
  const ligado = a.notificacao || a.som;
  const b = $('#btnNotificar');
  if (b) {
    b.textContent = ligado ? '🔔' : '🔕';
    b.setAttribute('aria-pressed', ligado ? 'true' : 'false');
    b.title = ligado ? 'Avisos ligados (notificação/som em segundo plano) — clique para desligar' : 'Ligar aviso de mensagem nova';
  }
  if ($('#cfgNotificacao')) $('#cfgNotificacao').checked = a.notificacao;
  if ($('#cfgSom')) $('#cfgSom').checked = a.som;
  const aviso = $('#cfgNotificacaoAviso');
  if (aviso) {
    const negada = 'Notification' in window && Notification.permission === 'denied';
    aviso.hidden = !(a.notificacao && negada);
    aviso.textContent = 'O navegador bloqueou as notificações deste site. Libere no cadeado ao lado do endereço.';
  }
}
async function pedirPermissaoNotificacao() {
  if (!('Notification' in window)) { toast('Este navegador não mostra notificações — fica só o som.'); return false; }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') { toast('⚠️ Notificações bloqueadas. Libere no cadeado ao lado do endereço.'); return false; }
  return (await Notification.requestPermission()) === 'granted';
}
$('#btnNotificar')?.addEventListener('click', async () => {
  const a = lerAvisos();
  if (a.notificacao || a.som) { gravarAvisos({ notificacao: false, som: false }); return toast('🔕 Avisos desligados'); }
  const pode = await pedirPermissaoNotificacao();
  gravarAvisos({ notificacao: pode, som: true });
  toast(pode ? '🔔 Avisos ligados: notificação e som quando o painel estiver em segundo plano' : '🔔 Som ligado');
});
$('#cfgNotificacao')?.addEventListener('change', async ev => {
  const a = lerAvisos();
  a.notificacao = ev.target.checked ? await pedirPermissaoNotificacao() : false;
  gravarAvisos(a);
});
$('#cfgSom')?.addEventListener('change', ev => { const a = lerAvisos(); a.som = ev.target.checked; gravarAvisos(a); if (a.som) tocarSom(); });
$('#btnTestarAviso')?.addEventListener('click', () => {
  const a = lerAvisos();
  if (!a.notificacao && !a.som) return toast('Ligue a notificação ou o som primeiro.');
  if (a.som) tocarSom();
  if (a.notificacao && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('💬 Teste — IndyCar Atendimento', { body: 'É assim que a mensagem nova aparece.', icon: '/icon-192.png', tag: 'teste' });
  }
});
$('#btnVerAtalhosTeclado')?.addEventListener('click', () => abrirAjudaTeclado());

let audioCtx = null, ultimoSom = 0;
function tocarSom() {
  if (Date.now() - ultimoSom < 2500) return;     // rajada de mensagens = um "plim" só
  ultimoSom = Date.now();
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const agora = audioCtx.currentTime;
    [[880, 0], [1320, 0.12]].forEach(([freq, t]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, agora + t);
      g.gain.exponentialRampToValueAtTime(0.12, agora + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, agora + t + 0.22);
      o.connect(g).connect(audioCtx.destination);
      o.start(agora + t); o.stop(agora + t + 0.25);
    });
  } catch { /* sem áudio: segue sem som */ }
}
function avisarMensagemNova(m) {
  const a = lerAvisos();
  if (!a.notificacao && !a.som) return;
  const segundoPlano = document.visibilityState !== 'visible';
  const outraConversa = conversaAtual?.id !== m.conversa_id;
  if (!segundoPlano && !outraConversa) return;
  if (a.som) tocarSom();
  // notificação só com o painel em segundo plano: na frente, o toast já avisa
  if (a.notificacao && segundoPlano && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(`💬 ${m.nome || telefoneBonito(m.telefone) || 'Cliente'}`, {
        body: String(m.corpo || (m.anexo ? '📎 anexo' : 'mensagem nova')).slice(0, 140),
        icon: '/icon-192.png', tag: 'conv-' + (m.conversa_id || ''), renotify: true,
      });
      n.onclick = () => { window.focus(); if (m.conversa_id) irParaConversa(m.conversa_id); n.close(); };
    } catch { /* alguns navegadores só notificam pelo service worker */ }
  }
}
pintarAvisos();

/* ---------------- Modo foco ---------------- */
function aplicarModoFoco(ligar) {
  $('#telaApp').classList.toggle('modo-foco', ligar);
  $('#btnFoco')?.setAttribute('aria-pressed', ligar ? 'true' : 'false');
  try { localStorage.setItem('indycar_foco', ligar ? '1' : '0'); } catch { /* ignora */ }
}
$('#btnFoco')?.addEventListener('click', () => {
  const ligar = !$('#telaApp').classList.contains('modo-foco');
  aplicarModoFoco(ligar);
  toast(ligar ? '⛶ Modo foco — Alt+Z ou ⛶ para voltar' : 'Modo foco desligado');
});
try { if (localStorage.getItem('indycar_foco') === '1') aplicarModoFoco(true); } catch { /* ignora */ }

/* ---------------- "⋯" no celular: ações menos usadas ---------------- */
function fecharMenuMais({ focar = false } = {}) {
  const m = $('#menuMaisAcoes');
  if (!m || m.hidden) return;
  m.hidden = true;
  $('#btnMaisAcoes').setAttribute('aria-expanded', 'false');
  if (focar) $('#btnMaisAcoes').focus();
}
$('#btnMaisAcoes')?.addEventListener('click', (ev) => {
  ev.stopPropagation();
  const m = $('#menuMaisAcoes');
  if (!m.hidden) return fecharMenuMais();
  m.hidden = false;
  // tela estreita: se o menu sairia pela esquerda, ancora pela esquerda do botão
  m.style.left = ''; m.style.right = '';
  if (m.getBoundingClientRect().left < 8) { m.style.left = '0'; m.style.right = 'auto'; }
  $('#btnMaisAcoes').setAttribute('aria-expanded', 'true');
  $('button:not([hidden]), select', m)?.focus();
});
// escolheu uma ação (botão) no menu: ele fecha; o seletor de situação fecha ao mudar
$('#menuMaisAcoes')?.addEventListener('click', ev => { if (ev.target.closest('button')) fecharMenuMais(); });
$('#chatStatus')?.addEventListener('change', () => fecharMenuMais());
document.addEventListener('click', ev => { if (!ev.target.closest('.mais-acoes')) fecharMenuMais(); });
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && !$('#menuMaisAcoes')?.hidden) { ev.stopPropagation(); fecharMenuMais({ focar: true }); }
}, true);

/* ---------------- Sem internet: faixa e fila de envio ---------------- */
const FILA_KEY = 'indycar_fila_envio';
function lerFila() { try { return JSON.parse(localStorage.getItem(FILA_KEY) || '[]'); } catch { return []; } }
function gravarFila(f) { try { localStorage.setItem(FILA_KEY, JSON.stringify(f)); } catch { /* ignora */ } }
function filaOfflineAdicionar(item) {
  const fila = lerFila();
  const novo = { ...item, idLocal: 'f' + Date.now() + Math.random().toString(16).slice(2, 6), criada: new Date().toISOString() };
  fila.push(novo);
  gravarFila(fila);
  locaisDe(item.conversaId).push({ _idLocal: novo.idLocal, _local: 'na_fila', conversa_id: item.conversaId,
    corpo: item.corpo, direcao: 'saida', created_at: novo.criada });
  pintarFaixaOffline();
}
let processandoFila = false;
async function filaOfflineProcessar() {
  const fila = lerFila();
  // depois de recarregar a página, as que estão na fila voltam a aparecer no chat
  for (const it of fila) {
    const l = locaisDe(it.conversaId);
    if (!l.some(x => x._idLocal === it.idLocal)) l.push({ _idLocal: it.idLocal, _local: 'na_fila', conversa_id: it.conversaId,
      corpo: it.corpo, direcao: 'saida', created_at: it.criada });
  }
  if (!fila.length || navigator.onLine === false || processandoFila || !sb) { pintarFaixaOffline(); return; }
  processandoFila = true;
  let saiu = 0;
  try {
    for (const it of fila) {
      tirarLocal(it.conversaId, it.idLocal);
      gravarFila(lerFila().filter(x => x.idLocal !== it.idLocal));
      const ok = await entregarMensagem({ id: it.conversaId, telefone: it.telefone, nome: it.nome, cliente_id: it.clienteId }, it.corpo);
      if (ok) saiu++;
    }
  } finally { processandoFila = false; }
  if (saiu) toast(`📤 ${saiu} mensage${saiu > 1 ? 'ns' : 'm'} da fila enviada${saiu > 1 ? 's' : ''}`);
  if (conversaAtual) renderMensagens();
  pintarFaixaOffline();
}
function pintarFaixaOffline() {
  const f = $('#faixaOffline');
  if (!f) return;
  const fora = navigator.onLine === false, n = lerFila().length;
  f.hidden = !fora && !n;
  f.classList.toggle('na-fila', !fora && n > 0);
  $('#faixaOfflineTexto').textContent = fora
    ? `Sem internet. ${n ? `${n} mensage${n > 1 ? 'ns' : 'm'} na fila — ` : 'O que você enviar fica na fila e '}sai sozinho quando a conexão voltar.`
    : `Enviando ${n} mensage${n > 1 ? 'ns' : 'm'} da fila…`;
}
window.addEventListener('offline', pintarFaixaOffline);
window.addEventListener('online', () => { pintarFaixaOffline(); filaOfflineProcessar(); agendarRecargaLista(); });
pintarFaixaOffline();

/* ---------------- Modais: Esc, foco preso e foco de volta ---------------- */
const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const modalAberto = () => [...document.querySelectorAll('.modal-bg.aberto')].pop() || null;
function abrirModal(id, focoSel) {
  const bg = document.getElementById(id);
  if (!bg) return;
  bg.classList.add('aberto');
  if (focoSel) setTimeout(() => $(focoSel, bg)?.focus(), 80);
}
function fecharModal(id) { document.getElementById(id)?.classList.remove('aberto'); }
$$('.modal-bg').forEach((bg, i) => {
  const modal = $('.modal', bg);
  const titulo = $('h3', modal);
  if (titulo && !titulo.id) titulo.id = `modalTitulo${i}`;
  modal?.setAttribute('role', 'dialog');
  modal?.setAttribute('aria-modal', 'true');
  if (titulo) modal?.setAttribute('aria-labelledby', titulo.id);
  $$('.modal-x', bg).forEach(x => x.setAttribute('aria-label', 'Fechar'));
  bg.setAttribute('aria-hidden', 'true');
  let quemAbriu = null;
  new MutationObserver(() => {
    const aberto = bg.classList.contains('aberto');
    if (aberto && bg.getAttribute('aria-hidden') === 'true') {
      bg.setAttribute('aria-hidden', 'false');
      quemAbriu = document.activeElement && !bg.contains(document.activeElement) ? document.activeElement : null;
      setTimeout(() => { if (!bg.contains(document.activeElement)) $(FOCAVEIS, modal)?.focus(); }, 90);
    } else if (!aberto && bg.getAttribute('aria-hidden') === 'false') {
      bg.setAttribute('aria-hidden', 'true');
      if (bg.id === 'modalAnexoBg' && anexoPendente?.url) { URL.revokeObjectURL(anexoPendente.url); anexoPendente = null; }
      if (quemAbriu?.isConnected) quemAbriu.focus({ preventScroll: true });
      quemAbriu = null;
    }
  }).observe(bg, { attributes: true, attributeFilter: ['class'] });
  // clicar no fundo escuro fecha (todos os modais, não só alguns)
  bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('aberto'); });
});
document.addEventListener('keydown', e => {
  const bg = modalAberto();
  if (!bg) return;
  if (e.key === 'Escape' && !menuAberto) { e.preventDefault(); bg.classList.remove('aberto'); return; }
  if (e.key !== 'Tab') return;
  const itens = $$(FOCAVEIS, bg).filter(el => el.offsetParent !== null);
  if (!itens.length) return;
  const primeiro = itens[0], ultimo = itens[itens.length - 1];
  if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  else if (!bg.contains(document.activeElement)) { e.preventDefault(); primeiro.focus(); }
});
// botão "+ Nova" ganha nome acessível e dica do atalho
btnNova.setAttribute('aria-label', 'Nova conversa (Alt+N)');
btnNova.title = 'Nova conversa (Alt+N)';
btnNova.classList.add('btn-nova');

/* ---------------- Atalhos de teclado ---------------- */
const TECLAS = [
  ['Ctrl + K  ou  /', 'Buscar conversa'],
  ['↑ ↓  (ou J K) na lista', 'Andar entre as conversas · Enter abre'],
  ['Alt + ↑ / ↓', 'Conversa anterior / próxima'],
  ['Enter', 'Enviar · Shift+Enter quebra a linha'],
  ['/  no campo', 'Respostas rápidas (★ favoritas primeiro)'],
  ['Alt + 1 … 9', 'Marcar a etapa do funil (na ordem das colunas)'],
  ['Alt + E', 'Abrir o menu de etapas'],
  ['Alt + M', 'Pegar o cliente para mim'],
  ['Alt + U', 'Marcar como não lida e voltar'],
  ['Alt + F', 'Buscar dentro da conversa'],
  ['Alt + I', 'Abrir o copiloto da IA'],
  ['Alt + Z', 'Modo foco (só chat e ficha)'],
  ['Alt + N', 'Nova conversa'],
  ['Esc', 'Fechar menu, busca, gaveta ou modal'],
  ['?', 'Esta lista'],
];
function abrirAjudaTeclado() {
  const etapas = etapasAtivas().slice(0, 9).map((e, i) => `Alt+${i + 1} ${e.nome}`).join(' · ');
  $('#listaTeclas').innerHTML = TECLAS.map(([k, d]) =>
    `<dt>${k.split('  ').map(p => `<kbd>${esc(p.trim())}</kbd>`).join(' ')}</dt><dd>${esc(d)}</dd>`).join('')
    + (etapas ? `<dt><kbd>Etapas</kbd></dt><dd>${esc(etapas)}</dd>` : '');
  abrirModal('modalAjudaBg');
}
const digitando = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
function irParaAbaConversas() {
  if (!abaVisivel('conversas')) $$('.nav-item').find(b => b.dataset.aba === 'conversas')?.click();
}
function conversaVizinha(passo) {
  const lista = conversasFiltradas();
  if (!lista.length) return;
  const i = lista.findIndex(c => c.id === conversaAtual?.id);
  const alvo = lista[i < 0 ? 0 : Math.min(lista.length - 1, Math.max(0, i + passo))];
  if (alvo && alvo.id !== conversaAtual?.id) {
    abrirConversa(alvo.id);
    $(`#listaConversas .conversa[data-id="${CSS.escape(alvo.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
}
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || modalAberto()) return;
  const noCampo = digitando(e.target);
  // Ctrl+K funciona até digitando; "/" e "?" só fora de campo
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault(); irParaAbaConversas(); fecharConversaNoCelular(); $('#buscaConversa').focus(); $('#buscaConversa').select(); return;
  }
  if (!noCampo && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === '?') { e.preventDefault(); return abrirAjudaTeclado(); }
    if (e.key === '/' && abaVisivel('conversas')) { e.preventDefault(); fecharConversaNoCelular(); $('#buscaConversa').focus(); return; }
  }
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const cod = e.code;
  if (cod === 'KeyN') { e.preventDefault(); irParaAbaConversas(); return abrirModalNova(); }
  if (cod === 'KeyZ') { e.preventDefault(); return $('#btnFoco')?.click(); }
  if (!conversaAtual || !abaVisivel('conversas')) return;
  if (cod === 'ArrowDown') { e.preventDefault(); return conversaVizinha(+1); }
  if (cod === 'ArrowUp') { e.preventDefault(); return conversaVizinha(-1); }
  if (cod === 'KeyF') { e.preventDefault(); return abrirBuscaNaConversa(); }
  if (cod === 'KeyI') { e.preventDefault(); return abrirCopiloto(); }
  if (cod === 'KeyU') { e.preventDefault(); return $('#btnNaoLida')?.click(); }
  if (cod === 'KeyM') {
    e.preventDefault();
    if (conversaAtual.atribuida_a === perfil?.id) return toast('★ Este cliente já é seu');
    return trocarDono(conversaAtual, perfil.id);
  }
  if (cod === 'KeyE') { e.preventDefault(); const p = $('#chatEtapa .plaquinha'); if (p) abrirMenuEtapas(p, conversaAtual); return; }
  const m = /^Digit([1-9])$/.exec(cod);
  if (m) {
    e.preventDefault();
    const etapa = etapasAtivas()[Number(m[1]) - 1];
    if (!etapa) return toast(`Não há etapa ${m[1]} — são ${etapasAtivas().length}.`);
    if (etapa.id === conversaAtual.etapa_id) return toast(`Já está em ${etapa.nome}`);
    trocarEtapa(conversaAtual, etapa.id);
  }
});
/** No celular a busca fica na lista: se o chat está na frente, volta para ela. */
function fecharConversaNoCelular() {
  if (window.matchMedia('(max-width:900px)').matches && conversaAtual) fecharConversa();
}

/* O seletor de dono "★ Meus" antigo saiu da tela; o estado continua valendo. */
pintarSegmentoDono();

/* Relógio dos selos de espera: a cada minuto a lista se atualiza sozinha
   ("⏱ 14min" vira "⏱ 15min" e muda de cor) sem ir ao banco. */
setInterval(() => { if (jaCarregouConversas && document.visibilityState === 'visible') renderConversas(); }, 60_000);
// trocou o serviço no "Agendar": os horários livres são outros (cada serviço tem a sua janela)
$('#agendarServico')?.addEventListener('change', () => { if (conversaAtual) carregarHorariosSugeridos(conversaAtual.id); });

/** Abriu (ou marcou como não lida) uma conversa: o número da barra e do título mexe na hora. */
function ajustarNaoLidas(delta) {
  if (naoLidasBanco === null) return;
  naoLidasBanco = Math.max(0, naoLidasBanco + delta);
  const b = $('#badgeNaoLidas');
  b.textContent = naoLidasBanco > 99 ? '99+' : naoLidasBanco;
  b.hidden = !naoLidasBanco;
  pintarContador('cntNaoLidas', naoLidasBanco);
  atualizarTituloDaAba(naoLidasBanco);
}

/* Chips numa linha só: a roda do mouse rola para o lado, e o chip ativo
   (vindo do link ?filtro= ou de um clique) sempre fica à vista. */
(() => {
  const barra = $('#aba-conversas .filtros-status');
  if (!barra) return;
  barra.addEventListener('wheel', ev => {
    if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX) || barra.scrollWidth <= barra.clientWidth) return;
    ev.preventDefault();
    barra.scrollLeft += ev.deltaY;
  }, { passive: false });
  const mostrarAtivo = () => $('.chip.ativo', barra)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  barra.addEventListener('click', () => setTimeout(mostrarAtivo, 0));
  window.addEventListener('load', () => setTimeout(mostrarAtivo, 300));
})();
