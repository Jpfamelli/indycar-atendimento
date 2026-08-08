# Base de conhecimento da IndyCar

O que a IA sabe sobre a oficina. Veio do material que o João aprovou
(`IndyCar_IA_Atendimento_Persuasivo.docx` e o levantamento de serviços).

## Onde cada coisa é usada

| Arquivo | Vira o quê no sistema |
|---|---|
| `01-empresa.md` | Endereço, horário, garantia e diferenciais — escritos no cérebro da IA (`PERSONA`, em `server.js`) |
| `02-catalogo-servicos.md` · `servicos.json` | Os **138 serviços**, carregados na tabela `catalogo_servicos` do Supabase |
| `03-agendamento.md` | As janelas de horário, na tabela `janelas_agendamento` |
| `04-playbook-humano.md` | Scripts para a equipe. Base dos atalhos do `/` no chat |
| `05-agente-ia.md` | O cérebro do agente — é a fonte da `PERSONA` |
| `99-pendencias.md` | **Contradições que ainda precisam da decisão do João** |

## Como a IA usa

A cada sugestão de resposta, o servidor lê `catalogo_servicos` e
`janelas_agendamento` do banco e cola no prompt (`conhecimentoDaOficina()`,
com cache de 10 minutos). Assim a IA:

- **Nunca promete serviço que a oficina não faz.** Se não está no catálogo,
  a resposta é *"deixa eu confirmar isso certinho com a equipe e já te falo"*.
- **Só oferece horário que cabe** nas janelas, sempre com duas opções.

Para mudar o que a IA sabe sobre serviços ou horários, **edite no banco** —
não aqui. Estes arquivos são a origem histórica, para consulta.

## ⚠️ Pendências que afetam a IA hoje

O `99-pendencias.md` lista 8 contradições entre os documentos originais.
Duas mexem direto no que a IA responde:

1. **Câmbio automático** — a lista de exclusões diz que não fazem; o catálogo
   diz que fazem troca de óleo por diálise e diagnóstico, mas não abrem o
   câmbio. **Vale o catálogo** (é o que está no banco). Se estiver errado,
   corrija na tabela `catalogo_servicos`.
2. **Parcelamento** — os documentos falam em "[Número] vezes" sem definir.
   A IA foi instruída a **não citar número de parcelas**, só dizer que há
   parcelamento. Defina o máximo real e me avise que eu acrescento.

As outras seis são de redação e não mudam a resposta ao cliente.
