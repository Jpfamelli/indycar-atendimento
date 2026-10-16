# IndyCar — Central de Atendimento

App de atendimento por WhatsApp, ligado ao mesmo banco do CRM e da Agenda.

---

## 🔑 Entrar

```
http://localhost:3200
```

Entre com o seu e-mail e senha. Quem ainda não tem acesso pede ao
administrador, que convida pela tela **Equipe** (o sistema gera uma senha
temporária, mostrada uma vez só, e pede uma senha nova no primeiro acesso).

> 🔒 Senha não fica escrita em arquivo nenhum (a varredura `npm run segredos`
> recusa). Até 13/10/2026 havia uma senha inicial anotada aqui — se ela ainda
> valer em algum login, troque.

## ▶️ Rodar

```bash
cd indycar-atendimento
node server.js
```

---

## ⚡ Atalhos de mensagem — digite `/`

No campo de resposta, digite **`/`** e o menu abre com as mensagens prontas.

- `/pn` já filtra para `/pneus` — não precisa digitar tudo
- **↑ ↓** escolhem, **Enter** usa, **Esc** fecha
- As variáveis são trocadas na hora: `{primeiro_nome}` vira *Camila*, `{carro}` vira *Corolla 2020*

Já vêm 14 prontos: `/bomdia` `/boatarde` `/endereco` `/orcamento` `/levaetraz`
`/pneus` `/cambio` `/confirmar` `/lembrete` `/prontoretirar` `/parcelamento`
`/avaliacao` `/garantia` `/aguarde`

Para criar ou mudar: aba **Atalhos**. Variáveis disponíveis:
`{nome}` `{primeiro_nome}` `{carro}` `{placa}` `{servico}` `{horario}` `{consultor}` `{atendente}`

## 📅 Agendar direto da conversa

Botão **Agendar** no topo do chat. Ao confirmar, o sistema cria de uma vez:

1. O **cliente** (ou reaproveita o cadastro, se o telefone já existir)
2. O **lead no CRM** — com a origem, o serviço e o valor previsto
3. O **horário na Agenda**, amarrado a esse lead

E ainda deixa a mensagem de confirmação pronta no campo, com data e serviço preenchidos.

Quando o serviço for concluído na Agenda, **o CRM fecha o lead sozinho com o valor
real cobrado**. Testado: orçado R$ 890 → cobrado R$ 965 → o CRM registrou R$ 965.

## 🔗 CodeWords (entrega no WhatsApp)

O CodeWords é quem conversa com o WhatsApp. Este painel administra os leads
e manda as mensagens através dele.

**Já está tudo configurado e LIGADO** (aba *Configurações* → cartão **CodeWords**):

| Campo | Valor |
|---|---|
| Service ID do fluxo | `indycar_carlos_whatsapp_e3cd01d3` — o fluxo **Carlos** |
| Chave de API | salva (aparece mascarada: `••••••••fe59`) |
| URL de envio | em branco de propósito — montamos `https://runtime.codewords.ai/run/<service id>` sozinhos |
| Token do webhook | gerado — cole o mesmo valor no CodeWords |

Os dois fluxos conhecidos ficam registrados na tabela `codewords_fluxos`:
- **Carlos — Indycar Centro Automotivo** (`indycar_carlos_whatsapp_e3cd01d3`) → envio de mensagens
- **Indycar — Banco de Agendamentos** (`indycar_agendamentos_db_6657a75c`) → referência

> ⛔ **Situação em 09/10/2026 — chave recusada (401):** desde 01/10 o CodeWords
> recusa a chave `cwk-…` com **401** e **nenhum WhatsApp entra nem sai** até
> trocar a chave. O painel mostra isso de três jeitos:
> 1. a **faixa laranja no topo** ("WhatsApp parado: a chave do CodeWords foi
>    recusada (401). Troque em Configurações › Integrações"), lida de
>    `vigia_estado` pelo robô vigia (`GET /api/saude`);
> 2. ao tentar enviar, o aviso diz exatamente isso (não mais "erro genérico");
> 3. em **Integrações › Chave de API do CodeWords**: botão **Testar chave**
>    (não gasta cota — só lista as conexões) e campo para **colar a chave nova**.
>    A troca grava nos **dois** lugares que leem a chave: `codewords_config.api_key`
>    (este painel) e `agenda_ia_config.cw_api_key` (a Agenda). Se o CodeWords
>    recusar a nova, nada é salvo. A chave inteira **nunca** volta para o
>    navegador — só a máscara `••••••••943a`.

**No CodeWords**, mande as mensagens recebidas para o endereço abaixo
(o mesmo aparece na tela, com botão *Copiar*):

```
https://nppfqhavqahapmugnyng.supabase.co/functions/v1/codewords-webhook
```

junto com o cabeçalho **`x-codewords-token`** = o *Token do webhook* da tela.

> 💡 Esse endereço é uma **Edge Function do Supabase**: fica no ar 24 horas,
> **mesmo com o computador da oficina desligado**. Não precisa de túnel,
> ngrok nem abrir porta — testamos por fora: mensagem sem o token é
> recusada (401) e com o token vira conversa no painel na hora.
> (O endereço antigo `http://localhost:3200/api/webhook/codewords` continua
> funcionando para testes locais.)

O webhook aceita nomes variados de campo (`telefone`/`phone`/`from`,
`mensagem`/`message`/`text`) para encaixar no formato que o CodeWords mandar.

Tudo que entra e sai fica registrado na tabela `codewords_eventos` — dá para
auditar quando algo não chegar. O código-fonte da função fica em
`supabase/functions/codewords-webhook/index.ts` (cópia de registro).

### 🔒 Proteção das rotas que gastam dinheiro

As rotas `/api/enviar`, `/api/codewords/testar` e `/api/ia/sugerir` agora
**exigem atendente logado e ativo** (o navegador manda o token do login
sozinho). Sem login: `401`. Assim, mesmo que um dia o painel seja exposto
na internet, ninguém dispara mensagens pelo seu CodeWords nem gasta sua IA.

## O que já funciona

### Aba **Conversas**
- Lista das conversas, com não lidas, situação (aberta / pendente / resolvida) e busca
- Chat com histórico por dia, envio por **Enter** (Shift+Enter quebra linha)
- **Mensagem nova aparece sozinha na tela** (tempo real, sem apertar F5)
- Botão **+ Nova** para começar uma conversa digitando o telefone

### Ficha do cliente (coluna da direita) — *a integração*
Assim que a conversa é aberta, o app mostra, do mesmo cliente:
- Quanto **já gastou**, quantos **serviços fez**, quantas vezes **faltou**
- **Próximo horário marcado** (vindo da Agenda)
- **Revisão**: último serviço concluído e a **próxima revisão prevista**
  (prazo das regras do Comunicar casando com o nome do serviço; sem regra, 6 meses).
  Atrasou? Aparece em vermelho na ficha e no topo do chat.
- Carro, placa, origem, desde quando é cliente e **aniversário** (dá para editar;
  "só dia e mês" grava o ano 1904, o combinado do ecossistema)
- Chave **"Aceita mensagens automáticas"**: desligada, mostra desde quando e o
  motivo — e o Comunicar pula esse cliente
- **Mensagens automáticas**: as 5 últimas da fila do Comunicar (tipo, situação,
  data, resposta 👍/👎/🔕) e o link *Abrir no Comunicar*
- Últimos **leads do CRM** com status e valor
- Últimos **agendamentos** com consultor e valor

> A parte do Comunicar vem pela rota `GET /api/clientes/:id/ficha` (exige login;
> o servidor lê `posvenda_envios` e `comunicar_regras_retorno` com a chave de
> serviço, porque essas tabelas não têm leitura pelo navegador).

### Lista de conversas
- Busca por **nome, telefone (com ou sem +55) ou placa/carro** (`abc-1d23` acha `ABC1D23`)
- Filtro **✉ Não lidas** e botão **✉ Não lida** no chat (deixa para depois sem perder)
- Cada conversa mostra o carro/placa e plaquinhas 🎂 (aniversário hoje) e 🔕 (sem mensagens automáticas)
- **Rascunho por conversa**: o que você digitou e não enviou volta quando reabre
- Mensagem nova **não pula a tela** se você estiver lendo lá em cima — aparece "↓ Novas mensagens"
- Tempo real caiu? Pílula "⟳ Reconectando…" e volta sozinho
- Atalhos (`/`) já mostram a **prévia com as variáveis trocadas**; novas: `{ultimo_servico}` e `{proxima_revisao}`

### Barra lateral — Ecossistema IndyCar
Um seletor abre os outros sistemas (Agenda, CRM, Comunicar, Orçador, Site) em
nova aba; o atual aparece marcado.

> O cliente é reconhecido pelo telefone. `(12) 99999-8888`,
> `+55 12 99999-8888` e `5512999998888` são a mesma pessoa.
> Se ele já existe no CRM ou na Agenda, a conversa se liga ao cadastro sozinha.

### Aba **Inteligência Artificial**
- Botão **✨ Sugerir** no chat: a IA lê o histórico da conversa **e a ficha do
  cliente** (o que ele já gastou, se tem horário marcado) e escreve a resposta
- A sugestão cai no campo de texto — **você revisa e só então envia**
- Campo de teste para experimentar sem mexer em conversa real
- A IA já sabe: endereço, horários, serviços, garantia, leva e traz,
  especialidade em câmbio automático, parcelamento em 10x

### Aba **Configurações**
- Seu perfil (nome)
- **WhatsApp Cloud API** (só admin) — o token nunca volta para a tela, só a máscara
- Lista da equipe

---

## ⚙️ Falta configurar

### 1. Chave da IA (para a aba de IA funcionar)
Abra o arquivo `.env` desta pasta e preencha:

```
ANTHROPIC_API_KEY=sua-chave-aqui
```

Pegue em: https://console.anthropic.com/settings/keys
Depois reinicie o servidor.

### 2. Chave do CodeWords (para as mensagens saírem)
O caminho até o WhatsApp **já está pronto e ligado** — entrada pela Edge
Function, saída pelo aparelho pareado. O que trava hoje é a **chave recusada
(401)**: abra **Integrações › Chave de API do CodeWords**, clique em *Testar
chave* para confirmar, pegue a chave nova no painel do CodeWords e cole em
*Testar e salvar*. A faixa laranja some sozinha quando o vigia confirmar.

> **WhatsApp Cloud API da Meta:** o cartão existe em *Configurações*, mas
> continua **não implementado** — é um caminho alternativo, para o caso de
> você um dia querer falar com a Meta direto, sem o CodeWords. Não precisa
> preencher nada ali para o sistema funcionar.

### 3. Proteção contra senha vazada (recomendado)
No painel: **Authentication → Policies → Password protection** →
ative *"Check against HaveIBeenPwned"*.

---

## 👥 Equipe (a central de pessoas do ecossistema)

O Atendimento é onde o **admin gerencia as pessoas** de todos os apps IndyCar
(o gestor só vê). Na tela **Equipe**: convidar (senha temporária gerada pelo
servidor, mostrada **uma vez**), mudar papel / apps / equipe / cargo / rodízio,
desativar (derruba o acesso na hora) e reativar, gerar senha nova, tirar a
verificação em duas etapas de quem perdeu o celular, ver último acesso e quem
tem verificação em duas etapas. Tudo fica na **auditoria**.

Papéis: `admin` (tudo), `gestor` (vê equipe, relatórios, carga, sem dono;
apaga conversa), `atendente`, `agenda` (só a Agenda — aqui não entra).
Cada pessoa só entra nos apps marcados em `perfis.apps` (admin entra em todos).

> ⚠️ O papel `gestor` depende de uma troca na base (`perfis_papel_check` ainda
> não aceita 'gestor'): proposta em `scripts/sql/2026-10-13_PROPOSTA_base_rodizio_e_gestor.sql`.

---

## 🔒 Como a segurança funciona

- O navegador usa a **chave publicável** — ela é pública de propósito
- Quem protege os dados é o **login + RLS** do banco: sem estar logado
  e ativo, nenhuma linha é lida
- A **chave da IA nunca vai para o navegador** — fica no servidor
- Configurações sensíveis (token do WhatsApp) só para quem é **admin**
- O `.env` está no `.gitignore`
- **Servidor (rodada 3):** porteiro em toda rota (ativo + papel de equipe + app
  Atendimento + verificação em duas etapas), CSP com hash dos scripts, HSTS na
  nuvem, CORS só para os apps IndyCar, limites por IP e por pessoa, JSON inválido
  = 400, erro sem detalhe interno (só um código para o suporte), auditoria das
  ações sensíveis, `npm run segredos` (arquivos versionados) e
  `npm run segredos:historico` (todo o histórico do Git), `npm audit` sem alertas.

---

## Onde fica cada coisa

| Arquivo | O quê |
|---|---|
| `server.js` | Entrega a interface, faz a ponte com a Claude e as rotas `/api/*` |
| `lib/comunicar.js` | Regras puras: próxima revisão, máscara/teste da chave, textos de erro, resumo do Comunicar |
| `test/comunicar.test.js` | Testes dessas regras (`npm test`) |
| `scripts/mock-server.mjs` | Servidor de MENTIRA (`npm run mock`, porta 3211): a tela real com dados inventados, sem login |
| `scripts/conferir-ficha-real.mjs` | Conferência só-leitura da ficha contra o banco real (usa o `.env`) |
| `public/index.html` | Telas (login, conversas, IA, configurações) |
| `public/styles.css` | Visual IndyCar (preto / vermelho / branco), tema claro e escuro |
| `public/app.js` | Toda a lógica: login, conversas, tempo real, ficha, IA |
| `MELHORIAS.md` | Registro numerado do que mudou em cada rodada |
| `.env` | Configuração (não vai para o Git) |

### Rotas novas (todas exigem login; as de chave exigem admin)
| Rota | Para quê |
|---|---|
| `GET /api/saude` | O que o vigia acusa (`problema`, `desde`, `texto`) — alimenta a faixa do topo |
| `GET /api/clientes/:id/ficha` | Aniversário, opt-out, último serviço, próxima revisão, 5 últimas mensagens automáticas |
| `GET /api/codewords/chave` | Máscara da chave e se Atendimento e Agenda estão com a mesma |
| `POST /api/codewords/testar-chave` | Testa a chave salva (ou uma colada) sem gastar cota |
| `POST /api/codewords/chave` | Testa e grava a chave nova nas duas tabelas |
| `GET /api/relatorios` | Ganhou o bloco `comunicar` (enviadas, respondidas, pediram para parar) |

### Testar sem a senha de ninguém
```bash
npm test          # regras puras
npm run mock      # http://localhost:3211 — tela real, dados de mentira, já logado como admin
                  # /?papel=atendente mostra a visão do atendente; /?saude=ok esconde a faixa
```

Banco: projeto `indycar-plataforma` no Supabase — o mesmo do CRM e da Agenda.

---

## ✨ Copiloto da IA (rodada 2 — 09/10/2026)

A IA lê **tudo** sobre o cliente e diz o que fazer — e faz com um clique.

**Na tela:** botão **✨ O que fazer agora?** no topo da ficha (ou o ✨ do chat).
A IA lê as últimas 40 mensagens, o cadastro, o CRM, a Agenda, os orçamentos do
Orçador, as mensagens do Comunicar, a satisfação, a etapa do funil, a próxima
revisão e os **horários livres de verdade** dos próximos 7 dias — e devolve:

- **resposta sugerida** (tom da casa, sem preço) → *Usar no campo* (nunca envia sozinha)
- **🔥 quente / 🌤 morno / ❄ frio** + intenção, resumo em 3 linhas e pendências
- **2 horários livres** clicáveis (viram frase pronta no campo)
- **cartões de ação** com *Executar / Recusar / ↶ Desfazer*: agendar (lead + horário
  amarrados, igual ao botão Agendar), remarcar, cancelar, mover etapa, completar ficha,
  registrar orçamento, aguardando consultor, chamar de novo (fila do Comunicar)
- **histórico** do que a IA propôs e do que foi feito na conversa

Atualiza sozinho quando o **cliente** escreve (espera 6 s, no máximo 1× a cada 45 s,
só com a tela visível; resposta do atendente no meio cancela). Dá para desligar no
próprio painel.

**Segurança (o servidor confere tudo, não a IA):** horário livre e dentro do expediente,
serviço do catálogo (o "não fazemos" é barrado), etapa que existe, placa/e-mail/data
válidos, ficha só com o que o **cliente** disse, valor só se o **atendente** informou,
nada de preço no texto, cliente que pediu para parar não recebe retorno. A conversa vai
cercada por marca aleatória (texto do cliente é DADO). Nenhum valor em R$ entra no prompt.

**Autonomia** (`ia_config.autonomia`, só admin muda): `sugerir` = só mostra ·
`confirmar` (padrão) = um clique executa · `automatico` = faz sozinho só o seguro
(ficha, etapa comum, aguardando consultor). Agendar, remarcar, cancelar, valor,
opt-out, etapa de ganho/perda e mensagem programada **sempre** pedem clique.
Tudo vai para `ia_acoes` (proposta/executada/recusada/erro/desfeita, tokens, modelo, duração).

### Rotas (todas com login; erros em JSON)
| Rota | Para quê |
|---|---|
| `GET /api/ia/contexto/:conversaId` | Ficha completa para a tela (com valores) — `?fresco=1` fura o cache de 45 s |
| `POST /api/ia/copiloto` `{conversaId, pedido?}` | `{resposta_sugerida, resposta_acao_id, acoes[], resumo, pendencias, intencao, temperatura, horarios_sugeridos[], autonomia, uso}` |
| `POST /api/ia/acoes/:id/executar` · `/recusar` `{motivo?}` · `/desfazer` | Um clique; trava contra clique duplo; desfaz em até 24 h |
| `GET /api/ia/acoes?conversaId=` | Histórico da conversa |
| `GET /api/ia/config` · `PUT` (admin) | ativo, modelos, autonomia, limite do dia, instruções extras |
| `GET /api/ia/uso` | Chamadas e tokens do dia, restante, as minhas |
| `GET /api/ia/horarios?servico=&dias=&consultor=` | Horários livres + 2 sugestões (o modal Agendar usa) |
| `POST /api/ia/resumo-do-dia` `{forte?}` | Gestor/admin: quem está esperando, quem pediu orçamento, quem quer agendar, reclamações |
| `GET /api/conversa-por-telefone?t=` | `{conversaId, link:"/?conversa=<id>"}` — CRM/Agenda abrem a conversa certa (aceita +55, máscara e sem o 9) |

CRM, Agenda, Comunicar e Orçador podem chamar essas rotas pelo navegador (CORS liberado
só para os endereços do ecossistema), com o mesmo login do Supabase. Para só abrir a
conversa, basta o link `https://indycar-atendimento.onrender.com/?tel=12999998888`
ou `?conversa=<id>`.

`/api/ia/sugerir` e `/api/ia/classificar` continuam iguais para a tela; o sugerir com
`conversaId` agora usa a ficha completa. Os dois leem o modelo de `ia_config`
(`MODELO_IA` no .env ainda manda, se existir), respeitam a IA desligada e o limite do
dia, e ficam registrados em `ia_acoes`. `/api/relatorios` ganhou o bloco `copilotoIA`.

### Arquivos
| Arquivo | O quê |
|---|---|
| `lib/contexto.js` | Monta a ficha (cache 45 s) e o texto para a IA, sem valores |
| `lib/horarios.js` | Horários livres e validação (regras puras) |
| `lib/ia-copiloto.js` | Laço com ferramentas, validação, executar/recusar/desfazer, uso, config |
| `lib/resumo-dia.js` | Resumo do dia do gestor |
| `lib/rotas-ia.js` | As rotas acima |
| `public/copiloto.js` / `copiloto.css` | O painel (pluga no `#copilotoSlot`; sem ele, vira botão flutuante) |
| `test/*.test.js` | `npm test` — banco e IA de mentira, nada sai para a rede |
| `test/apoio/servidor-copiloto.js` | Bancada do painel: `node test/apoio/servidor-copiloto.js --servir 3212` → `/bancada` |

---

## 🛡️ Rodada 3 (13/10/2026) — central da equipe, acesso e segurança do servidor

### Porteiro (vale para TODA rota com login)
Token do Supabase em `Authorization: Bearer <access_token>`. Respostas de recusa:

| Situação | HTTP | `codigo` |
|---|---|---|
| sem token | 401 | `sem_login` |
| token vencido / de ninguém | 401 | `sessao_expirada` / `sessao_invalida` |
| perfil desativado | 401 | `desativado` |
| papel `agenda` ou sem `'atendimento'` em `perfis.apps` (admin sempre entra) | 403 | `sem_acesso_app` (+ `apps:[{app,nome,link}]` que a pessoa pode usar) |
| tem verificação em duas etapas e o token ainda é `aal1` | 401 | `mfa_pendente` (só `GET /api/eu` responde) |
| token inválido 30× do mesmo IP em 10 min | 429 | `muitas_tentativas` (+ `Retry-After`) |

Último acesso: `perfis.ultimo_acesso_em`/`ultimo_app='atendimento'` gravados no máximo a cada 5 min.
Desativar alguém derruba o acesso em até 60 s (cache do porteiro esquecido na hora neste servidor).

### Rotas novas (contrato completo no relatório da rodada e em `lib/rotas-equipe.js`)
| Rota | Papel | Para quê |
|---|---|---|
| `GET /api/eu` · `PATCH /api/eu` · `POST /api/eu/senha-trocada` | qualquer da equipe | meu perfil, preferências, fim da troca obrigatória |
| `GET /api/equipe` | admin, gestor | lista com último acesso/login, apps, MFA, situação, carga |
| `GET /api/equipe/nomes` | equipe | nomes para a plaquinha (sem e-mail/telefone) |
| `POST /api/equipe` | admin | convidar → `senha_temporaria` (uma vez) |
| `PATCH /api/equipe/:id` | admin | papel, apps, equipe, cargo, telefone, rodízio |
| `POST /api/equipe/:id/desativar` · `/reativar` · `/senha` · `/mfa/remover` | admin | acesso, senha temporária, tirar MFA |
| `GET /api/auditoria` · `GET /api/auditoria/exportar` | admin | filtros + paginação · CSV (auditado) |
| `GET /api/tarefas/equipe[?pessoa=]` · `POST /api/tarefas` | gestor (carga) · equipe | carga da equipe · criar tarefa |
| `GET /api/rodizio` · `GET /api/conversas/sem-dono` | admin, gestor | próximo da fila · conversas sem dono |
| `POST /api/conversas/:id/distribuir` · `/transferir` | equipe | dar dono pelo rodízio · passar com motivo |
| `POST /api/automacoes/rodar` | admin | rodar agora: espera, resumo, donos, limpeza |
| `GET /api/status` | público | `{ok, app, versao, agora}` (nada interno) |

As rotas antigas `POST /api/equipe/papel|ativo|rodizio` continuam aceitas (mesmas regras novas).
Excluir conversa/mensagens e Relatórios agora valem também para o **gestor**.

### Rodízio
Recebe cliente quem está ativo, no rodízio, com papel de equipe e o app Atendimento,
fora de férias (`preferencias.ausente_ate`) — de preferência dentro do horário dele
(`preferencias.expediente`; sem isso, seg–sáb 8h–17h30). Ganha quem tem **menos conversas
abertas**; empate → quem recebeu há mais tempo. Quando a conversa muda de mão (assumir,
transferir, distribuir), os leads abertos do cliente **acompanham o novo dono** — só os
que estavam sem responsável ou com o dono antigo.

### Automações (só no Render ou com `AUTOMACOES=1`; a cada 5 min)
- Cliente esperando resposta há **30+ min** no horário da oficina → notificação para
  gestores/admin e para o dono da conversa (uma por mensagem; nada vai por WhatsApp).
- **Resumo do dia** às 17h40 (seg–sáb) → notificação para gestores/admin.
- **Dono inválido**: conversa nova que caiu com quem não pode atender volta ao rodízio.
- **Limpeza** diária: notificações lidas há 60+ dias, eventos do CodeWords com 120+ dias
  (cópias de segurança de exclusão nunca saem) e rascunhos da IA nunca usados há 30+ dias.
Preferências respeitadas: `preferencias.notificacoes.espera` / `.resumo_dia` = false desliga.

### Copiloto: `criar_tarefa`
A IA pode propor uma tarefa (título, responsável pelo nome da equipe, prazo, prioridade).
Na autonomia `automatico`, cria sozinha só a tarefa do dono da conversa; para outra pessoa
sempre pede clique. Desfazer = tarefa cancelada.

### Variáveis novas
`SINCRONIA=0` (não sincroniza com o aparelho — testes locais) · `AUTOMACOES=1|0` ·
`CONFIAR_PROXY=1` (fora do Render, atrás de outro proxy).

### Scripts
`npm run segredos` · `npm run segredos:historico` · `npm run auditar-deps` · `npm run verificar`
(sintaxe + segredos + audit + testes) · `node scripts/conferir-equipe-real.mjs` (só leitura).


---

## 🌙 Rodada 4 (14/10/2026) — quando o Render dorme

O plano gratuito do Render às vezes dorme e responde **503 "hibernate-wake-error"** por alguns minutos.
O Atendimento agora aguenta isso:

- **Faixa amarela "O sistema está acordando…"** com contagem e **Tentar agora**. Tudo que precisava do
  servidor espera sozinho (até 3 min, espera crescente) e segue quando ele volta ("✅ O sistema voltou").
- **As conversas continuam funcionando**: elas vêm direto do Supabase, que não dorme. O app abre mesmo com o
  servidor fora (a casca fica guardada no service worker e a configuração pública no aparelho).
- **Mensagem enviada nesse meio-tempo não se perde nem sai duas vezes**: fica "⏳ esperando o sistema" e sai
  quando ele acorda — mesmo que a página seja fechada (é retomada ao abrir de novo, até 15 min). O servidor
  recebe o id da mensagem e não manda duas vezes (`lib/entrega.js`).
- **Tempo real que recupera**: se o WebSocket caiu (calado ou não), o app busca no banco o que chegou no intervalo.
- **Tour de boas-vindas** por papel na primeira vez (atendente, gestor, admin) e **Ajuda** no `?` ou no menu
  do seu nome (como faço…, atalhos, rever o tour).

### Para quem mantém
| O quê | Onde |
|---|---|
| Novas tentativas, faixa, JSON em português no lugar do HTML do Render | `public/rede.js` (regras puras testadas em `test/rede-entrega.test.js`) |
| Marca das respostas do app (é assim que a tela distingue do roteador) | cabeçalho `X-IndyCar-App: atendimento` no `server.js` |
| Casca em cache, versão nova | `public/sw.js` (v14), `public/casca.js` |
| Biblioteca do Supabase local (versão travada) | `GET /vendor/supabase.js` (do `node_modules`) |
| Entrega idempotente | `POST /api/enviar` com `mensagemId` (+ cabeçalho `X-Idempotente: 1`) |
| Tour e ajuda | `public/ajuda.js`; marca em `perfis.preferencias.tour_visto` |
| Preferências | `PATCH /api/eu` lê o valor atual e faz **merge profundo** — nunca apaga chave de outro app |
| Estáticos | brotli/gzip + ETag/304; JSON > 2 KB em gzip |

### Testar
```bash
npm test                                   # 189 testes
PORT=3221 node scripts/mock-server.mjs     # servidor de mentira; ?dormir=20 ou POST /api/_dormir {segundos} simula o 503
node scripts/roteiro-rodada4.cjs           # 145 conferências (1440 e 375 px)
node scripts/roteiro-casca.cjs             # server.js real atrás de um "Render" que responde 503
node scripts/avaliar-copiloto.mjs <ids>    # IA com conversas reais, banco SÓ LEITURA, modo "sugerir" (custa tokens)
```

---

## 🧠 Rodada 5 (16/10/2026) — a IA conduz o funil

Quando o cliente escreve, o banco grava a mensagem na fila `at_ia_fila` e **acorda o servidor**
(`POST /api/ia/funil/acordar`, com o mesmo token do webhook do CodeWords). O servidor lê a ficha
inteira (`cliente_360` pelo telefone), decide se é caso de gente (preço, urgência, pedir pessoa,
reclamação) e conduz: pergunta o carro, oferece **dois horários livres de verdade**, marca o horário
(lead + agendamento + consultor livre, conferido também na função da Agenda `agenda_horarios_livres`),
confirma por mensagem e registra tudo em `ia_acoes`. Mensagem do botão do site ("Olá! Vim pelo site…
quero orçar: X (site/código)") já chega com serviço e campanha identificados.

**Até onde ela vai** (Atendimento › IA › "Até onde a IA vai sozinha", só admin): padrão
*Só sugerir / Pedir um clique / Fazer sozinha* e, por etapa, *Responder · Marcar horário · Ficha, lead
e etapa · Passar para gente*. Em "pedir um clique" o dono da conversa recebe o aviso no sino e aprova
dentro da conversa (faixa "✨ IA propôs…") ou em **IA em ação** (o que ela fez hoje, com desfazer).
Cancelar horário, religar quem pediu PARAR, ganho/perda e tarefa para outra pessoa sempre pedem clique.

| O quê | Onde |
|---|---|
| Motor do funil (fila, humano, site, conduzir, IA em ação) | `lib/ia-funil.js` · `test/ia-funil.test.js` |
| Papel da IA no funil, autonomia por etapa, envio da resposta, consultor livre | `lib/ia-copiloto.js` (`PAPEL_FUNIL`, `niveisDoFunil`, `decisaoDoFunil`) |
| Fila, gatilho, despertador (pg_cron a cada minuto, só com fila) | `scripts/sql/2026-10-16_at_ia_funil_v1.sql` |
| Rotas | `POST /api/ia/funil/acordar` (token) · `GET /api/ia/funil/estado` · `POST /api/ia/funil/processar` (gestor) · `GET /api/ia/hoje` |
| Tela | aba IA (autonomia + IA em ação), `#chatPropostas`, `#chatIA`, copiloto ("Próximo passo", respostas rápidas, "Aprovar e enviar") |
| Follow-up automático (cliente sumiu 24 h → tarefa) | `lib/automacoes.js` (`followUp24h`) |

Variáveis: `IA_FUNIL=0` desliga neste servidor. Nada novo no Render: o token do webhook já existe no banco.

### Preparo para a IndyCar Central
`server.js` exporta `{ handler, iniciar }` (`listen` só em `node server.js`); a Central tira o prefixo de
`req.url`, põe `req.prefixo` e o servidor injeta `<base href>` no HTML. A tela usa caminhos relativos;
`public/apps.js` é o único lugar com os endereços dos apps e com o prefixo; `rede.js` leva todo
`fetch('/api/…')` para dentro do prefixo; `sw.js` e `manifest.json` são relativos. Testar:
`PORT=3226 PREFIXO=atendimento node scripts/mock-server.mjs` → http://localhost:3226/atendimento/ e
`node scripts/roteiro-rodada5.cjs`. Quando a Central entrar no ar, trocar `ia_config.funil_url`
(`PUT /api/ia/config {funil_url}`) para o endereço novo do despertador.
