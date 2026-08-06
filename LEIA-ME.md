# IndyCar — Central de Atendimento

App de atendimento por WhatsApp, ligado ao mesmo banco do CRM e da Agenda.

---

## 🔑 Entrar

```
http://localhost:3200
```

| | |
|---|---|
| **E-mail** | `gerente@indycartaubate.com` |
| **Senha** | `IndyCar@2026` |

> ⚠️ **Troque essa senha no primeiro acesso.** Ela está escrita aqui neste
> arquivo, então vale só como acesso inicial.
> Para trocar: Supabase → Authentication → Users → o usuário → *Reset password*.

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

> ⚠️ **Cota do CodeWords:** no teste de conexão, o CodeWords avisou que as
> **2.500 execuções do mês já foram usadas**. A conexão está certa — assim que
> o plano for renovado (ou virar o mês), o envio passa a funcionar sem mexer
> em nada. Enquanto isso, o que você mandar fica registrado no painel e o
> atendente vê o aviso na hora.

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
- Carro, placa, origem e desde quando é cliente
- Últimos **leads do CRM** com status e valor
- Últimos **agendamentos** com consultor e valor

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

### 2. Cota do CodeWords (para as mensagens saírem)
O caminho até o WhatsApp **já está pronto e ligado** — entrada pela Edge
Function, saída pelo fluxo *Carlos*. O que trava hoje é a **cota mensal do
CodeWords** (2.500/2.500 usadas). Renovando o plano, volta a sair sozinho.

> **WhatsApp Cloud API da Meta:** o cartão existe em *Configurações*, mas
> continua **não implementado** — é um caminho alternativo, para o caso de
> você um dia querer falar com a Meta direto, sem o CodeWords. Não precisa
> preencher nada ali para o sistema funcionar.

### 3. Proteção contra senha vazada (recomendado)
No painel: **Authentication → Policies → Password protection** →
ative *"Check against HaveIBeenPwned"*.

---

## 👥 Adicionar mais atendentes

Pelo painel do Supabase:
**Authentication → Users → Add user** → marque *Auto Confirm User*.

O perfil é criado sozinho. O primeiro usuário do sistema vira **admin**;
os demais entram como **atendente** (não veem as configurações do WhatsApp).

Para promover alguém a admin, rode no SQL Editor:
```sql
update public.perfis set papel = 'admin' where email = 'pessoa@exemplo.com';
```

---

## 🔒 Como a segurança funciona

- O navegador usa a **chave publicável** — ela é pública de propósito
- Quem protege os dados é o **login + RLS** do banco: sem estar logado
  e ativo, nenhuma linha é lida
- A **chave da IA nunca vai para o navegador** — fica no servidor
- Configurações sensíveis (token do WhatsApp) só para quem é **admin**
- O `.env` está no `.gitignore`

---

## Onde fica cada coisa

| Arquivo | O quê |
|---|---|
| `server.js` | Entrega a interface e faz a ponte com a Claude |
| `public/index.html` | Telas (login, conversas, IA, configurações) |
| `public/styles.css` | Visual IndyCar (preto / vermelho / branco) |
| `public/app.js` | Toda a lógica: login, conversas, tempo real, ficha, IA |
| `.env` | Configuração (não vai para o Git) |

Banco: projeto `indycar-plataforma` no Supabase — o mesmo do CRM e da Agenda.
