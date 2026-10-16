-- ============================================================
-- Rodada 5 (16/10/2026) — IA do funil (Atendimento). Migração at_ia_funil_v1.
-- Só aditivo, prefixo at_. Nada de tocar_conversa, usuario_*, proximo_da_fila, patio_*, cliente_360.
--
-- Como funciona:
--   mensagem do CLIENTE entra (webhook/Edge Function/sincronia) → tocar_conversa (BEFORE) liga a conversa
--   → gatilho AFTER at_ia_enfileirar grava uma linha em at_ia_fila (agendada para daqui a 8 s, para o cliente
--     terminar de digitar) e chama at_ia_acordar(): um POST para o servidor do Atendimento
--     (/api/ia/funil/acordar, autenticado pelo MESMO token do webhook do CodeWords). Esse POST também
--     acorda o Render gratuito quando ele está dormindo.
--   → o servidor drena a fila (lib/ia-funil.js) e marca feita/pulada/erro com o resultado.
--   → pg_cron at-ia-funil-despertar (a cada minuto) só chama o servidor de novo se houver linha pendente
--     há mais de 20 s (o "acorda" anterior se perdeu num 503). Sem fila, não gasta hora do Render.
-- ============================================================

-- 1) configuração do funil (ia_config é do Atendimento, linha única id=true)
alter table public.ia_config
  add column if not exists funil_ativo boolean not null default true,
  add column if not exists funil_autonomia jsonb not null default '{}'::jsonb,
  add column if not exists funil_url text not null default 'https://indycar-atendimento.onrender.com/api/ia/funil/acordar',
  add column if not exists funil_acordado_em timestamptz;
comment on column public.ia_config.funil_autonomia is 'Autonomia por etapa do funil: {responder,agendar,crm,humano} = herdar|sugerir|confirmar|automatico (herdar = usa ia_config.autonomia)';
comment on column public.ia_config.funil_url is 'Para onde o banco avisa que há mensagem nova (POST com x-codewords-token). A Central (onda B2) troca este endereço.';

-- 2) fila de trabalho da IA
create table if not exists public.at_ia_fila (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  mensagem_id uuid references public.whatsapp_mensagens(id) on delete set null,
  telefone_e164 text,
  status text not null default 'pendente' check (status in ('pendente','processando','feita','pulada','erro')),
  motivo text,
  tentativas integer not null default 0,
  agendado_para timestamptz not null default now() + interval '8 seconds',
  iniciado_em timestamptz,
  concluido_em timestamptz,
  resultado jsonb,
  created_at timestamptz not null default now()
);
comment on table public.at_ia_fila is 'IA do funil: uma linha por mensagem de cliente que a IA precisa olhar. O servidor do Atendimento processa; a tela lê para mostrar "a IA está respondendo".';
create index if not exists at_ia_fila_pendente_idx on public.at_ia_fila (agendado_para) where status in ('pendente','processando');
create index if not exists at_ia_fila_conversa_idx on public.at_ia_fila (conversa_id, created_at desc);
create index if not exists at_ia_fila_dia_idx on public.at_ia_fila (created_at desc);

alter table public.at_ia_fila enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'at_ia_fila' and policyname = 'at_ia_fila: equipe le') then
    create policy "at_ia_fila: equipe le" on public.at_ia_fila for select to authenticated using ((select public.usuario_equipe()));
  end if;
end $$;
-- tempo real para a tela ("a IA está respondendo")
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'at_ia_fila') then
    alter publication supabase_realtime add table public.at_ia_fila;
  end if;
end $$;

-- 3) acorda o servidor (no máximo 1x a cada 20 s: um pedido já acorda o Render e o servidor drena a fila inteira)
create or replace function public.at_ia_acordar(p_conversa uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_tok text; v_url text; v_ult timestamptz;
begin
  select c.token_webhook into v_tok from public.codewords_config c where c.id = true;
  select funil_url, funil_acordado_em into v_url, v_ult from public.ia_config where id = true;
  if v_tok is null or v_tok = '' or v_url is null or v_url = '' then return false; end if;
  if v_ult is not null and v_ult > now() - interval '20 seconds' then return false; end if;
  update public.ia_config set funil_acordado_em = now() where id = true;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('conversa_id', p_conversa, 'origem', 'banco'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-codewords-token', v_tok),
    timeout_milliseconds := 8000);
  return true;
exception when others then
  return false;
end $$;
revoke all on function public.at_ia_acordar(uuid) from public, anon, authenticated;

-- 4) gatilho: mensagem de ENTRADA numa conversa de atendimento vira trabalho para a IA
create or replace function public.at_ia_enfileirar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_tipo text; v_ativo boolean; v_funil boolean;
begin
  if new.direcao <> 'entrada' or new.conversa_id is null then return null; end if;
  if coalesce(new.corpo, '') ~* '^\s*(\[sistema\]|perfil\s+atualizado\s*:)' then return null; end if;
  select ativo, funil_ativo into v_ativo, v_funil from public.ia_config where id = true;
  if coalesce(v_ativo, true) = false or coalesce(v_funil, true) = false then return null; end if;
  select tipo into v_tipo from public.conversas where id = new.conversa_id;
  if coalesce(v_tipo, 'atendimento') <> 'atendimento' then return null; end if;
  insert into public.at_ia_fila (conversa_id, mensagem_id, telefone_e164)
  values (new.conversa_id, new.id, public.normalizar_telefone(new.telefone));
  perform public.at_ia_acordar(new.conversa_id);
  return null;
exception when others then
  return null;   -- a fila da IA nunca derruba a gravação da mensagem
end $$;
revoke all on function public.at_ia_enfileirar() from public, anon, authenticated;

drop trigger if exists whatsapp_mensagens_zz_at_ia_fila on public.whatsapp_mensagens;
create trigger whatsapp_mensagens_zz_at_ia_fila
  after insert on public.whatsapp_mensagens
  for each row execute function public.at_ia_enfileirar();

-- 5) despertador (pg_cron, a cada minuto): só chama o servidor se há fila parada; solta travas velhas
create or replace function public.at_ia_despertar()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  -- "processando" há mais de 5 min = o servidor caiu no meio: volta para a fila (até 5 tentativas)
  update public.at_ia_fila set status = 'pendente', tentativas = tentativas + 1, iniciado_em = null
   where status = 'processando' and iniciado_em < now() - interval '5 minutes';
  update public.at_ia_fila set status = 'erro', motivo = 'tentativas esgotadas', concluido_em = now()
   where status = 'pendente' and tentativas >= 5;
  -- fila com mais de 2 dias nunca processada não interessa mais (a conversa já andou)
  update public.at_ia_fila set status = 'pulada', motivo = 'velha demais', concluido_em = now()
   where status = 'pendente' and created_at < now() - interval '2 days';
  select count(*) into n from public.at_ia_fila
   where status = 'pendente' and agendado_para < now() - interval '20 seconds';
  if n > 0 then perform public.at_ia_acordar(null); end if;
  return n;
end $$;
revoke all on function public.at_ia_despertar() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'at-ia-funil-despertar') then
    perform cron.schedule('at-ia-funil-despertar', '* * * * *', 'select public.at_ia_despertar()');
  end if;
end $$;
