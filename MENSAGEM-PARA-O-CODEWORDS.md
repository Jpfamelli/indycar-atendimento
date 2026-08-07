# Mensagem para o CodeWords

> Copie tudo abaixo da linha e mande para o suporte do CodeWords.
> Está pronta — não falta preencher nada.
>
> ⚠️ Ela contém o **token do webhook**, que é a senha que impede estranhos de
> escrever no seu banco. Mande só para o CodeWords. Se vazar, me avise que eu
> troco em 1 minuto (é um campo na aba *Integrações*).

---

Olá! Preciso de um ajuste no meu fluxo **Carlos** para ligá-lo a um painel de
atendimento que montei. Abaixo o contexto, o pedido e as dúvidas.

## O que eu tenho hoje aqui no CodeWords

| Fluxo | Service ID |
|---|---|
| Carlos — Indycar Centro Automotivo | `indycar_carlos_whatsapp_e3cd01d3` |
| Indycar — Banco de Agendamentos | `indycar_agendamentos_db_6657a75c` |
| Indycar — NoShow Notifier | `indycar_noshow_notifier_09b5cd69` |
| WhatsApp Device Manager | `whatsapp_device_manager` |

Aparelho do WhatsApp pareado: `2bbd5d3a-103a-4fb1-9f51-bc0f963a2546`
(número `5512982211090`), com `service_path = indycar_carlos_whatsapp_e3cd01d3/`.

## O que eu montei do meu lado

Um painel de atendimento com banco próprio, que junta o **CRM**, a **agenda da
oficina** e as **conversas do WhatsApp**, tudo amarrado pelo telefone do cliente.
Quando uma mensagem chega, o atendente já vê quanto aquele cliente gastou,
quantos serviços fez, qual o carro e se tem horário marcado.

**O Carlos continua sendo quem conversa com o cliente.** Eu só quero **enxergar**
essas conversas no painel e poder responder por lá quando precisar de gente.

O envio já funciona: mando pelo proxy do `whatsapp_device_manager`
(`/proxy/send/message?device_id=…`, form-urlencoded) e a mensagem chega. **O que
falta é o contrário: eu receber.**

---

# 🔴 Pedido principal

**Que o fluxo do Carlos, além de responder o cliente, mande uma cópia da mensagem
para o meu endereço.** Um `POST`, sem esperar resposta — se falhar, ignore e siga
atendendo normalmente.

### Endereço

```
https://nppfqhavqahapmugnyng.supabase.co/functions/v1/codewords-webhook
```

### Método

```
POST
```

### Cabeçalhos (os três são obrigatórios)

```
Content-Type: application/json
apikey: sb_publishable_6m4EQdymEn7UVtHwu8vWyw_4RObR9td
x-codewords-token: a522097ace9ec90b16b97073e9b68536
```

> O `apikey` é exigido pelo portão do Supabase antes de chegar no meu código —
> essa chave é publicável, não dá acesso a nada sozinha. Quem autentica de fato
> é o `x-codewords-token`.

### Corpo

```json
{
  "telefone": "5512999998888",
  "mensagem": "texto que o cliente escreveu",
  "nome": "nome do contato no WhatsApp"
}
```

Não precisam mudar o formato de vocês: eu aceito nomes alternativos —
`telefone` / `phone` / `from` / `numero` / `sender` / `wa_id`, e
`mensagem` / `message` / `text` / `corpo` / `body`.
Se mandarem o id da mensagem em `wamid` ou `message_id`, eu guardo também.

### O que eu respondo (testado agora, um por um)

| Situação | Resposta |
|---|---|
| Deu certo | `200` · `{"ok":true}` |
| Token errado ou ausente | `401` · `{"erro":"token inválido"}` |
| Faltou o cabeçalho `apikey` | `401` · `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` |
| Faltou telefone ou mensagem | `400` · com a lista dos campos que chegaram |
| Acima de 64 KB | `413` |

Para validar antes, um `GET` no mesmo endereço (só com o `apikey`) responde
`200 {"ok":true}`.

### ⚠️ Uma coisa que NÃO deve ser feita

Não troquem o `service_path` do aparelho no `whatsapp_device_manager` para
apontar para o meu endereço. Testei e o `subscribe` aceita URL externa — mas isso
**desvia** as mensagens e o Carlos para de receber. O aparelho tem que continuar
apontando para `indycar_carlos_whatsapp_e3cd01d3/`. Por isso o repasse precisa
sair de dentro do fluxo do Carlos, e não da inscrição do aparelho.

---

# 🟡 Três dúvidas que podem virar problema

**1. Risco de eco.** Quando eu respondo pelo painel, a mensagem sai pelo aparelho.
Se o Carlos também repassar as mensagens que *saem*, ela aparece duplicada na
minha tela. O ideal é repassar **só o que o cliente manda**. Se o payload puder
indicar a direção (entrada/saída) ou marcar que foi o próprio sistema que enviou,
eu filtro do meu lado.

**2. Pausar o Carlos numa conversa.** Quando um atendente humano assume, o certo é
o Carlos parar de responder **aquele contato** até eu liberar — senão os dois
respondem juntos e o cliente recebe mensagem em dobro. Existe como pausar por
contato? Se houver um endpoint ou um campo, me digam qual.

**3. O fluxo "Banco de Agendamentos".** Hoje ele guarda agendamentos do lado de
vocês, e eu consulto a cada 15 minutos. Como minha agenda agora vive no meu
banco, ficam duas versões do mesmo horário. Ele pode só **consultar** o meu banco
em vez de manter o dele? Se sim, eu exponho um endereço de leitura.

## Sobre a cota

Acabei de renovar o plano. Duas coisas que ajudariam a não ser pego de surpresa
de novo:

- **Existe alerta quando eu chegar a 80% da cota?** Da última vez eu só descobri
  que tinha acabado quando o cliente parou de receber resposta.
- **Uma execução conta o fluxo inteiro ou cada passo dentro dele?** Isso muda
  bastante o meu cálculo de consumo.

Obrigado!

---

## 📌 Depois que eles responderem

Me mande a resposta aqui que eu ajusto o sistema. Os pontos **1** e **2** (eco e
pausar o Carlos) podem exigir mudança no meu código — os outros são configuração
do lado deles.
