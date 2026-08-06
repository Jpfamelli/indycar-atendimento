-- ============================================================
-- 23_funil_config.sql
-- Preferências do funil (as "plaquinhas" de etapa).
--
-- Uma linha só, para o app inteiro: se a IA pode carimbar a etapa
-- sozinha e qual a confiança mínima para ela ter permissão de gravar.
--
-- NÃO foi aplicado automaticamente — rode este arquivo no SQL Editor
-- do Supabase (projeto nppfqhavqahapmugnyng) antes de usar a chavinha
-- "Deixar a IA classificar sozinha" na aba Etapas.
--
-- Enquanto a tabela não existir, o app continua funcionando: a
-- classificação manual e o botão "✨ Classificar" seguem valendo, e a
-- classificação automática fica desligada com o padrão de 0.6.
-- ============================================================

create table if not exists public.funil_config (
  id               boolean primary key default true check (id),
  ia_classifica    boolean not null default false,
  confianca_minima numeric not null default 0.6
                   check (confianca_minima >= 0 and confianca_minima <= 1),
  updated_at       timestamptz not null default now()
);

comment on table  public.funil_config is
  'Linha única com as preferências do funil de atendimento.';
comment on column public.funil_config.ia_classifica is
  'Quando verdadeiro, o app chama /api/ia/classificar sozinho ao chegar mensagem nova do cliente.';
comment on column public.funil_config.confianca_minima is
  'Confiança mínima (0 a 1) para a IA ter permissão de gravar a etapa. Abaixo disso, ela sugere e não grava.';

-- garante que a linha exista desde já
insert into public.funil_config (id) values (true) on conflict (id) do nothing;

-- ------------------------------------------------------------
-- RLS: todo atendente ativo LÊ (o app precisa saber se a chavinha
-- está ligada); só o admin ESCREVE.
-- ------------------------------------------------------------
alter table public.funil_config enable row level security;

drop policy if exists "funil_config: ativo le"   on public.funil_config;
drop policy if exists "funil_config: admin edita" on public.funil_config;

create policy "funil_config: ativo le"
  on public.funil_config
  for select
  using (public.usuario_ativo());

create policy "funil_config: admin edita"
  on public.funil_config
  for all
  using (
    exists (
      select 1 from public.perfis p
       where p.id = (select auth.uid())
         and p.papel = 'admin'
         and p.ativo
    )
  )
  with check (
    exists (
      select 1 from public.perfis p
       where p.id = (select auth.uid())
         and p.papel = 'admin'
         and p.ativo
    )
  );

-- carimba updated_at sozinho (mesma função das outras tabelas)
drop trigger if exists funil_config_updated_at on public.funil_config;
create trigger funil_config_updated_at
  before update on public.funil_config
  for each row execute function public.tocar_updated_at();

-- ------------------------------------------------------------
-- Tempo real para etapas_funil: quando o dono edita uma etapa, as
-- telas dos outros atendentes se atualizam sozinhas. Sem isto o app
-- continua funcionando — só não sincroniza entre navegadores.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'etapas_funil'
  ) then
    alter publication supabase_realtime add table public.etapas_funil;
  end if;
end $$;
