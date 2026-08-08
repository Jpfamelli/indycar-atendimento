# Mensagem para o CodeWords — correções

> Copie tudo abaixo da linha e mande para o suporte.
> Está pronta, com os erros que eu reproduzi e o que preciso de cada um.

---

Olá! O repasse das mensagens para o meu painel **já está funcionando** — obrigado.
Recebo as conversas, o cliente entra no meu CRM e o `/stop-ai` e `/start-ai` do
fluxo do Carlos respondem certinho. 👏

Só que ao ligar tudo apareceram quatro problemas. Vou do mais urgente para o
menos, com o que eu observei em cada um.

---

# 🔴 1. A cota nova é de 100 execuções/mês — e acabou no primeiro dia

Renovei o plano ontem. Hoje o retorno é:

```json
{"detail":"Monthly workflow run limit reached — you've used 100 of 100
workflow runs allowed this month on your current plan."}
```

**100 execuções por mês não dá para uma oficina.** Antes eu tinha 2.500 e mesmo
assim estourava. Com 100, o Carlos não consegue nem responder os clientes do dia.

**O que eu preciso saber:**

1. **Qual plano suporta o meu volume?** Hoje são **20 a 40 conversas por dia**.
   Se cada mensagem do cliente gasta pelo menos 1 execução, preciso de algo na
   casa de **3.000 a 5.000 por mês**, com folga. Me digam o plano e o preço.
2. **Uma execução conta o fluxo inteiro ou cada passo dentro dele?** Isso muda
   completamente a minha conta — e ninguém consegue planejar sem saber.
3. **Existe alerta em 80% da cota?** Nas duas vezes eu só descobri que tinha
   acabado quando o cliente parou de receber resposta. Isso é péssimo: o cliente
   fica no vácuo e eu não fico sabendo.
4. **`/stop-ai`, `/start-ai` e `/listar` consomem cota?** Se sim, preciso saber,
   porque são chamadas de controle, não de conversa.

---

# 🔴 2. O Carlos está errando a data dos agendamentos

Uma cliente escreveu, às 00:47 do dia **07/08/2026**:

> "Amanha as 9 f amanhã. Meu carro é um corsa 2011"

O Carlos agendou. Quando busquei em
`GET /run/indycar_agendamentos_db_6657a75c/listar`, veio isto:

```json
{
  "id": "ag_20260807035424_2300",
  "nome": "Raquel",
  "tel": "5512974032300",
  "veiculo": "Corsa", "ano": "2011",
  "servico": "Alinhamento e balanceamento",
  "data": "2023-10-24",
  "hora": "09:00",
  "criadoEm": "2026-08-07T03:54:24.686768+00:00"
}
```

O `criadoEm` está certo (2026-08-07), mas o campo **`data` veio 2023-10-24** —
quase três anos no passado. "Amanhã" deveria ser **2026-08-08**.

Isso é grave: um horário no passado **some da agenda** e a oficina perde o
cliente sem perceber. Do meu lado eu já coloquei um aviso quando a data
importada já passou, mas a correção precisa ser aí.

**Peço:** que o Carlos calcule datas relativas ("amanhã", "sexta", "semana que
vem") a partir da data atual, no fuso **America/Sao_Paulo**, e devolva sempre em
`YYYY-MM-DD`. Se ele não tiver certeza do dia, é melhor **perguntar ao cliente**
do que chutar.

---

# 🟠 3. Não consigo saber quem falou: cliente ou Carlos

O repasse manda **as duas direções** — o que o cliente escreve e o que o Carlos
responde. Mas o payload não traz nenhuma marca dizendo qual é qual.

Resultado: a saudação do Carlos ("Olá, seja muito bem-vindo à Indy Car! 🏁…")
aparece no meu painel **como se o cliente tivesse escrito**. Isso confunde o
atendente e atrapalha a leitura automática da conversa.

**Peço uma destas duas soluções** (qualquer uma resolve):

- **(a)** Repassar **só as mensagens que o cliente manda** — é o que eu prefiro; ou
- **(b)** Incluir um campo dizendo a direção. Eu já aceito qualquer um destes
  nomes, é só mandar: `from_me`, `fromMe`, `outgoing` (booleanos), ou
  `direcao` / `direction` / `tipo` / `type` com o valor `entrada`/`saida`
  (ou `in`/`out`).

---

# 🟡 4. Perguntas sobre o que já funciona

**a) `/stop-ai` e `/start-ai`** — funcionam, obrigado. Uso quando um atendente
humano assume a conversa. Duas dúvidas:
- A pausa **dura até eu chamar `/start-ai`**, ou expira sozinha depois de um tempo?
- Se o cliente mandar mensagem com a IA pausada, vocês ainda repassam para o meu
  webhook? (Preciso que sim — é justamente quando o humano está atendendo.)

**b) Fluxo "Banco de Agendamentos"** — hoje eu consulto o `/listar` de tempos em
tempos, e é isso que mais consome cota. Duas alternativas que resolveriam:
- O fluxo **avisar meu webhook** quando criar um agendamento (aí eu paro de
  consultar); ou
- Ele **gravar direto no meu banco**, e eu exponho um endereço para isso.

Qualquer uma economiza muita execução. Qual é mais fácil para vocês?

**c) No-show** — descobri o campo `respeitar_horario_comercial` no fluxo
`indycar_noshow_notifier_09b5cd69` e passei a mandar `false`, porque quem furou
o horário às 22h precisa ser chamado de volta igual. Só confirmando: **está
correto usar assim?**

---

## Resumo do que preciso

| # | O quê | Urgência |
|---|---|---|
| 1 | Plano com cota real (3.000–5.000/mês) + alerta em 80% | 🔴 trava tudo |
| 2 | Corrigir o cálculo de datas ("amanhã" virou 2023) | 🔴 perde cliente |
| 3 | Marcar a direção da mensagem, ou repassar só a do cliente | 🟠 |
| 4 | Respostas às dúvidas acima | 🟡 |

Obrigado!

---

## 📌 Depois que eles responderem

Me mande a resposta aqui. Os itens **1 e 2** são resolvidos do lado deles.
O **3** eu já deixei preparado — assim que disserem qual campo mandam, funciona
na hora. O **4b** pode economizar muita cota e eu implemento o que for mais
fácil para eles.
