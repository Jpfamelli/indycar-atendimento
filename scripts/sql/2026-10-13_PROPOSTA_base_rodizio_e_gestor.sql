-- ============================================================
-- PROPOSTA PARA O COORDENADOR (NÃO APLICADA pelo agente do Atendimento)
-- Mexe em objetos da BASE (perfis_papel_check e proximo_da_fila), que a
-- regra da rodada 3 proíbe o agente de alterar. Conferido em 13/10/2026:
--
-- 1) perfis_papel_check só aceita ('admin','atendente','agenda') — o papel
--    'gestor' (usado por usuario_gestor(), usuario_equipe(), notificar_conversa
--    e por todas as telas) é RECUSADO pelo banco. O servidor do Atendimento
--    já trata e devolve 409 {codigo:'papel_nao_aceito'} até isto ser aplicado.
--
-- 2) proximo_da_fila() (chamada por tocar_conversa na 1ª mensagem do cliente)
--    escolhe quem tem ativo+recebe_leads, sem olhar papel nem apps. Hoje o
--    Franklin (papel 'agenda') está com 3 conversas abertas por causa disso.
--    O servidor corrige em até 5 min (automação "dono inválido"), mas o certo
--    é a função já escolher direito. A versão abaixo segue a MESMA regra do
--    servidor (lib/rodizio.js): papel de equipe, app 'atendimento' (admin
--    sempre), fora de férias (preferencias.ausente_ate), menor carga aberta,
--    empate → quem recebeu há mais tempo.
-- ============================================================

alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check
  check (papel = any (array['admin','gestor','atendente','agenda']));

create or replace function public.proximo_da_fila()
returns uuid
language sql
stable security definer
set search_path = ''
as $$
  select p.id
    from public.perfis p
   where p.ativo and p.recebe_leads
     and p.papel in ('admin','gestor','atendente')
     and (p.papel = 'admin' or 'atendimento' = any(p.apps))
     and not coalesce((p.preferencias->>'ausente_ate') >= to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'), false)
   order by (select count(*) from public.conversas c
              where c.atribuida_a = p.id and c.status <> 'resolvida') asc,
            p.ultimo_lead_em asc nulls first,
            p.id asc
   limit 1
$$;
revoke execute on function public.proximo_da_fila() from anon, authenticated;
