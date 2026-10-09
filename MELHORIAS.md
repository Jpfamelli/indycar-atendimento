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
