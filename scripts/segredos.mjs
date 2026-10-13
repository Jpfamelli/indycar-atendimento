#!/usr/bin/env node
/* ============================================================
   npm run segredos — procura chave/segredo em arquivo VERSIONADO
   (git ls-files + arquivos novos que não estão no .gitignore).
   Sai com código 1 se achar algo. Nunca imprime o segredo inteiro:
   só arquivo:linha, o tipo e as 4 primeiras/últimas letras.
   A anon key do Supabase é pública por design e não conta; JWT com
   role service_role conta.
   Uso: node scripts/segredos.mjs [--todos]   (--todos inclui o .gitignore)
   ============================================================ */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PADROES = [
  { tipo: 'Anthropic', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { tipo: 'OpenAI', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g },
  { tipo: 'CodeWords', re: /\bcwk-[A-Za-z0-9_-]{16,}/g },
  { tipo: 'Supabase secret', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
  { tipo: 'Supabase token de acesso', re: /\bsbp_[a-f0-9]{30,}\b/g },
  { tipo: 'GitHub', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/g },
  { tipo: 'AWS', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { tipo: 'Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { tipo: 'Stripe', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/g },
  { tipo: 'Slack', re: /\bxox[abprs]-[0-9A-Za-z-]{20,}/g },
  { tipo: 'Meta/WhatsApp', re: /\bEAA[A-Za-z0-9]{100,}\b/g },
  { tipo: 'Chave privada', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { tipo: 'JWT service_role', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, filtro: ehServiceRole },
  { tipo: 'Senha em URL', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:'"@/]+:[^\s'"@/]{6,}@/g },
  { tipo: 'Senha escrita', re: /\b(?:senha|password|pass)\b\**\s*(?:\|\s*|[:=]\s*)\**\s*[`'"]([^`'"\s]{6,64})[`'"]/gi,
    filtro: v => /\d/.test(v) && /[a-z]/i.test(v) && !v.includes('${') },
  { tipo: 'Atribuição de segredo', re: /\b(?:SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY|SERVICE_ROLE_KEY|CW_API_KEY|GITHUB_TOKEN)\s*[=:]\s*['"]?([A-Za-z0-9_.-]{24,})/g },
];

function ehServiceRole(jwt) {
  try {
    const carga = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return carga.role === 'service_role' || carga.role === 'supabase_admin';
  } catch { return false; }
}

/** Chave de mentira dos testes: diz "teste"/"fake", alfabeto em sequência ou repetição longa. */
export function ficticio(v) {
  const s = String(v).toLowerCase();
  return /teste|test|fake|falsa|ficticia|dummy|exemplo|example/.test(s)
    || /abcdefgh|01234567|12345678/.test(s) || /(.)\1{7,}/.test(s);
}

const mascarar = s => (s.length <= 10 ? '••••' : `${s.slice(0, 4)}…${s.slice(-4)}`);
const BINARIO = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp3|mp4|ogg|webm|lock)$/i;

/** Procura nos textos dados. Pura (testada). */
export function procurar(arquivos) {
  const achados = [];
  for (const { nome, texto } of arquivos) {
    const linhas = texto.split(/\r?\n/);
    linhas.forEach((linha, i) => {
      if (/segredos:ignorar/.test(linha)) return;            // exemplo proposital documentado
      for (const p of PADROES) {
        p.re.lastIndex = 0;
        let m;
        while ((m = p.re.exec(linha))) {
          const valor = m[1] || m[0];
          if (p.filtro && !p.filtro(valor)) continue;
          if (/^(?:x+|\*+|•+|seu|sua|cole|exemplo|placeholder)/i.test(valor.replace(/^[^_]*_/, ''))) continue;
          if (ficticio(valor)) continue;
          achados.push({ arquivo: nome, linha: i + 1, tipo: p.tipo, amostra: mascarar(valor) });
        }
      }
    });
  }
  return achados;
}

function listar(todos) {
  const git = (...a) => execFileSync('git', a, { cwd: RAIZ, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const versionados = git('ls-files');
  const novos = git('ls-files', '--others', '--exclude-standard');
  const extra = todos ? git('ls-files', '--others', '--ignored', '--exclude-standard').filter(f => !f.startsWith('node_modules/')) : [];
  return [...new Set([...versionados, ...novos, ...extra])];
}

/** Linhas ADICIONADAS em todo o histórico do Git (chave que já foi commitada e depois apagada continua vazada). */
function historico() {
  const saida = execFileSync('git', ['log', '-p', '--all', '--no-color', '--unified=0', '--format=@@commit %h'],
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const porCommit = [];
  let atual = null, arquivo = '';
  for (const l of saida.split(/\r?\n/)) {
    if (l.startsWith('@@commit ')) { atual = { nome: '', linhas: [] }; porCommit.push(atual); atual.hash = l.slice(9); continue; }
    if (l.startsWith('+++ b/')) { arquivo = l.slice(6); continue; }
    if (atual && l.startsWith('+') && !l.startsWith('+++') && !BINARIO.test(arquivo)) atual.linhas.push(`${arquivo}\u0000${l.slice(1)}`);
  }
  const arquivos = [];
  for (const c of porCommit) for (const x of c.linhas) {
    const [arq, txt] = x.split('\u0000');
    arquivos.push({ nome: `${c.hash}:${arq}`, texto: txt });
  }
  return arquivos;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--historico')) {
    const achados = procurar(historico());
    if (!achados.length) { console.log('✅ Nenhum segredo no histórico do Git.'); process.exit(0); }
    console.log(`⛔ ${achados.length} possível(is) segredo(s) no histórico (troque a chave — apagar o arquivo não basta):`);
    for (const a of achados) console.log(`   ${a.arquivo}  ${a.tipo}  ${a.amostra}`);
    process.exit(1);
  }
  const todos = process.argv.includes('--todos');
  const nomes = listar(todos);
  const arquivos = [];
  for (const nome of nomes) {
    if (BINARIO.test(nome)) continue;
    const abs = path.join(RAIZ, nome);
    try { if (statSync(abs).size > 2 * 1024 * 1024) continue; arquivos.push({ nome, texto: readFileSync(abs, 'utf8') }); }
    catch { /* apagado no disco */ }
  }
  const envVersionado = nomes.filter(n => /(^|\/)\.env(\..*)?$/.test(n) && !/\.exemplo$|\.example$/.test(n));
  const achados = procurar(arquivos);
  if (!todos) for (const n of envVersionado) achados.push({ arquivo: n, linha: 0, tipo: '.env versionado', amostra: '—' });
  console.log(`🔎 ${arquivos.length} arquivos ${todos ? '(inclusive os ignorados) ' : 'versionados '}conferidos.`);
  if (!achados.length) { console.log('✅ Nenhum segredo encontrado.'); process.exit(0); }
  console.log(`⛔ ${achados.length} possível(is) segredo(s):`);
  for (const a of achados) console.log(`   ${a.arquivo}:${a.linha}  ${a.tipo}  ${a.amostra}`);
  console.log('Tire do arquivo, troque a chave no painel do serviço e use variável de ambiente (.env, fora do Git).');
  process.exit(1);
}
