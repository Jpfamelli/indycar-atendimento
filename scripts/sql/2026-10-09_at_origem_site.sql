-- Migração `at_origem_site` (09/10/2026): mensagem que chega com o código do site
-- "(site/<servico>)" (os botões de WhatsApp do site mandam esse código no texto pronto)
-- marca o lead aberto do cliente com utm_source='site', utm_medium='whatsapp',
-- utm_campaign=<servico>. Só preenche se o lead ainda não tem UTM e foi criado
-- há até 2 dias. Testada com DO-block revertido.
create or replace function public.at_origem_pelo_site()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cod text; v_tel text;
begin
  if new.direcao is distinct from 'entrada' then return new; end if;
  v_cod := substring(coalesce(new.corpo, '') from '\(site/([a-z0-9_-]{1,40})\)');
  if v_cod is null then return new; end if;
  v_tel := public.normalizar_telefone(new.telefone);
  update public.leads l
     set utm_source = 'site', utm_medium = 'whatsapp', utm_campaign = v_cod,
         origem = case when l.origem in ('whatsapp','organico') then 'organico'::public.canal_origem else l.origem end
   where l.status not in ('concluido','perdido')
     and l.utm_source is null
     and l.created_at > now() - interval '2 days'
     and ((new.cliente_id is not null and l.cliente_id = new.cliente_id)
          or (v_tel is not null and public.normalizar_telefone(l.telefone) = v_tel));
  return new;
exception when others then
  return new;
end $$;
revoke all on function public.at_origem_pelo_site() from public, anon, authenticated;
drop trigger if exists mensagem_origem_site on public.whatsapp_mensagens;
create trigger mensagem_origem_site after insert on public.whatsapp_mensagens
  for each row execute function public.at_origem_pelo_site();
