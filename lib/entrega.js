'use strict';
/* ============================================================
   Entrega de mensagem que não duplica (rodada 4)
   O Render gratuito às vezes dorme no meio do expediente. A tela agora tenta
   de novo sozinha quando o servidor não responde — e ao reabrir a página ela
   retoma as entregas que ficaram pela metade. Para isso não virar mensagem
   repetida no WhatsApp do cliente, o envio passa a carregar o id da linha em
   whatsapp_mensagens e este módulo garante:
   - já saiu (status enviado/entregue/lido)? responde ok sem mandar de novo;
   - já está saindo (outra aba/tentativa)? recusa com 409 em vez de mandar 2×;
   - terminou? grava a situação na própria linha pelo servidor (vale mesmo que
     a aba tenha fechado no meio).
   ============================================================ */

const JA_SAIU = new Set(['enviado', 'entregue', 'lido']);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function criarEntregador({ banco, enviar, agora = () => Date.now(), travaMs = 120_000 } = {}) {
  const emAndamento = new Map();   // mensagemId -> desde

  async function entregar(dados, mensagemId) {
    if (!mensagemId) return { ...(await enviar(dados)), semId: true };
    if (!RE_UUID.test(String(mensagemId))) return { ok: false, status: 400, erro: 'Identificador da mensagem inválido.', codigo: 'mensagem_invalida' };

    const desde = emAndamento.get(mensagemId);
    if (desde && agora() - desde < travaMs) {
      return { ok: false, status: 409, emAndamento: true, codigo: 'ja_saindo', erro: 'Esta mensagem já está saindo — aguarde um instante.' };
    }
    const sb = banco();
    let linha = null;
    if (sb) {
      const { data } = await sb.from('whatsapp_mensagens').select('id,status,direcao,conversa_id').eq('id', mensagemId).maybeSingle();
      linha = data || null;
      if (linha && linha.direcao !== 'saida') return { ok: false, status: 400, erro: 'Só mensagem de saída pode ser enviada.', codigo: 'mensagem_invalida' };
      if (linha && JA_SAIU.has(linha.status)) return { ok: true, jaEnviada: true };
    }
    emAndamento.set(mensagemId, agora());
    try {
      const r = await enviar(dados);
      if (sb && linha && !r.desligado) {
        const status = r.ok ? 'enviado' : 'falhou';
        await sb.from('whatsapp_mensagens').update({ status, erro: r.ok ? null : String(r.erro || 'não saiu').slice(0, 300) })
          .eq('id', mensagemId).then(() => {}, () => {});
      }
      return r;
    } finally {
      emAndamento.delete(mensagemId);
    }
  }

  return { entregar, emAndamento };
}

module.exports = { criarEntregador, JA_SAIU };
