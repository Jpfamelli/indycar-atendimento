# Mensagem para mandar ao CodeWords

> **Antes de mandar:** onde estiver `COLE-AQUI-O-TOKEN`, troque pelo *Token do
> webhook* que aparece no painel em **Configurações → CodeWords**. Não colei ele
> aqui de propósito — é a senha que impede qualquer um de escrever no seu banco.

---

## 📋 Copie daqui para baixo

Olá! Preciso conectar um painel de atendimento que montei ao meu fluxo do WhatsApp
aqui no CodeWords. Vou explicar o cenário inteiro e depois o que preciso de vocês.

### O que eu tenho hoje no CodeWords

| Fluxo | Service ID | Papel |
|---|---|---|
| Carlos — Indycar Centro Automotivo | `indycar_carlos_whatsapp_e3cd01d3` | Conversa com o cliente no WhatsApp |
| Indycar — Banco de Agendamentos | `indycar_agendamentos_db_6657a75c` | Guarda agendamentos |
| Indycar — NoShow Notifier | `indycar_noshow_notifier_09b5cd69` | Avisa quem não apareceu |
| WhatsApp Device Manager | `whatsapp_device_manager` | Conexão do número (device `c52c3776-389f-4d7c-a082-ca40d5fac69f`) |

### O que eu montei do meu lado

Um **painel de atendimento** com banco de dados próprio (Postgres no Supabase) que
junta três coisas que antes viviam separadas:

- **CRM** — de onde veio cada cliente, em que pé está o negócio, quanto foi cobrado
- **Agenda** — os horários da oficina
- **Atendimento** — as conversas do WhatsApp

Tudo amarrado **pelo telefone do cliente**. Quando uma mensagem entra, o sistema
reconhece se é cliente antigo e já mostra ao atendente o histórico dele: quanto
já gastou, quantos serviços fez, se tem horário marcado, qual o carro e a placa.

**O que eu quero:** o Carlos continua sendo quem fala no WhatsApp. Eu só quero
**enxergar e administrar** essas conversas no meu painel, e poder responder por lá
quando o atendimento precisar de gente.

---

### 🔴 Pedido 1 — mandar as mensagens recebidas para o meu webhook

Preciso que o fluxo do **Carlos** repasse para mim toda mensagem que chegar do cliente.

**Endereço (fica no ar 24h, não depende do meu computador):**

```
https://nppfqhavqahapmugnyng.supabase.co/functions/v1/codewords-webhook
```

**Método:** `POST`

**Cabeçalhos (os três são obrigatórios):**

```
Content-Type: application/json
apikey: sb_publishable_6m4EQdymEn7UVtHwu8vWyw_4RObR9td
x-codewords-token: COLE-AQUI-O-TOKEN
```

> Sobre o `apikey`: é exigido pelo portão de entrada do Supabase, antes de
> chegar no meu código. Essa chave é **publicável** — ela já é usada no
> navegador e não dá acesso a nada sozinha. Quem realmente autentica é o
> `x-codewords-token`. Sem o `apikey` a requisição volta com
> `401 UNAUTHORIZED_NO_AUTH_HEADER` e a mensagem não chega até mim.

**Corpo (JSON):**

```json
{
  "telefone": "5512999998888",
  "mensagem": "texto que o cliente escreveu",
  "nome": "nome do contato no WhatsApp"
}
```

Sobre o formato: eu aceito nomes alternativos, então não precisa mudar seu payload
se ele já usa outra convenção. Funciona com `telefone` / `phone` / `from` / `numero`
/ `sender` / `wa_id`, e com `mensagem` / `message` / `text` / `corpo` / `body`. Se
mandarem o id da mensagem em `wamid` ou `message_id`, eu guardo também.

**O que eu respondo:**

| Situação | Resposta |
|---|---|
| Deu certo | `200` — `{"ok": true}` |
| Token errado ou ausente | `401` — `{"erro": "token inválido"}` |
| Faltou o cabeçalho `apikey` | `401` — `{"code": "UNAUTHORIZED_NO_AUTH_HEADER"}` |
| Faltou telefone ou texto | `400` — com a lista dos campos que chegaram |
| Mensagem acima de 64 KB | `413` |

Se vocês quiserem validar a URL antes, um `GET` no mesmo endereço (com o
`apikey`, sem precisar do token) responde `200 {"ok": true}`.

---

### 🔴 Pedido 2 — a cota mensal estourou

Quando testei o envio pelo fluxo do Carlos, veio:

```
429 — Monthly workflow run limit reached — you've used 2500 of 2500
workflow runs allowed this month on your current plan.
```

Preciso entender:

1. **Qual plano** me dá folga para o volume de uma oficina — hoje são cerca de
   **20 a 40 conversas por dia**, e cada conversa dispara várias execuções.
2. A cota **zera na virada do mês** ou na data de aniversário da assinatura?
3. Existe **alerta** quando eu chegar em 80% da cota? Fiquei sabendo que tinha
   acabado só quando o cliente parou de receber resposta — isso não pode acontecer.
4. **Uma execução** conta o fluxo inteiro ou cada passo dentro dele? Isso muda
   bastante minha conta.

---

### 🟡 Pedido 3 — algumas dúvidas técnicas

1. **Como eu mando mensagem pelo painel?** Hoje eu chamo
   `POST https://runtime.codewords.ai/run/indycar_carlos_whatsapp_e3cd01d3`
   com a minha chave `cwk-…` no header `Authorization: Bearer` e um corpo com
   `telefone` e `mensagem`. Está certo? Se o formato correto for outro, me digam qual.

2. **Tem risco de eco?** Se eu mandar uma mensagem pelo painel e vocês
   repassarem ela de volta para o meu webhook, ela vai aparecer duplicada na tela.
   Se o payload tiver como marcar a direção (entrada/saída) ou dizer que a mensagem
   foi enviada pelo próprio sistema, eu filtro do meu lado.

3. **O Carlos pode ficar quieto quando eu assumir a conversa?** Quando um atendente
   humano entra, o ideal é o Carlos parar de responder aquele contato até eu liberar.
   Existe forma de pausar por contato?

4. **O fluxo "Banco de Agendamentos"** (`indycar_agendamentos_db_6657a75c`) hoje
   guarda agendamentos do lado de vocês. Agora que minha agenda vive no meu banco,
   quero evitar que os dois guardem versões diferentes do mesmo horário. Ele pode
   só **consultar** meu banco em vez de manter o dele? Se sim, eu exponho um endereço
   de leitura para vocês.

Obrigado!

---

## 📌 Depois que eles responderem

Se a resposta pedir algo de mim, me manda aqui que eu ajusto o sistema.
Os pontos 2 e 3 acima (eco e pausar o Carlos) são os que podem exigir uma
mudança no meu código — os outros são configuração do lado deles.
