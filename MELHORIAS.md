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
