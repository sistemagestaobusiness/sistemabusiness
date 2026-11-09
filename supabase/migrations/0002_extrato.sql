-- Sistema Business · 0002 · extrato do banco (OFX) e conciliação

create table public.extrato_linhas (
  id            bigint generated always as identity primary key,
  conta_id      bigint not null references public.contas(id),
  fitid         text not null,                      -- código único do movimento no banco (OFX)
  data          date not null,
  valor         numeric(14,2) not null,             -- + crédito, − débito (como no extrato)
  descricao     text,
  documento     text,
  lancamento_id bigint unique references public.lancamentos(id),
  ignorada      boolean not null default false,      -- ex.: transferência entre contas próprias
  importado_em  timestamptz not null default now(),
  importado_por uuid default auth.uid(),
  unique (conta_id, fitid)                           -- subir o mesmo extrato de novo não duplica
);
create index extrato_linhas_data_idx on public.extrato_linhas (data);

alter table public.extrato_linhas enable row level security;
revoke all on public.extrato_linhas from anon, authenticated;
grant select, insert, update on public.extrato_linhas to authenticated;
create policy extrato_linhas_ler on public.extrato_linhas for select to authenticated using (public.pode_ler());
create policy extrato_linhas_incluir on public.extrato_linhas for insert to authenticated with check (public.eh_socio());
create policy extrato_linhas_alterar on public.extrato_linhas for update to authenticated using (public.eh_socio()) with check (public.eh_socio());

create trigger extrato_linhas_auditoria after insert or update or delete on public.extrato_linhas
  for each row execute function public.tg_auditoria();

-- conciliar: liga a linha do extrato ao lançamento, que passa a valer o que o banco diz (data e valor) e fica CONCILIADO
create or replace function public.fn_conciliar(p_linha bigint, p_lancamento bigint) returns void
language plpgsql security invoker set search_path = public as $$
declare e public.extrato_linhas; k text;
begin
  if not public.eh_socio() then raise exception 'Sem permissão'; end if;
  select * into e from public.extrato_linhas where id = p_linha for update;
  if not found then raise exception 'Linha do extrato não existe'; end if;
  if e.lancamento_id is not null then raise exception 'Essa linha do extrato já foi conciliada'; end if;
  if exists (select 1 from public.extrato_linhas x where x.lancamento_id = p_lancamento) then
    raise exception 'Esse lançamento já está ligado a outra linha do extrato';
  end if;
  select c.tipo into k from public.lancamentos l join public.categorias c on c.id = l.categoria_id
   where l.id = p_lancamento and l.excluido_em is null;
  if k is null then raise exception 'Lançamento não existe'; end if;
  if (k = 'ENTRADA') <> (e.valor > 0) then
    raise exception 'O extrato é % e o lançamento é %', case when e.valor > 0 then 'crédito' else 'débito' end,
      case when k = 'ENTRADA' then 'entrada' else 'pagamento' end;
  end if;
  update public.lancamentos set data = e.data, valor = abs(e.valor), status = 'CONCILIADO', conta_id = e.conta_id
   where id = p_lancamento;
  update public.extrato_linhas set lancamento_id = p_lancamento, ignorada = false where id = p_linha;
end $$;

create or replace function public.fn_desconciliar(p_linha bigint) returns void
language plpgsql security invoker set search_path = public as $$
declare l bigint;
begin
  if not public.eh_socio() then raise exception 'Sem permissão'; end if;
  select lancamento_id into l from public.extrato_linhas where id = p_linha;
  update public.extrato_linhas set lancamento_id = null where id = p_linha;
  if l is not null then update public.lancamentos set status = 'REALIZADO' where id = l; end if;
end $$;

revoke execute on function public.fn_conciliar(bigint, bigint), public.fn_desconciliar(bigint) from public, anon;
grant execute on function public.fn_conciliar(bigint, bigint), public.fn_desconciliar(bigint) to authenticated;

alter publication supabase_realtime add table public.extrato_linhas;
