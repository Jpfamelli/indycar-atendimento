// ============================================================================
// Servidor de MENTIRA para mexer na tela sem login e sem dado real de cliente.
//
//   node scripts/mock-server.mjs            → http://localhost:3211  (perfil admin)
//   ?papel=  escolhe QUEM está logado (um perfil de mentira por papel):
//      admin (padrão) · gestor · atendente · agenda (Franklin, só a Agenda) ·
//      desativado · semapp (atendente sem o app Atendimento) ·
//      trocarsenha (precisa trocar a senha) · mfa (verificação em duas etapas;
//      código certo = 123456) · deslogado (abre a tela de login; senha "errada"
//      dá senha incorreta; o e-mail de qualquer perfil acima entra como ele)
//   ?recuperar=1   simula a volta do link "esqueci a senha" (evento PASSWORD_RECOVERY)
//   ?sem_rotas=1   as rotas novas da rodada 3 (equipe, auditoria, tarefas/equipe,
//                  transferir) respondem 404 — testa o aviso amigável da tela
//   ?saude=ok      sem a faixa de saúde · ?envio=ok o envio dá certo (✓) em vez do 401
//   MOCK_MUITAS=400 node scripts/mock-server.mjs   → +400 conversas (testa a rolagem infinita)
//   MOCK_COPILOTO=c:/caminho/copiloto-teste.js     → serve esse arquivo como /copiloto.js
//                                                    (sem ele e sem public/copiloto.js: arquivo vazio, sem erro)
//   No console: __mockTempoReal('INSERT', 'notificacoes', {...}) simula o tempo real de qualquer
//   tabela; __mockPresenca(conversaId, [{id, nome, cor}]) simula colegas vendo a mesma conversa.
//
// O token do "login" é `mock-<id do perfil>`: as rotas /api/* e o dublê do banco
// sabem quem chama e aplicam as regras do servidor e do RLS de verdade
// (desativado → 403 'desativado'; sem o app → 403 'sem_acesso_app'; só gestor/
// admin apaga; perfis: cada um vê o seu e o admin vê todos; notificações: só as minhas).
//
// Serve a pasta public/ de verdade (o mesmo index.html, app.js e styles.css que
// vão para o Render) e responde /api/* com dados inventados. A única coisa
// trocada no HTML é a biblioteca do Supabase, que vira um dublê respondendo às
// tabelas que o app usa, com os dados em memória.
// NUNCA é usado em produção: o Render sobe o server.js.
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PAT from '../lib/patio.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 3211);
/* Rodada 5 (Central): PREFIXO=/atendimento/ monta o mock num caminho, como a Central vai fazer
   (o index.html recebe <base href> e todo caminho da tela vira relativo). */
const PREFIXO = (() => { let p = String(process.env.PREFIXO || '/'); if (!p.startsWith('/')) p = '/' + p; if (!p.endsWith('/')) p += '/'; return p; })();
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

const agora = Date.now();
const h = (n) => new Date(agora - n * 3600_000).toISOString();          // n horas atrás
const d = (n) => new Date(agora - n * 86400_000).toISOString();         // n dias atrás
// dia no fuso da oficina, n dias à frente (AAAA-MM-DD)
const diaSP = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(agora + n * 86400_000));
const hojeMMDD = () => { const x = new Date(); return `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const U = { admin: '11111111-1111-4111-8111-111111111111', atendente: '22222222-2222-4222-8222-222222222222',
  gestor: '33333333-3333-4333-8333-333333333333', agenda: '44444444-4444-4444-8444-444444444444',
  desativado: '55555555-5555-4555-8555-555555555555', semapp: '66666666-6666-4666-8666-666666666666',
  trocarsenha: '77777777-7777-4777-8777-777777777777', mfa: '88888888-8888-4888-8888-888888888888' };
const EQ = { recepcao: 'e0000000-0000-4000-8000-0000000000a1', oficina: 'e0000000-0000-4000-8000-0000000000a2' };
const TODOS_APPS = ['atendimento', 'crm', 'agenda', 'comunicar', 'orcador', 'ads'];
const ETAPA = { novo: 'e1', orc: 'e2', agendado: 'e3', servico: 'e4', concluido: 'e5' };
const CLI = {
  camila: '5f6c1a2e-0001-4abc-9def-000000000001', jose: '5f6c1a2e-0002-4abc-9def-000000000002',
  renata: '5f6c1a2e-0003-4abc-9def-000000000003', marcos: '5f6c1a2e-0004-4abc-9def-000000000004',
};
const CONV = { camila: 'c0000000-0000-4000-8000-000000000001', jose: 'c0000000-0000-4000-8000-000000000002',
  renata: 'c0000000-0000-4000-8000-000000000003', marcos: 'c0000000-0000-4000-8000-000000000004',
  semcad: 'c0000000-0000-4000-8000-000000000005' };

// ---------------------------------------------------------------- dados
const DB = {
  perfis: [
    { id: U.admin, nome: 'João Pedro', email: 'joao@indycartaubate.com', papel: 'admin', ativo: true, equipe_id: EQ.recepcao,
      apps: TODOS_APPS, cargo: 'Dono', telefone: '12996830272', avatar_cor: '#e50914', recebe_leads: false, ultimo_acesso_em: h(0.1),
      ultimo_app: 'atendimento', mfa_ativo: false, precisa_trocar_senha: false, created_at: d(300), preferencias: {} },
    { id: U.gestor, nome: 'Maria Souza', email: 'maria@indycartaubate.com', papel: 'gestor', ativo: true, equipe_id: EQ.recepcao,
      apps: ['atendimento', 'crm', 'agenda', 'comunicar'], cargo: 'Gerente', telefone: '12991112222', avatar_cor: '#a855f7', recebe_leads: true,
      ultimo_acesso_em: h(3), ultimo_app: 'crm', mfa_ativo: false, precisa_trocar_senha: false, created_at: d(200), preferencias: {} },
    { id: U.atendente, nome: 'Leonardo Alves', email: 'leo@indycartaubate.com', papel: 'atendente', ativo: true, equipe_id: EQ.recepcao,
      apps: ['atendimento', 'crm', 'agenda'], cargo: 'Consultor', telefone: '12993334444', avatar_cor: '#0ea5e9', recebe_leads: true,
      ultimo_acesso_em: h(0.5), ultimo_app: 'atendimento', mfa_ativo: false, precisa_trocar_senha: false, created_at: d(150), preferencias: {} },
    { id: U.agenda, nome: 'Franklin Rocha', email: 'franklin@indycartaubate.com', papel: 'agenda', ativo: true, equipe_id: EQ.oficina,
      apps: ['agenda'], cargo: 'Chefe de oficina', telefone: null, avatar_cor: '#f97316', recebe_leads: false,
      ultimo_acesso_em: d(1), ultimo_app: 'agenda', mfa_ativo: false, precisa_trocar_senha: false, created_at: d(120), preferencias: {} },
    { id: U.desativado, nome: 'Paulo Mendes', email: 'paulo@indycartaubate.com', papel: 'atendente', ativo: false, equipe_id: EQ.recepcao,
      apps: ['atendimento'], cargo: 'Consultor', telefone: null, avatar_cor: '#64748b', recebe_leads: false,
      ultimo_acesso_em: d(40), ultimo_app: 'atendimento', mfa_ativo: false, precisa_trocar_senha: false, created_at: d(250),
      desativado_em: d(35), preferencias: {} },
    { id: U.semapp, nome: 'Bianca Lopes', email: 'bianca@indycartaubate.com', papel: 'atendente', ativo: true, equipe_id: EQ.recepcao,
      apps: ['crm', 'comunicar'], cargo: 'Marketing', telefone: null, avatar_cor: '#ec4899', recebe_leads: false,
      ultimo_acesso_em: d(2), ultimo_app: 'comunicar', mfa_ativo: false, precisa_trocar_senha: false, created_at: d(60), preferencias: {} },
    { id: U.trocarsenha, nome: 'Carlos Henrique', email: 'carlos@indycartaubate.com', papel: 'atendente', ativo: true, equipe_id: EQ.oficina,
      apps: ['atendimento', 'agenda'], cargo: 'Consultor', telefone: null, avatar_cor: '#14b8a6', recebe_leads: true,
      ultimo_acesso_em: null, ultimo_app: null, mfa_ativo: false, precisa_trocar_senha: true, created_at: d(1), preferencias: {} },
    { id: U.mfa, nome: 'Renan Dias', email: 'renan@indycartaubate.com', papel: 'atendente', ativo: true, equipe_id: EQ.oficina,
      apps: ['atendimento', 'crm', 'orcador'], cargo: 'Consultor técnico', telefone: '12995556666', avatar_cor: '#22c55e', recebe_leads: true,
      ultimo_acesso_em: h(20), ultimo_app: 'orcador', mfa_ativo: true, precisa_trocar_senha: false, created_at: d(90), preferencias: {} },
  ],
  equipes: [{ id: EQ.recepcao, nome: 'Recepção', cor: '#3b82f6' }, { id: EQ.oficina, nome: 'Oficina', cor: '#f97316' }],
  tarefas: [
    { id: 'a0000000-0000-4000-8000-0000000000b1', titulo: 'Ligar para a Camila confirmando o alinhamento', descricao: 'Ela pediu para ligar depois das 10h.',
      responsavel_id: U.admin, criado_por: U.gestor, cliente_id: CLI.camila, conversa_id: CONV.camila, origem: 'atendimento', prioridade: 1,
      vence_em: new Date(agora - 2 * 3600_000).toISOString(), status: 'aberta', created_at: d(1) },
    { id: 'a0000000-0000-4000-8000-0000000000b2', titulo: 'Mandar orçamento do freio para o José', descricao: null,
      responsavel_id: U.admin, criado_por: U.admin, cliente_id: CLI.jose, conversa_id: CONV.jose, origem: 'atendimento', prioridade: 2,
      vence_em: new Date(agora + 3 * 3600_000).toISOString(), status: 'aberta', created_at: h(5) },
    { id: 'a0000000-0000-4000-8000-0000000000b3', titulo: 'Conferir peças do Compass', descricao: null,
      responsavel_id: U.atendente, criado_por: U.admin, cliente_id: CLI.renata, conversa_id: CONV.renata, origem: 'manual', prioridade: 3,
      vence_em: new Date(agora + 2 * 86400_000).toISOString(), status: 'aberta', created_at: h(8) },
    { id: 'a0000000-0000-4000-8000-0000000000b4', titulo: 'Retornar o Marcos sobre a garantia', descricao: null,
      responsavel_id: U.atendente, criado_por: U.gestor, cliente_id: CLI.marcos, conversa_id: CONV.marcos, origem: 'crm', prioridade: 2,
      vence_em: null, status: 'aberta', created_at: d(2) },
    { id: 'a0000000-0000-4000-8000-0000000000b5', titulo: 'Pedir avaliação no Google para a Camila', descricao: null,
      responsavel_id: U.admin, criado_por: U.admin, cliente_id: CLI.camila, conversa_id: CONV.camila, origem: 'comunicar', prioridade: 3,
      vence_em: d(3), status: 'feita', concluida_em: d(2), concluida_por: U.admin, created_at: d(5) },
  ],
  notificacoes: [],
  etapas_funil: [
    { id: ETAPA.novo, nome: 'Novo contato', cor: '#3b82f6', ordem: 1, ativa: true, gatilhos: [] },
    { id: ETAPA.orc, nome: 'Orçamento enviado', cor: '#f59e0b', ordem: 2, ativa: true, gatilhos: [], status_lead: 'orcamento' },
    { id: ETAPA.agendado, nome: 'Agendado', cor: '#22c55e', ordem: 3, ativa: true, gatilhos: [] },
    { id: ETAPA.servico, nome: 'Em serviço', cor: '#a855f7', ordem: 4, ativa: true, gatilhos: [] },
    { id: ETAPA.concluido, nome: 'Serviço concluído', cor: '#14b8a6', ordem: 5, ativa: true, gatilhos: [] },
  ],
  funil_config: [{ id: true, ia_classifica: false, confianca_minima: 0.6 }],
  clientes: [
    { id: CLI.camila, nome: 'Camila Rodrigues', telefone: '12996830111', telefone_e164: '12996830111', carro_modelo: 'Corolla 2020', placa: 'FHR6F16',
      origem: 'whatsapp', email: 'camila@exemplo.com', observacoes: 'Gosta de ser chamada pelo primeiro nome.',
      nascimento: `1904-${hojeMMDD()}`, aceita_mensagens: true, aceita_mensagens_em: null, aceita_mensagens_motivo: null, created_at: d(400) },
    { id: CLI.jose, nome: 'José Antônio Ferreira', telefone: '12988887777', telefone_e164: '12988887777', carro_modelo: 'S10 2018', placa: 'GFK3H26',
      origem: 'google', nascimento: '1979-03-22', aceita_mensagens: false, aceita_mensagens_em: d(12),
      aceita_mensagens_motivo: 'Pediu para parar pelo WhatsApp (resposta à campanha)', created_at: d(700) },
    { id: CLI.renata, nome: 'Renata Figueiredo', telefone: '12977776666', telefone_e164: '12977776666', carro_modelo: 'Compass 2022', placa: 'ABC1D23',
      origem: 'instagram', nascimento: null, aceita_mensagens: true, created_at: d(90) },
    { id: CLI.marcos, nome: 'Marcos Vinícius', telefone: '12966665555', telefone_e164: '12966665555', carro_modelo: 'Gol 2012', placa: null,
      origem: 'indicacao', nascimento: '1990-11-02', aceita_mensagens: true, created_at: d(30) },
  ],
  conversas: [
    { id: CONV.camila, cliente_id: CLI.camila, telefone: '5512996830111', telefone_e164: '12996830111', nome: 'Camila Rodrigues', status: 'aberta',
      atribuida_a: U.admin, ia_ativa: false, nao_lidas: 2, ultima_mensagem_em: h(0.2), ultima_previa: 'Consigo levar amanhã de manhã?', created_at: d(3),
      tipo: 'atendimento', etapa_id: ETAPA.orc, desfecho: null, aguardando_consultor: false },
    { id: CONV.jose, cliente_id: CLI.jose, telefone: '5512988887777', telefone_e164: '12988887777', nome: 'José Antônio Ferreira', status: 'pendente',
      atribuida_a: U.atendente, ia_ativa: true, nao_lidas: 0, ultima_mensagem_em: h(5), ultima_previa: 'Ok, obrigado', created_at: d(40),
      tipo: 'atendimento', etapa_id: ETAPA.novo, desfecho: null, aguardando_consultor: true, aguardando_desde: h(3) },
    { id: CONV.renata, cliente_id: CLI.renata, telefone: '5512977776666', telefone_e164: '12977776666', nome: 'Renata Figueiredo', status: 'aberta',
      atribuida_a: null, ia_ativa: true, nao_lidas: 1, ultima_mensagem_em: h(26), ultima_previa: '🖼 Foto', created_at: h(26),
      tipo: 'atendimento', etapa_id: ETAPA.novo, desfecho: null, aguardando_consultor: false },
    { id: CONV.marcos, cliente_id: CLI.marcos, telefone: '5512966665555', telefone_e164: '12966665555', nome: 'Marcos Vinícius', status: 'resolvida',
      atribuida_a: U.admin, ia_ativa: false, nao_lidas: 0, ultima_mensagem_em: d(2), ultima_previa: 'Valeu!', created_at: d(20),
      tipo: 'atendimento', etapa_id: ETAPA.novo, desfecho: null, aguardando_consultor: false },
    { id: CONV.semcad, cliente_id: null, telefone: '5512955554444', telefone_e164: '12955554444', nome: null, status: 'aberta',
      atribuida_a: null, ia_ativa: true, nao_lidas: 1, ultima_mensagem_em: h(1), ultima_previa: 'Vocês fazem alinhamento?', created_at: h(1),
      tipo: 'atendimento', etapa_id: ETAPA.novo, desfecho: null, aguardando_consultor: false },
  ],
  whatsapp_mensagens: [
    { id: 'm1', conversa_id: CONV.camila, telefone: '5512996830111', nome: 'Camila', corpo: 'Oi! Quanto fica a troca de óleo do Corolla?', direcao: 'entrada', status: 'recebido', created_at: d(1) },
    { id: 'm2', conversa_id: CONV.camila, corpo: 'Oi, Camila! Aqui é o atendimento da IndyCar. Para o Corolla a gente faz o diagnóstico gratuito primeiro, pode trazer?', direcao: 'saida', status: 'enviado', enviado_por: U.atendente, created_at: new Date(agora - 86400_000 + 120_000).toISOString() },
    { id: 'm2b', conversa_id: CONV.camila, corpo: 'Assim que chegar, me chama aqui que eu te recebo. 👍', direcao: 'saida', status: 'enviado', enviado_por: U.gestor, created_at: new Date(agora - 86400_000 + 240_000).toISOString() },
    { id: 'm3', conversa_id: CONV.camila, corpo: 'Consigo levar amanhã de manhã?', direcao: 'entrada', status: 'recebido', created_at: h(0.2) },
    { id: 'm4', conversa_id: CONV.jose, corpo: 'Bom dia, meu freio está fazendo barulho', direcao: 'entrada', status: 'recebido', created_at: h(6) },
    { id: 'm5', conversa_id: CONV.jose, corpo: 'Bom dia, José! Vou passar para um consultor te atender.', direcao: 'saida', status: 'enviado', gerada_por_ia: true, created_at: h(5.5) },
    { id: 'm6', conversa_id: CONV.jose, corpo: 'Ok, obrigado', direcao: 'entrada', status: 'recebido', created_at: h(5) },
    { id: 'm7', conversa_id: CONV.renata, corpo: '🖼 Foto', direcao: 'entrada', status: 'recebido', created_at: h(26) },
    { id: 'm8', conversa_id: CONV.semcad, corpo: 'Vocês fazem alinhamento?', direcao: 'entrada', status: 'recebido', created_at: h(1) },
  ],
  leads: [
    { id: 'l1', cliente_id: CLI.camila, servico: 'Troca de óleo do motor', valor_orcado: 320, valor_pago: 340, status: 'concluido', created_at: d(200), closed_at: d(190), origem: 'whatsapp' },
    { id: 'l2', cliente_id: CLI.camila, servico: 'Alinhamento 3D', valor_orcado: 180, valor_pago: 0, status: 'orcamento', created_at: d(1), origem: 'whatsapp' },
    { id: 'l3', cliente_id: CLI.jose, servico: 'Pastilha de freio', valor_orcado: 450, valor_pago: 450, status: 'concluido', created_at: d(400), closed_at: d(395), origem: 'google' },
  ],
  agendamentos: [
    { id: 'a1', cliente_id: CLI.camila, servico: 'Troca de óleo do motor', inicio_em: d(190), data: d(190).slice(0, 10), status: 'concluido', valor: 340, consultores: { nome: 'Leonardo' } },
    { id: 'a2', cliente_id: CLI.camila, servico: 'Alinhamento 3D', inicio_em: new Date(agora + 86400_000).toISOString(), data: diaSP(1), hora: '09:00', status: 'confirmado', valor: 0, consultores: { nome: 'Leonardo' } },
    { id: 'a3', cliente_id: CLI.jose, servico: 'Pastilha de freio', inicio_em: d(395), data: d(395).slice(0, 10), status: 'concluido', valor: 450, consultores: { nome: 'Leonardo' } },
    { id: 'a4', cliente_id: CLI.jose, servico: 'Revisão', inicio_em: d(100), data: d(100).slice(0, 10), status: 'nao_veio', valor: 0, consultores: null },
  ],
  v_cliente_360: [
    { id: CLI.camila, nome: 'Camila Rodrigues', telefone: '12996830111', carro_modelo: 'Corolla 2020', placa: 'FHR6F16', origem: 'whatsapp', cliente_desde: d(400),
      total_leads: 2, total_agendamentos: 2, servicos_feitos: 1, faltas: 0, total_gasto: 340, ultimo_servico_em: d(190), proximo_horario: new Date(agora + 86400_000).toISOString(),
      email: 'camila@exemplo.com', observacoes: 'Gosta de ser chamada pelo primeiro nome.' },
    { id: CLI.jose, nome: 'José Antônio Ferreira', telefone: '12988887777', carro_modelo: 'S10 2018', placa: 'GFK3H26', origem: 'google', cliente_desde: d(700),
      total_leads: 1, total_agendamentos: 2, servicos_feitos: 1, faltas: 1, total_gasto: 450, ultimo_servico_em: d(395), proximo_horario: null },
    { id: CLI.renata, nome: 'Renata Figueiredo', telefone: '12977776666', carro_modelo: 'Compass 2022', placa: 'ABC1D23', origem: 'instagram', cliente_desde: d(90),
      total_leads: 0, total_agendamentos: 0, servicos_feitos: 0, faltas: 0, total_gasto: 0, ultimo_servico_em: null, proximo_horario: null },
    { id: CLI.marcos, nome: 'Marcos Vinícius', telefone: '12966665555', carro_modelo: 'Gol 2012', placa: null, origem: 'indicacao', cliente_desde: d(30),
      total_leads: 0, total_agendamentos: 0, servicos_feitos: 0, faltas: 0, total_gasto: 0, ultimo_servico_em: null, proximo_horario: null },
  ],
  atalhos_mensagem: [
    { id: 't1', comando: 'bomdia', titulo: 'Bom dia', corpo: 'Bom dia, {primeiro_nome}! Aqui é o atendimento da IndyCar. Como posso ajudar com o {carro}?', categoria: 'saudacao', ativo: true, usos: 12 },
    { id: 't2', comando: 'revisao', titulo: 'Lembrete de revisão', corpo: '{primeiro_nome}, sua {ultimo_servico} tem revisão prevista para {proxima_revisao}. Quer já deixar marcado?', categoria: 'retorno', ativo: true, usos: 3 },
    { id: 't3', comando: 'confirmar', titulo: 'Confirmar horário', corpo: 'Combinado, {primeiro_nome}! Te esperamos {horario} com o {carro} ({placa}). Quem conhece, Indyca! 🏎', categoria: 'agenda', ativo: true, usos: 30 },
  ],
  servicos: [{ id: 's1', nome: 'Troca de óleo do motor', ativo: true }, { id: 's2', nome: 'Alinhamento 3D', ativo: true }, { id: 's3', nome: 'Pastilha de freio', ativo: true }],
  consultores: [{ id: 'c1', nome: 'Leonardo', ativo: true }],
  codewords_config: [{ id: true, ativo: true, url_envio: null, service_id: 'indycar_carlos_whatsapp_e3cd01d3', token_webhook: 'segredo-de-teste', responder_auto: true,
    ultimo_erro: 'WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações', ultimo_evento_em: d(6),
    url_webhook_publica: 'https://nppfqhavqahapmugnyng.supabase.co/functions/v1/codewords-webhook', modo_envio: 'dispositivo' }],
  codewords_fluxos: [{ id: 'f1', nome: 'Carlos — Indycar Centro Automotivo', service_id: 'indycar_carlos_whatsapp_e3cd01d3', descricao: 'envio e recebimento', ativo: true }],
  whatsapp_config: [{ id: true, numero_exibicao: '+55 12 99683-0272', ativo: false }],
  etiquetas: [], conversa_etiquetas: [], conversa_eventos: [], numeros_bloqueados: [],
};
let CHAVE = 'cwk-chave-antiga-de-teste-0000000000943a';
let ultimoEnvio401 = true;   // o primeiro envio simula a chave recusada

// Caixa de entrada cheia (como a real, com 2.400+): MOCK_MUITAS=400 cria conversas de enchimento
const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elaine', 'Fábio', 'Gisele', 'Hugo', 'Íris', 'Jorge', 'Kátia', 'Lucas'];
for (let i = 0; i < Number(process.env.MOCK_MUITAS || 0); i++) {
  const tel = String(12900000000 + i * 7919).slice(0, 11);
  DB.conversas.push({ id: `c1000000-0000-4000-8000-${String(i).padStart(12, '0')}`, cliente_id: null, telefone: '55' + tel, telefone_e164: tel,
    nome: `${NOMES[i % NOMES.length]} Teste ${String(i + 1).padStart(3, '0')}`, status: 'aberta', atribuida_a: i % 3 ? U.admin : null,
    ia_ativa: true, nao_lidas: i % 7 === 0 ? 1 : 0, ultima_mensagem_em: h(2 + i * 0.7), ultima_previa: 'Mensagem de enchimento ' + (i + 1),
    created_at: d(1 + i), tipo: 'atendimento', etapa_id: ETAPA.novo, desfecho: null, aguardando_consultor: false });
}
// ações do copiloto em memória (para executar / recusar / desfazer)
const ACOES = new Map();
/* Rodada 5 — IA do funil de mentira: propostas que a IA deixou SOZINHA (perfil null) esperando o clique,
   o que ela já fez hoje e a fila (a Renata está sendo respondida agora). */
const IA_CFG = { ativo: true, autonomia: 'confirmar', modelo_rapido: 'claude-sonnet-5-5', modelo_forte: 'claude-opus-5-5', limite_chamadas_dia: 500,
  instrucoes_extras: null, funil_ativo: true, funil_autonomia: { responder: 'automatico', agendar: 'confirmar' }, funil_url: 'https://indycar-atendimento.onrender.com/api/ia/funil/acordar' };
const niveisMock = () => Object.fromEntries(['responder', 'agendar', 'crm', 'humano'].map(e => [e, IA_CFG.funil_autonomia[e] || IA_CFG.autonomia]));
const IA_HOJE = [
  { id: 'ia-h1', tipo: 'responder', status: 'executada', resumo: 'Mensagem ao cliente', conversa_id: CONV.camila, created_at: h(0.3), executada_em: h(0.3), sozinha: true, automatica: true, enviada: true, reversivel: false, texto: 'Oi, Camila! Amanhã de manhã tenho 9h ou 10h30 para o Corolla. Qual fica melhor?' },
  { id: 'ia-h2', tipo: 'agendar', status: 'proposta', resumo: 'Agendar Alinhamento 3D — ' + diaSP(1) + ' às 9h', conversa_id: CONV.camila, created_at: h(0.2), sozinha: true, automatica: false, enviada: false, reversivel: false, texto: null },
  { id: 'ia-h3', tipo: 'atualizar_ficha', status: 'executada', resumo: 'Ficha: placa → FHR6F16', conversa_id: CONV.camila, created_at: h(0.3), executada_em: h(0.3), sozinha: true, automatica: true, enviada: false, reversivel: true, texto: null },
  { id: 'ia-h4', tipo: 'marcar_aguardando_consultor', status: 'executada', resumo: 'Aguardando consultor: pediu valor do freio', conversa_id: CONV.jose, created_at: h(3), executada_em: h(3), sozinha: true, automatica: true, enviada: false, reversivel: true, texto: null },
  { id: 'ia-h5', tipo: 'responder', status: 'executada', resumo: 'Mensagem ao cliente', conversa_id: CONV.jose, created_at: h(3), executada_em: h(3), sozinha: true, automatica: true, enviada: true, reversivel: false, texto: 'Bom dia, José! Valor certinho quem passa é o consultor — já estou chamando. 🏎' },
  { id: 'ia-h6', tipo: 'mover_etapa', status: 'executada', resumo: 'Mover para "Agendado" (cliente já tem horário marcado)', conversa_id: CONV.marcos, created_at: h(5), executada_em: h(5), sozinha: true, automatica: true, enviada: false, reversivel: true, texto: null },
];
for (const a of IA_HOJE.filter(x => x.status === 'proposta')) ACOES.set(a.id, { ...a, parametros: {}, precisa_clique: true });
ACOES.set('ia-h7', { id: 'ia-h7', tipo: 'responder', status: 'proposta', resumo: 'Mensagem ao cliente', conversa_id: CONV.camila, created_at: h(0.1), sozinha: true,
  parametros: { texto: 'Fechado então: amanhã às 9h a gente te espera com o Corolla! 📍 Av. Bandeirantes, 875', enviar: true }, precisa_clique: true, reversivel: false });
IA_HOJE.unshift({ ...ACOES.get('ia-h7'), automatica: false, enviada: false, texto: ACOES.get('ia-h7').parametros.texto });
const IA_FILA = [{ id: 'fila-1', conversa_id: CONV.renata, status: 'processando', created_at: h(0.01), iniciado_em: h(0.01) }];
DB.at_ia_fila = IA_FILA;

// ------------------------------------------------- rodada 3: notificações, auditoria, papéis
const PAPEL_PERFIL = { admin: U.admin, gestor: U.gestor, atendente: U.atendente, agenda: U.agenda, desativado: U.desativado,
  semapp: U.semapp, trocarsenha: U.trocarsenha, mfa: U.mfa };
const perfilPorId = (id) => DB.perfis.find(p => p.id === id) || null;
let seqNotif = 0;
function notificar(perfilId, tipo, titulo, corpo, link, app = 'atendimento', quando = new Date().toISOString()) {
  const n = { id: `f0000000-0000-4000-8000-${String(++seqNotif).padStart(12, '0')}`, perfil_id: perfilId, tipo, titulo, corpo, link, app,
    chave: null, lida_em: null, created_at: quando };
  DB.notificacoes.unshift(n);
  return n;
}
for (const p of DB.perfis) {
  notificar(p.id, 'tarefa', 'Tarefa nova para você', 'Maria passou "Ligar para a Camila confirmando o alinhamento".', `/?conversa=${CONV.camila}`, 'atendimento', h(1.2));
  notificar(p.id, 'conversa', 'Conversa passada para você', 'José Antônio Ferreira — "freio fazendo barulho". Motivo: fim do meu turno.', `/?conversa=${CONV.jose}`, 'atendimento', h(4));
  notificar(p.id, 'aguardando', 'Cliente aguardando consultor', 'Renata Figueiredo está esperando resposta há 26 h.', `/?conversa=${CONV.renata}`, 'atendimento', h(26));
  const lida = notificar(p.id, 'lead', 'Lead passado para você no CRM', 'Marcos Vinícius — Revisão.', '/?lead=l1', 'crm', d(2));
  lida.lida_em = d(1.5);
}

/* Auditoria: linha do tempo de mentira, nos formatos que os gatilhos do banco gravam */
const AUDITORIA = [];
let seqAud = 0;
function auditar(perfilId, acao, tabela, registro, { campos = null, antes = null, depois = null, detalhes = null, app = 'atendimento', quando } = {}) {
  AUDITORIA.unshift({ id: ++seqAud, perfil_id: perfilId, perfil_nome: perfilPorId(perfilId)?.nome || null, app, acao, tabela,
    registro_id: registro, campos, antes, depois, detalhes, created_at: quando || new Date().toISOString() });
}
auditar(U.admin, 'update', 'perfis', U.gestor, { campos: ['papel'], antes: { nome: 'Maria Souza', papel: 'atendente' }, depois: { nome: 'Maria Souza', papel: 'gestor' }, quando: d(20) });
auditar(U.admin, 'update', 'perfis', U.desativado, { campos: ['ativo'], antes: { nome: 'Paulo Mendes', ativo: true }, depois: { nome: 'Paulo Mendes', ativo: false }, quando: d(35) });
auditar(U.admin, 'update', 'perfis', U.semapp, { campos: ['apps'], antes: { nome: 'Bianca Lopes', apps: ['atendimento', 'crm'] }, depois: { nome: 'Bianca Lopes', apps: ['crm', 'comunicar'] }, quando: d(9) });
auditar(U.gestor, 'update', 'leads', 'l2', { campos: ['status'], antes: { status: 'contato', cliente_nome: 'Camila Rodrigues' }, depois: { status: 'orcamento', cliente_nome: 'Camila Rodrigues' }, app: 'crm', quando: d(1) });
auditar(U.atendente, 'update', 'leads', 'l2', { campos: ['valor_orcado'], antes: { valor_orcado: 150, cliente_nome: 'Camila Rodrigues' }, depois: { valor_orcado: 180, cliente_nome: 'Camila Rodrigues' }, app: 'crm', quando: h(20) });
auditar(U.gestor, 'delete', 'agendamentos', 'a9', { antes: { servico: 'Revisão', data: diaSP(-3), cliente_nome: 'Hugo Teste' }, app: 'agenda', quando: d(3) });
auditar(U.admin, 'delete', 'conversas', 'c9', { antes: { nome: 'Número de teste', telefone: '12900000000' }, quando: d(6) });
auditar(U.admin, 'update', 'codewords_config', 'true', { campos: ['api_key'], antes: { api_key: '•••' }, depois: { api_key: '•••' }, quando: d(12) });
auditar(U.admin, 'auditoria.exportar', 'auditoria', null, { detalhes: { filtros: { tabela: 'perfis' }, linhas: 12 }, quando: d(4) });
auditar(U.gestor, 'conversa.transferir', 'conversas', CONV.jose, { detalhes: { de: U.gestor, para: U.atendente, motivo: 'Fim do meu turno', leads_movidos: 1 }, quando: h(4) });
auditar(U.atendente, 'ia.executar', 'ia_acoes', 'ac1', { detalhes: { tipo: 'mover_etapa' }, quando: h(9) });
auditar(U.admin, 'equipe.redefinir_senha', 'perfis', U.trocarsenha, { detalhes: { troca_obrigatoria: true }, quando: d(1) });
auditar(U.admin, 'equipe.convidar', 'perfis', U.trocarsenha, { detalhes: { email: 'carlos@indycartaubate.com', papel: 'atendente', apps: ['atendimento', 'agenda'] }, quando: d(1) });
auditar(U.admin, 'equipe.editar', 'perfis', U.mfa, { detalhes: { antes: { papel: 'atendente', recebe_leads: false }, depois: { papel: 'atendente', recebe_leads: true } }, quando: d(8) });
auditar(U.admin, 'equipe.desativar', 'perfis', U.desativado, { detalhes: { motivo: 'Saiu da empresa', sessoes: 'derrubadas' }, quando: d(35) });
auditar(null, 'conversa.distribuir', 'conversas', CONV.marcos, { detalhes: { para: U.admin, motivo: 'rodízio' }, quando: d(20) });
auditar(U.atendente, 'tarefa.criar', 'tarefas', 'a0000000-0000-4000-8000-0000000000b3', { detalhes: { origem: 'atendimento', responsavel_id: U.atendente }, quando: h(8) });
auditar(null, 'update', 'leads', 'l3', { campos: ['responsavel_id'], antes: { responsavel_id: null, cliente_nome: 'José Antônio Ferreira' }, depois: { responsavel_id: U.atendente, responsavel_nome: 'Leonardo Alves', cliente_nome: 'José Antônio Ferreira' }, app: 'crm', quando: d(7) });
for (let i = 0; i < 30; i++) auditar(i % 2 ? U.atendente : U.gestor, 'update', 'leads', 'l' + (10 + i), { campos: ['status'],
  antes: { status: 'novo', cliente_nome: `${NOMES[i % NOMES.length]} Teste` }, depois: { status: 'contato', cliente_nome: `${NOMES[i % NOMES.length]} Teste` },
  app: 'crm', quando: d(10 + i) });
AUDITORIA.sort((a, b) => b.created_at.localeCompare(a.created_at));

// ------------------------------------------------- dublê do supabase-js
// Montado em texto para ser injetado no HTML. Encadeia .from().select().eq()...
// e resolve { data, error, count } lendo o DB em memória pela rota /api/_mock.
const DUBLE_SUPABASE = `<script>
(function(){
  var CFG = __CFG__;            // { perfil, recuperar } — perfil null = deslogado
  var sessao = CFG.perfil ? { access_token: 'mock-' + CFG.perfil.id, user: { id: CFG.perfil.id, email: CFG.perfil.email } } : null;
  var aal = 'aal1';
  var fatores = CFG.perfil && CFG.perfil.mfa_ativo ? [{ id: 'fator-1', factor_type: 'totp', status: 'verified', friendly_name: 'Celular' }] : [];
  var ouvintesAuth = [];
  function avisarAuth(ev){ ouvintesAuth.forEach(function(cb){ try { cb(ev, sessao); } catch(e){} }); }
  function pedir(op){
    var h = {'Content-Type':'application/json'};
    if (sessao) h.Authorization = 'Bearer ' + sessao.access_token;
    return fetch('/api/_mock', {method:'POST', headers:h, body: JSON.stringify(op)}).then(function(r){return r.json();});
  }
  // tempo real de mentira: cada canal guarda os seus ouvintes
  var canais = [];
  function dispararTabela(evento, tabela, linha, velha){
    var n = 0;
    canais.forEach(function(c){ c.pg.forEach(function(o){
      if ((o.f.event === '*' || o.f.event === evento) && o.f.table === tabela) {
        if (o.f.filter) { var m = /^([a-z_]+)=eq\\.(.+)$/.exec(o.f.filter); if (m && String((linha||{})[m[1]]) !== m[2]) return; }
        n++; o.cb({ eventType: evento, new: linha || {}, old: velha || {} });
      }
    }); });
    return n;
  }
  function builder(tabela){
    var op = { tabela: tabela, acao: 'select', colunas: '*', filtros: [], ordem: [], limite: null, um: false, head: false, count: null, corpo: null, range: null };
    var p = {};
    p.select = function(c, o){ if (op.acao === 'select') op.colunas = c || '*'; if (o && o.count) { op.count = o.count; op.head = !!o.head; } return p; };
    p.insert = function(c){ op.acao = 'insert'; op.corpo = c; return p; };
    p.update = function(c){ op.acao = 'update'; op.corpo = c; return p; };
    p.upsert = function(c){ op.acao = 'upsert'; op.corpo = c; return p; };
    p.delete = function(){ op.acao = 'delete'; return p; };
    ['eq','neq','gt','gte','lt','lte','like','ilike','is','in','not','or'].forEach(function(f){
      p[f] = function(a,b,c){ op.filtros.push([f,a,b,c]); return p; };
    });
    p.order = function(c,o){ op.ordem.push([c, o||{}]); return p; };
    p.limit = function(n){ op.limite = n; return p; };
    p.range = function(a,b){ op.range = [a,b]; return p; };
    p.maybeSingle = function(){ op.um = 'maybe'; return p; };
    p.single = function(){ op.um = 'single'; return p; };
    p.then = function(ok, ko){
      return pedir(op).then(function(r){
        // escrita em tabela com tempo real: o dublê avisa os ouvintes como o Supabase faria
        if (op.acao !== 'select' && (tabela === 'tarefas' || tabela === 'notificacoes') && !r.error) {
          var linhas = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
          var ev = op.acao === 'insert' ? 'INSERT' : op.acao === 'delete' ? 'DELETE' : 'UPDATE';
          setTimeout(function(){ linhas.forEach(function(l){ dispararTabela(ev, tabela, ev === 'DELETE' ? {} : l, l); }); }, 60);
        }
        return r;
      }).then(ok, ko);
    };
    return p;
  }
  function novoCanal(nome){
    var estado = {};               // presença: chave -> [meta]
    var c = { nome: nome, pg: [], pres: [], chave: null };
    c.on = function(tipo, filtro, cb){
      if (tipo === 'presence') c.pres.push({ f: filtro || {}, cb: cb }); else c.pg.push({ f: filtro || {}, cb: cb });
      return c;
    };
    c.subscribe = function(cb){ setTimeout(function(){ cb && cb('SUBSCRIBED'); }, 300); return c; };
    c.track = function(meta){ if (sessao) { estado[sessao.user.id] = [Object.assign({}, meta)]; c.sync(); } return Promise.resolve('ok'); };
    c.untrack = function(){ if (sessao) delete estado[sessao.user.id]; c.sync(); return Promise.resolve('ok'); };
    c.presenceState = function(){ return JSON.parse(JSON.stringify(estado)); };
    c.unsubscribe = function(){ return Promise.resolve('ok'); };
    c.sync = function(){ setTimeout(function(){ c.pres.forEach(function(o){ if (o.f.event === 'sync') o.cb(); }); }, 30); };
    c._estado = estado;
    canais.push(c);
    return c;
  }
  window.__mockTempoReal = function(evento, tabela, linha){ return dispararTabela(evento, tabela, linha); };
  // colegas vendo a mesma conversa (Presence): __mockPresenca(conversaId, [{id, nome, cor}])
  window.__mockPresenca = function(conversaId, gente){
    var n = 0;
    canais.forEach(function(c){
      if (c.nome !== 'conversa:' + conversaId) return;
      Object.keys(c._estado).forEach(function(k){ if (!sessao || k !== sessao.user.id) delete c._estado[k]; });
      (gente || []).forEach(function(g){ c._estado[g.id] = [{ id: g.id, nome: g.nome, cor: g.cor || '#a855f7', desde: new Date().toISOString(), digitando: !!g.digitando }]; });
      c.sync(); n++;
    });
    return n;
  };
  window.__mockCanais = function(){ return canais.map(function(c){ return c.nome; }); };
  var CAMILA = ${JSON.stringify(CONV.camila)};
  window.supabase = { createClient: function(){ return {
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: sessao } }); },
      getUser: function(){ return Promise.resolve({ data: { user: sessao && sessao.user }, error: null }); },
      refreshSession: function(){ return Promise.resolve({ data: { session: sessao }, error: sessao ? null : { message: 'sem sessão' } }); },
      signInWithPassword: function(c){
        if (navigator.onLine === false) return Promise.reject(new TypeError('Failed to fetch'));
        return pedir({ tabela: '_login', acao: 'login', corpo: { email: c.email, senha: c.password } }).then(function(r){
          if (r.error) return { data: {}, error: r.error };
          sessao = { access_token: 'mock-' + r.data.id, user: { id: r.data.id, email: r.data.email } };
          fatores = r.data.mfa_ativo ? [{ id: 'fator-1', factor_type: 'totp', status: 'verified', friendly_name: 'Celular' }] : [];
          aal = 'aal1';
          avisarAuth('SIGNED_IN');
          return { data: { user: sessao.user, session: sessao }, error: null };
        });
      },
      signOut: function(o){ window.__ultimoSignOut = (o && o.scope) || 'local'; try { sessionStorage.setItem('__mock_signout', window.__ultimoSignOut); } catch(e){} sessao = null; setTimeout(function(){ avisarAuth('SIGNED_OUT'); }, 10); return Promise.resolve({ error: null }); },
      resetPasswordForEmail: function(email, o){ window.__ultimoReset = { email: email, redirectTo: o && o.redirectTo }; return Promise.resolve({ data: {}, error: null }); },
      updateUser: function(u){ window.__ultimoUpdateUser = Object.keys(u || {}); return Promise.resolve({ data: { user: sessao && sessao.user }, error: null }); },
      onAuthStateChange: function(cb){
        ouvintesAuth.push(cb);
        if (CFG.recuperar) setTimeout(function(){ cb('PASSWORD_RECOVERY', sessao); }, 50);
        return { data: { subscription: { unsubscribe: function(){} } } };
      },
      mfa: {
        listFactors: function(){ return Promise.resolve({ data: { all: fatores, totp: fatores.filter(function(f){ return f.status === 'verified'; }) }, error: null }); },
        getAuthenticatorAssuranceLevel: function(){
          var temVerificado = fatores.some(function(f){ return f.status === 'verified'; });
          return Promise.resolve({ data: { currentLevel: aal, nextLevel: temVerificado ? 'aal2' : 'aal1' }, error: null });
        },
        enroll: function(){
          var f = { id: 'fator-novo', factor_type: 'totp', status: 'unverified', friendly_name: 'Celular' };
          fatores = fatores.filter(function(x){ return x.status === 'verified'; }).concat([f]);
          var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/>' +
            Array.from({length: 120}, function(_, i){ return '<rect x="' + ((i * 7) % 27 + 1) + '" y="' + ((i * 11) % 27 + 1) + '" width="1" height="1"/>'; }).join('') + '</svg>';
          return Promise.resolve({ data: { id: f.id, type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,' + encodeURIComponent(svg), secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/IndyCar' } }, error: null });
        },
        challenge: function(){ return Promise.resolve({ data: { id: 'desafio-1' }, error: null }); },
        verify: function(o){
          if (String(o.code) !== '123456') return Promise.resolve({ data: null, error: { message: 'Invalid TOTP code entered', code: 'mfa_verification_failed' } });
          fatores.forEach(function(f){ if (f.id === o.factorId) f.status = 'verified'; });
          aal = 'aal2';
          if (sessao && !/\.aal2$/.test(sessao.access_token)) sessao.access_token += '.aal2';
          return Promise.resolve({ data: {}, error: null });
        },
        challengeAndVerify: function(o){ return this.verify(o); },
        unenroll: function(o){ fatores = fatores.filter(function(f){ return f.id !== o.factorId; }); aal = 'aal1'; return Promise.resolve({ data: {}, error: null }); }
      }
    },
    from: builder,
    channel: function(nome){
      var c = novoCanal(nome);
      // a conversa da Camila já tem uma colega olhando (para ver o indicador sem console)
      if (nome === 'conversa:' + CAMILA && CFG.perfil && CFG.perfil.nome !== 'Maria Souza') {
        c._estado['33333333-3333-4333-8333-333333333333'] = [{ id: '33333333-3333-4333-8333-333333333333', nome: 'Maria Souza', cor: '#a855f7', desde: new Date().toISOString() }];
      }
      return c;
    },
    removeChannel: function(c){ var i = canais.indexOf(c); if (i >= 0) canais.splice(i, 1); return Promise.resolve('ok'); },
    storage: { from: function(){ return { createSignedUrl: function(){ return Promise.resolve({ data: { signedUrl: '' } }); }, upload: function(){ return Promise.resolve({ error: null }); } }; } }
  }; } };
})();
</script>`;

// ---------------------------------------------------------------- motor de consulta
function pegar(linha, col) { return linha?.[col]; }
function aplicarFiltro(l, [f, a, b]) {
  const v = pegar(l, a);
  switch (f) {
    case 'eq': return v === b || String(v) === String(b);
    case 'neq': return v !== b;
    case 'gt': return v > b; case 'gte': return v >= b; case 'lt': return v < b; case 'lte': return v <= b;
    case 'is': return b === null ? (v === null || v === undefined) : v === b;
    case 'in': return (Array.isArray(b) ? b : String(b || '').replace(/^\(|\)$/g, '').split(',')).map(String).includes(String(v));
    case 'like': case 'ilike': return new RegExp('^' + String(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i').test(String(v ?? ''));
    case 'not': { const [, , op, val] = [f, a, b]; if (op === 'is' && val === null) return !(v === null || v === undefined); return !aplicarFiltro(l, [op, a, val]); }
    case 'or': return String(a).split(',').some(parte => {
      const m = /^([a-z_0-9]+)\.(eq|in|is|gt|gte|lt|lte|like|ilike)\.(.*)$/.exec(parte.trim());
      if (!m) return false;
      if (m[2] === 'in') return m[3].replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/"/g, '')).includes(String(pegar(l, m[1])));
      const val = m[3] === 'null' ? null : m[3] === 'true' ? true : m[3] === 'false' ? false : /^\d+$/.test(m[3]) && /^(gt|gte|lt|lte)$/.test(m[2]) ? Number(m[3]) : m[3];
      return aplicarFiltro(l, [m[2], m[1], val]);
    });
    default: return true;
  }
}
/* RLS de mentira — as mesmas regras do banco real (migração rodada3_base):
   - desativado e papel 'agenda' não enxergam as tabelas do atendimento;
   - só gestor/admin APAGA cliente, conversa, lead, agendamento e mensagem
     (o banco real devolve 0 linhas, sem erro — a tela precisa conferir);
   - perfis: cada um lê a si mesmo, admin lê todos; notificações: só as minhas. */
const TABELAS_EQUIPE = ['agendamentos', 'clientes', 'conversas', 'leads', 'whatsapp_mensagens', 'tarefas', 'v_cliente_360'];
const APAGA_SO_GESTOR = ['agendamentos', 'clientes', 'conversas', 'leads', 'whatsapp_mensagens'];
const ehEquipe = (q) => !!q && q.ativo && ['admin', 'gestor', 'atendente'].includes(q.papel);
const ehGestor = (q) => !!q && q.ativo && ['admin', 'gestor'].includes(q.papel);

function consultar(op, quem) {
  if (op.acao === 'login') {
    const email = String(op.corpo?.email || '').trim().toLowerCase();
    const alvo = DB.perfis.find(x => x.email === email);
    if (!alvo || op.corpo?.senha === 'errada' || !op.corpo?.senha) return { data: null, error: { message: 'Invalid login credentials', status: 400 } };
    return { data: { id: alvo.id, email: alvo.email, mfa_ativo: !!alvo.mfa_ativo }, error: null };
  }
  const tabela = DB[op.tabela];
  if (!tabela) return { data: op.acao === 'select' ? [] : null, error: null, count: 0 };
  const vazio = () => op.count ? { data: op.head ? null : [], error: null, count: 0 } : { data: op.um ? null : [], error: null };
  if (!quem) return vazio();
  if (TABELAS_EQUIPE.includes(op.tabela) && !ehEquipe(quem)) return vazio();
  if (op.tabela === 'auditoria' && !(quem.ativo && quem.papel === 'admin')) return vazio();
  if (op.acao === 'delete' && APAGA_SO_GESTOR.includes(op.tabela) && !ehGestor(quem)) return { data: [], error: null };

  if (op.acao === 'insert') {
    const linhas = (Array.isArray(op.corpo) ? op.corpo : [op.corpo]).map(c => ({
      id: c.id || (op.tabela === 'tarefas' ? `a0000000-0000-4000-8000-${String(Date.now()).slice(-12)}` : `n${Date.now()}${Math.random().toString(16).slice(2, 6)}`),
      created_at: new Date().toISOString(), ...c }));
    if (op.tabela === 'tarefas') linhas.forEach(t => {
      t.criado_por = quem.id; t.status = t.status || 'aberta'; t.prioridade = t.prioridade || 2;
      // o gatilho do banco avisa quem recebeu a tarefa
      if (t.responsavel_id && t.responsavel_id !== quem.id) notificar(t.responsavel_id, 'tarefa', 'Tarefa nova para você',
        `${quem.nome.split(' ')[0]} passou "${t.titulo}".`, t.conversa_id ? `/?conversa=${t.conversa_id}` : null, 'atendimento');
    });
    tabela.push(...linhas);
    if (op.tabela === 'whatsapp_mensagens') {
      const conv = DB.conversas.find(c => c.id === linhas[0].conversa_id);
      if (conv) { conv.ultima_previa = linhas[0].corpo; conv.ultima_mensagem_em = linhas[0].created_at; }
    }
    return { data: op.um ? linhas[0] : linhas, error: null };
  }
  if (op.acao === 'upsert') {
    const c = op.corpo; const i = tabela.findIndex(l => String(l.id) === String(c.id));
    if (i >= 0) Object.assign(tabela[i], c); else tabela.push({ ...c });
    return { data: op.um ? c : [c], error: null };
  }
  // o builder guarda [f,a,b,c]; o filtro 'not' chega como ['not', coluna, 'is', null]
  let linhas = tabela.filter(l => op.filtros.every(([f, a, b, c]) => f === 'not' ? !aplicarFiltro(l, [b, a, c]) : aplicarFiltro(l, [f, a, b])));
  if (op.tabela === 'perfis' && quem.papel !== 'admin') linhas = linhas.filter(l => l.id === quem.id);
  if (op.tabela === 'notificacoes') linhas = linhas.filter(l => l.perfil_id === quem.id);
  if (op.acao === 'update') {
    if (op.tabela === 'perfis') {
      // gatilho proteger_campos_do_perfil: ninguém muda o próprio papel/apps/ativo
      const proibidos = ['papel', 'apps', 'ativo', 'equipe_id'].filter(k => k in op.corpo);
      if (proibidos.length && quem.papel !== 'admin') return { data: null, error: { message: 'Você não pode alterar ' + proibidos.join(', ') } };
    }
    if (op.tabela === 'tarefas' && op.corpo.status === 'feita') op.corpo = { concluida_em: new Date().toISOString(), concluida_por: quem.id, ...op.corpo };
    linhas.forEach(l => Object.assign(l, op.corpo));
    // v_cliente_360 é uma VIEW no banco real: o que muda em clientes aparece nela
    if (op.tabela === 'clientes') linhas.forEach(l => { const v = DB.v_cliente_360.find(x => x.id === l.id); if (v) ['nome', 'carro_modelo', 'placa', 'email', 'observacoes'].forEach(k => { if (k in op.corpo) v[k] = op.corpo[k]; }); });
    return { data: op.um ? (linhas[0] ?? null) : linhas, error: null };
  }
  if (op.acao === 'delete') {
    if (op.tabela === 'tarefas' && !ehGestor(quem)) linhas = linhas.filter(l => l.criado_por === quem.id);
    linhas.forEach(l => tabela.splice(tabela.indexOf(l), 1));
    return { data: linhas, error: null };
  }
  for (const [col, o] of op.ordem.slice().reverse()) {
    const asc = o.ascending !== false;
    linhas.sort((x, y) => {
      const a = pegar(x, col), b = pegar(y, col);
      if (a == null && b == null) return 0; if (a == null) return o.nullsFirst ? -1 : 1; if (b == null) return o.nullsFirst ? 1 : -1;
      return (a < b ? -1 : a > b ? 1 : 0) * (asc ? 1 : -1);
    });
  }
  const total = linhas.length;
  if (op.range) linhas = linhas.slice(op.range[0], op.range[1] + 1);
  if (op.limite) linhas = linhas.slice(0, op.limite);
  if (op.count) return { data: op.head ? null : linhas, error: null, count: total };
  if (op.um) return { data: linhas[0] ?? null, error: op.um === 'single' && !linhas[0] ? { message: 'nenhuma linha' } : null };
  return { data: linhas, error: null };
}

// ---------------------------------------------------------------- servidor
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-IndyCar-App': 'atendimento' }); res.end(JSON.stringify(obj)); };
/* Rodada 4 — Render dormindo de mentira: ?dormir=20 faz TODA rota /api/ (menos o
   dublê do banco, que é o "Supabase" e não dorme) responder 503 em HTML, SEM o
   cabeçalho do app, por 20 s a partir do carregamento da página — igual ao
   "hibernate-wake-error" do Render. POST /api/_dormir {segundos} faz o mesmo. */
let DORMINDO_ATE = 0;
const dormindo = () => Date.now() < DORMINDO_ATE;
const ENVIOS_FEITOS = [];   // mensagemId de cada /api/enviar que "saiu" (o teste confere que não duplica)
let SAUDE_OK = false, SEM_ROTAS = false;
const ehUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
/* Token do login de mentira: "mock-<id>" (nível 1) ou "mock-<id>.aal2" (depois do código das duas etapas). */
const tokenDe = (req) => {
  const t = /^Bearer mock-([0-9a-f-]{36})(\.aal2)?$/i.exec(req.headers.authorization || '');
  return { perfil: t ? perfilPorId(t[1]) : null, aal2: !!(t && t[2]) };
};
const quemDoToken = (req) => tokenDe(req).perfil;
const erro = (res, status, codigo, msg, extra = {}) => json(res, status, { ok: false, erro: msg, ...(codigo ? { codigo } : {}), ...extra });
const podeAtendimento = (q) => q.papel === 'admin' || (['gestor', 'atendente'].includes(q.papel) && (q.apps || []).includes('atendimento'));
const atende = (q) => !!(q && q.ativo && podeAtendimento(q));
const NOME_PAPEL = { admin: 'Administrador', gestor: 'Gestor', atendente: 'Atendente', agenda: 'Agenda' };
const NOMES_APPS = { atendimento: 'Atendimento', crm: 'CRM', agenda: 'Agenda', comunicar: 'Comunicar', orcador: 'Orçador', ads: 'Tráfego pago' };
const LINKS_APPS = { atendimento: 'https://indycar-atendimento.onrender.com', crm: 'https://indycar-crm.onrender.com', agenda: 'https://indycar-agendamentos.onrender.com',
  comunicar: 'https://indycar-posvenda.onrender.com', orcador: 'https://indycar-orcador.netlify.app', ads: null };
const appsLiberados = (q) => (q.papel === 'admin' ? TODOS_APPS : (q.apps || [])).filter(a => a !== 'atendimento').map(a => ({ app: a, nome: NOMES_APPS[a], link: LINKS_APPS[a] }));
const dadosDoEu = (u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, apps: u.papel === 'admin' ? TODOS_APPS.slice() : (u.apps || []),
  cargo: u.cargo || null, telefone: u.telefone || null, avatar_cor: u.avatar_cor || null, equipe_id: u.equipe_id || null, recebe_leads: u.recebe_leads !== false,
  precisa_trocar_senha: !!u.precisa_trocar_senha, mfa: { ativo: !!u.mfa_ativo, nivel: 'aal1' }, preferencias: u.preferencias || {}, ultimo_acesso_em: u.ultimo_acesso_em || null,
  ativo: u.ativo, pode: { gerenciar_equipe: u.papel === 'admin', ver_equipe: ['admin', 'gestor'].includes(u.papel), ver_auditoria: u.papel === 'admin', apagar: ['admin', 'gestor'].includes(u.papel) } });
/** Rodízio de mentira: quem atende, recebe clientes e tem menos conversas abertas. */
function escolherRodizio() {
  const c = DB.perfis.filter(x => atende(x) && x.recebe_leads)
    .map(x => ({ x, n: DB.conversas.filter(cv => cv.atribuida_a === x.id && cv.status !== 'resolvida').length }))
    .sort((a, b) => a.n - b.n)[0];
  return c ? c.x : null;
}

const senhaTemporaria = () => {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, (_, i) => (i === 4 || i === 8) ? '-' : s[Math.floor(Math.random() * s.length)]).join('');
};
const PAPEIS_VALIDOS = ['admin', 'gestor', 'atendente', 'agenda'];
/* GET /api/equipe — o formato combinado com o servidor (contrato da rodada 3) */
function pessoaDaEquipe(x, quem = null) {
  const nunca = !x.ultimo_acesso_em;
  const abertas = DB.tarefas.filter(t => t.responsavel_id === x.id && t.status === 'aberta');
  return { id: x.id, nome: x.nome, email: x.email, papel: x.papel, papel_nome: NOME_PAPEL[x.papel], apps: x.papel === 'admin' ? TODOS_APPS.slice() : (x.apps || []),
    cargo: x.cargo || null, telefone: x.telefone || null, equipe_id: x.equipe_id || null, recebe_leads: !!x.recebe_leads, ativo: !!x.ativo,
    ultimo_acesso_em: x.ultimo_acesso_em || null, ultimo_login_em: x.ultimo_acesso_em || null, ultimo_app: x.ultimo_app || null,
    mfa_ativo: !!x.mfa_ativo, mfa: { ativo: !!x.mfa_ativo, fatores: x.mfa_ativo ? 1 : 0 }, precisa_trocar_senha: !!x.precisa_trocar_senha, avatar_cor: x.avatar_cor || null,
    situacao: !x.ativo ? 'desativado' : nunca ? 'convite_pendente' : x.precisa_trocar_senha ? 'precisa_trocar_senha' : 'ativo',
    eu: quem ? x.id === quem.id : false, banido: !x.ativo, desativado_em: x.desativado_em || null,
    convidado_por_nome: x.convidado_por ? (perfilPorId(x.convidado_por)?.nome || null) : null,
    carga: { conversas_abertas: DB.conversas.filter(c => c.atribuida_a === x.id && c.status !== 'resolvida').length,
             tarefas_abertas: abertas.length, tarefas_atrasadas: abertas.filter(t => t.vence_em && new Date(t.vence_em).getTime() < Date.now()).length } };
}
const adminsAtivos = () => DB.perfis.filter(x => x.papel === 'admin' && x.ativo).length;
const csvCelula = (v) => { const t = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
function filtrarAuditoria(sp) {
  const pessoa = sp.get('pessoa'), tabela = sp.get('tabela'), acao = sp.get('acao'), de = sp.get('de'), ate = sp.get('ate');
  return AUDITORIA.filter(a => (!pessoa || a.perfil_id === pessoa) && (!tabela || a.tabela === tabela) && (!acao || a.acao === acao)
    && (!de || a.created_at.slice(0, 10) >= de) && (!ate || a.created_at.slice(0, 10) <= ate));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // fora do prefixo? 404 (na Central, outro app responderia)
  if (PREFIXO !== '/' && !url.pathname.startsWith(PREFIXO) && url.pathname + '/' !== PREFIXO) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('fora do prefixo ' + PREFIXO); }
  const p = PREFIXO === '/' ? url.pathname : ('/' + url.pathname.slice(PREFIXO.length)).replace(/^\/{2,}/, '/') || '/';
  const m = req.method;
  if (!p.startsWith('/api/')) {
    if (p === '/' || p === '/index.html') {
      const papel = url.searchParams.get('papel') || 'admin';
      const eu = papel === 'deslogado' ? null : perfilPorId(PAPEL_PERFIL[papel] || U.admin);
      SAUDE_OK = url.searchParams.get('saude') === 'ok';
      /* Tour de boas-vindas (rodada 4): no mock, todo mundo já "viu" — senão ele
         cobriria a tela nos roteiros antigos. ?tour=1 faz a pessoa nunca ter visto. */
      const tourNovo = url.searchParams.get('tour') === '1';
      for (const x of DB.perfis) {
        x.preferencias = { ...(x.preferencias || {}) };
        if (tourNovo) delete x.preferencias.tour_visto;
        else x.preferencias.tour_visto = `v1-${['admin', 'gestor'].includes(x.papel) ? x.papel : 'atendente'}`;
      }
      if (url.searchParams.get('dormir')) DORMINDO_ATE = Date.now() + Number(url.searchParams.get('dormir')) * 1000;
      SEM_ROTAS = url.searchParams.get('sem_rotas') === '1';
      if (url.searchParams.get('envio') === 'ok') ultimoEnvio401 = false;
      const cfg = { perfil: eu && { id: eu.id, email: eu.email, nome: eu.nome, mfa_ativo: !!eu.mfa_ativo }, recuperar: url.searchParams.get('recuperar') === '1' };
      let html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
        .replace(/<script src="\/?vendor\/supabase\.js"><\/script>/, () => DUBLE_SUPABASE.replace('__CFG__', JSON.stringify(cfg)))
        .replace(/<head([^>]*)>/i, (x) => `${x}\n  <base href="${PREFIXO}" />`)   // como o server.js faz
        .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, '');   // sem fonte externa no teste
      /* As duas tags do copiloto são do outro agente; se ainda não estiverem no
         index.html, o mock põe — assim dá para testar o contrato desde já. */
      if (!/copiloto\.css/.test(html)) html = html.replace('</head>', '  <link rel="stylesheet" href="copiloto.css" />\n</head>');
      if (!/copiloto\.js/.test(html)) html = html.replace('<script src="app.js"></script>', '<script src="app.js"></script>\n<script src="copiloto.js" defer></script>');
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }); return res.end(html);
    }
    if (p === '/sw.js') { res.writeHead(200, { 'Content-Type': MIME['.js'] }); return res.end('/* sem service worker no modo de teste */'); }
    // copiloto: o real (public/), o de teste (MOCK_COPILOTO) ou vazio — nunca 404
    if (p === '/copiloto.js' || p === '/copiloto.css') {
      const real = path.join(PUBLIC, p.slice(1));
      const teste = p === '/copiloto.js' ? process.env.MOCK_COPILOTO : process.env.MOCK_COPILOTO_CSS;
      const arq = fs.existsSync(real) ? real : (teste && fs.existsSync(teste) ? teste : null);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)], 'Cache-Control': 'no-store' });
      return res.end(arq ? fs.readFileSync(arq) : `/* ${p.slice(1)} ainda não existe — slot fica vazio */`);
    }
    const arq = path.join(PUBLIC, path.normalize(p));
    if (!arq.startsWith(PUBLIC) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    return fs.createReadStream(arq).pipe(res);
  }

  let body = {};
  if (m !== 'GET') { let b = ''; for await (const c of req) b += c; try { body = JSON.parse(b || '{}'); } catch {} }
  if (p === '/api/_mock') return json(res, 200, consultar(body, quemDoToken(req)));
  if (p === '/api/_dormir') { DORMINDO_ATE = Date.now() + Number(body.segundos || 0) * 1000; return json(res, 200, { ok: true }); }
  if (p === '/api/_envios') return json(res, 200, { envios: ENVIOS_FEITOS });
  if (p === '/api/_ia_reset') { for (const k of [...ACOES.keys()]) if (!IA_HOJE.some(a => a.id === k)) ACOES.delete(k); for (const a of IA_HOJE) if (ACOES.has(a.id)) ACOES.get(a.id).status = a.status; ACOES.get('ia-h7').status = 'proposta'; IA_FILA.forEach(f => { f.status = 'processando'; }); return json(res, 200, { ok: true }); }
  if (dormindo()) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'x-render-routing': 'hibernate-wake-error' });
    return res.end('<html><body><h1>Service Unavailable</h1></body></html>');
  }
  await new Promise(r => setTimeout(r, 180));            // latência de verdade, para ver esqueletos
  let mm;

  if (p === '/api/config') return json(res, 200, { configurado: true, supabaseUrl: 'http://mock.local', supabaseAnonKey: 'mock', iaConfigurada: true, modeloIA: 'claude-opus-5' });
  if (p === '/api/primeiro-acesso') return json(res, 200, { aberto: false });

  /* ---------- daqui para baixo: login obrigatório, igual ao porteiro do server.js (lib/acesso.js) ---------- */
  const tok = tokenDe(req);
  const quem = tok.perfil;
  if (!quem) return erro(res, 401, 'sessao_invalida', 'Faça login.');
  if (!quem.ativo) return erro(res, 401, 'desativado', 'Seu acesso foi desativado. Fale com o administrador.');
  if (!podeAtendimento(quem)) return erro(res, 403, 'sem_acesso_app', 'Você não tem acesso ao Atendimento.', { apps: appsLiberados(quem) });
  // verificação em duas etapas ligada e token ainda no nível 1: só /api/eu responde
  if (quem.mfa_ativo && !tok.aal2 && !(p === '/api/eu' && m === 'GET')) return erro(res, 401, 'mfa_pendente', 'Falta confirmar o código da verificação em duas etapas.');
  const admin = quem.papel === 'admin';
  const gestor = admin || quem.papel === 'gestor';
  if (p === '/api/teste/limite') return erro(res, 429, 'muitas_tentativas', 'Muitas requisições deste endereço. Espere um minuto.');
  const NOVAS = /^\/api\/(eu(\/senha-trocada)?|equipe(\/[^/]+(\/(senha-temporaria|senha|desativar|reativar|mfa\/remover))?)?|auditoria(\.csv|\/exportar)?|tarefas(\/equipe)?|conversas\/sem-dono|conversas\/[^/]+\/(transferir|distribuir))$/;
  if (SEM_ROTAS && NOVAS.test(p) && p !== '/api/equipe/nomes') return erro(res, 404, undefined, 'rota não encontrada');

  /* ---------- Eu ---------- */
  if (p === '/api/eu' && m === 'GET') return json(res, 200, { ok: true, ...dadosDoEu(quem), mfa_pendente: !!(quem.mfa_ativo && !tok.aal2) });
  if (p === '/api/eu' && m === 'PATCH') {
    const muda = {};
    if (body.nome !== undefined) { const v = String(body.nome || '').trim().slice(0, 80); if (v.length < 2) return erro(res, 400, 'invalido', 'Nome curto demais.'); muda.nome = v; }
    if (body.cargo !== undefined) muda.cargo = String(body.cargo || '').trim().slice(0, 60) || null;
    if (body.telefone !== undefined) {
      const t = String(body.telefone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
      if (t && !/^\d{10,11}$/.test(t)) return erro(res, 400, 'invalido', 'Telefone inválido (DDD + número).');
      muda.telefone = t || null;
    }
    if (body.avatar_cor !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(String(body.avatar_cor))) return erro(res, 400, 'invalido', 'Cor inválida (use #RRGGBB).'); muda.avatar_cor = String(body.avatar_cor).toLowerCase(); }
    if (body.preferencias?.tour_visto !== undefined && body.preferencias.notificacoes === undefined) {
      if (body.preferencias.tour_visto !== null && !/^v[0-9]{1,2}-(atendente|gestor|admin)$/.test(String(body.preferencias.tour_visto))) return erro(res, 400, 'invalido', 'tour_visto inválido.');
      muda.preferencias = { ...(quem.preferencias || {}), tour_visto: body.preferencias.tour_visto };
    } else if (body.preferencias !== undefined) {
      const n = body.preferencias?.notificacoes;
      if (!n || typeof n !== 'object') return erro(res, 400, 'invalido', 'notificacoes precisa ser um objeto.');
      const out = {};
      for (const k of ['espera', 'resumo_dia', 'tarefa', 'conversa', 'lead', 'aguardando', 'som', 'navegador']) if (n[k] !== undefined) out[k] = n[k] === true;
      muda.preferencias = { ...(quem.preferencias || {}), notificacoes: out };
    }
    if (!Object.keys(muda).length) return erro(res, 400, 'nada', 'Nada para mudar.');
    Object.assign(quem, muda);
    return json(res, 200, { ok: true, ...dadosDoEu(quem) });
  }
  if (p === '/api/eu/senha-trocada' && m === 'POST') {
    if (quem.precisa_trocar_senha) { quem.precisa_trocar_senha = false; auditar(quem.id, 'perfil.senha_trocada', 'perfis', quem.id); }
    return json(res, 200, { ok: true, precisa_trocar_senha: false });
  }

  /* ---------- Nomes (toda a equipe): o mínimo, sem e-mail nem telefone nem equipe ---------- */
  if (p === '/api/equipe/nomes') return json(res, 200, { ok: true, equipe: DB.perfis.map(x => ({ id: x.id, nome: x.nome, papel: x.papel,
    ativo: x.ativo, recebe_leads: !!x.recebe_leads, avatar_cor: x.avatar_cor || null, cargo: x.cargo || null, atende: atende(x) })) });

  /* ---------- Equipe ---------- */
  if (p === '/api/equipe' && m === 'GET') {
    if (!gestor) return erro(res, 403, 'so_gestor', 'Só gestor ou administrador vê a equipe completa.');
    const pessoas = DB.perfis.map(x => pessoaDaEquipe(x, quem));
    return json(res, 200, { ok: true, pessoas, equipe: pessoas, equipes: DB.equipes, papeis: PAPEIS_VALIDOS.map(x => ({ papel: x, nome: NOME_PAPEL[x] })),
      apps: TODOS_APPS, podeEditar: admin, avisos: [] });
  }
  if (p === '/api/equipe' && m === 'POST') {
    if (!admin) return erro(res, 403, 'so_admin', 'Só o administrador convida pessoas.');
    const email = String(body.email || '').trim().toLowerCase(), nome = String(body.nome || '').trim();
    if (nome.length < 2) return erro(res, 400, 'invalido', 'Informe o nome da pessoa.', { campo: 'nome' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro(res, 400, 'invalido', 'Esse e-mail não parece válido.', { campo: 'email' });
    if (DB.perfis.some(x => x.email === email)) return erro(res, 409, 'email_existe', 'Esse e-mail já tem conta.', { campo: 'email' });
    if (!PAPEIS_VALIDOS.includes(body.papel)) return erro(res, 400, 'invalido', 'Papel inválido. Use admin, gestor, atendente ou agenda.', { campo: 'papel' });
    const apps = body.papel === 'agenda' ? ['agenda'] : (Array.isArray(body.apps) ? body.apps.filter(a => TODOS_APPS.includes(a)) : []);
    if (!apps.length) return erro(res, 400, 'invalido', 'Escolha pelo menos um app.', { campo: 'apps' });
    const novo = { id: `99999999-9999-4999-8999-${String(Date.now()).slice(-12)}`, nome, email, papel: body.papel, ativo: true, apps,
      equipe_id: ehUuid(body.equipe_id) ? body.equipe_id : null, cargo: body.cargo || null, telefone: body.telefone || null,
      avatar_cor: null, recebe_leads: false, ultimo_acesso_em: null, ultimo_app: null, mfa_ativo: false, precisa_trocar_senha: true,
      created_at: new Date().toISOString(), convidado_por: quem.id, preferencias: {}, nunca_entrou: true };
    DB.perfis.push(novo);
    auditar(quem.id, 'equipe.convidar', 'perfis', novo.id, { detalhes: { email, papel: novo.papel, apps, equipe_id: novo.equipe_id, cargo: novo.cargo } });
    const pessoa = pessoaDaEquipe(novo, quem);
    return json(res, 201, { ok: true, pessoa, perfil: pessoa, senha_temporaria: senhaTemporaria(),
      aviso: 'Passe esta senha para a pessoa agora: ela não aparece de novo. No primeiro acesso o sistema pede uma senha nova.' });
  }
  if ((mm = /^\/api\/equipe\/([^/]+)\/(senha-temporaria|senha|desativar|reativar|mfa\/remover)$/.exec(p)) && m === 'POST') {
    if (!admin) return erro(res, 403, 'so_admin', 'Só o administrador mexe no acesso da equipe.');
    const alvo = ehUuid(mm[1]) && perfilPorId(mm[1]);
    if (!alvo) return erro(res, 404, 'nao_encontrado', 'Não achei essa pessoa.');
    const acao = mm[2] === 'senha-temporaria' ? 'senha' : mm[2];
    if (acao === 'senha') {
      if (!alvo.ativo) return erro(res, 409, 'desativado', 'Essa pessoa está desativada. Reative antes de gerar senha.');
      alvo.precisa_trocar_senha = true;
      auditar(quem.id, 'equipe.redefinir_senha', 'perfis', alvo.id, { detalhes: { troca_obrigatoria: true } });
      return json(res, 200, { ok: true, senha_temporaria: senhaTemporaria(), aviso: 'Passe esta senha para a pessoa agora: ela não aparece de novo.' });
    }
    if (acao === 'desativar') {
      if (alvo.id === quem.id) return erro(res, 409, 'proprio_acesso', 'Você não pode desativar o próprio acesso.');
      if (alvo.papel === 'admin' && alvo.ativo && adminsAtivos() <= 1) return erro(res, 409, 'ultimo_admin', 'Este é o único administrador ativo. Promova outra pessoa antes de tirar o acesso desta.');
      if (!alvo.ativo) return json(res, 200, { ok: true, jaEstava: true, pessoa: pessoaDaEquipe(alvo, quem) });
      alvo.ativo = false; alvo.desativado_em = new Date().toISOString(); alvo.desativado_por = quem.id; alvo.recebe_leads = false;
      auditar(quem.id, 'equipe.desativar', 'perfis', alvo.id, { detalhes: { motivo: String(body.motivo || '').slice(0, 200) || null, sessoes: 'derrubadas' } });
      const r = { ok: true, sessoes: 'derrubadas', desativado_em: alvo.desativado_em, aviso: null };
      if (body.redistribuir === true) {
        const dele = DB.conversas.filter(c => c.atribuida_a === alvo.id && c.status !== 'resolvida');
        let movidas = 0;
        for (const c of dele) { const e = escolherRodizio(); c.atribuida_a = e?.id || null; if (e) movidas++; }
        r.redistribuidas = { ok: true, total: dele.length, movidas };
      }
      return json(res, 200, r);
    }
    if (acao === 'reativar') {
      if (alvo.ativo) return json(res, 200, { ok: true, jaEstava: true });
      alvo.ativo = true; alvo.desativado_em = null;
      auditar(quem.id, 'equipe.reativar', 'perfis', alvo.id, { detalhes: {} });
      return json(res, 200, { ok: true });
    }
    // mfa/remover
    const removidos = alvo.mfa_ativo ? 1 : 0;
    alvo.mfa_ativo = false;
    auditar(quem.id, 'equipe.remover_mfa', 'perfis', alvo.id, { detalhes: { fatores_removidos: removidos } });
    return json(res, 200, { ok: true, removidos });
  }
  if ((mm = /^\/api\/equipe\/([^/]+)$/.exec(p)) && m === 'PATCH') {
    if (!admin) return erro(res, 403, 'so_admin', 'Só o administrador muda a equipe.');
    const alvo = ehUuid(mm[1]) && perfilPorId(mm[1]);
    if (!alvo) return erro(res, 404, 'nao_encontrado', 'Não achei essa pessoa.');
    if ('papel' in body && !PAPEIS_VALIDOS.includes(body.papel)) return erro(res, 400, 'invalido', 'Papel inválido. Use admin, gestor, atendente ou agenda.', { campo: 'papel' });
    if (alvo.id === quem.id && 'papel' in body && body.papel !== alvo.papel) return erro(res, 409, 'proprio_papel', 'Você não pode mudar o seu próprio papel. Peça a outro administrador.');
    if (alvo.papel === 'admin' && body.papel && body.papel !== 'admin' && adminsAtivos() <= 1) return erro(res, 409, 'ultimo_admin', 'Este é o único administrador ativo. Promova outra pessoa antes de rebaixar esta.');
    if (body.recebe_leads === false && alvo.recebe_leads && DB.perfis.filter(x => x.ativo && x.recebe_leads).length <= 1)
      return erro(res, 409, 'ultimo_rodizio', 'É a única pessoa recebendo clientes. Coloque outra antes de tirar esta, senão o cliente novo chega sem responsável.');
    const antes = {}, depois = {};
    for (const k of ['nome', 'papel', 'apps', 'equipe_id', 'cargo', 'telefone', 'recebe_leads']) {
      if (!(k in body)) continue;
      let v = body[k];
      if (k === 'apps') { v = (Array.isArray(v) ? v : []).filter(a => TODOS_APPS.includes(a)); if (!v.length) return erro(res, 400, 'invalido', 'Escolha pelo menos um app.', { campo: 'apps' }); }
      if (k === 'equipe_id' && v !== null && !ehUuid(v)) return erro(res, 400, 'invalido', 'Equipe inválida.', { campo: 'equipe_id' });
      if (JSON.stringify(alvo[k]) === JSON.stringify(v)) continue;
      antes[k] = alvo[k]; depois[k] = v; alvo[k] = v;
    }
    if (alvo.papel === 'agenda') alvo.apps = ['agenda'];
    if (Object.keys(depois).length) auditar(quem.id, 'equipe.editar', 'perfis', alvo.id, { detalhes: { antes, depois } });
    const pessoa = pessoaDaEquipe(alvo, quem);
    return json(res, 200, { ok: true, pessoa, perfil: pessoa, mudou: Object.keys(depois) });
  }

  /* ---------- Auditoria (só admin) ---------- */
  if (p === '/api/auditoria' && m === 'GET') {
    if (!admin) return erro(res, 403, 'so_admin', 'Só o administrador vê a auditoria.');
    const lista = filtrarAuditoria(url.searchParams);
    const pagina = Math.max(1, Number(url.searchParams.get('pagina')) || 1), POR = 20;
    return json(res, 200, { ok: true, itens: lista.slice((pagina - 1) * POR, pagina * POR).map(a => ({ ...a, pessoa: a.perfil_nome || 'sistema' })),
      total: lista.length, pagina, por_pagina: POR, paginas: Math.max(1, Math.ceil(lista.length / POR)) });
  }
  if ((p === '/api/auditoria.csv' || p === '/api/auditoria/exportar') && m === 'GET') {
    if (!admin) return erro(res, 403, 'so_admin', 'Só o administrador exporta a auditoria.');
    const lista = filtrarAuditoria(url.searchParams);
    auditar(quem.id, 'auditoria.exportar', 'auditoria', null, { detalhes: { linhas: lista.length } });
    const cab = ['quando', 'pessoa', 'app', 'acao', 'tabela', 'registro', 'campos', 'detalhes'];
    const linhas = lista.map(a => [a.created_at, a.perfil_nome || 'sistema', a.app, a.acao, a.tabela, a.registro_id, (a.campos || []).join(' '), a.detalhes].map(csvCelula).join(';'));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="auditoria.csv"', 'Cache-Control': 'no-store', 'X-Linhas': String(lista.length) });
    return res.end('﻿' + [cab.join(';'), ...linhas].join('\n'));
  }

  /* ---------- Tarefas ---------- */
  if (p === '/api/tarefas/equipe' && m === 'GET') {
    if (!gestor) return erro(res, 403, 'so_gestor', 'A carga da equipe é do gestor ou do administrador.');
    const fimHoje = new Date(diaSP(0) + 'T23:59:59-03:00').getTime();
    const pessoas = DB.perfis.filter(x => x.ativo && x.papel !== 'agenda').map(x => {
      const minhas = DB.tarefas.filter(t => t.responsavel_id === x.id && t.status === 'aberta');
      const c = { id: x.id, nome: x.nome, papel: x.papel, cargo: x.cargo || null, avatar_cor: x.avatar_cor || null, recebe_leads: x.recebe_leads !== false,
        abertas: minhas.length,
        atrasadas: minhas.filter(t => t.vence_em && new Date(t.vence_em).getTime() < Date.now()).length,
        vencem_hoje: minhas.filter(t => t.vence_em && new Date(t.vence_em).getTime() >= Date.now() && new Date(t.vence_em).getTime() <= fimHoje).length,
        urgentes: minhas.filter(t => t.prioridade === 1).length, sem_prazo: minhas.filter(t => !t.vence_em).length,
        conversas_abertas: DB.conversas.filter(cv => cv.atribuida_a === x.id && cv.status !== 'resolvida').length,
        aguardando_consultor: DB.conversas.filter(cv => cv.atribuida_a === x.id && cv.aguardando_consultor).length };
      return { ...c, perfil_id: c.id, tarefas_abertas: c.abertas, tarefas_atrasadas: c.atrasadas, tarefas_hoje: c.vencem_hoje };
    });
    return json(res, 200, { ok: true, pessoas, equipe: pessoas, gerado_em: new Date().toISOString() });
  }
  if (p === '/api/tarefas' && m === 'POST') {
    const titulo = String(body.titulo || '').trim().slice(0, 200);
    if (!titulo) return erro(res, 400, 'invalido', 'Diga o que precisa ser feito (título).', { campo: 'titulo' });
    if (body.prioridade !== undefined && ![1, 2, 3].includes(Number(body.prioridade))) return erro(res, 400, 'invalido', 'Prioridade é 1 (alta), 2 (normal) ou 3 (baixa).', { campo: 'prioridade' });
    if (body.vence_em && new Date(body.vence_em).getTime() < Date.now() - 86_400_000) return erro(res, 400, 'invalido', 'O prazo já passou.', { campo: 'vence_em' });
    const resp = body.responsavel_id || quem.id;
    const dono = perfilPorId(resp);
    if (!dono || !dono.ativo) return erro(res, 409, 'responsavel_invalido', 'Essa pessoa não está ativa na equipe.');
    if (resp !== quem.id && !gestor) return erro(res, 403, 'so_gestor', 'Só o gestor cria tarefa para outra pessoa. Crie para você ou peça ao gestor.');
    const r = consultar({ tabela: 'tarefas', acao: 'insert', corpo: { titulo, descricao: body.descricao || null, responsavel_id: resp, prioridade: Number(body.prioridade) || 2,
      vence_em: body.vence_em || null, conversa_id: body.conversa_id || null, cliente_id: body.cliente_id || null, origem: 'atendimento' }, um: 'single', filtros: [], ordem: [] }, quem);
    auditar(quem.id, 'tarefa.criar', 'tarefas', r.data.id, { detalhes: { origem: 'atendimento', responsavel_id: resp, conversa_id: body.conversa_id || null } });
    return json(res, 201, { ok: true, tarefa: r.data });
  }

  /* ---------- Rodízio, sem dono e transferência ---------- */
  if (p === '/api/conversas/sem-dono' && m === 'GET') {
    if (!gestor) return erro(res, 403, 'so_gestor', 'Só gestor ou administrador.');
    const itens = DB.conversas.filter(c => !c.atribuida_a && c.status !== 'resolvida' && c.tipo === 'atendimento').map(c => ({ ...c, desde: c.ultima_mensagem_em }));
    return json(res, 200, { ok: true, itens, total: itens.length });
  }
  if ((mm = /^\/api\/conversas\/([^/]+)\/distribuir$/.exec(p)) && m === 'POST') {
    const conv = ehUuid(mm[1]) && DB.conversas.find(c => c.id === mm[1]);
    if (!conv) return erro(res, 404, 'nao_encontrado', 'Conversa não encontrada.');
    if (conv.atribuida_a) return erro(res, 409, 'ja_tem_dono', 'Esta conversa já tem responsável. Use "transferir".', { atribuida_a: conv.atribuida_a });
    const e = escolherRodizio();
    if (!e) return erro(res, 409, 'ninguem_no_rodizio', 'Ninguém está recebendo clientes agora. Coloque alguém no rodízio em Equipe.');
    conv.atribuida_a = e.id;
    notificar(e.id, 'conversa', 'Conversa nova para você (rodízio)', conv.nome || conv.telefone, `/?conversa=${conv.id}`);
    auditar(quem.id, 'conversa.distribuir', 'conversas', conv.id, { detalhes: { para: e.id, motivo: 'pedido na tela' } });
    return json(res, 200, { ok: true, para: { id: e.id, nome: e.nome }, criterio: 'menor carga' });
  }
  if ((mm = /^\/api\/conversas\/([^/]+)\/transferir$/.exec(p)) && m === 'POST') {
    const motivo = String(body.motivo || '').trim().slice(0, 200);
    if (motivo.length < 3) return erro(res, 400, 'motivo', 'Diga o motivo da transferência (pelo menos 3 letras).', { campo: 'motivo' });
    if (!ehUuid(body.para)) return erro(res, 400, 'para', 'Escolha para quem passar.', { campo: 'para' });
    const conv = ehUuid(mm[1]) && DB.conversas.find(c => c.id === mm[1]);
    if (!conv) return erro(res, 404, 'nao_encontrado', 'Conversa não encontrada.');
    if (!gestor && conv.atribuida_a && conv.atribuida_a !== quem.id) return erro(res, 403, 'nao_e_sua', 'Só quem está com a conversa (ou o gestor) pode passar para outra pessoa.');
    if (conv.atribuida_a === body.para) return erro(res, 409, 'mesmo_dono', 'A conversa já está com essa pessoa.');
    const para = perfilPorId(body.para);
    if (!para || !atende(para)) return erro(res, 409, 'destino_invalido', 'Essa pessoa não pode atender (desativada ou sem acesso ao Atendimento).');
    const de = conv.atribuida_a || null;
    conv.atribuida_a = para.id;
    notificar(para.id, 'conversa', 'Conversa passada para você', `${conv.nome || conv.telefone} — motivo: ${motivo}`, `/?conversa=${conv.id}`);
    auditar(quem.id, 'conversa.transferir', 'conversas', conv.id, { detalhes: { de, para: para.id, motivo, leads_movidos: 0 } });
    return json(res, 200, { ok: true, de, para: { id: para.id, nome: para.nome }, leads_movidos: 0 });
  }
  if (p === '/api/whatsapp/status') return json(res, 200, { conectado: true, inscrito: true, numero: '(12) 99683-0272' });
  if (p === '/api/saude') return json(res, 200, SAUDE_OK
    ? { ok: true, problema: null, desde: null, resumo: null, texto: '' }
    : { ok: false, problema: 'codewords-fora', desde: '2026-10-01T16:56:31.089+00:00', checadoEm: new Date().toISOString(),
        resumo: 'O CodeWords respondeu com erro 401.', texto: 'WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações' });
  if ((mm = /^\/api\/clientes\/([^/]+)\/ficha$/.exec(p))) {
    const cli = DB.clientes.find(c => c.id === mm[1]);
    if (!cli) return json(res, 404, { ok: false, erro: 'Cliente não encontrado.' });
    const r360 = DB.v_cliente_360.find(c => c.id === cli.id) || {};
    const ultimo = DB.agendamentos.filter(a => a.cliente_id === cli.id && a.status === 'concluido').sort((a, b) => b.inicio_em.localeCompare(a.inicio_em))[0] || null;
    const regra = ultimo && /[óo]leo/i.test(ultimo.servico) ? { rotulo: 'Troca de óleo do motor', meses: 6, padrao: false }
      : ultimo && /freio|pastilha/i.test(ultimo.servico) ? { rotulo: 'Freios', meses: 12, padrao: false } : { rotulo: 'Revisão geral', meses: 6, padrao: true };
    const prevista = ultimo ? new Date(new Date(ultimo.inicio_em).getTime() + regra.meses * 30.4 * 86400_000).toISOString() : null;
    const envios = cli.id === CLI.camila ? [
      { id: 'pe1', tipo: 'posvenda', status: 'enviado', enviar_em: d(187), enviado_em: d(187), respondido_em: d(187), resposta_tipo: 'positiva', rotulo: 'Pós-venda' },
      { id: 'pe2', tipo: 'aniversario', status: 'enviado', enviar_em: d(0.3), enviado_em: d(0.3), resposta_tipo: null, rotulo: 'Aniversário' },
      { id: 'pe3', tipo: 'retorno', status: 'pendente', enviar_em: new Date(agora + 5 * 86400_000).toISOString(), rotulo: 'Retorno de revisão' },
    ] : cli.id === CLI.jose ? [
      { id: 'pe4', tipo: 'campanha', status: 'enviado', enviar_em: d(12), enviado_em: d(12), respondido_em: d(12), resposta_tipo: 'parar', rotulo: 'Campanha' },
      { id: 'pe5', tipo: 'retorno', status: 'pulado', enviar_em: d(5), rotulo: 'Retorno de revisão' },
      { id: 'pe6', tipo: 'lembrete', status: 'falhou', enviar_em: d(101), erro: 'HTTP 401', rotulo: 'Lembrete de horário' },
    ] : [];
    return json(res, 200, { ok: true,
      cliente: { id: cli.id, nome: cli.nome, nascimento: cli.nascimento, aceita_mensagens: cli.aceita_mensagens !== false,
        aceita_mensagens_em: cli.aceita_mensagens_em, aceita_mensagens_motivo: cli.aceita_mensagens_motivo },
      resumo: r360, ultimoServico: ultimo, revisao: ultimo ? { prevista, ...regra, regraId: null } : null, envios,
      comunicarUrl: 'https://indycar-posvenda.onrender.com',
      // Pátio (16/10): a Camila está com o carro na oficina, com um extra esperando
      patio: cli.id === CLI.camila ? (() => {
        const o = PAT.resumoDaOs({ id: '44444444-4444-4444-8444-444444444444', numero: 57, etapa: 'aguardando_aprovacao', etapa_em: d(0.06),
          veiculo: 'Corolla', placa: 'GFK3H26', servico: 'Troca de pastilhas', token_publico: 'ab12cd34ef56ab12cd34ef56', created_at: d(0.2) },
          [{ os_id: '44444444-4444-4444-8444-444444444444', descricao: 'Disco de freio dianteiro', urgencia: 'seguranca', status: 'pendente', valor: 680 },
           { os_id: '44444444-4444-4444-8444-444444444444', descricao: 'Fluido de freio', urgencia: 'recomendado', status: 'aprovado', valor: 120 }]);
        return { ...o, texto_link: PAT.textoDoAcompanhamento({ nome: cli.nome, veiculo: o.veiculo, link: o.link_cliente }) };
      })() : null });
  }
  if ((mm = /^\/api\/clientes\/([^/]+)\/area-cliente$/.exec(p)) && m === 'POST') {
    const cli = DB.clientes.find(c => c.id === mm[1]);
    if (!cli) return json(res, 404, { erro: 'Cliente não encontrado.' });
    const link = PAT.linkArea('https://indycar-patio.netlify.app', 'f00dbabe' + Date.now().toString(16));
    return json(res, 200, { ok: true, link, texto: PAT.textoDaArea({ nome: cli.nome, link }) });
  }
  if (p === '/api/codewords/chave' && m === 'GET') {
    if (!admin) return json(res, 403, { erro: 'Só o administrador vê a chave.' });
    return json(res, 200, { ok: true, mascara: '••••••••' + CHAVE.slice(-4), mascaraAgenda: '••••••••' + CHAVE.slice(-4), iguais: true, atualizadoEm: d(60),
      ultimoErro: ultimoEnvio401 ? 'WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações' : null });
  }
  if (p === '/api/codewords/testar-chave') {
    if (!admin) return json(res, 403, { erro: 'Só o administrador testa a chave.' });
    const k = body.chave || CHAVE;
    const recusada = /antiga/.test(k);
    return json(res, 200, recusada
      ? { ok: false, resultado: 'recusada', mensagem: 'Chave recusada pelo CodeWords (401). Ela foi revogada ou está errada.', status: 401, mascara: '••••••••' + k.slice(-4), salva: !body.chave }
      : { ok: true, resultado: 'ok', mensagem: 'Chave aceita pelo CodeWords — 1 conexão de WhatsApp.', status: 200, mascara: '••••••••' + k.slice(-4), salva: !body.chave });
  }
  if (p === '/api/codewords/chave' && m === 'POST') {
    if (!admin) return json(res, 403, { erro: 'Só o administrador troca a chave.' });
    const k = String(body.chave || '').trim();
    if (k.length < 20 || /\s/.test(k)) return json(res, 400, { ok: false, erro: 'Isso não parece uma chave do CodeWords (cole a chave inteira, sem espaços).' });
    if (/antiga|ruim/.test(k)) return json(res, 400, { ok: false, erro: 'O CodeWords recusou essa chave (401) — nada foi salvo. Confira se copiou a chave nova inteira.', teste: { resultado: 'recusada' } });
    CHAVE = k; ultimoEnvio401 = false; SAUDE_OK = true;
    return json(res, 200, { ok: true, mascara: '••••••••' + k.slice(-4), salvoEm: ['codewords_config', 'agenda_ia_config'], teste: { resultado: 'ok', mensagem: 'Chave aceita pelo CodeWords — 1 conexão de WhatsApp.' }, avisos: [] });
  }
  if (p === '/api/enviar') {
    if (ultimoEnvio401) return json(res, 502, { ok: false, codigo: 'codewords-401', status: 401,
      erro: 'WhatsApp parado: a chave do CodeWords foi recusada (401). Troque em Configurações › Integrações' });
    // igual ao lib/entrega.js: o mesmo mensagemId não sai duas vezes
    if (body.mensagemId && ENVIOS_FEITOS.includes(body.mensagemId)) return json(res, 200, { ok: true, jaEnviada: true });
    if (body.mensagemId) {
      ENVIOS_FEITOS.push(body.mensagemId);
      const linha = DB.whatsapp_mensagens?.find(x => x.id === body.mensagemId);
      if (linha) linha.status = 'enviado';
    }
    return json(res, 200, { ok: true, resposta: '{"status":"sent"}' });
  }
  if (p === '/api/conversas/sincronizar') return json(res, 200, { ok: true, novas: 0 });

  /* ---------- copiloto da IA (respostas fictícias, para a integração visual) ---------- */
  const livres = () => {
    const l = [];
    for (let i = 1; l.length < 12 && i < 10; i++) {
      const dia = diaSP(i);
      if (new Date(dia + 'T12:00:00').getDay() === 0) continue;
      ['09:00', '14:30'].forEach(hora => l.push({ data: dia, hora, rotulo: `${dia.slice(8)}/${dia.slice(5, 7)} às ${hora}`, periodo: hora < '12' ? 'manhã' : 'tarde' }));
    }
    return l;
  };
  if ((mm = /^\/api\/ia\/contexto\/([^/]+)$/.exec(p))) {
    const conv = DB.conversas.find(c => c.id === mm[1]);
    if (!conv) return json(res, 404, { ok: false, erro: 'Conversa não encontrada.' });
    const cli = DB.clientes.find(c => c.id === conv.cliente_id) || null;
    const l = livres();
    return json(res, 200, { ok: true, conversa: { id: conv.id, nome: conv.nome, telefone: conv.telefone, etapa_id: conv.etapa_id },
      cliente: cli && { id: cli.id, nome: cli.nome, carro_modelo: cli.carro_modelo, placa: cli.placa },
      resumo: 'Cliente quer trazer o carro amanhã de manhã; já fez troca de óleo há 6 meses.',
      leads: DB.leads.filter(x => x.cliente_id === conv.cliente_id), agendamentos: DB.agendamentos.filter(x => x.cliente_id === conv.cliente_id),
      ficha: { horariosLivres: l, horariosSugeridos: [l[0], l[3]] } });   // formato da rota real (lib/contexto.js)
  }
  if (p === '/api/ia/horarios') { const l = livres(); return json(res, 200, { ok: true, livres: l, sugeridos: [l[0], l[3]] }); }
  if (p === '/api/ia/copiloto' && m === 'POST') {
    const conv = DB.conversas.find(c => c.id === body.conversaId);
    const nome = (conv?.nome || 'cliente').split(' ')[0];
    const acoes = [
      { id: 'ac' + Date.now(), tipo: 'mover_etapa', resumo: 'Mover para "Orçamento enviado"', parametros: { etapa_id: ETAPA.orc }, status: 'proposta', precisa_clique: true, reversivel: true, conversa_id: body.conversaId, perfil_id: quem.id },
      { id: 'ad' + Date.now(), tipo: 'agendar', conversa_id: body.conversaId, perfil_id: quem.id, resumo: 'Agendar diagnóstico gratuito amanhã 09:00', parametros: { data: diaSP(1), hora: '09:00' }, status: 'proposta', precisa_clique: true, reversivel: true },
    ];
    acoes.forEach(a => ACOES.set(a.id, a));
    const hs = livres().slice(0, 2).map(({ data, hora, rotulo }) => ({ data, hora, rotulo }));
    return json(res, 200, { ok: true, id: 'cp' + Date.now(), resposta_acao_id: null, resposta_sugerida: `Oi, ${nome}! Pode trazer sim — amanhã às 9h fazemos o diagnóstico digital gratuito (uns 30 min). Quem conhece, Indyca! 🏎`,
      acoes, resumo: 'Quer levar o carro amanhã de manhã.', pendencias: ['Confirmar o horário'], intencao: 'agendar', temperatura: 'quente',
      motivo_classificacao: 'Pediu horário para amanhã.', horarios_sugeridos: hs, autonomia: IA_CFG.autonomia, niveis: niveisMock(),
      proxima_acao: { tipo: 'aprovar', texto: 'Aprove o agendamento proposto pela IA — o horário já foi conferido como livre.' }, modelo: 'mock',
      tokens: { entrada: 1200, saida: 180 }, duracao_ms: 900, uso: { chamadas: 13, limite: 500 } });
  }
  if ((mm = /^\/api\/ia\/acoes\/([^/]+)\/(executar|recusar|desfazer)$/.exec(p))) {
    const a = ACOES.get(mm[1]) || { id: mm[1], tipo: 'desconhecida', resumo: '—' };
    a.status = mm[2] === 'executar' ? 'executada' : mm[2] === 'recusar' ? 'recusada' : 'desfeita';
    ACOES.set(a.id, a);
    let mensagem = mm[2] === 'executar' ? 'Feito.' : mm[2] === 'recusar' ? 'Recusado.' : 'Desfeito.';
    if (mm[2] === 'executar' && a.tipo === 'responder' && a.parametros?.enviar) {
      const conv = DB.conversas.find(c => c.id === a.conversa_id);
      if (conv) DB.whatsapp_mensagens.push({ id: 'ia-msg-' + Date.now(), conversa_id: conv.id, corpo: a.parametros.texto, direcao: 'saida', status: 'enviado', gerada_por_ia: true, created_at: new Date().toISOString() });
      mensagem = '✉️ Mensagem enviada ao cliente.';
    }
    return json(res, 200, { ok: true, acao: a, tipo: a.tipo, mensagem });
  }
  if (p === '/api/ia/acoes') { const cid = url.searchParams.get('conversaId'); return json(res, 200, { ok: true, acoes: [...ACOES.values()].filter(a => !cid || a.conversa_id === cid) }); }
  if (p === '/api/ia/uso') return json(res, 200, { ok: true, chamadas: 12, limite: 500, tokens_entrada: 48000, tokens_saida: 6100, minhas: 4 });
  if (p === '/api/ia/config' && m === 'GET') return json(res, 200, { ok: true, config: { ...IA_CFG, funil_niveis: niveisMock() }, podeEditar: admin, modelosPermitidos: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
    etapasFunil: ['responder', 'agendar', 'crm', 'humano'], niveis: ['sugerir', 'confirmar', 'automatico'], funilDisponivel: true, iaConfigurada: true });
  if (p === '/api/ia/config' && m === 'PUT') {
    if (!admin) return json(res, 403, { ok: false, erro: 'Só o administrador muda a configuração da IA.' });
    for (const k of ['ativo', 'autonomia', 'funil_ativo', 'instrucoes_extras', 'limite_chamadas_dia']) if (body[k] !== undefined) IA_CFG[k] = body[k];
    if (body.funil_autonomia !== undefined) { IA_CFG.funil_autonomia = {}; for (const [k, v] of Object.entries(body.funil_autonomia || {})) if (v && v !== 'herdar') IA_CFG.funil_autonomia[k] = v; }
    auditar(quem.id, 'config.ia', 'ia_config', 'true', { detalhes: { campos: Object.keys(body) } });
    return json(res, 200, { ok: true, config: { ...IA_CFG, funil_niveis: niveisMock() } });
  }
  if (p === '/api/ia/hoje') {
    const grupos = new Map();
    for (const a of IA_HOJE) {
      const c = DB.conversas.find(x => x.id === a.conversa_id);
      if (!grupos.has(a.conversa_id)) grupos.set(a.conversa_id, { conversa_id: a.conversa_id, nome: c?.nome || null, telefone: c?.telefone || null, atribuida_a: c?.atribuida_a || null, acoes: [] });
      const viva = ACOES.get(a.id);
      grupos.get(a.conversa_id).acoes.push({ ...a, status: viva ? viva.status : a.status });
    }
    const todas = [...grupos.values()].flatMap(g => g.acoes);
    return json(res, 200, { ok: true, desde: new Date(agora - 10 * 3600_000).toISOString(),
      totais: { conversas: grupos.size, executadas: todas.filter(a => a.status === 'executada').length, propostas: todas.filter(a => a.status === 'proposta').length,
        enviadas: todas.filter(a => a.enviada).length, agendamentos: todas.filter(a => a.tipo === 'agendar' && a.status === 'executada').length, humano: 1, erros: 0 },
      fila: { pendente: 0, processando: IA_FILA.filter(f => f.status === 'processando').length, feita: 7, pulada: 2, erro: 0 },
      processando: IA_FILA.filter(f => f.status === 'processando').map(f => f.conversa_id), conversas: [...grupos.values()] });
  }
  if (p === '/api/ia/funil/estado') return json(res, 200, { ok: true, disponivel: true, hoje: { pendente: 0, processando: IA_FILA.filter(f => f.status === 'processando').length, feita: 7, pulada: 2, erro: 0 }, processando: IA_FILA.filter(f => f.status === 'processando').map(f => f.conversa_id) });
  if (p === '/api/ia/funil/processar') {
    if (!gestor) return json(res, 403, { ok: false, erro: 'Só gestor ou administrador roda a fila da IA à mão.' });
    IA_FILA.forEach(f => { f.status = 'feita'; });
    return json(res, 200, { ok: true, conversas: 1, feitas: 1, puladas: 0, erros: 0 });
  }
  if (p === '/api/conversa-por-telefone') {
    const t = String(url.searchParams.get('t') || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    const conv = DB.conversas.find(c => c.telefone_e164 === t);
    return conv ? json(res, 200, { ok: true, conversaId: conv.id, nome: conv.nome, clienteId: conv.cliente_id, telefone: conv.telefone_e164,
        link: `/?conversa=${conv.id}`, outras: [] })
      : json(res, 404, { ok: false, conversaId: null, erro: 'Nenhuma conversa com esse telefone.' });
  }
  if (p === '/api/ia/sugerir') return json(res, 200, { ok: true, sugestao: 'Oi! Aqui é o atendimento da IndyCar. Pode trazer o carro amanhã às 9h para o diagnóstico gratuito?', modelo: 'mock' });
  if (p === '/api/relatorios') {
    if (!gestor) return json(res, 403, { erro: 'Só gestor ou administrador vê os relatórios da equipe.' });
    const dias = Array.from({ length: 7 }, (_, i) => new Date(agora - (6 - i) * 86400_000).toISOString().slice(0, 10));
    const porDia = dias.map((dia, i) => ({ dia, leads: 2 + (i % 3), ganhos: i % 2, perdidos: 0, conversao: i % 2 ? 50 : 0, novas: 3, resolvidas: 2, backlog: 4 }));
    return json(res, 200, { ok: true, periodo: { de: dias[0], ate: dias[6], dias, fuso: 'America/Sao_Paulo' },
      resumo: { leads: 15, ganhos: 4, perdidos: 2, conversao: 66.7 }, porDia,
      origens: [{ rotulo: 'WhatsApp', volume: 9, ganhos: 3, perdidos: 1, conversao: 75 }, { rotulo: 'Google', volume: 6, ganhos: 1, perdidos: 1, conversao: 50 }],
      leadsPorAtendente: [{ atendente: 'João Pedro', volume: 10, ganhos: 3, perdidos: 1, conversao: 75 }],
      capacidade: { novos: 21, concluidos: 14, desempenho: 66.7, backlogInicial: 3, porDia },
      espera: { media: 12, amostras: 20, porDia: dias.map(dia => ({ dia, minutos: 12, amostras: 3 })) },
      duracao: { media: 240, amostras: 14, porDia: dias.map(dia => ({ dia, minutos: 240, amostras: 2 })) },
      canais: [], etiquetas: [], atendentes: [], equipes: [], mapaCalor: { matriz: Array.from({ length: 7 }, () => Array(24).fill(0)), total: 0, pico: null },
      comunicar: { total: 42, enviadas: 37, respondidas: 9, pararam: 2, falharam: 3, pendentes: 2, canceladas: 0, puladas: 0, agendaram: 4, positivas: 6,
        porTipo: { aniversario: 18, posvenda: 12, retorno: 9, campanha: 3 } },
      avisos: [] });
  }
  if ((p === '/api/conversas/excluir' || p === '/api/mensagens/excluir') && !gestor)
    return json(res, 403, { ok: false, codigo: 'so_gestor', erro: 'Só gestor ou administrador pode apagar.' });
  if (m === 'GET') return json(res, 200, { ok: true });
  return json(res, 200, { ok: true });
}).listen(PORT, () => console.log(`Atendimento (dados de MENTIRA) em http://localhost:${PORT}  ·  papéis: /?papel=admin|gestor|atendente|agenda|desativado|semapp|trocarsenha|mfa|deslogado  ·  sem faixa: /?saude=ok`));
