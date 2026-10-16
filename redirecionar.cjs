// IndyCar — este serviço antigo agora SÓ redireciona (16/10/2026).
// O app mora na IndyCar Central: https://indycar-agendamentos.onrender.com/atendimento/
// Todo pedido (qualquer método, caminho e consulta) recebe 308 para o mesmo caminho lá —
// 308 preserva o método e o corpo (POST continua POST). Sem dependências.
// Start command no Render: `node redirecionar.cjs`. Voltar atrás: `node server.js`.
'use strict';
const http = require('node:http');

const CENTRAL = String(process.env.CENTRAL_URL || 'https://indycar-agendamentos.onrender.com').replace(/\/+$/, '');
const PREFIXO = '/atendimento';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function destino(url) {
  let caminho = '/';
  try { const u = new URL(url || '/', 'http://antigo.local'); caminho = u.pathname + u.search; } catch { /* lixo: vai para a raiz do app */ }
  return CENTRAL + PREFIXO + (caminho.startsWith('/') ? caminho : '/' + caminho);
}

const server = http.createServer((req, res) => {
  const para = destino(req.url);
  res.writeHead(308, {
    Location: para,
    // sem cache de propósito: se um dia precisar voltar o app para cá, o navegador não fica preso no 308
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
    'X-IndyCar-App': 'redirecionar',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>IndyCar mudou de endereço</title>` +
    `<p>Este app agora mora na <strong>IndyCar Central</strong>: <a href="${esc(para)}">${esc(para)}</a></p></html>`);
});
server.requestTimeout = 15_000;
server.keepAliveTimeout = 65_000;
if (require.main === module) {
  server.listen(Number(process.env.PORT) || 3000, () => console.log(`IndyCar: redirecionando tudo para ${CENTRAL}${PREFIXO}/ (308)`));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
module.exports = { destino, server };
