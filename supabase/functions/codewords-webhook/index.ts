// ============================================================
// Webhook do CodeWords — mora no Supabase, no ar 24 horas.
// Recebe a mensagem do cliente e grava no banco; o gatilho
// tocar_conversa() cria/atualiza a conversa, cadastra o cliente
// e abre o lead no CRM. Não depende do PC da oficina.
//
// v6: "Agendamento: <serviço> - <nome> - <data> <hora>" vira cartão
// na agenda NA HORA.
//
// v8: MENSAGEM SÓ DE MÍDIA não é mais recusada. Cliente que manda
// só a FOTO DO CARRO (comum numa oficina) ou um áudio vinha com
// texto vazio e levava 400 — a conversa nunca aparecia no painel.
// Agora vira "🖼 Foto" / "🎤 Áudio" e o atendimento enxerga.
//
// v9: OUVIR/VER A MÍDIA NO PAINEL. Se o CodeWords mandar junto o
// arquivo (media_base64 + media_mime, ou uma media_url pública), a
// gente guarda no Storage e liga na mensagem (anexo/anexo_mime) —
// aí o áudio toca e a foto abre direto no painel, igual às que a
// gente envia. Sem o arquivo, continua só o rótulo "🎤 Áudio".
//
// Segurança: verify_jwt desligado DE PROPÓSITO (o CodeWords não
// fala JWT) — em troca todo POST precisa do x-codewords-token.
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
  let diferenca = A.length ^ B.length;
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    diferenca |= (A[i] ?? 0) ^ (B[i] ?? 0);
  }
  return diferenca === 0;
}

/** Texto vindo de fora: só aceita string/número e corta no limite. */
function texto1(v: unknown, max: number): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return "";
  return String(v).slice(0, max);
}

/* ---------- MÍDIA SEM TEXTO ----------
   Foto, áudio e vídeo chegam com a mensagem vazia e o tipo num campo
   à parte. Vira um recado legível para o painel. */
const ROTULO_MIDIA: Record<string, string> = {
  image: "🖼 Foto", photo: "🖼 Foto", video: "🎬 Vídeo",
  audio: "🎤 Áudio", ptt: "🎤 Áudio", voice: "🎤 Áudio",
  document: "📎 Documento", file: "📎 Documento", sticker: "💬 Figurinha",
  location: "📍 Localização", contact: "👤 Contato", vcard: "👤 Contato",
};

function tipoDeMidia(body: Record<string, unknown>): string {
  return String(
    body.media_type ?? body.mediaType ?? body.tipo_midia ?? body.message_type ??
    body.messageType ?? body.type ?? "",
  ).toLowerCase().trim();
}

function rotuloDeMidia(body: Record<string, unknown>): string {
  const tipo = tipoDeMidia(body);
  if (!tipo || tipo === "text" || tipo === "chat" || tipo === "conversation") {
    // sem tipo declarado, mas com anexo? ainda assim é mídia
    const temAnexo = !!(body.media_url ?? body.mediaUrl ?? body.url ?? body.filename ?? body.file_name);
    return temAnexo ? "📎 Anexo" : "";
  }
  const base = ROTULO_MIDIA[tipo] ?? `📦 ${tipo}`;
  const arq = texto1(body.filename ?? body.file_name ?? body.nome_arquivo, 120).trim();
  // nome gerado pelo WhatsApp (audio_20260825_202724.ogg) não informa nada
  return arq && !/^(audio|image|video|document)_\d{8}/i.test(arq) ? `${base}: ${arq}` : base;
}

/* ---------- ARQUIVO DA MÍDIA (v9) ----------
   O CodeWords/Carlos pode mandar o arquivo junto de três jeitos:
   base64 (media_base64), data-url ("data:audio/ogg;base64,..."), ou
   uma URL pública (media_url). A gente aceita qualquer um. */
const MIME_POR_EXT: Record<string, string> = {
  ogg: "audio/ogg", opus: "audio/ogg", oga: "audio/ogg",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/mp4", wav: "audio/wav",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", pdf: "application/pdf", mp4: "video/mp4", "3gp": "video/3gpp",
};
const MIME_POR_TIPO: Record<string, string> = {
  audio: "audio/ogg", ptt: "audio/ogg", voice: "audio/ogg",
  image: "image/jpeg", photo: "image/jpeg", video: "video/mp4",
  document: "application/octet-stream", file: "application/octet-stream",
};

function mimeDaMidia(body: Record<string, unknown>, nomeArq: string): string {
  const declarado = texto1(
    body.media_mime ?? body.mediaMime ?? body.mimetype ?? body.mime_type ??
    body.content_type ?? body.contentType, 100).trim().toLowerCase();
  if (declarado && declarado.includes("/")) return declarado.split(";")[0];
  const ext = (nomeArq.split(".").pop() || "").toLowerCase();
  if (MIME_POR_EXT[ext]) return MIME_POR_EXT[ext];
  return MIME_POR_TIPO[tipoDeMidia(body)] ?? "application/octet-stream";
}

function base64ParaBytes(b64: string): Uint8Array {
  const limpo = b64.includes(",") && /^data:/i.test(b64) ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(limpo.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Devolve os bytes da mídia (de base64 ou baixando a media_url), ou null. */
async function bytesDaMidia(body: Record<string, unknown>): Promise<
  { bytes: Uint8Array; mime: string; nome: string } | null
> {
  const nome = texto1(body.filename ?? body.file_name ?? body.nome_arquivo, 120).trim() ||
    `midia-${Date.now()}`;
  const b64 = body.media_base64 ?? body.mediaBase64 ?? body.audio_base64 ??
    body.file_base64 ?? body.base64 ?? body.arquivo_base64;
  try {
    if (typeof b64 === "string" && b64.length > 32) {
      const bytes = base64ParaBytes(b64);
      if (bytes.length) return { bytes, mime: mimeDaMidia(body, nome), nome };
    }
    // só busca URL se for http(s) público — nunca endereço interno de cluster
    const u = texto1(body.media_url ?? body.mediaUrl, 500).trim();
    if (/^https?:\/\//i.test(u) && !/\.svc\.cluster\.local|localhost|127\.0\.0\.1|\.internal/i.test(u)) {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (r.ok) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length) {
          const mime = (r.headers.get("content-type") || "").split(";")[0] || mimeDaMidia(body, nome);
          return { bytes, mime, nome };
        }
      }
    }
  } catch { /* mídia é bônus: se falhar, a mensagem já entrou com o rótulo */ }
  return null;
}

const EXT_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "application/pdf": "pdf", "video/mp4": "mp4",
};
function nomeSeguro(nome: string, mime: string): string {
  let n = nome.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(0, 80) || "midia";
  if (!/\.[a-z0-9]{2,4}$/i.test(n)) n += "." + (EXT_POR_MIME[mime] || "bin");
  return n;
}

/** Guarda no máximo 4 KB do payload na auditoria (sem o base64, que é enorme). */
function recortarPayload(body: unknown): unknown {
  try {
    const limpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (/base64|_b64$/i.test(k)) { limpo[k] = `[${String(v).length} bytes omitidos]`; continue; }
      limpo[k] = v;
    }
    const t = JSON.stringify(limpo);
    return t.length > 4000 ? { recortado: true, inicio: t.slice(0, 4000) } : limpo;
  } catch { return { erro: "payload não serializável" }; }
}

// Base64 de uma foto de 5 MB dá ~7 MB. 15 MB cobre qualquer mídia de WhatsApp.
const LIMITE_CORPO = 15 * 1024 * 1024;

/* ============================================================
   DETECTOR DE PROPAGANDA
   ============================================================ */
const SINAIS_PROPAGANDA: Array<[RegExp, string]> = [
  [/de\s*~?\s*r\$\s*[\d.,]+\s*~?[\s\S]{0,40}por\s*\*?\s*r\$/i, "preço riscado"],
  [/~\s*r\$\s*[\d.,]+\s*~/i, "preço riscado"],
  [/\bpor\s*\*\s*r\$\s*[\d.,]+/i, "preço em destaque"],
  [/\bcupom\b|\bcupons\b/i, "cupom"],
  [/\b\d{1,2}\s*%\s*(de\s*)?off\b/i, "percentual OFF"],
  [/(amzn\.to|amazon\.com|shopee\.|shope\.ee|s\.shopee|mercadolivre|mercadolibre|magazinevoce|magazineluiza|ml\.com\.br|shp\.ee)/i, "link de loja"],
  [/frete\s*gr[áa]tis/i, "frete grátis"],
  [/[úu]ltimas?\s*unidades?/i, "últimas unidades"],
  [/\boferta\s*(rel[âa]mpago|exclusiva|do\s*dia)\b/i, "oferta relâmpago"],
  [/\bpre[çc]inho\b/i, "precinho"],
  [/corre+\s*(que|pra)\b|vai\s*correndo/i, "chamada de urgência"],
  [/promo[çc][ãa]o\s*(rel[âa]mpago|imperd[íi]vel)/i, "promoção imperdível"],
];

/** Dois sinais independentes = propaganda. Um só pode ser coincidência. */
function cheiroDePropaganda(texto: string): string[] {
  const achados = new Set<string>();
  for (const [re, nome] of SINAIS_PROPAGANDA) {
    if (re.test(texto)) achados.add(nome);
  }
  return [...achados];
}

/** Mesma normalização do banco: tira o DDI 55 quando ele é DDI mesmo. */
function normalizarTelefone(v: string): string {
  return v.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
}

Deno.serve(async (req: Request) => {
  const json = (code: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), {
      status: code,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });

  if (req.method === "GET") return json(200, { ok: true, versao: 9 });
  if (req.method !== "POST") return json(405, { erro: "use POST" });

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
                          body.sender || body.wa_id || body.tel, 40);
  const escrito  = texto1(body.mensagem || body.message || body.text || body.corpo ||
                          body.body, 4000).trim();
  // sem texto? pode ser foto/áudio — vira recado em vez de virar erro 400
  const texto    = escrito || rotuloDeMidia(body);
  const nome     = texto1(body.nome || body.name || body.pushname || body.contact_name, 120) || null;

  if (!telefone || !texto) {
    await registrarEvento({ direcao: "entrada", sucesso: false,
      resumo: "faltou telefone ou texto", payload: recortarPayload(body) });
    return json(400, { erro: "informe telefone e mensagem", recebido: Object.keys(body).slice(0, 20) });
  }

  /* ---------- GRUPO DO WHATSAPP ----------
     Grupo não é cliente: não vira conversa, não vira lead e a IA não lê. */
  const cru = String(body.telefone ?? body.phone ?? body.from ?? body.chat_id ??
                     body.chatId ?? body.remote_jid ?? body.remoteJid ?? telefone);
  const soNumeros = cru.replace(/\D/g, "");
  const ehGrupo =
    /@g\.us/i.test(cru) ||
    /@broadcast|@newsletter|status@/i.test(cru) ||
    (cru.includes("-") && soNumeros.length > 13) ||
    soNumeros.length > 15 ||
    body.isGroup === true || body.is_group === true || body.group === true ||
    body.participant != null || body.group_id != null ||
    String(body.chat_type ?? body.chatType ?? "").toLowerCase() === "group";

  if (ehGrupo) {
    await registrarEvento({ direcao: "entrada", sucesso: false, telefone,
      resumo: texto.slice(0, 120),
      erro: "mensagem de grupo ou lista — ignorada de propósito (não é cliente)" });
    return json(200, { ok: true, ignorado: "grupo" });
  }

  /* ---------- NÚMERO BLOQUEADO ---------- */
  const { data: bloqueio } = await sb.from("numeros_bloqueados")
    .select("nome,motivo").eq("telefone", normalizarTelefone(telefone)).maybeSingle();

  if (bloqueio) {
    await registrarEvento({ direcao: "entrada", sucesso: false, telefone,
      resumo: texto.slice(0, 120),
      erro: `número bloqueado (${bloqueio.nome || "sem nome"}) — ${bloqueio.motivo || "não é cliente"}` });
    return json(200, { ok: true, ignorado: "bloqueado" });
  }

  /* ---------- PROPAGANDA ---------- */
  const sinais = cheiroDePropaganda(texto);
  if (sinais.length >= 2) {
    try {
      await sb.from("numeros_bloqueados").upsert({
        telefone: normalizarTelefone(telefone),
        nome: nome || "Disparo de propaganda",
        motivo: `Bloqueado sozinho — texto de propaganda (${sinais.join(", ")})`,
      }, { onConflict: "telefone" });
    } catch { /* se não gravar, ao menos esta mensagem já foi barrada */ }

    await registrarEvento({ direcao: "entrada", sucesso: false, telefone,
      resumo: texto.slice(0, 120),
      erro: `propaganda detectada (${sinais.join(", ")}) — número bloqueado automaticamente` });
    return json(200, { ok: true, ignorado: "propaganda", sinais });
  }

  /* DIREÇÃO — o Carlos repassa TAMBÉM o que ele mesmo responde. */
  const pista = String(
    body.direcao ?? body.direction ?? body.sender_type ?? body.origem_mensagem ?? "",
  ).toLowerCase();
  const deMim = body.from_me === true || body.fromMe === true ||
                body.is_from_me === true || body.self === true ||
                body.echo === true || body.outgoing === true ||
                /sa[ií]da|out|outgoing|bot|agent|assistant|system/.test(pista);
  const direcao = deMim ? "saida" : "entrada";

  const { data: inserida, error } = await sb.from("whatsapp_mensagens").insert({
    telefone, nome, corpo: texto,
    direcao, status: deMim ? "enviado" : "recebido",
    gerada_por_ia: deMim,
    wamid: texto1(body.wamid || body.message_id, 120) || null,
  }).select("id, conversa_id").maybeSingle();

  // 23505 = a sincronia do servidor JÁ tinha gravado esta mensagem (mesmo
  // wamid). Não é erro: seguimos para anexar a mídia na mensagem existente.
  if (error && error.code !== "23505") {
    await registrarEvento({ direcao: "entrada", sucesso: false, telefone,
      resumo: "falha ao gravar", erro: error.message, payload: recortarPayload(body) });
    return json(500, { erro: error.message });
  }
  const jaExistia = !!error && error.code === "23505";

  /* ---------- ARQUIVO DA MÍDIA (v9) ----------
     Se veio o arquivo, guarda no Storage e liga na mensagem. É bônus:
     qualquer erro aqui não derruba a mensagem, que já entrou.
     Corrida com a sincronia do servidor: se a mensagem JÁ existia (mesmo
     wamid), a inserção acima foi descartada pela porteira anti-duplicata —
     então achamos a existente pelo wamid e anexamos NELA, para o áudio não
     se perder por causa de qual caminho chegou primeiro. */
  let midiaSalva = false;
  {
    const wamid = texto1(body.wamid || body.message_id, 120) || null;
    let alvo: { id: string; conversa_id: string } | null =
      (inserida?.id && inserida?.conversa_id)
        ? { id: String(inserida.id), conversa_id: String(inserida.conversa_id) }
        : null;
    if (!alvo && wamid) {
      const { data: ja } = await sb.from("whatsapp_mensagens")
        .select("id, conversa_id").eq("wamid", wamid)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (ja?.id && ja?.conversa_id) alvo = { id: String(ja.id), conversa_id: String(ja.conversa_id) };
    }
    if (alvo) {
      const midia = await bytesDaMidia(body);
      if (midia) {
        try {
          const caminho = `${alvo.conversa_id}/${Date.now()}-${nomeSeguro(midia.nome, midia.mime)}`;
          const up = await sb.storage.from("anexos").upload(caminho, midia.bytes, {
            contentType: midia.mime, upsert: true,
          });
          if (!up.error) {
            await sb.from("whatsapp_mensagens").update({ anexo: caminho, anexo_mime: midia.mime })
              .eq("id", alvo.id);
            midiaSalva = true;
          }
        } catch { /* mídia é bônus */ }
      }
    }
  }

  /* ---------- AGENDAMENTO INSTANTÂNEO ----------
     Só para mensagem NOVA — se já existia (23505), a agenda já foi tratada. */
  let agendamentoCriado: string | null = null;
  const ag = jaExistia ? null : texto.match(/^\s*agendamento:\s*(.+?)\s*-\s*(.+)\s*-\s*(\d{4}-\d{2}-\d{2})[T ]+(\d{1,2}:\d{2})/i);
  if (ag) {
    try {
      const servico = ag[1].trim(), nomeAg = ag[2].trim(), dataAg = ag[3];
      const hora = ag[4].padStart(5, "0") + ":00";
      const tel8 = normalizarTelefone(telefone).slice(-8);
      const { data: mesmoHorario } = await sb.from("agendamentos")
        .select("id, telefone, cliente_nome").eq("data", dataAg).eq("hora", hora).limit(50);
      const repetido = (mesmoHorario || []).some((a) =>
        (tel8 && String(a.telefone || "").replace(/\D/g, "").slice(-8) === tel8) ||
        String(a.cliente_nome || "").trim().toLowerCase() === nomeAg.toLowerCase());
      if (repetido) {
        agendamentoCriado = "ja-existia";
      } else {
        const { error: erroAg } = await sb.from("agendamentos").insert({
          cliente_nome: nomeAg, telefone: telefone.replace(/\D/g, ""),
          servico, data: dataAg, hora,
          origem: "whatsapp", status: "confirmado", confirmado: true,
        });
        if (erroAg) throw new Error(erroAg.message);
        agendamentoCriado = `${nomeAg} — ${servico} ${dataAg} ${ag[4]}`;
        await registrarEvento({ direcao: "entrada", sucesso: true, telefone,
          resumo: `⚡ agendamento criado NA HORA: ${agendamentoCriado}` });
      }
    } catch (e) {
      await registrarEvento({ direcao: "entrada", sucesso: false, telefone,
        resumo: "agendamento instantâneo falhou (importador pega depois)",
        erro: e instanceof Error ? e.message : String(e) });
    }
  }

  await sb.from("codewords_config")
    .update({ ultimo_evento_em: new Date().toISOString(), ultimo_erro: null })
    .eq("id", true);
  await registrarEvento({ direcao: "entrada", sucesso: true,
    telefone, resumo: (midiaSalva ? "▶ " : "") + texto.slice(0, 120), payload: recortarPayload(body) });

  return json(200, {
    ok: true,
    ...(midiaSalva ? { midia: "salva" } : {}),
    ...(agendamentoCriado ? { agendamento: agendamentoCriado } : {}),
  });
});
