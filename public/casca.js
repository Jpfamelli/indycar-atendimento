/* ============================================================
   IndyCar Atendimento — casca.js (rodada 4)
   Service worker (app instalável + casca guardada para quando o servidor
   dorme) e o aviso "versão nova pronta". Nunca recarrega sozinho: o
   atendente pode estar no meio de uma resposta — ele escolhe a hora.
   ============================================================ */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  const tinhaControle = !!navigator.serviceWorker.controller;
  let avisou = false;

  function avisarVersaoNova() {
    if (avisou || !tinhaControle) return;   // primeira instalação não é "versão nova"
    avisou = true;
    const el = document.createElement('div');
    el.className = 'pill-versao';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>✨ Versão nova do Atendimento pronta</span>'
      + '<button type="button" class="pv-ok">Atualizar</button>'
      + '<button type="button" class="pv-x" aria-label="Depois">×</button>';
    el.querySelector('.pv-ok').addEventListener('click', () => location.reload());
    el.querySelector('.pv-x').addEventListener('click', () => el.remove());
    document.body.appendChild(el);
  }

  navigator.serviceWorker.register('sw.js').then((reg) => {
    // confere de tempos em tempos se saiu versão nova (app aberto o dia inteiro)
    setInterval(() => { if (!document.hidden && navigator.onLine !== false) reg.update().catch(() => {}); }, 30 * 60_000);
  }).catch(() => { /* sem service worker o app funciona igual; só não instala */ });
  navigator.serviceWorker.addEventListener('controllerchange', avisarVersaoNova);

  /** Versão da casca guardada (aparece na Ajuda). */
  window.versaoDaCasca = function () {
    return new Promise((resolve) => {
      const sw = navigator.serviceWorker.controller;
      if (!sw) return resolve(null);
      const canal = new MessageChannel();
      const t = setTimeout(() => resolve(null), 1500);
      canal.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data || null); };
      sw.postMessage('versao', [canal.port2]);
    });
  };
})();
