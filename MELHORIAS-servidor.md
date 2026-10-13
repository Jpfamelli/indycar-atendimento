# Melhorias — Atendimento: servidor, segurança e equipe

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
