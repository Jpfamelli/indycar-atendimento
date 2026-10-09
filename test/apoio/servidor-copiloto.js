/* Bancada do painel do copiloto: serve public/ + uma página mínima com o
   slot e as rotas reais do copiloto (lib/rotas-ia.js) com banco e IA de
   mentira. Sem login de verdade, sem rede.
     node test/apoio/servidor-copiloto.js --servir [porta]
   http://localhost:3212/bancada            → com o slot na ficha
   http://localhost:3212/bancada?sem-slot   → sem slot (painel flutuante)
   ?autonomia=sugerir|automatico
   (o node --test também carrega este arquivo: sem --servir ele não faz nada) */
'use strict';
if (!process.argv.includes('--servir')) return;

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const IA = require('../../lib/ia-copiloto.js');
const CTX = require('../../lib/contexto.js');
const RD = require('../../lib/resumo-dia.js');
const { criarRotasIA } = require('../../lib/rotas-ia.js');
const { criarSbFalso } = require('./sb-falso.js');
const { ID, tabelas, criarIAFalsa } = require('./dados.js');

const PORTA = Number(process.argv[process.argv.indexOf('--servir') + 1]) || 3212;
const AGORA = () => new Date('2026-10-14T13:00:00Z');
const PUBLIC = path.join(__dirname, '..', '..', 'public');

let n = 0;
const tu = (name, input) => ({ type: 'tool_use', id: `b_${++n}`, name, input });
const roteiro = (params) => {
  const ultima = params.messages.at(-1);
  if (Array.isArray(ultima.content)) return { stop_reason: 'end_turn', content: [] };
  return { stop_reason: 'tool_use', usage: { input_tokens: 3200, output_tokens: 410 }, content: [
    tu('classificar', { intencao: 'agendar', temperatura: 'quente', motivo: 'Pediu quinta 14h' }),
    tu('resumir', { resumo: 'Camila: barulho na suspensão do Corolla.\nAceitou trazer quinta às 14h.', pendencias: ['Confirmar o horário', 'Anotar a placa ABC1D23'] }),
    tu('responder', { texto: 'Opa, Camila! 😊 Fechado então: quinta às 14h a gente coloca o Corolla no elevador e faz o diagnóstico gratuito, com foto de tudo.\n📍 Av. Bandeirantes, 875 — Parque Paduan.\nDeixo reservado no seu nome?' }),
    tu('agendar', { data: '2026-10-15', hora: '14:00', servico: 'Diagnóstico', observacoes: 'Barulho na suspensão' }),
    tu('atualizar_ficha', { placa: 'abc-1d23' }),
    tu('mover_etapa', { etapa: 'Agendado', motivo: 'cliente aceitou o horário' }),
    tu('agendar_retorno', { data: '2026-10-20', texto: 'Oi Camila! Tudo certo com o Corolla depois do diagnóstico? 🏎' }),
  ] };
};

const autonomiaPedida = u => new URL(u, 'http://x').searchParams.get('autonomia');
let estado = null;
function novoEstado(autonomia) {
  const t = tabelas();
  if (autonomia) t.ia_config[0].autonomia = autonomia;
  t.ia_acoes.push({ id: '12121212-1212-4121-8121-121212121299', origem: 'atendimento', tipo: 'registrar_interesse', status: 'executada',
    conversa_id: ID.conversa, resumo: 'Interesse em Alinhamento — no lead aberto', entrada: {}, saida: { lead_id: ID.lead, antes: { status: 'contato' } },
    created_at: '2026-10-14T12:20:00Z', executada_em: '2026-10-14T12:20:00Z' });
  const sb = criarSbFalso(t, { relogio: AGORA });
  const contexto = CTX.criarContexto({ sb, agora: AGORA });
  const ia = criarIAFalsa(roteiro);
  const copiloto = IA.criarCopiloto({ sb, contexto, criarIA: async () => { await new Promise(r => setTimeout(r, 900)); return ia; }, agora: AGORA });
  const resumoDoDia = RD.criarResumoDoDia({ sb, criarIA: async () => ia, copiloto, agora: AGORA });
  const tratar = criarRotasIA({ getSb: () => sb, usuarioLogado: async () => ({ id: ID.perfil, papel: 'admin' }),
    dentroDoLimite: () => true,
    readBody: req => new Promise(r => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => { try { r(d ? JSON.parse(d) : {}); } catch { r({}); } }); }),
    copiloto, resumoDoDia, contexto });
  return { tratar, sb };
}

const PAGINA = (semSlot) => `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bancada do copiloto</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/copiloto.css">
<style>body{margin:0;background:var(--preto);color:var(--texto);font-family:var(--fonte)} .lado{display:grid;grid-template-columns:1fr 360px;gap:16px;padding:16px;min-height:100vh;box-sizing:border-box}
@media (max-width:900px){.lado{grid-template-columns:1fr}} textarea#campo{width:100%;min-height:90px;box-sizing:border-box} .ficha{background:var(--grafite);padding:12px;border-radius:12px;min-width:0}</style></head>
<body><div class="lado"><main><h1 style="font-family:var(--fonte-cond)">Chat (bancada)</h1>
<p><button id="abrir" class="btn btn-ghost sm">Abrir conversa da Camila</button> <button id="fechar" class="btn btn-ghost sm">Fechar</button>
<button id="msg" class="btn btn-ghost sm">Cliente escreveu</button> <button id="tema" class="btn btn-ghost sm">Tema</button></p>
<textarea id="campo" aria-label="Mensagem"></textarea></main>
<aside class="ficha" id="colFicha">${semSlot ? '' : '<section id="copilotoSlot" aria-label="Copiloto" hidden></section>'}<p>Ficha…</p></aside></div>
<script>
window.IndyCar = { authCabecalhos: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer teste' }),
  toast: m => { const d = document.createElement('div'); d.className = 'cop-toast'; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 2500); },
  inserirNoCampo: t => { document.getElementById('campo').value = t; return true; },
  recarregarFicha: async () => {}, recarregarConversa: async () => {}, papel: 'admin' };
const det = { conversaId: '${ID.conversa}', clienteId: '${ID.cliente}', telefone: '5512988887777', nome: 'Camila' };
document.getElementById('abrir').onclick = () => { const s = document.getElementById('copilotoSlot'); if (s) s.hidden = false; dispatchEvent(new CustomEvent('indycar:conversa', { detail: det })); };
document.getElementById('fechar').onclick = () => { const s = document.getElementById('copilotoSlot'); if (s) s.hidden = true; dispatchEvent(new CustomEvent('indycar:conversa', { detail: { conversaId: null } })); };
document.getElementById('msg').onclick = () => dispatchEvent(new CustomEvent('indycar:mensagem', { detail: { conversaId: det.conversaId, direcao: 'entrada' } }));
document.getElementById('tema').onclick = () => { const h = document.documentElement; h.dataset.tema = h.dataset.tema === 'claro' ? '' : 'claro'; };
</script><script src="/copiloto.js" defer></script></body></html>`;

const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/bancada') {
    estado = novoEstado(autonomiaPedida(req.url));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGINA(u.searchParams.has('sem-slot')));
  }
  if (!estado) estado = novoEstado();
  if (await estado.tratar(req, res, u.pathname, u.searchParams)) return;
  const arq = path.join(PUBLIC, u.pathname);
  if (!arq.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(arq, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORTA, '127.0.0.1', () => console.log(`bancada do copiloto em http://localhost:${PORTA}/bancada`));
