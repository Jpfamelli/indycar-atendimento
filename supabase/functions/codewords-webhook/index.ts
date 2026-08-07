// ============================================================
// Webhook do CodeWords — mora no Supabase, no ar 24 horas.
// Recebe a mensagem do cliente (via CodeWords) e grava no banco;
// o gatilho tocar_conversa() cria/atualiza a conversa e o painel
// recebe tudo em tempo real. Não depende do PC da oficina.
//
// Segurança: verify_jwt está desligado DE PROPÓSITO porque o
// CodeWords não fala JWT — em troca, todo POST precisa do
// x-codewords-token igual ao gravado em codewords_config.
//
// Este arquivo é uma CÓPIA de registro. A versão que roda está
// publicada no projeto nppfqhavqahapmugnyng (função codewords-webhook).
// Para republicar depois de mudar algo, use o MCP do Supabase ou:
//   supabase functions deploy codewords-webhook --no-verify-jwt
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function registrarEvento(dados: Record<string, unknown>) {
  try { await sb.from("codewords_eventos").insert(dados); } catch { /* log é melhor esforço */ }
}

/** Compara segredos sem dar pista pelo tempo de resposta. */
function segredosIguais(a: unknown, b: string): boolean {
  const A = new TextEncoder().encode(String(a ?? ""));
  const B = new TextEncoder().encode(b);
  // percorre o comprimento inteiro sempre, mesmo com tamanhos diferentes
  let diferenca = A.length ^ B.length;
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    diferenca |= (A[i] ?? 0) ^ (B[i] ?? 0);
  }
  return diferenca === 0;
}

/** Texto vindo de fora: só aceita string/número e corta no limite.
    Objetos e arrays viram vazio, para não quebrar o insert nem gravar lixo. */
function texto1(v: unknown, max: number): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return "";
  return String(v).slice(0, max);
}

/** Guarda no máximo 4 KB do payload na auditoria. */
function recortarPayload(body: unknown): unknown {
  try {
    const t = JSON.stringify(body);
    return t.length > 4000 ? { recortado: true, inicio: t.slice(0, 4000) } : body;
  } catch { return { erro: "payload não serializável" }; }
}

const LIMITE_CORPO = 64 * 1024;   // 64 KB já é folgado para uma mensagem de WhatsApp

Deno.serve(async (req: Request) => {
  const json = (code: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), {
      status: code,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });

  // Alguns serviços validam a URL com GET antes de começar a mandar
  if (req.method === "GET") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { erro: "use POST" });

  // Teto de tamanho: sem isto, um POST gigante entraria inteiro no banco
  const tamanho = Number(req.headers.get("content-length") || 0);
  if (tamanho > LIMITE_CORPO) return json(413, { erro: "mensagem grande demais" });

  let body: Record<string, unknown> = {};
  try {
    const bruto = await req.text();
    if (bruto.length > LIMITE_CORPO) return json(413, { erro: "mensagem grande demais" });
    body = bruto ? JSON.parse(bruto) : {};
    if (typeof body !== "object" || body === null || Array.isArray(body)) body = {};
  } catch { body = {}; }

  const { data: cfg, error: erroCfg } = await sb.from("codewords_config")
    .select("token_webhook").maybeSingle();

  // Confere o segredo combinado (cabeçalho ou campo no corpo).
  // FECHA quando não há token configurado ou a leitura falhou — o contrário
  // deixaria esta função, que é pública 24h, aberta para qualquer um.
  const enviado = req.headers.get("x-codewords-token") ||
                  req.headers.get("x-webhook-token") ||
                  (typeof body.token === "string" ? body.token : undefined);
  const esperado = typeof cfg?.token_webhook === "string" ? cfg.token_webhook.trim() : "";
  if (erroCfg || !esperado || !segredosIguais(enviado, esperado)) {
    await registrarEvento({ direcao: "entrada", sucesso: false,
      resumo: esperado ? "token inválido" : "webhook sem token configurado",
      erro: erroCfg ? "não consegui ler a configuração"
                    : (esperado ? "x-codewords-token não confere"
                                : "defina o Token do webhook em Configurações"),
      payload: recortarPayload(body) });
    return json(401, { erro: "token inválido" });
  }

  // Aceita formatos diferentes para não travar na variação do CodeWords
  const telefone = texto1(body.telefone || body.phone || body.from || body.numero ||
                          body.sender || body.wa_id, 40);
  const texto    = texto1(body.mensagem || body.message || body.text || body.corpo ||
                          body.body, 4000);
  const nome     = texto1(body.nome || body.name || body.pushname || body.contact_name, 120) || null;

  if (!telefone || !texto) {
    await registrarEvento({ direcao: "entrada", sucesso: false,
      resumo: "faltou telefone ou texto", payload: recortarPayload(body) });
    return json(400, { erro: "informe telefone e mensagem", recebido: Object.keys(body).slice(0, 20) });
  }

  /* ---------- GRUPO DO WHATSAPP ----------
     Grupo não é cliente: não vira conversa, não vira lead e a IA não lê.
     O id de grupo termina em @g.us, tem hífen no formato antigo, ou é um
     número longo demais para ser telefone. Alguns provedores também mandam
     "participant"/"isGroup" quando a mensagem veio de um grupo. */
  const cru = String(body.telefone ?? body.phone ?? body.from ?? body.chat_id ??
                     body.chatId ?? body.remote_jid ?? body.remoteJid ?? telefone);
  const soNumeros = cru.replace(/\D/g, "");
  const ehGrupo =
    /@g\.us/i.test(cru) ||
    /@broadcast|status@/i.test(cru) ||
    (cru.includes("-") && soNumeros.length > 13) ||
    soNumeros.length > 15 ||
    body.isGroup === true || body.is_group === true || body.group === true ||
    body.participant != null || body.group_id != null ||
    String(body.chat_type ?? body.chatType ?? "").toLowerCase() === "group";

  if (ehGrupo) {
    await registrarEvento({ direcao: "entrada", sucesso: false, telefone,
      resumo: texto.slice(0, 120),
      erro: "mensagem de grupo — ignorada de propósito (grupo não é cliente)" });
    return json(200, { ok: true, ignorado: "grupo" });
  }

  /* ---------- NÚMERO BLOQUEADO ----------
     Listas de transmissão de propaganda entupiam o painel e criariam lead
     no CRM. O dono gerencia a lista na aba Integrações. */
  const { data: bloqueio } = await sb.from("numeros_bloqueados")
    .select("nome,motivo").eq("telefone", telefone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, ""))
    .maybeSingle();

  if (bloqueio) {
    await registrarEvento({ direcao: "entrada", sucesso: false, telefone,
      resumo: texto.slice(0, 120),
      erro: `número bloqueado (${bloqueio.nome || "sem nome"}) — ${bloqueio.motivo || "não é cliente"}` });
    return json(200, { ok: true, ignorado: "bloqueado" });
  }

  /* DIREÇÃO — o Carlos repassa TAMBÉM o que ele mesmo responde, e sem isto
     tudo entrava como se fosse fala do cliente: o atendente via a saudação
     da IA como se o cliente tivesse escrito, e a classificação lia errado.
     Procuramos qualquer pista no payload; na dúvida, tratamos como entrada. */
  const pista = String(
    body.direcao ?? body.direction ?? body.tipo ?? body.type ??
    body.sender_type ?? body.origem_mensagem ?? "",
  ).toLowerCase();
  const deMim = body.from_me === true || body.fromMe === true ||
                body.is_from_me === true || body.self === true ||
                body.echo === true || body.outgoing === true ||
                /sa[ií]da|out|outgoing|bot|agent|assistant|system/.test(pista);
  const direcao = deMim ? "saida" : "entrada";

  const { error } = await sb.from("whatsapp_mensagens").insert({
    telefone, nome, corpo: texto,
    direcao, status: deMim ? "enviado" : "recebido",
    gerada_por_ia: deMim,
    wamid: texto1(body.wamid || body.message_id, 120) || null,
  });

  if (error) {
    await registrarEvento({ direcao: "entrada", sucesso: false, telefone,
      resumo: "falha ao gravar", erro: error.message, payload: recortarPayload(body) });
    return json(500, { erro: error.message });
  }

  await sb.from("codewords_config")
    .update({ ultimo_evento_em: new Date().toISOString(), ultimo_erro: null })
    .eq("id", true);
  // Guarda o payload também quando dá certo: é a única forma de descobrir
  // quais campos o CodeWords manda (ex.: se existe marca de direção).
  await registrarEvento({ direcao: "entrada", sucesso: true,
    telefone, resumo: texto.slice(0, 120), payload: recortarPayload(body) });

  return json(200, { ok: true });
});
