# Melhorias — papel "Atendimento — IA e servidor" (Rodada 2, 09/10/2026)

Cada linha foi verificada (testes `npm test` — 87 passando —, bancada no navegador com puppeteer, leitura real do banco e chamadas reais à IA em modo "sugerir" sem gravar nada).

### Contexto da conversa (`lib/contexto.js`)
1. `montarContexto(conversaId)` junta numa ficha só: 40 últimas mensagens, cliente, `v_cliente_360`, leads (com "há N dias" e o lead aberto), agendamentos futuros e passados (com nome do consultor), orçamentos do Orçador, envios do Comunicar, satisfação, etapa + histórico do funil, último serviço, próxima revisão, catálogo, janelas, serviços, consultores, empresa e horários livres.
2. Cache por conversa de 45 s (`doCache`), com `forcar` e `invalidar` (o copiloto invalida depois de cada ação).
3. Catálogo, janelas, serviços, consultores, etapas, regras de retorno e empresa em cache de 10 min (só guarda se o essencial veio).
4. Agenda dos próximos dias (todos os clientes) em cache de 30 s, compartilhada entre conversas.
5. Orçamentos do Orçador achados pelo cliente **e** pelos leads dele (sem duplicar).
6. Fila do Comunicar achada pelo `cliente_id` **e** pelo telefone (a fila antiga não tinha cliente_id).
7. Conversa sem cadastro: procura os leads pelo telefone (com e sem 55).
8. Tabela que falhar vira aviso em `ficha.avisos` — a ficha nunca cai inteira.
9. Próxima revisão calculada com as regras do Comunicar (reaproveita `lib/comunicar.js`) e marcada "ATRASADA" no prompt.
10. Satisfação resumida: última, nota média e se já reclamou.
11. `textoParaIA` não leva NENHUM valor em dinheiro: nada de orçamento, total gasto ou valor de lead; valores escritos nas mensagens viram "R$ [valor]".
12. Conversa cercada por marca aleatória; qualquer imitação da marca no texto do cliente vira "[marca removida]" (testado com `</CONVERSA_…>` injetado).
13. Foto/áudio/vídeo/documento sem texto aparecem como `[foto]`, `[áudio]`… no prompt.
14. Cliente que não aceita mensagens aparece no prompt com o aviso para não propor retorno.
15. Horários marcados vão para o prompt com o id, para a IA remarcar/cancelar o certo.
16. `fichaParaTela` (com valores, sem repetir as mensagens que a tela já tem) e `textoDoCatalogo` (✅/❌ + janelas) para o system.

### Horários livres (`lib/horarios.js`)
17. Horários livres seg–sáb 8h–17h30 em passos de 30 min, no fuso de São Paulo (último início 17h; domingo fechado).
18. Desconta agendamentos ativos (cancelado e "não veio" não ocupam), usando a duração do serviço (padrão 60 min).
19. Capacidade = nº de consultores ativos (mínimo 1); filtro por consultor quando informado.
20. Janelas por tipo de serviço (`janelas_agendamento`): "troca de óleo" só nas janelas da manhã; casamento por raiz da palavra ("pneu" acha "Pneus, alinhamento…").
21. Hoje só a partir de 1 h de antecedência.
22. `sugerirDois`: duas opções concretas, de preferência em outro dia e outro período (regra 7 da casa).
23. `validarHorario` com motivo claro: data/hora inválida, fora dos 30 min, domingo, fora do expediente, passado, mais de 60 dias, ocupado, consultor ocupado; remarcação ignora o próprio horário.
24. Rótulo do jeito que se fala com o cliente: "quinta, 15/10 às 14h".

### Copiloto (`lib/ia-copiloto.js`)
25. Laço com tool use (até 4 voltas) e cliente da IA injetável — testado inteiro sem gastar API.
26. 11 ferramentas: responder, agendar, remarcar, cancelar_agendamento, mover_etapa, atualizar_ficha, registrar_interesse, marcar_aguardando_consultor, agendar_retorno, resumir, classificar.
27. Toda proposta passa pela validação do servidor; o erro volta para a IA como `tool_result` com `is_error` para ela corrigir.
28. Responder: troca "prezado/efetuar/comparecer/veículo"; recusa texto com preço (a IA reescreve); máximo 900 caracteres.
29. Agendar: confere horário livre/expediente/domingo, barra serviço "não fazemos" do catálogo, casa o nome com o cadastro de serviços (`servico_id`).
30. Agendar executa igual ao botão Agendar: lead + agendamento amarrados, origem whatsapp, status confirmado, liga a conversa ao cadastro — e reaproveita o lead aberto em vez de duplicar.
31. Agendar revalida o horário no clique (ocupado entre a proposta e o clique = não grava) e apaga o lead que acabou de criar se o agendamento falhar.
32. Depois de agendar, devolve a mensagem de confirmação pronta (dia, hora, endereço, "deixo reservado no seu nome").
33. Remarcar/cancelar só aceitam horário futuro do próprio cliente; cancelar anota o motivo na observação.
34. Mover etapa: nome validado contra `etapas_funil` (sem acento/caixa); executa com trava da etapa lida (não sobrescreve quem mudou à mão).
35. Atualizar ficha: só o que o CLIENTE escreveu (ou o atendente pediu); placa normalizada (ABC1D23), e-mail, ano 1950–hoje+1, nascimento "DD/MM" → ano 1904; campos recusados voltam como aviso no cartão.
36. Opt-out só se o cliente pediu para parar (grava data e motivo); religar só com pedido do atendente.
37. Atualizar ficha em conversa sem cadastro cria o cliente (`obter_ou_criar_cliente`) e liga a conversa.
38. Registrar interesse: lead aberto vai para "orçamento" (só se estava em novo/contato) com serviço; sem lead, cria um; **valor só entra se o atendente o escreveu** (número conferido nas mensagens dele ou no pedido).
39. Aguardando consultor: marca a conversa com data.
40. Agendar retorno: fila do Comunicar tipo 'avulsa', `criado_por='copiloto'`, `chave_unica` por ação, horário de expediente, de amanhã até 6 meses, texto sem preço; recusado para quem não aceita mensagens.
41. Resumir (3 linhas + pendências) e classificar (intenção + quente/morno/frio) entram como "executada" sem mexer em nada.
42. Cada proposta e cada consulta gravadas em `ia_acoes` com modelo, tokens (entrada/saída/cache), duração, conversa, cliente, lead, agendamento e quem pediu.
43. Autonomia de `ia_config`: 'sugerir' recusa executar (exceto usar a resposta), 'confirmar' executa com um clique, 'automatico' executa sozinho só ficha/etapa comum/aguardando — etapa de ganho/perda e opt-out sempre pedem clique.
44. Trava contra clique duplo e dois atendentes: só um "executar" passa (409 para o outro).
45. Proposta com mais de 24 h não executa; recusada não executa nem desfaz.
46. Desfazer para 8 tipos (agendar cancela o horário e devolve/apaga o lead, remarcar volta o horário, cancelar reativa, etapa volta, ficha volta, lead volta/sai, aguardando sai, retorno sai da fila se não saiu) — janela de 24 h.
47. IA desligada = 503 claro; limite diário de `ia_config` = 429 claro; IA fora do ar = 502 e linha "erro" no log; recusa da IA não quebra a tela.
48. Proteções do laço: até 8 ações, ação repetida ignorada, ferramenta inexistente recusada.
49. System com prompt caching (persona da casa + papel do copiloto + catálogo) — na chamada real, 8–16 mil tokens lidos do cache.
50. Instruções extras do dono (`ia_config.instrucoes_extras`) entram no system como regra da casa.
51. `ia_config` em cache de 60 s; `salvarConfig` valida autonomia, modelos permitidos, limite 10–100000 e texto ≤ 2000, e registra a mudança em `ia_acoes` (tipo 'config', origem 'sistema').
52. Uso do dia (chamadas por tipo e por pessoa, tokens, executadas/recusadas) com cache de 10 s e contagem incremental — sugerir e classificar também contam.
53. `resumoCopiloto` para relatório: chamadas, propostas, executadas, recusadas, desfeitas, automáticas, erros, % de aceite, duração média e por tipo.

### Resumo do dia (`lib/resumo-dia.js`)
54. Parte sem IA (sempre certa e de graça): quem escreveu por último e está sem resposta + quem está "aguardando consultor", ordenado por tempo de espera.
55. Parte com IA (ferramenta obrigatória `relatorio_do_dia`): pediram orçamento, querem agendar, reclamações, outras pendências e resumo geral; ids inventados pela IA são descartados.
56. Conversas cercadas, sem valores; disparos em massa fora; até 60 conversas × 6 mensagens.
57. Cache de 3 min; IA fora do ar ou limite atingido ainda devolve quem está esperando.

### Rotas (`lib/rotas-ia.js`, todas com login)
58. `GET /api/ia/contexto/:conversaId` (ficha para a tela, `?fresco=1`).
59. `POST /api/ia/copiloto` no formato combinado com a tela.
60. `POST /api/ia/acoes/:id/executar|recusar|desfazer` com status HTTP certos (400/403/409/422).
61. `GET /api/ia/acoes?conversaId=` (histórico sem os bastidores do desfazer).
62. `GET/PUT /api/ia/config` (PUT só admin; GET diz se pode editar e os modelos permitidos).
63. `GET /api/ia/uso` (chamadas, restante, tokens, as minhas).
64. `GET /api/ia/horarios?servico=&dias=&consultor=` (o modal Agendar da tela já usa).
65. `POST /api/ia/resumo-do-dia` só para gestor/admin.
66. `GET /api/conversa-por-telefone?t=` → `{conversaId, link}` para CRM/Agenda abrirem a conversa certa; aceita +55, máscara e número sem o 9º dígito.
67. CORS só para os endereços do ecossistema (CRM, Agenda, Comunicar, Orçador, locais) + pré-voo OPTIONS; outras origens ficam sem CORS (403 no pré-voo).
68. Limites por usuário: copiloto 20/min e 400/dia, ações 60/min, ficha 120/min, resumo do dia 6/min, config 20/min.
69. Sem a chave de serviço: 503 com o nome do que falta (nunca 500).

### Servidor (`server.js`)
70. Um cliente Supabase de serviço para o processo inteiro (antes cada rota criava o seu).
71. Um cliente da Anthropic só, com 1 nova tentativa e timeout por chamada.
72. `/api/ia/sugerir` com `conversaId` monta a ficha completa no servidor (CRM, Agenda, Orçador, Comunicar, horários livres).
73. Sugerir: saiu "Já gastou: R$ …" do prompt; o histórico vai cercado e marcado como dado.
74. Sugerir: vocabulário da casa corrigido na resposta e aviso quando a sugestão cita valor.
75. Sugerir e classificar leem o modelo de `ia_config.modelo_rapido` (antes `claude-opus-5` fixo; `MODELO_IA` do .env ainda manda), com `max_tokens` enxuto e timeout.
76. Classificar: sem o valor orçado do lead no prompt e com a cerca protegida contra imitação.
77. Sugerir e classificar respeitam IA desligada e limite do dia, e ficam registrados em `ia_acoes`.
78. `/api/config` mostra o modelo realmente usado.
79. `/api/relatorios` ganhou o bloco `copilotoIA`.
80. Webhook do CodeWords com mensagens claras e `codigo` (token-invalido, sem-token, faltou-campo, falha-gravar) — sem vazar erro do banco.
81. `/api/enviar` recusa telefone sem DDD/número (10–11 dígitos) e mensagem vazia com texto claro.
82. `server.js` exporta `copiloto`, `criarClienteIA`, `sugerirResposta`, `montarRelatorio` e `PERSONA` para scripts de conferência.

### Painel (`public/copiloto.js` + `copiloto.css`)
83. Pluga no `#copilotoSlot` da ficha sem depender do app.js; sem o slot, vira botão ✨ flutuante com painel recolhível (Esc fecha).
84. Botão "✨ O que fazer agora?" com estado de carregamento e esqueleto; "Pedir algo específico" com Ctrl+Enter.
85. Resposta sugerida com "Usar no campo" (via `IndyCar.inserirNoCampo`, marca no log que foi usada) e "Copiar".
86. Cartões de ação com Executar/Recusar/↶ Desfazer, estado (aguardando você/feito/feito sozinho/recusado/desfeito/erro) e avisos da validação.
87. Depois de agendar, cartão verde com a confirmação pronta para usar no campo.
88. Horários livres clicáveis (um ou "as duas opções" viram frase pronta no campo).
89. Chips 🔥/🌤/❄ + intenção, resumo e pendências; histórico da conversa recolhível.
90. Uso do dia no topo, aviso quando faltam ≤10%, aviso do modo "só sugerir".
91. Atualiza sozinho quando o cliente escreve: espera 6 s, no máximo 1× a cada 45 s por conversa, só com a aba visível e o painel aberto; mensagem do atendente cancela; chave liga/desliga lembrada.
92. Troca de conversa cancela o pedido em andamento e descarta resposta atrasada.
93. Funciona sem `window.IndyCar` (token do supabase-js, toast e área de transferência próprios) e sem o evento (não quebra nada); ouve também `indycar:pronto` e `indycar:copiloto-abrir` (abre e já consulta se ainda não consultou).
94. `esc()` em todo dado (testado com `<img onerror>` e `<script>` no resumo: nada vira tag).
95. Visual da casa com os tokens do tema (claro e escuro), 375 px sem rolagem horizontal, foco visível, `prefers-reduced-motion`.

### Testes e verificação
96. Dublê do supabase-js (`test/apoio/sb-falso.js`) e cenário fictício (`test/apoio/dados.js`) com IA roteirizada.
97. `test/horarios.test.js` (10), `test/contexto.test.js` (13), `test/copiloto.test.js` (32 — cada ferramenta, injeção, limites, autonomia, trava, desfazer), `test/rotas.test.js` (14 — servidor numa porta livre), `test/servidor.test.js` (2 — o server.js de verdade).
98. Bancada do painel (`node test/apoio/servidor-copiloto.js --servir 3212` → `/bancada`, `?sem-slot`, `?autonomia=`).
99. LEIA-ME com a seção "Copiloto da IA".
