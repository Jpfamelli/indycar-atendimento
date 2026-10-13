# Melhorias — Atendimento (tela) · Rodada 3 (13/10/2026)

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
