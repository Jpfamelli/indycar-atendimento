# Melhorias — papel "Atendimento — tela" (Rodada 2, 09/10/2026)

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
