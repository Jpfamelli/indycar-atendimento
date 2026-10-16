# Melhorias — IndyCar Atendimento

Registro numerado do que mudou e foi verificado. Uma linha por melhoria.

## Rodada de 09/10/2026 — ficha 360, saúde do ecossistema e chave do CodeWords

Contexto: desde 01/10 a chave do CodeWords é recusada (401) e nenhum WhatsApp entra ou sai.
O dono precisa enxergar isso e trocar a chave sozinho; a ficha passa a conversar com o Comunicar
(aniversário, opt-out, revisão, fila de mensagens automáticas). Verificado com `npm test`
(13 testes), servidor de mentira (`npm run mock`, porta 3211) no navegador embutido em
1440px e 375px, `server.js` real na porta 3210 (rotas sem login) e conferência só-leitura
contra o banco real (`scripts/conferir-ficha-real.mjs`).

### Ficha do cliente (painel lateral do chat)
1. Rota `GET /api/clientes/:id/ficha` (login obrigatório, id validado como UUID, limite de 120/min): lê com a chave de serviço o que o navegador não enxerga — `posvenda_envios` e `comunicar_regras_retorno` — e devolve cliente, resumo 360, último serviço concluído, próxima revisão e as 5 últimas mensagens automáticas numa ida só.
2. Bloco **Revisão**: último serviço concluído (nome, data, "há 6 meses") e **próxima revisão prevista** calculada pelas regras do Comunicar casando palavras com o serviço (sem acento/caixa); sem regra, 6 meses. Conferido no banco real: "Cambagem" caiu na regra "Alinhamento e balanceamento" (6 meses).
3. Revisão atrasada fica em vermelho na ficha, vira selo no cabeçalho e plaquinha no topo do chat ("🔧 revisão atrasada desde 01/10").
4. **Aniversário** na ficha: ver (DD/MM ou DD/MM/AAAA + idade) e editar com `<input type=date>` e a chave "só dia e mês", que grava o ano 1904 (combinado do ecossistema). Verificado: 1988-05-14 → "14/05/1988 · 38 anos"; com "só dia e mês" → `1904-05-14` no banco e "14/05" na tela.
5. Selo 🎂 "aniversário hoje" / "em N dias" (até 7) no cabeçalho da ficha e no topo do chat; 🎂 também na lista de conversas.
6. Chave **"Aceita mensagens automáticas"** (`clientes.aceita_mensagens`): ao desligar grava `aceita_mensagens_em` e o motivo "Desligado no Atendimento por <nome>"; desligada, mostra "Desligado em DD/MM · motivo". Ligar de novo limpa o motivo.
7. Cliente que não aceita ganha plaquinha 🔕 no cabeçalho da ficha, no topo do chat e na lista de conversas — o atendente vê antes de escrever.
8. Bloco **Mensagens automáticas**: 5 últimas linhas de `posvenda_envios` do cliente (pela ligação direta OU pelo telefone com e sem 55), com tipo legível, situação (na fila/enviada/falhou/cancelada/pulada), data e resposta 👍/👎/🔕/💬; link "Abrir no Comunicar ↗". Conferido com a linha real da fila (tipo avulsa).
9. Cartão de faltas fica vermelho quando o cliente já faltou (`.mini-kpi.alerta`).
10. "Cliente e veículo" virou "Cliente e carro" (vocabulário da casa).
11. Esqueleto animado da ficha enquanto as consultas não voltam (em vez de "Carregando…").
12. Ficha ignora a resposta se o atendente já trocou de conversa no meio da carga (sem ficha trocada).
13. Variáveis novas nos atalhos: `{ultimo_servico}` e `{proxima_revisao}` (ex.: "sua Troca de óleo do motor tem revisão prevista para 01/10").

### Saúde do ecossistema e CodeWords 401
14. Rota `GET /api/saude` (login): lê `vigia_estado` com a chave de serviço (cache de 30 s) e devolve `{ok, problema, desde, resumo, texto}`; o texto do caso atual é exatamente "WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações".
15. **Faixa de saúde** laranja no topo (abaixo da tarja vermelha do WhatsApp, quando as duas aparecem; o app é empurrado pela soma das alturas), com "desde 01/10", botão **Abrir Integrações** (só admin; rola até o bloco da chave) e × para dispensar por uma hora (volta se o problema continuar). Reavaliada a cada 2 min, ao voltar para a aba e depois de trocar a chave.
16. Erro de envio com 401/403 do CodeWords agora diz exatamente "WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações" (antes: "O CodeWords recusou a chave de API — confira em Configurações"); a resposta leva `codigo:'codewords-401'` e `status`, e `codewords_config.ultimo_erro` guarda o texto claro.
17. Ao receber `codigo:'codewords-401'` no envio, a tela acende a faixa de saúde na hora, sem esperar o vigia.
18. Textos de erro do envio (WhatsApp desconectado, cota, 401, fluxo 404) saíram do `server.js` para `lib/comunicar.js`, com teste.

### Integrações (admin) — chave do CodeWords
19. Bloco **Chave de API do CodeWords** com máscara (`••••••••943a`), selo de situação ("recusada (401)", "salva nos dois sistemas", "Agenda com chave diferente", "sem chave") e botão **Testar chave**.
20. `POST /api/codewords/testar-chave` (admin, 10/min): `GET {base}/run/whatsapp_device_manager/connections` com `Authorization: <chave crua>`, 20 s de limite; classifica em OK (com nº de conexões) / recusada (401/403) / outro (429, 5xx, sem resposta). Testa a salva ou uma colada, sem gastar cota.
21. Campo **colar a chave nova** + `POST /api/codewords/chave` (admin): valida o formato, testa antes e, se o CodeWords aceitar, grava em `codewords_config.api_key` E `agenda_ia_config.cw_api_key` (upsert), limpa `ultimo_erro` e zera o cache da saúde. Chave recusada = nada gravado, com aviso claro.
22. `GET /api/codewords/chave` devolve só a máscara das duas tabelas e se são iguais — a chave inteira nunca sai pela API.
23. O formulário do CodeWords deixou de ler `api_key` do navegador: `select` com colunas nomeadas (antes `select('*')` trazia a chave inteira para a tela).
24. Bloco da chave travado para quem não é admin ("só admin", campos e botões desabilitados); botão da faixa escondido para atendente.

### Barra lateral
25. Seletor **Ecossistema IndyCar** no lugar dos dois links antigos (CRM/Agenda apontavam para localhost): Agenda, CRM, ● Atendimento (aqui), Comunicar, Orçador, Site; abre em nova aba e volta a marcar o atual. Compacto na barra horizontal do celular.

### Lista de conversas e busca
26. Busca por **placa e carro** (`abc-1d23` acha `ABC1D23`, "compass" acha a Renata) e por **telefone normalizado** com ou sem +55 ("+55 12 98888" e "12988887777" acham a mesma conversa); nome sem acento ("jose" acha "José").
27. Carro e placa de cada conversa aparecem na lista (uma consulta `in` por lote de ids, com cache em memória).
28. Chip **✉ Não lidas** (filtra a lista carregada, qualquer etapa).
29. Botão **✉ Não lida** no chat: volta a contar no badge, fecha o chat e, no celular, volta para a lista.
30. Esqueleto animado da lista na primeira carga.
31. Prévia da conversa mostra "✎ rascunho…" em amarelo quando há texto não enviado.

### Chat
32. **Rascunho por conversa** em localStorage: volta ao reabrir, some ao enviar. Verificado trocando Camila → José → Camila.
33. Rolagem que **não pula** quando chega mensagem e o atendente está lendo lá em cima; pílula "↓ Novas mensagens" desce até o fim. Quem envia sempre vê a própria mensagem.
34. Indicador **"⟳ Reconectando ao tempo real…"** quando o canal cai (CHANNEL_ERROR/TIMED_OUT/CLOSED), religação automática com espera crescente (5 s → 60 s) e ao voltar a rede; ao reconectar recarrega lista e conversa e avisa "Tempo real de volta".
35. **Ctrl+Enter** envia sempre (Enter continua enviando; Shift+Enter quebra linha).
36. **Esc** fecha a gaveta da ficha no celular/tablet e, na tela estreita, volta do chat para a lista (modais e menu de atalhos continuam cuidando do próprio Esc).
37. **Contador de caracteres** discreto a partir de 500 ("620/4.000"), vermelho perto do teto; `maxlength=4000`, o mesmo limite do servidor.
38. Menu de atalhos (`/`) mostra a **prévia com as variáveis já trocadas** ("Bom dia, Camila! … Corolla 2020"); variável sem valor fica marcada em amarelo para completar antes de enviar.

### Relatórios
39. `GET /api/relatorios` ganhou o bloco `comunicar` (fila do Comunicar no período, lido pelo servidor): total, enviadas, respondidas, positivas, pediram para parar, falharam, pendentes, agendaram depois e contagem por tipo.
40. Aba Relatórios ganhou o bloco **"Mensagens automáticas (Comunicar)"** só com números (4 cartões + tabela por tipo) e link "Abrir o Comunicar ↗".

### Tema, acessibilidade e robustez
41. Troca de tema marca `<html data-trocando-tema>` e desliga todas as transições por um quadro (rAF duplo + fallback de 120 ms para aba em segundo plano); `body` segue sem transition. Verificado: fundo `rgb(10,10,11)` → `rgb(234,236,240)`.
42. Todos os elementos novos usam os tokens `var(--…)`; faixa de saúde tem variante para o tema claro.
43. a11y: `aria-label` nos botões só de ícone (📎, 🎤, ‹), na busca, no campo de mensagem e no seletor do ecossistema; `role="status"`/`aria-live="polite"` no toast, na faixa de saúde, na pílula de tempo real e no contador.
44. Mobile ≤900 px revisado: faixa de saúde enxuta (≤600 px esconde ícone e "desde"), seletor do ecossistema cabe na barra, lista↔chat com Esc, sem rolagem horizontal (verificado em 375 px).
45. Respostas `/api/*` saem com `Cache-Control: no-store` e `X-Content-Type-Options: nosniff`; estáticos também com `nosniff`.
46. Corpo acima do limite responde `413` em JSON ("Conteúdo grande demais para esta rota.") em vez de derrubar a conexão; `readBody` drena o resto sem guardar.
47. Novas rotas com limite por usuário (ficha 120/min, chave 10/min) e erros sempre em JSON (400 id inválido, 401 sem login, 403 sem ser admin, 404 cliente, 429, 503 sem chave de serviço).

### Base de código, testes e documentação
48. `lib/comunicar.js`: regras puras (normalização de telefone, variantes com/sem 55, soma de meses segurando o fim do mês, próxima revisão, máscara e validação da chave, classificação do teste, textos de erro e de saúde, resumo do Comunicar, rótulos de tipo).
49. `test/comunicar.test.js` com 13 testes (`npm test`), todos passando.
50. `scripts/mock-server.mjs` (`npm run mock`, porta 3211): serve o `public/` real com um dublê do supabase-js (encadeia `.from().select().eq()…`, insert/update/upsert em memória) e inventa as rotas `/api/*`, incluindo o 401 do CodeWords, a saúde, a ficha e a troca de chave; `/?papel=atendente` e `/?saude=ok`.
51. `scripts/conferir-ficha-real.mjs`: conferência só-leitura da ficha, da saúde e da máscara contra o banco real (usa `SO_FUNCOES=1`, que faz o `server.js` exportar as funções sem abrir porta).
52. `.claude/launch.json` da pasta ganhou a entrada `mock` (porta 3211); `package.json` ganhou `test` e `mock`.
53. `LEIA-ME.md` atualizado: situação da chave 401 e como trocar, ficha nova, busca/filtros/rascunho, ecossistema, rotas novas, como testar sem senha, mapa de arquivos.
54. Cópia local da Edge Function `codewords-webhook` conferida byte a byte com a publicada (versão 12): idêntica; commit só de registro, sem nenhum deploy da função.


# Rodada 2 (09/10/2026, tarde) — IA copiloto e tela

## 
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


## 
Arquivos: `public/app.js`, `public/styles.css`, `public/index.html` (menos as duas tags do copiloto), `public/sw.js`,
`public/manifest.json`, `scripts/mock-server.mjs`. Cada linha foi verificada no servidor de mentira
(`PORT=3212 MOCK_MUITAS=400 node scripts/mock-server.mjs`) com Chrome via puppeteer-core em 1440×900 e 375×812
(54 conferências automáticas, todas OK, sem erro de console), `node --check` e `npm test` (87 passando).

### Contrato com o copiloto (public/copiloto.js)
1. `indycar:conversa` com `{conversaId, clienteId, telefone, nome}` ao abrir/trocar de conversa (só quando troca de verdade) e `{conversaId:null}` ao fechar, voltar para a lista (celular/Esc), marcar não lida ou excluir.
2. `indycar:mensagem` com `{conversaId, direcao, id}` quando chega mensagem pelo tempo real na conversa aberta, quando o atendente envia (com o id da linha gravada) e quando sai um arquivo.
3. `window.IndyCar` desde o carregamento: `authCabecalhos()`, `toast(msg, tipo)`, `inserirNoCampo(texto)` (põe no campo, foca, não envia, devolve `false` sem conversa; usa `insertText`, então Ctrl+Z desfaz), `recarregarFicha()`, `recarregarConversa()`, `abrirConversa(id)`, getters `papel` e `conversa`.
4. `<section id="copilotoSlot">` no topo da coluna da ficha, FORA do `#fichaConteudo` (a ficha é redesenhada a cada carga e o copiloto não é apagado junto); visível sempre que há conversa aberta, escondido ao fechar.
5. Botão ✨ no topo do chat (e Alt+I): abre a ficha (gaveta no celular/tablet) rolada até o topo, foca o slot e dispara `indycar:copiloto-abrir`.
6. `indycar:pronto` depois do login (para quem carregou antes de ter perfil).
7. `?conversa=<uuid>` abre a conversa; `?tel=<telefone>` usa `GET /api/conversa-por-telefone` (reserva: procura direto em `conversas.telefone_e164`); telefone sem conversa abre "Nova conversa" já preenchida.
8. O endereço acompanha a conversa aberta (`?conversa=` por `replaceState`) — dá para copiar, favoritar e recarregar sem perder o lugar; botão 🔗 copia o link.
9. Mock: rotas do copiloto nos formatos finais (`/api/ia/contexto/:id` com `ficha.horariosSugeridos`, `POST /api/ia/copiloto` com ações `precisa_clique/reversivel` e `horarios_sugeridos` em objetos, `acoes/:id/executar|recusar|desfazer`, `GET /api/ia/acoes`, `/api/ia/uso`, `/api/ia/config`, `/api/ia/horarios`, `/api/conversa-por-telefone` com 404 `{conversaId:null}`).
10. Mock serve `copiloto.js/.css` do `public/`, ou um de teste (`MOCK_COPILOTO=`), ou vazio — nunca 404 — e injeta as duas tags se o index ainda não as tiver.
11. Mock: `__mockTempoReal(evento, tabela, linha)` no console simula o tempo real (usado para conferir o `indycar:mensagem` de entrada).
12. `toast(msg, tipo)`: borda vermelha para erro e verde para ok (o copiloto manda o tipo; sem tipo, deduz do ⚠️/✅) e fica mais tempo na tela quando o texto é longo.

### Caixa de entrada (2.400+ conversas)
13. Paginação incremental: 150 por vez com rolagem infinita (IntersectionObserver) e botão "Carregar mais" de reserva; antes cortava em 200 e o resto sumia. Verificado: 150 → 300 ao rolar.
14. Cada carga tem "geração": resposta velha (filtro trocado no meio, rajada do tempo real) é descartada em vez de pintar por cima.
15. Tempo real em rajada vira UMA recarga a cada 600 ms (antes: uma por evento).
16. Lista só mexe no DOM se o HTML mudou — não perde foco, rolagem nem hover a cada evento.
17. Um ouvinte de clique para a lista inteira (antes: 3 por linha, recriados a cada render).
18. `content-visibility:auto` nas linhas: o navegador não desenha o que está fora da tela.
19. Contadores no banco: Não lidas, ★ Meus e Sem dono (além de Novos hoje, Aguardando e Disparos), no máximo uma rodada a cada 15 s.
20. Badge da barra e título da aba contam conversas não lidas NO BANCO (antes: soma só das carregadas) e mexem na hora ao abrir/marcar não lida.
21. Título da aba com contador "(61) IndyCar · Atendimento" e selo no ícone do app instalado (`setAppBadge`).
22. Rodapé da lista: "150 conversas na tela · role para ver mais" / "N resultados para …".
23. Ordenar: Mais recentes / Esperando há mais tempo (traz do banco quem espera, mesmo fora da página) / Não lidas primeiro — guardado neste navegador.
24. Selo de espera colorido ⏱ (verde < 15 min, âmbar < 1 h, vermelho pulsando depois), para quem tem mensagem sem ler ou espera consultor; atualiza sozinho a cada minuto.
25. Filtro de dono segmentado Todos / ★ Meus / Sem dono, aplicado no banco (paginação certa) e combinável com qualquer aba.
26. 🔥 Quentes: esperando consultor + etapa de orçamento com conversa nos últimos 3 dias.
27. 📅 Amanhã: clientes com horário na Agenda amanhã (aguardando/confirmado/em atendimento).
28. 🔧 Revisão vencida: último serviço há 6+ meses e nada marcado (`v_cliente_360`).
29. 🎂 Aniversário: hoje ou nos próximos 7 dias (vale o ano 1904), com "🎂 em Nd" na linha.
30. "Não lidas" e "Novos hoje" filtram no banco (antes só entre as 200 carregadas).
31. A aba "Aguardando consultor" agora ordena de verdade pelo mais antigo (a ordem por `aguardando_desde` era a segunda chave e não valia).
32. Busca com respiro de 120 ms e, com 3+ letras, também no BANCO inteiro (nome, telefone, placa, carro); quem estava fora da página aparece marcado "🔎 no banco". Verificado: "Teste 399" achado com só 150 carregadas.
33. ★ Pegar: conversa sem dono assume com UM clique, na lista e no topo do chat (Alt+M).
34. Dono no topo do chat, clicável para passar a um colega.
35. O menu de dono agora fecha ao clicar fora, com Esc e ao redimensionar (só o de etapas fechava).
36. Teclado na lista: ↑ ↓ / J K andam, Home/End, Enter abre já com o cursor no campo; foco itinerante (uma parada de Tab só).
37. Linhas com `aria-label` (nome, não lidas, espera) e `aria-current` na aberta; lista `role=list`.
38. Estados vazios por filtro com ícone e ação (+ Nova conversa); erro na primeira carga mostra "Tentar de novo" em vez de esqueleto eterno.
39. Chips numa linha só que rola para o lado (roda do mouse também), com o chip ativo sempre à vista — antes 12 filtros empilhavam 7 linhas.
40. `?filtro=` no endereço abre direto num filtro (usado pelos atalhos do app instalado).

### Chat
41. Mensagens: as 300 MAIS NOVAS (antes vinham as 500 mais antigas e o fim de conversas longas não aparecia) + "↑ Carregar mensagens anteriores" sem pular a leitura.
42. Envio otimista: a mensagem aparece na hora com ⏳.
43. Situação de entrega: ✓ entregue, ⏳ enviando, • sem confirmação (antigas), ⚠ não saiu — gravada em `whatsapp_mensagens.status/erro` (antes toda mensagem do painel ficava "pendente" para sempre).
44. "Tentar de novo" na mensagem que não saiu (reaproveita a mesma linha; se nem gravou, grava de novo).
45. Tempo real de UPDATE nas mensagens: ✓/⚠ muda sem recarregar o chat.
46. Separador de data "Hoje", "Ontem", dia da semana, "12/09" ou "12/09/2025".
47. Marca "— N não lidas —" no ponto em que o atendente parou.
48. Links clicáveis com segurança: só http/https (e www.), `noopener noreferrer nofollow`, pontuação final fora do link, o resto escapado.
49. Quebras de linha da mensagem respeitadas (`pre-wrap`).
50. Mensagens seguidas da mesma pessoa (< 5 min) coladas num bloco.
51. ⧉ Copiar o texto de uma mensagem (aparece ao passar o mouse).
52. Busca dentro da conversa (🔍 / Alt+F): marca os trechos, "2 de 7", Enter/Shift+Enter e ↑ ↓ andam, Esc fecha.
53. Esqueleto de mensagens ao abrir e "Tentar de novo" se a carga falhar.
54. Links assinados dos anexos guardados por 50 min (antes: um pedido novo por foto a cada mensagem nova) e um ouvinte só para o chat inteiro.
55. Conversa aberta com a aba em segundo plano não é mais marcada como lida sozinha.
56. Telefone do topo legível "(12) 99683-0111" e clique copia.
57. Topo do chat enxuto: ícones (🔍 🔗 ⛶ ✨), Assumir/Devolver, Agendar, Ficha e "⋯" com Não lida, Classificar, Situação e as lixeiras (antes 3 linhas de botões).

### Envio de arquivo
58. Prévia antes de mandar (miniatura ou nome/tamanho), com legenda editável que já vem do campo.
59. Colar imagem (Ctrl+V de print) no campo abre a prévia.
60. Arrastar arquivo para o chat ("Solte para enviar") abre a prévia.
61. Tamanho/tipo conferidos ANTES de ler o arquivo, com mensagem clara ("tem 18,2 MB — o máximo é 15 MB").

### Respostas rápidas
62. ⚡ abre as respostas rápidas sem digitar "/"; com texto já escrito, o atalho entra onde está o cursor (não apaga).
63. ★ Favoritos por pessoa (no menu e na aba Atalhos) sempre no topo; depois os mais usados (com "12×").
64. Busca do "/" sem acento e também pelo texto da mensagem.
65. Contagem de uso corrigida: incrementa o valor local (antes gravava sempre o mesmo número).
66. Aba Atalhos: favoritos e mais usados primeiro, selo "🏆 mais usado", cartões abrem por teclado, estado vazio com "+ Novo atalho".
67. Menu do "/" acessível: `listbox`/`option`, `aria-activedescendant` e clique sem tirar o foco do campo.

### Teclado, avisos e modo foco
68. Tela "?" com os atalhos de teclado (inclui as etapas numeradas) — também em Configurações › ⌨.
69. Ctrl+K ou "/" vão para a busca; Alt+↑/↓ conversa anterior/próxima; Alt+N nova conversa.
70. Alt+1…9 marca a etapa do funil na ordem das colunas; Alt+E abre o menu de etapas. Verificado: Alt+1 → "Novo contato".
71. Alt+U marca como não lida; Alt+M pega para mim; Alt+I copiloto; Alt+Z modo foco.
72. Modo foco (⛶): some a barra lateral e a lista, fica chat + ficha; lembrado neste navegador.
73. Avisos de mensagem nova: notificação do navegador (com permissão) só com o painel em segundo plano, clicar abre a conversa; 🔔/🔕 na lista e cartão em Configurações › Minha conta com "Testar aviso".
74. Som discreto opcional (WebAudio, sem arquivo), um "plim" por rajada.

### Ficha e Agendar
75. Edição na hora de nome, carro e placa (clique no valor, Enter salva, Esc cancela); nome atualiza a conversa e o topo do chat.
76. Placa normalizada (sem hífen, maiúscula) e conferida (ABC1234 ou ABC1D23).
77. Links do cliente para Agenda, CRM e Comunicar (com `?tel=`) e 📋 copiar telefone.
78. Telefone da ficha legível.
79. Ficha mais larga (330 px) em tela ≥ 1400 px — o copiloto mora no topo dela.
80. Gaveta da ficha no celular/tablet: botão × e tocar fora fecha; começa abaixo das faixas de aviso (antes ficava por baixo da faixa laranja).
81. Agendar: horários livres de `/api/ia/horarios` (as duas sugestões da IA com ✨ + um por período/dia); um toque preenche data e hora; trocar o serviço atualiza; reserva pelo contexto do copiloto.
82. Agendar: data padrão = próximo dia de oficina (pula domingo, no fuso de SP), mínimo hoje, aviso para domingo e data passada; hora de 08:00 a 17:00 de 30 em 30 min.

### Funil, relatórios e equipe
83. Funil: filtro por nome/telefone/placa/carro e "Só meus".
84. Funil: arrastar no celular — segure o cartão, ele acompanha o dedo, a coluna acende e o quadro rola sozinho na borda.
85. Funil: cartões focáveis; ← → mudam de etapa, Enter abre, Espaço abre o menu. Verificado.
86. Funil: dono no cartão e esqueleto de colunas na primeira carga.
87. Relatórios: atalhos Hoje / Este mês / Mês passado; data inicial depois da final avisa.
88. Relatórios: comparação com o período anterior de mesmo tamanho em cada cartão (▲/▼ %, pontos na conversão; perdidos subindo = vermelho).
89. Relatórios: esqueleto e descarte de resposta velha ao trocar o período; erro com "Tentar de novo".
90. Equipe: cada pessoa mostra "12 clientes em aberto · 3 sem ler · 1 esperando consultor".
91. Tokens `--borda` e `--texto-fraco` (usados na equipe sem existir) agora definidos.

### Offline, PWA, acessibilidade, tema e celular
92. Sem internet: faixa avisa; a mensagem enviada vai para uma fila local ("🕓 na fila"), sobrevive a recarregar a página e sai sozinha quando a conexão volta.
93. Modais: `role=dialog`, `aria-modal`, título ligado, × com nome, foco no primeiro campo, Tab preso dentro, Esc fecha qualquer um (o de serviço não fechava) e o foco volta para quem abriu; clicar no fundo fecha todos.
94. Link "Pular para as conversas" e foco visível em linhas, plaquinhas, donos, chips, cartões, estrelas e links.
95. `role=log`/`aria-live` nas mensagens; `role=toolbar`/`aria-pressed` nos filtros.
96. Toast acima da barra de envio e sem pegar clique (antes cobria ⚡ 📎 e o Enviar).
97. 375 px: chips numa linha, topo do chat em 2 linhas com o resto no "⋯", "Devolver" curto, campo + Enviar em cima e ✨ ⚡ 📎 🎤 embaixo; sem rolagem horizontal (lista, chat e funil verificados).
98. Barra de envio por container query: com lista e ficha abertas o chat fica estreito e o "Sugerir" vira só ✨ em vez de espremer o campo.
99. Tema: sem escolha salva, segue o do sistema (e não grava a escolha sozinho no primeiro carregamento); novos elementos só com tokens — conferido no claro.
100. sw.js v12: nunca cacheia /api nem nada de fora; só guarda resposta boa (antes um 404/500 entrava no cache); navegação com `?conversa=` cai na casca; copiloto.js/.css no CORE; clique na notificação traz o painel.
101. manifest: `id`, categorias e atalhos do app instalado (Não lidas, Aguardando consultor, Clientes de amanhã).


## Coordenador
1. Título do copiloto não quebra mais em coluna estreita (cabe numa linha, com reticências).

## Coordenador (fim da rodada 2)
2. Gatilho `at_origem_pelo_site`: cliente que chega pelo botão do site ("(site/<serviço>)" no texto) tem o lead marcado com UTM do site e o serviço — o CRM e o Tráfego pago passam a enxergar o site como canal.
3. Resumo do dia volta a funcionar nos modelos 5.5 (ferramenta em modo auto) e o Sonnet não gasta o teto pensando nas chamadas curtas.


# Rodada 3 (13/10/2026) — equipe, segurança, login, tarefas

## 
## Rodada 3 (13/10/2026)

Papel: "Atendimento — servidor, segurança e equipe" (server.js, lib/**, test/**, scripts/sql/**, scripts/*.mjs, LEIA-ME.md, package.json).
Verificado com `npm test` (162 testes, 0 falhas; 75 novos com dublês do banco e da Auth Admin API), `node scripts/segredos.mjs`
(versionados e histórico), `npm audit` (0 vulnerabilidades), `server.js` real na porta 3210 (curl: cabeçalhos, CSP, CORS,
porteiro com o Supabase de verdade, `.env` bloqueado) + Chrome (puppeteer-core) em 1440 e 375 px sem nenhuma violação de CSP,
e conferência SÓ LEITURA contra o banco real (`scripts/conferir-equipe-real.mjs`: equipe com último login/MFA pelo Auth Admin,
rodízio, sem dono, carga, auditoria, números do resumo). Nenhum usuário real criado; nada gravado no banco.

### Porteiro e acesso por app
1. Porteiro único (`lib/acesso.js`) em TODA rota `/api/` com token: confere login, perfil ativo, papel de equipe e o app `atendimento` em `perfis.apps` (admin sempre).
2. Perfil desativado → 401 `{codigo:'desativado'}` (antes: 401 genérico "faça login").
3. Sem o app ou papel `agenda` → 403 `{codigo:'sem_acesso_app', apps:[{app,nome,link}]}` com os apps que a pessoa pode usar.
4. Verificação em duas etapas cobrada no servidor: quem tem fator TOTP verificado e manda token `aal1` recebe 401 `mfa_pendente` (só `GET /api/eu` responde).
5. Token vencido recusado sem ir ao Supabase (`sessao_expirada`); token de ninguém → `sessao_invalida`.
6. Supabase Auth fora do ar → 503 `auth_fora` (não confunde com senha errada); sem chave de serviço → 503 (fail-closed).
7. Cache do porteiro limitado (2.000 tokens, nunca além do `exp` do JWT) e esquecido na hora quando a pessoa é desativada/editada.
8. Último acesso: `ultimo_acesso_em` e `ultimo_app='atendimento'` gravados no máximo a cada 5 min (e não regrava logo depois de reiniciar se o banco já tem acesso recente).
9. `GET /api/eu`: id, nome, email, papel, apps, cargo, telefone, avatar_cor, equipe_id, recebe_leads, precisa_trocar_senha, mfa {ativo, nivel}, preferencias, ultimo_acesso_em e `pode` (o que a tela mostra).
10. `PATCH /api/eu`: nome, cargo, telefone, cor do avatar e preferências validadas (tema, notificações, expediente, ausente_ate, copiloto_automatico, lembrar_email); papel/apps nunca mudam por aqui.
11. `POST /api/eu/senha-trocada`: desliga a troca obrigatória pelo servidor (cache atualizado) e audita.

### Equipe (admin gerencia; gestor só vê)
12. `POST /api/equipe` convida: login no Supabase Auth (service role, `email_confirm:true`), senha temporária forte gerada no servidor e devolvida UMA vez (a senha que a tela mandava é ignorada).
13. Senha temporária em 3 blocos de 4 (ex.: Kp7x-Qm4r-Tz9w), maiúscula+minúscula+número, sem letras que se confundem (~69 bits).
14. Perfil do convidado completo: papel, apps, equipe, cargo, telefone, recebe_leads, `precisa_trocar_senha=true`, `convidado_por`.
15. Apps padrão por papel (admin/gestor: todos; atendente: sem Tráfego pago; agenda: só Agenda) e papel `agenda` sempre fora do rodízio.
16. Se o perfil não grava, o login recém-criado é apagado (não fica conta solta sem papel).
17. E-mail repetido → 409 `email_existe`; se a pessoa está desativada, a resposta manda reativar em vez de convidar.
18. `PATCH /api/equipe/:id` edita papel, apps, equipe, cargo, telefone, nome e rodízio, devolvendo `mudou`; nada mudou = sem gravar e sem auditoria.
19. Só admin muda alguém (atendente e gestor → 403; testado "atendente não muda papel" na função e por HTTP).
20. Ninguém muda o próprio papel (409 `proprio_papel`).
21. O último admin ativo não é rebaixado nem desativado (409 `ultimo_admin`).
22. A última pessoa do rodízio não sai dele (409 `ultimo_rodizio`).
23. `POST /api/equipe/:id/desativar` derruba o acesso: `ativo=false`, `desativado_em/por`, sai do rodízio, cache do porteiro esquecido e ban de 100 anos no Auth (o refresh token para de valer). A Admin API não faz signOut sem o JWT da pessoa — documentado.
24. Desativar com `redistribuir:true` devolve as conversas abertas da pessoa ao rodízio (e os leads dela acompanham o novo dono).
25. Ninguém desativa a si mesmo (409 `proprio_acesso`).
26. Auth fora na hora de desativar: o acesso cai aqui mesmo assim, com aviso claro (`sessoes:'nao_derrubadas'`).
27. `POST /api/equipe/:id/reativar` tira o ban primeiro; se o Auth não liberar, não reativa pela metade (502).
28. `POST /api/equipe/:id/senha` gera nova senha temporária + troca obrigatória; recusa a própria senha e pessoa desativada.
29. `POST /api/equipe/:id/mfa/remover` tira os fatores TOTP de quem perdeu o celular (Auth Admin `mfa.deleteFactor`).
30. `GET /api/equipe` (admin e gestor): último login (Auth) e último acesso (perfil), apps, MFA verificado, situação (ativo / convite_pendente / precisa_trocar_senha / desativado), banido, quem convidou, carga (conversas abertas, tarefas abertas e atrasadas), equipes, papéis e `podeEditar`.
31. Lista da equipe continua saindo com o Auth fora do ar (aviso e MFA "não sei").
32. `GET /api/equipe/nomes` sem e-mail nem telefone, com `atende` (pode receber conversa) e cor do avatar.
33. Rotas antigas da tela (`/api/equipe/papel|ativo|rodizio`) continuam aceitas, agora com as mesmas regras e auditoria.
34. Papel `gestor` recusado pelo banco vira 409 `papel_nao_aceito` com texto claro (a constraint da base ainda não aceita; proposta em scripts/sql).
35. Senha temporária nunca vai para console, log, auditoria, registro de chamadas nem banco (teste captura tudo e procura a senha).

### Auditoria
36. `registrar_auditoria` nas ações sensíveis: convidar, editar, desativar, reativar, redefinir senha, remover MFA, primeiro acesso, senha trocada.
37. … excluir conversa e apagar mensagens (com contagem; telefone só os 4 finais).
38. … trocar a chave do CodeWords (sem a chave), parear/reinscrever WhatsApp e teste de envio.
39. … mudar a configuração da IA (só os nomes dos campos) e executar/desfazer ação da IA.
40. … assumir conversa de outra pessoa, transferir (com motivo), distribuir e redistribuir.
41. … criar tarefa, exportar auditoria e rodar automação.
42. Nada de segredo nos detalhes (senha/token/chave viram "•••", em qualquer nível).
43. `GET /api/auditoria` (admin): filtros por pessoa, tabela, ação (prefixo, ex.: `equipe`), app e período em dias de São Paulo; paginação com total e páginas; nome de quem fez (ou "sistema").
44. `GET /api/auditoria/exportar` (admin): CSV com `;` e BOM (abre certo no Excel), data de São Paulo, proteção contra fórmula (=,+,-,@), até 5.000 linhas, nome `auditoria-AAAA-MM-DD.csv` — e a exportação fica auditada.

### Tarefas e IA
45. `GET /api/tarefas/equipe` (gestor/admin): por pessoa abertas, atrasadas, vencem hoje, urgentes, sem prazo, conversas abertas e aguardando consultor; quem tem atrasada vem primeiro; total com "sem responsável".
46. `GET /api/tarefas/equipe?pessoa=<id>`: tarefas de alguém (atendente só as dele), com `atrasada`.
47. `POST /api/tarefas`: validação (título, UUIDs, prioridade 1–3, prazo; só o dia = 17h30), `criado_por` do servidor, atendente cria para si e gestor para qualquer um; responsável inativo recusado.
48. Prazo padrão: hoje 17h30 ou o próximo dia útil (pula domingo).
49. Copiloto ganhou a ferramenta `criar_tarefa` (título, responsável pelo nome, prazo, prioridade) e passa a sugerir tarefas para a equipe.
50. O prompt recebe a lista EQUIPE só com nomes (sem e-mail/telefone; papel agenda fora) e as tarefas já abertas na conversa.
51. Responsável achado pelo nome (sem acento) ou só pelo primeiro nome quando não há dúvida; vazio = dono da conversa.
52. Autonomia respeitada: no `automatico` cria sozinha só a tarefa do dono da conversa/quem pediu; para outra pessoa sempre pede clique; no `sugerir` não executa.
53. Tarefa repetida na conversa, prazo passado/longe e nome fora da equipe voltam como erro para a IA corrigir.
54. Executar confere de novo se o responsável segue ativo; desfazer cancela a tarefa.

### Distribuição para mais funcionários
55. Rodízio novo (`lib/rodizio.js`): só quem está ativo, no rodízio, com papel de equipe e o app Atendimento (admin sempre), fora de férias (`preferencias.ausente_ate`).
56. Ganha quem tem menos conversas abertas; empate → quem recebeu há mais tempo; quem nunca recebeu vem antes.
57. Horário respeitado: prefere quem está no expediente dele (`preferencias.expediente`, padrão seg–sáb 8h–17h30); ninguém no horário → cliente não fica sem dono.
58. `POST /api/conversas/:id/transferir {para, motivo}`: motivo obrigatório, atendente só passa a conversa dele, gestor qualquer uma, destino precisa poder atender, grava com compara-e-troca (não atropela quem mexeu no meio) e evento "transferida".
59. Lead acompanha o dono (assumir, transferir, distribuir, redistribuir): leads abertos do cliente sem responsável ou do dono antigo passam para o novo; lead de outra pessoa e lead fechado não mudam.
60. `POST /api/conversas/:id/distribuir`: dá dono pelo rodízio (só se ainda está sem dono) e atualiza `ultimo_lead_em`.
61. `GET /api/conversas/sem-dono?minutos=15&dias=30` (gestor/admin): atendimento aberto sem dono, com espera em minutos, prévia e link; o acúmulo antigo da importação não afoga o de hoje.
62. `GET /api/rodizio` (gestor/admin): próximo da fila, fila com carga e quem está fora (e por quê).
63. Assumir conversa de outra pessoa agora leva o lead junto e fica auditado.
64. Excluir conversa e apagar mensagens liberados para o gestor (como o RLS novo), com limite de 20/min.
65. Relatórios liberados para o gestor.

### Automações do servidor (só no Render ou com `AUTOMACOES=1`)
66. Cliente esperando resposta há 30+ min no horário da oficina → notificação para gestores/admin e o dono (uma por mensagem, chave única; `[sistema]` não conta; nada vai por WhatsApp).
67. Resumo do fim do dia (seg–sáb, 17h40) para gestores/admin: conversas novas, mensagens, respostas, agendamentos, tarefas feitas e pendências (sem dono, aguardando consultor, tarefas atrasadas).
68. Dono inválido: conversa nova que caiu com quem não pode atender (ex.: papel agenda) volta ao rodízio, auditada.
69. Limpeza diária: notificações lidas há 60+ dias, eventos do CodeWords com 120+ dias (cópias de segurança de exclusão nunca saem) e rascunhos de resposta da IA nunca usados há 30+ dias.
70. Preferências respeitadas (`notificacoes.espera` / `.resumo_dia` = false desliga); ciclo a cada 5 min sem sobreposição, uma falha não derruba as outras.
71. `POST /api/automacoes/rodar {tarefa}` (admin) roda uma agora (resumo e limpeza forçados), auditado.

### Segurança do servidor
72. Cabeçalhos em toda resposta: nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy (microfone só do próprio app), COOP e CORP.
73. CSP na interface com o hash de cada `<script>` embutido calculado na hora (sem `unsafe-inline` em script), `frame-ancestors 'none'`, Supabase só no connect/img/media; conferido no Chrome sem nenhuma violação.
74. HSTS só quando a conexão é https de verdade atrás do proxy do Render (localmente não manda).
75. CORS só para os apps IndyCar em todas as rotas `/api/` (antes só nas da IA), pré-voo com PATCH/DELETE; origem estranha → 403 sem cabeçalho.
76. IP real atrás do proxy (antes o limite do primeiro acesso juntava todo mundo no IP do Render); X-Forwarded-For ignorado fora da nuvem.
77. Teto geral de 900 requisições/min por IP e freio de 30 tokens inválidos em 10 min por IP (429 com Retry-After).
78. Limitador com memória limitada que, ao encher, tira só o que venceu/mais antigo (antes zerava todos os limites de uma vez).
79. JSON inválido → 400 `json_invalido` (antes virava `{}` em silêncio); corpo grande recusado já pelo Content-Length (413).
80. Arquivos: só de dentro de `public/` (corrigido o `startsWith` que deixava passar pasta vizinha), sem arquivo escondido (.env/.git) nem byte nulo; só GET/HEAD (405); HTML e sw sem cache, resto 1 h.
81. Erro inesperado sem detalhe interno: o cliente recebe só um código para o suporte e o detalhe vai para o log (rotas de assumir, excluir, ficha, classificar, sincronia, relatório e copiloto também).
82. `GET /api/status` público mínimo (app, versão, hora) para o vigia.
83. `npm run segredos`: procura chaves (Anthropic, OpenAI, CodeWords, Supabase service_role/secret, GitHub, AWS, Google, Stripe, Slack, Meta, chave privada, senha em URL, senha escrita) nos arquivos versionados, sem imprimir o segredo; `--todos` inclui os ignorados.
84. `npm run segredos:historico`: varre todo o histórico do Git.
85. Senha inicial que estava escrita no LEIA-ME removida (o login dela não existe mais no Auth; segue no histórico — avisado).
86. `npm audit`: 0 vulnerabilidades; `npm run verificar` = sintaxe + segredos + audit + testes.
87. `SINCRONIA=0` desliga a sincronia com o aparelho (conferências locais sem efeito no banco).


## 
Arquivos: `public/acesso.js` (novo), `public/equipe.js` (novo), `public/tarefas.js` (novo), `public/app.js`, `public/index.html`,
`public/styles.css`, `public/sw.js`, `scripts/mock-server.mjs`. Verificado no servidor de mentira (`PORT=3221 node scripts/mock-server.mjs`)
com roteiro de navegador (puppeteer-core + Chrome) em 1440×900 e 375×812, cada papel (admin, gestor, atendente, agenda, desativado,
sem o app, troca obrigatória, com MFA, deslogado e "servidor sem as rotas novas"): 220 conferências, todas OK (`node scripts/roteiro-tela.cjs`, 220/220); `node --check`
nos 4 scripts; `npm test` (162 passando — nada do servidor quebrou).

### Login (padrão comum, itens 1–2)
1. Botão 👁 mostrar/esconder senha (aria-pressed e rótulo que muda) no login e na nova senha.
2. Aviso "⇪ Caps Lock ligado" ao digitar a senha; some ao desligar ou sair do campo.
3. "Lembrar meu e-mail" (só o e-mail fica no aparelho; a senha nunca).
4. "Manter conectado": desmarcado, o login vai para o sessionStorage e some ao fechar o navegador (computador compartilhado).
5. E-mail sem @/domínio avisa antes de chamar o servidor.
6. Mensagens claras e separadas: senha errada, sem internet (testado com o navegador offline), muitas tentativas, desativado, e-mail não confirmado.
7. Espera progressiva depois de 5 erros seguidos (30 s, 1 min, 2 min… até 5 min) com contagem no botão, sobrevive a recarregar a página, e sugere "Esqueci a senha"; avisa "mais N tentativas" antes de travar.
8. O erro some quando a pessoa começa a corrigir (menos durante a espera) e a senha é limpa do campo depois de entrar.
9. "Esqueci a senha": vista própria com o e-mail já preenchido, `resetPasswordForEmail(email, {redirectTo: <app>})`, aviso do limite do e-mail grátis e da senha temporária do admin.
10. Volta do link do e-mail (`PASSWORD_RECOVERY` ou `#type=recovery`): tela "Crie uma senha nova" por cima de tudo, mesmo se o app já tinha aberto.

### Troca obrigatória, duas etapas e acesso por app (itens 3–4)
11. `precisa_trocar_senha`: depois do login abre "Olá, Fulano! troque a senha temporária" antes do app.
12. Regras ao vivo (8+ caracteres, diferente do e-mail, as duas iguais) com ✓ verde e medidor de força (muito fraca → forte); senha óbvia é recusada.
13. Depois de gravar com `updateUser`, chama `POST /api/eu/senha-trocada` (servidor audita) — sem a rota, desliga direto no perfil.
14. Verificação em duas etapas na entrada: com fator verificado e nível aal1, pede o código de 6 dígitos (envia sozinho ao completar, `autocomplete=one-time-code`), erro explica "confira o relógio do celular".
15. Sem o app Atendimento (ou papel agenda): tela "Sem acesso a este app" com links para os apps liberados da pessoa e "Sair" (Bianca → CRM e Comunicar; Franklin → só Agenda).
16. Desativado ao entrar: volta ao login com "Seu acesso foi desativado. Fale com o administrador.".
17. "Sair e entrar com outra conta" nas telas de código, nova senha e sem acesso.

### Sessão e respostas do servidor (item 9)
18. Vigia único do `fetch` das rotas `/api/` do app: 401 `desativado` → login com o motivo (nunca "sessão expirou").
19. 401 `mfa_pendente` → abre a tela do código no meio do uso.
20. 403 `sem_acesso_app` → tela de sem acesso usando a lista `apps:[{app,nome,link}]` que o servidor manda.
21. 429 `muitas_tentativas` → aviso "espere um minuto" (no máximo um a cada 20 s), sem derrubar nada.
22. 401 de token vencido tenta `refreshSession` uma vez (uma só para várias chamadas juntas); só sem renovação volta ao login com "Sua sessão expirou".
23. A cada 5 min (e ao voltar para a aba) confere `GET /api/eu`: desativado, sem o app ou papel mudado agem na hora (papel mudado recarrega a tela).
24. Último acesso: o porteiro do servidor grava; a tela só grava sozinha (no máximo a cada 5 min) se o servidor não tiver `/api/eu`.
25. Entrar de novo depois da sessão cair recarrega a página limpa (nada ligado duas vezes).
26. `iniciar()` só roda depois de todos os scripts (DOMContentLoaded) — os módulos novos nunca chegam atrasados.

### Menu do perfil (item 5)
27. Avatar no canto vira botão com menu: nome, e-mail, papel colorido; Meu perfil, Trocar senha, Duas etapas (selo "ligada"), Preferências de aviso, Tema, Sair, Sair de todos os aparelhos.
28. Menu com teclado: setas andam, Esc fecha e devolve o foco, Tab fecha; cabe na tela no celular.
29. Cada item leva ao cartão certo em Configurações › Minha conta, rolando e piscando o contorno.
30. Meu perfil: nome, cargo, telefone (validado com DDD) e cor do avatar (10 cores) com prévia ao vivo; grava por `PATCH /api/eu` (sem a rota, direto no perfil); e-mail, papel e apps só leitura ("Seus apps: …").
31. A cor escolhida vale no avatar da barra, nas mensagens, nos donos, nas tarefas e na presença.
32. Trocar senha em Minha conta recusa a senha igual ao e-mail e traduz os erros do Supabase (senha vazada, igual à atual, precisa entrar de novo).
33. Cartão "Verificação em duas etapas": estado ligada/desligada; Ligar abre QR (imagem do Supabase) + chave para digitar com "copiar" + código de confirmação; limpa tentativa anterior não confirmada; Desligar com confirmação.
34. Preferências de aviso (tarefa, conversa passada, aguardando consultor, lead, espera longa, resumo do dia, som) em `perfis.preferencias.notificacoes` — valem em todo aparelho; o tipo desligado some do sino.
35. Cartão "Sessão": hora em que entrou e se continua conectado ao fechar o navegador; "Limpar rascunhos deste aparelho"; "Sair de todos os aparelhos" (`signOut({scope:'global'})`) com confirmação.
36. Rótulos de papel em português em todo lugar (Administrador, Gestor, Atendente, Agenda) — antes gestor aparecia como "Atendente".

### Sair e dados no aparelho (pedido 5)
37. "Sair" abre a escolha de apagar o que ficou neste aparelho (conta os rascunhos) e avisa se há mensagens na fila sem internet que se perderiam.
38. Sair + limpar apaga rascunhos, fila, filtros, e-mail lembrado e caches do app (fica só o tema).
39. Rascunhos das conversas foram do localStorage para o sessionStorage (somem ao fechar o navegador); os antigos migram na primeira leitura.
40. Confirmações bonitas no lugar do `confirm()` do navegador (título, texto do efeito, botão vermelho, caixinha opcional, Esc e clique fora cancelam).

### Sino de notificações (item 7)
41. Sino ao lado do avatar com contador (99+), lê `notificacoes` (RLS: só as minhas) e escuta INSERT/UPDATE/DELETE em tempo real.
42. Painel com "Não lidas"/"Todas", ícone por tipo, tempo relativo, ponto vermelho nas novas; cabe na tela do celular.
43. Clicar marca como lida e abre o link: `/?conversa=` abre a conversa aqui; links de outro app abrem o app certo em nova aba; só links do ecossistema.
44. "Marcar todas como lidas" (gravado no banco) e "Ver minhas tarefas →".
45. Notificação nova: o sino balança, aparece um aviso e (se ligado) toca o som discreto.

### Minhas tarefas (item 8)
46. Aba "Tarefas" com contador no menu (vermelho pulsando quando há atrasada).
47. Grupos Atrasadas / Hoje / Amanhã / Próximos dias / Sem prazo, ordenados por prioridade; resumo "2 abertas com você · 1 atrasada · 1 para hoje".
48. Visões Minhas / Que eu passei / Feitas (dá para reabrir) / Equipe (gestor) e busca por tarefa, cliente ou pessoa.
49. Concluir com um toque (otimista, volta se o banco recusar e confere 0 linhas), cancelar, apagar (só quem criou ou gestor), abrir a conversa.
50. Cada tarefa mostra cliente, prazo legível ("atrasada 2 h", "amanhã 09:00"), prioridade alta, quem passou e o avatar do responsável.
51. Nova tarefa: título, detalhes, responsável, prazo com atalhos (Hoje 17h, Amanhã 9h, Em 2 dias, 1 semana — pula domingo), prioridade 🔴/🟡/⚪.
52. Criada a partir da conversa (menu ⋯ "Nova tarefa", botão na ficha ou Alt+T): já ligada à conversa e ao cliente.
53. Grava por `POST /api/tarefas` (o servidor valida e audita; a pessoa recebe aviso no sino); sem a rota, direto no banco pelo RLS.
54. Atendente cria tarefa só para si (regra do servidor) — o seletor de responsável fica travado com a explicação; gestor escolhe qualquer um.
55. Tarefas do cliente na ficha (fora do bloco que é redesenhado): abertas, "N feitas" recolhidas e "+ Tarefa"; atualiza em tempo real.
56. Painel do gestor: carga por pessoa (`GET /api/tarefas/equipe`) com tarefas abertas, atrasadas, para hoje e conversas, barra de carga; clicar filtra as tarefas da pessoa.
57. Sem a rota de carga, o painel calcula com o que a tela enxerga e avisa.

### Mais funcionários no dia a dia (pedido 4)
58. Transferir conversa para colega com motivo (`POST /api/conversas/:id/transferir`): lista de colegas que atendem (sem o papel agenda nem o dono atual), com papel, "fora do rodízio" e quantas conversas cada um tem.
59. Motivos prontos (Fim do meu turno, Assunto técnico, Cliente pediu, Orçamento para fechar); motivo obrigatório como o servidor exige.
60. Erros da transferência tratados: `mudou_no_meio`/`mesmo_dono` recarregam o dono certo; `nao_e_sua`/`destino_invalido` explicados; atendente só transfere o que é dele ou sem dono.
61. No menu de dono, escolher um colega abre a transferência já com ele marcado (pegar para si e "sem dono" continuam de um clique).
62. Sem a rota de transferência, passa do jeito antigo e avisa que o motivo não foi registrado.
63. Gestor: botão "🎯 Rodízio" em conversa sem dono (`POST /api/conversas/:id/distribuir`) — mostra com quem ficou.
64. Filtro "Equipe X" na lista de conversas (dono pertence à equipe), no banco e com paginação certa; lembrado na aba; só aparece quando dá para saber a equipe de cada dono.
65. "Quem está vendo": Realtime Presence no canal `conversa:<id>` mostra "Maria também está aqui" com avatares coloridos; troca de conversa sai do canal.
66. "Maria está digitando…" em tempo real (no máximo um aviso a cada 2,5 s, apaga sozinho em 4 s).
67. Mensagens enviadas pela equipe mostram iniciais na cor da pessoa e o primeiro nome ("você" para as minhas; ✨ para a IA), inclusive quando outra pessoa responde logo em seguida.
68. Envio grava `whatsapp_mensagens.enviado_por` quando a coluna existir (se o banco ainda não tiver, grava sem ela e não tenta de novo).

### Segurança na tela (pedido 5)
69. Apagar conversa, apagar mensagens e apagar registro do CRM só aparecem para gestor/admin (o banco agora recusa o resto).
70. Apagar lead confere as linhas apagadas: RLS que recusa devolve 0 linhas sem erro — antes a tela dizia "apagado" sem ter apagado.
71. Botões "Tentar de novo"/"+ Novo atalho" dos estados vazios usavam `onclick=` no HTML, que a CSP nova do servidor bloqueia — agora passam por um ouvinte único.

### Tela Equipe (pedido 1)
72. Aba "Equipe" (admin muda; gestor só lê com faixa explicando): cartões com avatar colorido, cargo · equipe, papel colorido, apps em chips, carga (conversas com barra e tarefas), último acesso (ponto verde se < 15 min, app usado) e selos (2 etapas, convite pendente, troca de senha pendente, login bloqueado, recebe clientes, desativado).
73. Filtros: busca (nome, e-mail, cargo, sem acento), papel, equipe e situação (com acesso, desativados, ainda não entraram, todos); resumo "7 com acesso · 1 ainda não entrou · 1 desativada".
74. Ficha da pessoa: papel em 4 cartões com explicação curta, apps em chips (admin = todos; agenda = só Agenda), equipe, cargo, telefone, rodízio; salva só o que mudou (`PATCH /api/equipe/:id`) e confirma antes de promover a administrador.
75. Não deixa mexer em si mesmo (papel, apps, acesso travados com explicação) nem no último administrador ativo; os 409 do servidor (`proprio_papel`, `ultimo_admin`, `ultimo_rodizio`) aparecem na ficha.
76. Desativar com confirmação explicando o efeito e a opção "passar as N conversas abertas dela para o rodízio" (`POST /api/equipe/:id/desativar {redistribuir}`); reativar (`/reativar`); aviso do servidor quando o Supabase não confirmou o bloqueio.
77. Senha temporária (`POST /api/equipe/:id/senha-temporaria`): confirmação, senha grande com "Copiar senha" e "Copiar e-mail + senha + endereço", aviso "aparece só agora — entregue pessoalmente"; some da página ao fechar.
78. "Tirar duas etapas" para quem perdeu o celular (`POST /api/equipe/:id/mfa/remover`), com confirmação.
79. Convite em 4 passos (Quem → Papel → Apps → Pronto): valida nome, e-mail e duplicado; apps já marcados pelo papel; revisão antes de criar; `POST /api/equipe` mostra a senha temporária uma vez e a pessoa aparece na grade.
80. Servidor sem as rotas novas: aviso amigável "ainda não chegou no servidor" e a lista que dá, só leitura (nada de erro vermelho).

### Tela Auditoria (pedido 2)
81. Aba "Auditoria" (admin) em linha do tempo por dia (Hoje, Ontem, data), ícone e cor por tipo (vermelho para exclusão/desativação, âmbar para senha/configuração).
82. Frases em português: "João Pedro mudou o papel de Maria Souza de atendente para gestor", "desativou o acesso de Paulo — “Saiu da empresa”", "mudou os apps de Bianca: liberou Comunicar; tirou Atendimento", "passou a conversa de José de Maria para Leonardo — “Fim do meu turno”", "moveu o lead de Camila de em contato para orçamento", "apagou o agendamento de Hugo (Revisão, 10/10)", convites, senha temporária, rodízio, tarefas, IA, configuração, exportações; "O sistema" para gatilhos.
83. Entende os dois formatos (gatilho do banco com antes/depois na linha; servidor com `detalhes.antes/depois`).
84. "ver detalhes": tabela Campo · Antes → Depois com valores legíveis (papel, apps, R$, equipe, pessoa) e o id do registro.
85. Filtros pessoa, onde (tabela), ação (nomes do servidor), de/até; 20 por página com "Anteriores / Mais antigos" e "Página 1 de N · 44 registros".
86. Exportar CSV (`GET /api/auditoria.csv` com os mesmos filtros, token no cabeçalho — nada na URL), arquivo `auditoria-indycar-AAAA-MM-DD.csv`.

### Visual, celular e PWA
87. No celular, sino e avatar ficam grudados à direita da barra de cima (a barra rola por baixo).
88. Equipe, Auditoria, Tarefas, Minha conta, sino e menu do perfil sem rolagem horizontal em 375 px; modais em uma coluna.
89. Tudo novo com tokens do tema (claro/escuro), `esc()` em todo dado, foco visível, `aria-*` nos menus, abas e chips.
90. `sw.js` v13 com `acesso.js`, `equipe.js` e `tarefas.js` no CORE (o app instalado abre com os módulos novos).

### Servidor de mentira (`scripts/mock-server.mjs`)
91. `?papel=` admin · gestor · atendente · agenda · desativado · semapp · trocarsenha · mfa · deslogado, `?recuperar=1` e `?sem_rotas=1`.
92. Login de mentira de verdade: e-mail de qualquer perfil entra como ele; senha "errada" falha; MFA com código 123456 (o token passa a aal2).
93. Porteiro igual ao do servidor: 401 `sessao_invalida`/`desativado`/`mfa_pendente`, 403 `sem_acesso_app` com `apps:[{app,nome,link}]`, 429 em `/api/teste/limite`; erros `{ok:false, erro, codigo, campo?}`.
94. RLS de mentira: só gestor/admin apaga (0 linhas sem erro), perfis (cada um vê o seu), notificações (só as minhas), tarefas (apaga quem criou), perfis protegidos.
95. Rotas no formato do servidor: `/api/eu` (GET/PATCH), `/api/eu/senha-trocada`, `/api/equipe` (GET/POST/PATCH, desativar, reativar, senha, mfa/remover), `/api/auditoria(.csv)`, `/api/tarefas`, `/api/tarefas/equipe`, `/api/conversas/sem-dono`, `/distribuir`, `/transferir`.
96. Dados: 8 perfis, 2 equipes, tarefas, notificações por pessoa, 50 linhas de auditoria nos dois formatos; tempo real de tarefas/notificações e Presence (`__mockPresenca`).


## Coordenador
1. Coluna whatsapp_mensagens.enviado_por (padrão auth.uid()): o nome de quem mandou aparece nas mensagens reais.
2. Aba Relatórios escondida para atendente (o servidor já recusava com 403; o teste de ponta a ponta pegou).


# Rodada 4 (14/10/2026) — confiabilidade com o Render dormindo, velocidade, tour, ajuda e copiloto

Motivo: em 14/10 às 19h o Render gratuito respondeu 503 "hibernate-wake-error" por ~5 min.
Verificado com `npm test` (189 testes, 0 falhas; 27 novos), `node scripts/roteiro-rodada4.cjs` (servidor de mentira
com o Render "dormindo" de mentira, 1440 e 375 px: **145/145**), `node scripts/roteiro-casca.cjs` (server.js DE VERDADE
atrás de um proxy que responde 503: **13/13**), `node scripts/roteiro-tela.cjs` (roteiro antigo: **220/220**) e
`node scripts/avaliar-copiloto.mjs` (10 conversas reais, modo "sugerir", banco só leitura — 72 escritas bloqueadas, nada gravado).

### Servidor acordando (public/rede.js — novo)
1. Toda chamada ao nosso servidor (`/api/…`) passa por uma camada que reconhece quando a resposta NÃO veio do app (502/503/504 do roteador do Render, falha de rede).
2. Novas tentativas sozinhas com espera crescente 2, 3, 5, 8, 12, 15, 20, 25, 30 s… somando 3 min.
3. 503 sem a marca do app (o pedido nem chegou) repete até POST; 502/504 só repetem pedido seguro (GET) ou marcado como idempotente — nada de cobrar/enviar duas vezes.
4. Resposta do PRÓPRIO app (401, 403, 429, 502 do CodeWords, 503 "IA desligada") passa direto, sem nova tentativa.
5. Desistiu depois de 3 min: a tela recebe JSON com erro em português ("O sistema está acordando e ainda não respondeu…") e a marca `X-IndyCar-Sintetica`, nunca o HTML do Render (antes: "Unexpected token <").
6. Faixa "O sistema está acordando…" com contagem ("tentando de novo em 8 s (3ª tentativa)") e "As conversas continuam aqui".
7. Botão **Tentar agora** acorda na hora todos os pedidos que estavam esperando.
8. Aviso "✅ O sistema voltou" (com quanto tempo ficou fora, se passou de 1 min) e a faixa some sozinha.
9. Depois de 3 min sem resposta a faixa vira "O sistema não respondeu ainda" e continua conferindo sozinha a cada 30 s (sonda leve em `/api/status`).
10. Voltou a internet: os pedidos parados tentam na hora (sem esperar o relógio).
11. Sem internet quem avisa é a faixa de offline que já existia — a do servidor fica quieta (sem dois avisos).
12. Cancelar um pedido (o copiloto cancela ao trocar de conversa) interrompe a espera na hora.
13. Cada chamada pode dizer quanto tempo insistir (`tetoMs`): a gravação do tour, por exemplo, desiste em 30 s.
14. Faixa acessível (role=status, aria-live, botão com nome, foco visível) e sem animação para quem pede menos movimento.
15. 375 px: a faixa cabe na tela, sem rolagem lateral.
16. Servidor marca TODA resposta com `X-IndyCar-App: atendimento` — é como a tela distingue o app do roteador do Render.

### Abrir o app com o servidor dormindo
17. A configuração pública (endereço do Supabase + chave publicável, que é pública) fica guardada no aparelho: com o servidor fora, o app abre na hora e as conversas vêm direto do Supabase (que não dorme).
18. Primeira vez no aparelho com o servidor dormindo: tela de entrar mostra "Conectando ao sistema…" + a faixa e entra sozinha quando ele acorda.
19. Nomes da equipe (só nome/cor/equipe/papel — nada de e-mail ou telefone) guardados no aparelho e fora do caminho crítico: a lista não espera o servidor.
20. Vigia de WhatsApp e faixa de saúde não acendem alarme falso enquanto o servidor dorme ("O sistema está acordando — confiro já já").
21. Conferências periódicas (WhatsApp/saúde a cada 2 min, sincronia da conversa a cada 15 s) pausam enquanto o servidor acorda — nada de empilhar pedidos.
22. Quando o servidor volta, confere WhatsApp e saúde na hora.

### Casca em cache (service worker v14 + casca.js)
23. Página: rede primeiro com limite de 4 s; demorou, caiu ou veio 5xx → casca do cache (antes o 503 do Render ia direto para a tela, porque fetch não falha em 503).
24. Arquivos da tela: rede primeiro com limite de 3 s, cópia do cache quando o servidor dorme; 503/404 nunca entram no cache.
25. Sem casca guardada e sem rede: página curta "Sem conexão com o Atendimento" que tenta de novo sozinha a cada 15 s.
26. Instalação baixa tudo de novo do servidor (`cache: 'reload'`) — versão nova nunca mistura arquivo velho do cache HTTP.
27. Só apaga caches do próprio app.
28. Biblioteca do Supabase servida pelo nosso servidor (`/vendor/supabase.js`, versão travada 2.112.0 do package-lock) e guardada na casca — a casca abre sem depender da CDN.
29. Reserva: se o arquivo local falhar, carrega a mesma versão travada da CDN (antes: `@2` sem versão fixa).
30. Aviso "✨ Versão nova do Atendimento pronta · Atualizar" quando sai deploy — nunca recarrega sozinho no meio de uma resposta.
31. Confere versão nova a cada 30 min com a aba visível.
32. A Ajuda mostra qual casca está guardada.

### Envio que não se perde
33. `/api/enviar` aceita `mensagemId`: repetir o pedido não manda duas vezes (já saiu → `{ok:true, jaEnviada:true}`) — `lib/entrega.js`.
34. Duas tentativas ao mesmo tempo (duas abas, retentativa) → a segunda recebe 409 "já está saindo"; trava velha (aba fechou no meio) expira em 2 min.
35. O servidor grava enviado/falhou na própria linha — vale mesmo se a aba fechou no meio.
36. Mensagem de entrada nunca é "enviada" (400); id inválido recusado.
37. O envio vai marcado como idempotente (`X-Idempotente: 1`): pode ser repetido com segurança enquanto o servidor acorda.
38. Cada envio fica anotado no aparelho até ter resposta; se o servidor estava dormindo ou a página fechou, é retomado ao abrir, quando o servidor volta e quando a internet volta.
39. Retomada confere no banco antes (já saiu? tira da lista) e só reenvia até 15 min depois — mensagem muito atrasada fica "não saiu" com "Tentar de novo".
40. Bolha "⏳ esperando o sistema" enquanto o servidor acorda (e volta a ⏳/✓ sozinha).
41. Wi-fi piscou ao gravar a mensagem → vai para a fila offline (sai sozinha) em vez de "não saiu".

### Tempo real que recupera o que perdeu (Recuperador)
42. Ao religar o tempo real, busca no banco as mensagens criadas enquanto estava fora e diz quantas ("Tempo real de volta — 3 mensagens chegaram enquanto estava fora").
43. A cada 60 s (aba visível, com internet) uma consulta de 1 linha confere se existe mensagem mais nova que a última vista — pega o WebSocket que morreu calado.
44. Canal caído sem avisar é religado nessa conferência.
45. Voltar para a aba depois de 30 s fora busca o que chegou ("chegaram enquanto a aba estava fechada").
46. Voltou a internet → busca na hora.
47. Ponto de partida pelo relógio do BANCO (o do computador pode estar adiantado).
48. Mensagem recuperada entra na conversa aberta na ordem certa e sem duplicar (confere pelo id).

### Velocidade
49. Arquivos da tela comprimidos em brotli (ou gzip): os 7 maiores caem de 876 KB para ~201 KB (−77%; app.js 310 → 76 KB).
50. ETag em todo arquivo: recarregar devolve 304 sem corpo quando nada mudou.
51. Arquivos guardados em memória já comprimidos (o disco do Render free é lento ao acordar).
52. Respostas JSON acima de 2 KB (ficha, relatórios, equipe, auditoria) em gzip.
53. Biblioteca do Supabase com cache de 1 dia.
54. Conexão com o Supabase aberta já no começo da página (preconnect pela configuração guardada).
55. Abertura: etapas e configuração do funil em paralelo; serviços/consultores e atalhos em paralelo.
56. Reabrir uma conversa vista há pouco mostra as mensagens na hora (memória das 12 últimas, só nesta aba) e atualiza por trás — sem esqueleto piscando.

### Tour de boas-vindas por papel (public/ajuda.js — novo)
57. Na primeira vez, tour curto: atendente 7 passos, gestor 8 (relatórios, sem dono, rodízio), administrador 10 (equipe e chave do WhatsApp).
58. Aparece uma vez por versão e papel — quem é promovido a gestor vê os passos novos.
59. Marcado em `perfis.preferencias.tour_visto` (vale em todo aparelho; validado no servidor: só `v1-atendente|gestor|admin`) e no aparelho (se o servidor estiver dormindo).
60. Destaque do que está explicando e cartão sempre dentro da tela (ao lado quando o alvo é alto, como a lista).
61. Teclado: Enter/→ avança, ← volta, Esc encerra; foco preso no cartão e devolvido no fim; aria-modal.
62. "Rever o tour" na Ajuda e "ver o tour de novo" no chat vazio.

### Ajuda curta
63. "?" (fora do campo) abre a Ajuda; também pelo menu do seu nome › "Ajuda e atalhos".
64. "Como faço…" com 13 respostas curtas (agendar, passar conversa, pegar cliente, não lida, resposta pronta, foto/áudio, IA, tarefa, sistema acordando, sem internet, WhatsApp parado, permissões, senha/duas etapas).
65. Busca na Ajuda sem acento e por várias palavras ("audio", "passar colega"); sem resultado explica o que fazer.
66. Aba "Atalhos" com as teclas e as etapas do funil; abas navegáveis por ← →.
67. Permissão explicada: "Apagar, Relatórios e Equipe são do gestor… Peça ao gestor".
68. Textos do tour e da ajuda sem "prezado/efetuar/comparecer/veículo" (teste).

### Copiloto da IA — avaliação com 10 conversas reais (modo "sugerir", nada executado nem gravado)
Antes → depois (mesmas 10 conversas, Sonnet 5.5): uma pergunta por mensagem 8/10 → **10/10**; duas opções de horário quando quer agendar 8/10 → **10/10**;
"Aqui é o atendimento da IndyCar" repetido em conversa já em andamento 7/10 → **1/10** (a única é conversa em que a loja nunca falou — correto);
tamanho médio 351 → 297 caracteres; preço 0/10 e vocabulário proibido 0/10 nas duas; sem sugestão 0/10 (uma rodada intermediária saiu sem resposta — corrigido no item 74).
69. Ficha da IA ganhou "SITUAÇÃO DA CONVERSA" calculada pelo sistema: quem falou por último, há quanto tempo o cliente espera, se a loja já se apresentou.
70. Hora de cada mensagem no fuso de Brasília (antes ia em UTC, 3 h adiantada em relação ao "Hoje é…" — errava bom dia/boa tarde e o tempo de espera).
71. Regra "UMA pergunta por mensagem" conferida pelo servidor: 2+ perguntas voltam para a IA reescrever.
72. Se a IA insistir, a sugestão vem mesmo assim com o aviso "mais de uma pergunta — revise antes de enviar", mostrado no painel do copiloto.
73. "Aqui é o atendimento da IndyCar" sai sozinho da sugestão quando a loja já falou com o cliente (mantém as quebras de linha).
74. Cliente esperando e a IA terminou sem "responder": o copiloto cobra uma vez (se ainda couber volta) — sem laço e sem mandar bloco de texto vazio para a API.
75. Prompt com o que aprendemos: respeitar a preferência de horário do cliente, não prometer peça reservada/estoque/nota/desconto/prazo (propor aguardando consultor ou tarefa), pós-venda pergunta como ficou, mover etapa só quando ficou para trás.
76. Retorno do copiloto traz `recusadas_na_validacao` e `parou_por` (para entender sugestão que não veio).
77. `scripts/avaliar-copiloto.mjs`: avalia N conversas reais com banco SÓ LEITURA (todo insert/update/upsert/delete/rpc vira de mentira), autonomia forçada em "sugerir" e checagens automáticas (preço, vocabulário, tamanho, perguntas, duas opções, abertura). Saída fora do Git (tem conversa real).

### Preferências são de todos os apps (pedido do coordenador)
78. `PATCH /api/eu` lê `perfis.preferencias` ATUAL do banco antes de gravar (antes usava a cópia do porteiro, até 60 s velha — o que outro app gravou no último minuto sumia).
79. Merge profundo: gravar `notificacoes.espera` não apaga chave que outro app pôs dentro de `notificacoes`, nem `tema`, `tour_visto` ou chaves da Agenda/CRM.
80. A resposta devolve as preferências já mescladas e a tela passa a usar esse valor.
81. Caminho antigo da tela (servidor sem a rota): lê o valor atual do banco e mescla antes de gravar.

### Erros em português claro, estados vazios e acessibilidade
82. Qualquer aviso com erro técnico vira frase clara: "Failed to fetch" → "Sem conexão…", RLS → "Você não tem permissão para isso. Peça ao gestor.", JWT vencido → "Sua sessão venceu", tempo esgotado, HTML no lugar de JSON → "talvez acordando".
83. Erro ao carregar conversas/mensagens mostra a frase clara (não o texto técnico).
84. Chat vazio ensina: "Ctrl+K busca um cliente · ? abre a ajuda · ver o tour de novo".
85. Ficha sem horário: "Use Agendar no topo do chat — ou peça ao ✨".
86. Ficha sem serviço: "Quando a Agenda concluir um, ele aparece aqui com o valor".
87. Versão da casca na Ajuda com contraste suficiente.
88. `mobile-web-app-capable` no HTML (fim do aviso de descontinuado no console).

### Testes e ferramentas
89. `test/rede-entrega.test.js` (10): espera crescente, quando repetir e quando não, textos, entrega que não duplica, 409, trava velha, situação gravada.
90. `test/ajuda.test.js` (5): passos por papel, uma vez por versão/papel, vocabulário, busca, `tour_visto` validado.
91. `test/servidor.test.js` (+4): X-IndyCar-App em tudo, brotli/gzip + ETag/304, vendor só do arquivo listado (nada mais do node_modules), JSON grande em gzip, ordem dos scripts, CORE do SW existindo, reserva da CDN escapada.
92. `test/copiloto.test.js` (+5) e `test/contexto.test.js` (+1): uma pergunta, reserva com aviso, apresentação, cobrança do "responder", situação e hora de Brasília.
93. `test/rotas-equipe.test.js` (+2): merge profundo e PATCH que não apaga o que outro app guardou.
94. Servidor de mentira: `?dormir=N` / `POST /api/_dormir` simulam o 503 do Render (HTML, sem a marca do app; o "banco" segue de pé).
95. Servidor de mentira: `/api/_envios` conta envios e `/api/enviar` é idempotente como o de verdade.
96. Servidor de mentira: `?tour=1` (tour como primeira vez) e `tour_visto` no PATCH; por padrão todo mundo já "viu" (os roteiros antigos não esbarram no tour).
97. `scripts/roteiro-rodada4.cjs` (145 conferências em 1440 e 375 px): espera e volta, Tentar agora, JSON em português, envio esperando e saindo uma vez, retomada depois de recarregar, abrir com o servidor dormindo, primeira vez sem cópia, Recuperador, Ajuda, tour dos 3 papéis, avisos traduzidos, chat vazio.
98. `scripts/roteiro-casca.cjs` (13): server.js real atrás de um "Render" que responde 503 — página abre da casca, Supabase do cache, preconnect, faixa, volta sozinha, sem erro de script.
99. Roteiro antigo atualizado (a configuração pública e os nomes podem ficar no aparelho depois de "sair + limpar") — 220/220.
100. `.gitignore`: capturas dos roteiros e saídas da avaliação da IA fora do repositório (que é público).
101. Achado e corrigido no caminho: o `</script>` da reserva da CDN fechava o script embutido antes da hora (erro "Invalid or unexpected token" em todas as telas) — pego pelo roteiro antigo, agora com teste.
102. Achado e corrigido: o servidor de mentira "acordava" o Render ao recarregar a página (o teste de abrir dormindo passava por engano).
103. LEIA-ME: seção "Rodada 4" com o que muda para quem usa e para quem mantém (servidor acordando, entregas, casca, tour, ajuda, avaliação da IA, scripts).
104. Leitor de tela: a faixa anuncia só a mudança de estado ("acordando", "voltou"); a contagem que muda a cada segundo fica fora do anúncio (antes de virar costume, falaria sem parar).
105. Destaque do tour sem animação para quem pede menos movimento.
106. Anotações de entrega com teto de 50 no aparelho (não enche o armazenamento).
107. Memória de mensagens já vistas do Recuperador com teto (3.000 ids) — aba aberta o dia inteiro não cresce sem fim.
108. Cache em memória dos arquivos comprimidos com teto (80 arquivos) no servidor.
109. "Sair e limpar o aparelho" também apaga as entregas anotadas e a cópia dos nomes (tudo que começa com `indycar_`, menos o tema) — conferido no roteiro antigo.
110. Ajuda é um diálogo com título ligado (aria-labelledby) e "×" com nome ("Fechar a ajuda"); lista de atalhos diz que "?" abre a Ajuda.
111. Envio pendente não se repete em outra aba ao mesmo tempo: a retomada espera 20 s depois da anotação (a aba que enviou ainda pode estar esperando a resposta) e o servidor trava pelo id.
112. ETag fraca (`W/"…"`, como a borda do Render/Cloudflare devolve) e lista de ETags também dão 304 — achado conferindo em produção; com teste.

## Pátio (16/10/2026)
1. Ficha do cliente ganhou o bloco **"No pátio agora"**: etapa real da ordem do IndyCar Pátio, há quanto tempo está nela, nº da ordem e placa, com a cor da situação (andamento, esperando, pronto).
2. Previsão de entrega só a que a equipe registrou; sem ela, a ficha avisa "sem previsão — não prometa prazo"; previsão vencida aparece marcada "passou".
3. Extras esperando a aprovação do cliente (descrição, urgência e valor) e o resumo dos aprovados/recusados.
4. **"Colar link de acompanhamento no chat"**: um clique põe o texto pronto com o link no campo (revisa e envia; nunca sai sozinho); mostra se o cliente já abriu o link.
5. "Abrir no Pátio ↗" leva direto à ordem (`/?os=<id>`); carro entregue há até 2 dias aparece como "Saiu do pátio".
6. Bloco **"Área do Cliente"**: "Gerar link e colar no chat" chama `cliente_gerar_acesso` pelo servidor (o token aparece uma vez), monta `{link_base}/minha/?c=<token>` e cola o convite no campo.
7. Rota `POST /api/clientes/:id/area-cliente`: só equipe logada, uuid validado, limite 10/min, auditada como `cliente.area_link` sem o link/token.
8. A ficha do servidor (`/api/clientes/:id/ficha`) traz `patio` lido com a chave de serviço; erro no Pátio não derruba a ficha.
9. **Copiloto conhece a OS em andamento** (`lib/contexto.js` → `ficha.patio`): o prompt ganha "CARRO NA OFICINA" com a etapa real, se está pronto ou não e os extras pendentes.
10. A IA não promete prazo: sem previsão registrada ela diz que avisa quando ficar pronto; previsão vencida não é repetida; "pronto" vira "pode retirar (seg–sáb, 8h às 17h30)".
11. Para a IA vão só etapa e descrição: nenhum valor de extra, nenhum link nem token do cliente (a tela do atendente é que tem o link).
12. Regra nova no system prompt do copiloto para "meu carro está pronto?".
13. Nomes dos tipos novos da fila do Comunicar (`patio_entrada`, `patio_extra`, `patio_pronto`, `area_cliente`) na ficha e no contexto.
14. `lib/patio.js` (regras puras + leitura) e `test/patio.test.js` (11 testes: links, escolha da ordem, texto da IA sem R$/link, contexto, rpc da Área, rota com login).
15. Mock: a Camila está com o carro em "Aguardando aprovação" com extra; rota de mentira da Área do Cliente; roteiro de navegador 1440/375 sem rolagem lateral.


# Rodada 5 (16/10/2026) — a IA conduz o funil, IA em ação, preparo para a Central

Verificado com `npm test` (**234 testes**, 0 falhas; 45 novos em `test/ia-funil.test.js`, `test/rotas.test.js`, `test/servidor.test.js`,
`test/automacoes.test.js`, `test/contexto.test.js`), `node scripts/roteiro-rodada5.cjs` (**74/74** em 1440 e 375 px, inclusive o app
montado em `/atendimento/` num segundo servidor de mentira), regressão `roteiro-rodada4.cjs` **145/145**, `roteiro-tela.cjs` **220/220**,
`roteiro-casca.cjs` **13/13**, `npm run segredos` (0 segredos), `npm audit` (0), migração `at_ia_funil_v1` aplicada e o gatilho testado em
DO-block revertido (mensagem de teste → 1 linha em `at_ia_fila` agendada para +8 s, 1 chamada HTTP na fila do pg_net, nada gravado), leitura
só-leitura do banco real pelo `server.js` (fila vazia, `ia_config` com os campos novos, `hoje()` responde, `agenda_horarios_livres` devolve
os horários no formato esperado) e `get_advisors` (nenhum aviso para os objetos `at_*`).

## A IA conduz (`lib/ia-funil.js`, novo; `lib/ia-copiloto.js`; migração `at_ia_funil_v1`)
1. Caminho que NÃO depende do servidor acordado: gatilho `at_ia_enfileirar` (AFTER INSERT em `whatsapp_mensagens`) grava cada mensagem do cliente em `at_ia_fila` e chama `at_ia_acordar()` — um `net.http_post` para `POST /api/ia/funil/acordar`, que acorda o Render gratuito quando ele dorme.
2. Fila `at_ia_fila` (prefixo `at_`): conversa, mensagem, telefone normalizado, status pendente/processando/feita/pulada/erro, tentativas, `agendado_para` (+8 s para o cliente terminar de digitar), resultado em JSON. RLS ligado: equipe só lê (a tela mostra "a IA está respondendo"), o servidor grava com a chave de serviço. Entrou no `supabase_realtime`.
3. Despertador `pg_cron` `at-ia-funil-despertar` (a cada minuto): só chama o servidor se há linha pendente há mais de 20 s (o "acorda" anterior se perdeu num 503). Sem fila não gasta hora do Render. Solta trava de "processando" com mais de 5 min, dá erro depois de 5 tentativas e aposenta fila com mais de 2 dias.
4. `at_ia_acordar` no máximo 1× a cada 20 s (um pedido já acorda o Render e o servidor drena a fila inteira); as 3 funções novas são `security definer`, `search_path = ''` e sem EXECUTE para anon/authenticated.
5. A rota do despertador é pública mas autenticada pelo MESMO token do webhook do CodeWords (`x-codewords-token`, comparação em tempo constante): nenhuma variável de ambiente nova.
6. `ia_config` ganhou `funil_ativo`, `funil_autonomia` (por etapa), `funil_url` (a Central troca este endereço) e `funil_acordado_em`.
7. O servidor drena a fila ao subir (acordou do 503? o que ficou para trás sai em 3 s), a cada 15 s enquanto houver fila, e na hora quando o banco avisa (`acordar()` com 1,5 s de espera e sem empilhar pedidos).
8. Agrupa a fila por conversa: duas mensagens seguidas do cliente viram UMA leitura da IA; se ainda há linha agendada para o futuro (cliente digitando), espera a próxima rodada.
9. `conduzir(conversaId)`: identifica o cliente pelo telefone com a rpc `cliente_360` quando a conversa está sem `cliente_id` e religa `conversas.cliente_id` (ação `vincular_cliente` em `ia_acoes`).
10. Conversa de quem JÁ tem horário marcado nascida em "Primeiro contato" vai para "Agendado" no servidor (achado do simulador), registrada em `ia_acoes` como `mover_etapa` sem pessoa, com antes/depois para desfazer — sem tocar no gatilho `tocar_conversa`.
11. Última mensagem já é da loja → "pulada: já respondida", sem gastar IA.
12. Regras do sistema para passar para gente antes mesmo do julgamento da IA: PREÇO ("quanto custa/fica", "valor", "desconto", "parcela"…), URGÊNCIA ("parou", "não liga", "socorro", "na estrada", "AGORA"…), PEDIDO DE PESSOA ("falar com alguém", "é robô?"…) e RECLAMAÇÃO ("absurdo", "procon", "voltou o barulho"…).
13. "Quero um orçamento" NÃO vai para humano de propósito: numa oficina isso é diagnóstico gratuito + horário, que a IA conduz; só a pergunta de valor passa ao consultor. "Tem garantia?" é dúvida comum (12 meses), não reclamação.
14. Papel novo da IA (`PAPEL_FUNIL`): ela CONDUZ — pergunta carro e serviço (uma coisa por vez), completa a ficha, registra o interesse, oferece DUAS opções reais de horário respeitando o período pedido, chama `agendar` quando o cliente aceita e confirma com dia, hora e endereço; preço/urgência/pessoa/reclamação viram `marcar_aguardando_consultor` + resposta curta; nunca promete peça, estoque, desconto, prazo nem guincho.
15. O prompt do funil recebe a autonomia por etapa, o motivo de humano detectado pelo sistema ("PASSE PARA HUMANO AGORA") e se há atendente na conversa (aí a mensagem vira sugestão).
16. Autonomia POR ETAPA (meio-termo: 4 etapas × 3 níveis + "herdar o padrão"): responder, agendar (marcar/remarcar), crm (ficha, interesse, etapa), humano (aguardando consultor, tarefa). `niveisDoFunil()` e `decisaoDoFunil()` são regras puras testadas.
17. `automatico` executa: a IA RESPONDE o cliente (mensagem na fila de saída `whatsapp_mensagens` com `gerada_por_ia`, entregue pelo mesmo entregador idempotente da tela), CRIA o agendamento (lead + horário amarrados), completa a ficha, registra interesse, move etapa, marca aguardando consultor e cria tarefa — tudo com `perfil_id` nulo em `ia_acoes` (foi a IA sozinha).
18. `confirmar` deixa a proposta e AVISA quem está com a conversa pela rpc `notificar` (tipo `ia`, chave `ia-proposta:<conversa>:<run>`, link `/?conversa=`); sem dono, avisa gestores/admin e quem recebe leads com o app Atendimento. Um aviso por rodada da IA, com todas as propostas no corpo.
19. `sugerir` só propõe: nada sai, nada muda, ninguém é avisado.
20. Mesmo em `automatico`, SEMPRE pedem clique: cancelar horário, mensagem programada (retorno), religar mensagens de quem pediu PARAR, etapa de ganho/perda, valor no lead e tarefa para outra pessoa.
21. Ordem de execução pensada: agenda → CRM → mensagem → humano. A mensagem vem depois da agenda para refletir o que aconteceu, e ANTES de "aguardando consultor" porque a mensagem de saída limpa a espera no banco (gatilho `marcar_espera_do_consultor`) — testado pela ordem no log do banco de mentira.
22. Cliente aceitou um horário que acabou de ser ocupado (ou a IA tentou um horário inválido): a IA NÃO agenda e a mensagem que sai troca "Fechado!" por outras duas opções livres (`textoHorarioOcupado`, sem preço, uma pergunta); o texto original fica guardado em `entrada.texto_original`.
23. Marcou de verdade e a mensagem da IA não cita o horário: sai a confirmação do sistema (dia, hora, endereço).
24. Mensagem com aviso (mais de uma pergunta) NUNCA sai sozinha: vira proposta para a equipe.
25. Atendente humano escreveu nos últimos 30 min: a IA não manda nada sozinha — a resposta vira "Aprovar e enviar" para ele (vale mesmo em `automatico`).
26. Agendamento criado pela IA ganha CONSULTOR livre no horário (mesma regra da Agenda: um carro por consultor por meia hora, índice `agendamentos_slot_uk`), entre os livres o de menor carga no dia (`escolherConsultor`, pura, testada); lead nasce com `responsavel_id` = dono da conversa e observação "Agendado pela IA do atendimento (WhatsApp)".
27. Cada rodada do funil grava em `ia_acoes` (tipo `copiloto`, `perfil_id` nulo): autonomia usada, motivo de humano, mensagens enviadas, propostas para confirmar e a próxima ação sugerida — o simulador (`--exigir-ia-automatica`) conta isso como "IA agiu sozinha".
28. `executarAcao` em modo funil respeita `decisaoDoFunil` (403 "pede o clique de alguém da equipe" para o que não pode sozinho); no copiloto do atendente nada mudou.
29. Executar uma proposta de `responder` com `enviar` (clique do atendente em "Aprovar e enviar") manda a mensagem ao cliente; sem `enviar` continua só pondo o texto no campo.
30. Falha na IA (rede, 429, 503) vira linha `erro`/`pulada` na fila com o motivo — nunca derruba o servidor; o despertador tenta de novo até 5 vezes.
31. `PUT /api/ia/config` aceita `funil_ativo`, `funil_autonomia` (valida cada etapa: herdar/sugerir/confirmar/automatico; "herdar" limpa) e `funil_url` (só endereços terminados em `/api/ia/funil/acordar`); a auditoria registra os campos e os níveis.
32. `GET /api/ia/config` devolve `funil_niveis` (efetivos), `etapasFunil`, `niveis` e `funilDisponivel`; `GET /api/ia/uso` devolve `funil_ativo` e os níveis.
33. Rotas novas: `POST /api/ia/funil/acordar` (token do webhook, 60/min por IP), `GET /api/ia/funil/estado` (equipe), `POST /api/ia/funil/processar` (gestor/admin, 6/min, auditado), `GET /api/ia/hoje` (equipe).
34. `IA_FUNIL=0` desliga a IA do funil num servidor (testes locais); sem `ANTHROPIC_API_KEY` ela não liga.
35. Teste do gatilho em produção sem sujar nada (DO-block revertido): mensagem de entrada → linha na fila com `telefone_e164`, agendada para +8 s, apontando para a mensagem; o HTTP de acordar entrou na fila do pg_net dentro da transação e foi desfeito junto.
36. Contrato do Site (coordenador): mensagem do botão do site ("Olá! Vim pelo site… quero orçar: <serviço>. (site/<código>--<campanha>)") é lida pelo funil (`origemDoSite`): a IA recebe serviço e campanha, não pergunta o serviço de novo e registra o interesse; "quero orçar" do site não vira pedido de valor.
37. Contrato da Agenda (coordenador): antes de marcar, o servidor consulta a função SQL `agenda_horarios_livres(p_dia, p_servico, p_consultor)` — não depende do Render acordado — e, se o dia está fechado ou o horário lotado lá, não marca e a mensagem oferece outras opções; sem a função ou com erro, vale só a nossa regra (`horarioLivreNaAgenda`). Conferido no banco real: a função devolve `horarios[{hora, fim, livres, consultores_livres}]` como o contrato diz.

## Cliente da casa e telefone normalizado (`lib/contexto.js`)
38. Conversa sem `cliente_id` → `cliente_360(p_telefone)` acha o cadastro pelo telefone (com/sem 55, com/sem o 9) antes de montar a ficha; a ficha devolve `ligadoPeloTelefone` para o funil religar a conversa.
39. `clienteDaCasa` calculado (serviço feito, lead ganho ou agendamento concluído) e marcado no prompt: "CLIENTE DA CASA: cumprimente pelo nome, cite o carro, NÃO se apresente como a um desconhecido" — o achado do simulador (IA tratando cliente antigo como estranho).
40. A linha "pode se apresentar" da situação só aparece para quem é novo de verdade; para cliente da casa vira "sem apresentação formal — vá direto ao assunto".
41. A validação do `responder` tira a apresentação de desconhecido do texto quando o cliente é da casa, mesmo na primeira resposta da conversa.
42. Buscas por telefone em `leads` e `posvenda_envios` passaram de `in(telefone, variantes)` para `eq(telefone_e164, dígitos)` (coluna gerada e indexada da rodada 5 do banco).
43. Histórico na ficha: cliente com serviço concluído na agenda mas sem contagem na view aparece como "já fez serviço aqui", não "nunca fez".

## Copiloto humano (`lib/ia-copiloto.js`, `public/copiloto.js`)
44. "Próximo passo" calculado pelo sistema (`proximaAcao`, pura): aprovar o agendamento proposto, confirmar endereço, ligar para reclamação, montar orçamento, oferecer dois horários, lembrete na véspera, retomar conversa fria, responder quem espera, acompanhar.
45. O painel mostra o "Próximo passo" acima do resumo; `/api/ia/copiloto` devolve `proxima_acao`, `niveis`, `enviadas` e `para_confirmar`.
46. Respostas rápidas por intenção (sem IA, sem preço): agendar, orçamento, dúvida, reclamação, remarcar, cancelar, retorno, pós-venda, saudação, outro — com `{nome}` e os dois horários livres já trocados; um clique põe no campo.
47. Cartão de `responder` com `enviar` vira "✉️ Aprovar e enviar" e mostra o texto que vai sair; executa mesmo em "só sugerir" (é o clique humano).
48. Cabeçalho do copiloto mostra "a IA está respondendo…" quando a conversa está na fila (ouve `indycar:ia-fila` do app.js) e recarrega o histórico quando ela termina; ao trocar de conversa recalcula.
49. Executar/recusar/desfazer no painel dispara `indycar:ia-acao` para a faixa de propostas da conversa acompanhar.
50. Resumo da conversa em 3 linhas e pendências continuam; o funil usa o mesmo `resumir`.

## Painel: IA em ação, autonomia, propostas na conversa (`public/index.html`, `public/app.js`, `public/styles.css`)
51. Aba IA ganhou o cartão "Até onde a IA vai sozinha": chave "IA responde os clientes pelo WhatsApp", padrão em 3 pílulas (Só sugerir / Pedir um clique / Fazer sozinha) e tabela de 4 etapas com "Padrão · <nível efetivo>" + 3 níveis. Salva no clique, confirma "Salvo. Vale para a próxima mensagem".
52. Só o administrador muda; atendente e gestor veem tudo desabilitado com o aviso "peça ao administrador". Texto fixo lembra o que SEMPRE pede clique.
53. Selo do funil: "ligada" / "só copiloto" / "IA desligada".
54. Cartão "IA em ação": totais do dia (conversas tocadas, mensagens enviadas, horários marcados, esperando clique, passados para gente, erros, na fila agora) e a lista por conversa com hora, ícone, resumo, texto enviado, situação (feito sozinha / esperando clique / recusado / deu erro / desfeito).
55. Em cada ação: Aprovar (ou "✉️ Aprovar e enviar"), Recusar e ↶ Desfazer (só nas reversíveis executadas); "abrir conversa ›" leva à conversa certa.
56. Botão "▶ Rodar a fila agora" para gestor/admin quando há fila (processa na hora e mostra quantas respondeu/pulou/erros); atendente não vê.
57. Estado vazio que ensina: "A IA ainda não agiu hoje. Quando um cliente escrever, o que ela fizer aparece aqui — com desfazer."
58. Faixa de propostas DENTRO da conversa (`#chatPropostas`): o que a IA deixou sozinha esperando clique, com Aprovar / Aprovar e enviar / Recusar; mostra o texto da mensagem proposta; até 4, o resto no copiloto.
59. Aprovar na faixa recarrega mensagens, ficha e etapa; botões desabilitados enquanto a ação roda (sem clique duplo — pego pelo roteiro); erro em português.
60. "a IA está respondendo…" no cabeçalho do chat e na lista de conversas (tag com giro) via tempo real da `at_ia_fila`; some quando a fila fecha e, se a conversa está aberta, mensagens e propostas chegam na hora.
61. Estado inicial da fila lido em `GET /api/ia/funil/estado` ao entrar (quem já estava sendo respondido aparece marcado).
62. Texto da aba IA e do "Como funciona" atualizados (conduz até onde você deixar; gente cuida de gente).
63. Tudo em 375 px sem rolagem lateral (tabela de autonomia empilha, faixa compacta).

## Follow-up automático (`lib/automacoes.js`)
64. Automação nova "followup" no ciclo de 5 min: a loja respondeu e o cliente não voltou em 24 h (até 3 dias) → tarefa "Dar um retorno para <nome>" para o dono da conversa (origem `automacao`, prioridade normal, vence no fim do expediente), com a última mensagem nossa na descrição.
65. Não cria para: cliente que ainda espera resposta (isso é o alerta de espera), horário marcado, conversa resolvida/fechada, cedo demais (< 24 h) e quem já ganhou tarefa automática na semana; até 30 por ciclo.
66. `POST /api/automacoes/rodar {tarefa:'followup'}` roda à mão (admin).

## Pronto para a IndyCar Central (onda B2) — `server.js`, `public/*`
67. `server.js` exporta `handler` e `iniciar()`; `listen` só com `require.main === module` (importar não abre porta). `SO_FUNCOES=1` continua valendo para os scripts antigos.
68. `req.prefixo` (posto pela Central) ou variável `PREFIXO` define onde o app está montado; `normalizarPrefixo` aceita "atendimento", "/atendimento" e "/atendimento/".
69. O `index.html` sai com `<base href="<prefixo>">` injetado no servidor (cache e ETag por prefixo; CSP mantém `base-uri 'self'`).
70. `GET /api/config` devolve `prefixo` e `funilIA`.
71. `public/apps.js` (novo, carregado antes de tudo): o ÚNICO lugar com os endereços dos apps (Agenda, CRM, Atendimento, Comunicar, Orçador, Pátio, Site, Ads) e com `base`, `caminho()`, `url()`, `link(app, rel)` e `lista()`.
72. `rede.js` reescreve todo `fetch('/api/…')` para dentro do prefixo (um lugar só; os 40 pontos da tela continuam iguais) e reconhece o `/api/` do prefixo como "nosso servidor" (novas tentativas no 503).
73. `acesso.js` (apps do "sem acesso"/perfil), `tarefas.js` (links do sino) e `app.js` (links da ficha, "Abrir o Comunicar", copiar link da conversa, seletor do ecossistema) passaram a ler do `apps.js`; nenhum `onrender.com` solto fora das reservas.
74. Seletor "Ecossistema IndyCar" montado pelo `apps.js` (ganhou o Pátio); dentro da Central o próprio Atendimento passa a ser a origem atual + prefixo.
75. `index.html`, `manifest.json` (`start_url: "./"`, `scope: "./"`, ícones e atalhos relativos) e `casca.js` (`register('sw.js')`) sem nenhuma barra inicial.
76. `sw.js` v16: tudo relativo à pasta dele (`RAIZ`): casca, arquivos, fronteira do `/api/` e clique na notificação; ignora pedidos de outro app no mesmo domínio.
77. Servidor de mentira com `PREFIXO=atendimento` monta o mock em `/atendimento/` (404 fora dele) — é assim que o roteiro prova a tela no prefixo.
78. Teste automático com um proxy mínimo (tira o prefixo e põe `req.prefixo`, como a Central): `/atendimento/` com a base certa, estáticos, `/api/status`, `/api/config.prefixo`, 404 fora, e sozinho continua em "/".

## Testes e ferramentas
79. `test/ia-funil.test.js` (29): regras de humano, site, textos sem resposta, humano recente, etapa "Agendado", níveis e decisões, texto de horário ocupado, próxima ação, consultor livre; a IA conduzindo em `automatico`/`confirmar`/`sugerir`/por etapa, preço→humano com a ordem certa, atendente recente, já respondida, desligada, disparo, religar cliente, cliente do site, dupla checagem com a Agenda, fila (agrupar/digitando/pulada/erro), `hoje()`, relógio da fila.
80. `test/rotas.test.js` (+1): acordar com/sem token, estado, processar (403 para atendente, auditado), hoje, config por etapa (herdar, inválido 400, url 400), uso.
81. `test/servidor.test.js` (+2 e ajustes): caminhos relativos no HTML/manifest/casca/SW, exportação de handler/iniciar, proxy do prefixo, rotas do funil (401 e token).
82. `test/automacoes.test.js` (+1): follow-up com 6 casos; o ciclo roda as cinco.
83. `test/contexto.test.js` (+1): religar pelo telefone via rpc, cliente da casa no prompt, telefone_e164.
84. Servidor de mentira: `ia_config` com os campos novos, `GET/PUT /api/ia/config`, `/api/ia/hoje`, `/api/ia/funil/estado|processar`, fila com a Renata "processando", propostas da IA (agendar e "Aprovar e enviar"), executar que "envia" a mensagem, `/api/ia/acoes?conversaId=` filtrado como a rota real, `POST /api/_ia_reset`.
85. `scripts/roteiro-rodada5.cjs` (74 conferências, 1440 e 375 px, mais o prefixo): lista/cabeçalho/copiloto com "IA respondendo", faixa de propostas (aprovar e enviar, recusar), tempo real da fila, aba IA (autonomia, salvar, IA em ação, desfazer, abrir conversa, Rodar a fila), atendente só leitura, e o app inteiro em `/atendimento/`.
86. Link do Comunicar "Colar a chave no Atendimento" (`?aba=integracoes`): abre Configurações › Integrações direto, rola até a caixa da chave, destaca e põe o campo da chave em foco; quem não é admin vê "peça ao gestor"; o parâmetro sai do endereço. Vale para qualquer `?aba=<nome>` (aba que o papel não tem → aviso). Conferido no Chrome com admin e atendente.
87. Cópia da migração em `scripts/sql/2026-10-16_at_ia_funil_v1.sql` com a explicação do caminho; LEIA-ME com a seção da rodada.

## Como verifiquei
- `npm test` 234/234; `npm run segredos` limpo; `npm audit` 0.
- Dois mocks (`PORT=3225` e `PORT=3226 PREFIXO=atendimento`) + `node scripts/roteiro-rodada5.cjs` → 74/74; regressões `roteiro-rodada4.cjs` 145/145, `roteiro-tela.cjs` 220/220, `roteiro-casca.cjs` 13/13.
- Banco real: migração aplicada; gatilho testado em DO-block revertido; `server.js` com `SO_FUNCOES=1` lendo `at_ia_fila`, `ia_config` e `hoje()` (só leitura); `agenda_horarios_livres` conferida; `get_advisors` sem avisos para `at_*`.
- Em produção, depois de publicar: `/api/status`, `<base href="/">` no HTML, `POST /api/ia/funil/acordar` sem token → 401, e `select at_ia_acordar()` no banco → o servidor respondeu (ver relatório).

## Pendências
- A IA só manda mensagem se `funil_autonomia.responder` (ou o padrão) estiver em `automatico`. Em produção o padrão está em **confirmar** (seguro): ligar "Fazer sozinha" em Atendimento › IA é decisão do João. O simulador com `--exigir-ia-automatica` precisa disso ligado.
- Render gratuito: a primeira mensagem depois de o servidor dormir leva o tempo de acordar (~30–60 s) antes da IA responder; o despertador do pg_cron garante que não se perde. Para resposta em segundos, Starter no Atendimento (RENDER.md).
- Chave do CodeWords recusada (401): a mensagem da IA fica `falhou` em `whatsapp_mensagens` até a chave voltar — igual às dos atendentes.
- Simulador (`indycar-ferramentas/simulador/cliente.mjs`): quando a IA agenda sozinha, o passo "IA propôs agendar" do copiloto não acha a proposta (o horário já foi marcado) — vale ajustar o cenário para pular `executarProposta` quando o agendamento já existe.
- Edge Function `codewords-webhook` não foi alterada (a fila nasce no gatilho do banco, que vale para qualquer caminho de entrada).
- A lista de horários livres mostrada à IA (`lib/horarios.js`) continua a nossa; a função da Agenda entra como dupla checagem no `agendar`. Trocar a lista inteira pela função SQL fica para a onda C/Central.
