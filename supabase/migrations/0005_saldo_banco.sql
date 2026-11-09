-- Sistema Business · 0005 · saldo do banco dia a dia, para conferir com o saldo do fluxo
-- O OFX do C6 não traz o saldo da conta. Por isso o sócio informa uma vez o saldo que o app do banco mostra
-- num dia (fim do dia) e o saldo dos outros dias sai das linhas do extrato importadas:
--   saldo(d) = saldo informado + soma(extrato até d) − soma(extrato até o dia informado)
-- Só vale entre a véspera da primeira linha importada e o último dia conhecido (antes disso faltam linhas).

alter table public.contas
  add column saldo_banco    numeric(14,2),   -- saldo do app do banco no fim do dia saldo_banco_em
  add column saldo_banco_em date;

create or replace function public.fn_saldo_banco(p_ini date, p_fim date)
returns table (data date, saldo numeric)
language sql stable security invoker set search_path = public as $$
  with lim as (
    select c.id, c.saldo_banco, c.saldo_banco_em,
           min(e.data) - 1 as de,
           greatest(c.saldo_banco_em, max(e.data)) as ate
      from public.contas c
      join public.extrato_linhas e on e.conta_id = c.id
     where c.saldo_banco is not null and c.saldo_banco_em is not null
     group by c.id
  ), dias as (
    select d::date as data from generate_series(p_ini, p_fim, interval '1 day') d
  )
  select dias.data,
         sum(lim.saldo_banco
             + coalesce((select sum(e.valor) from public.extrato_linhas e where e.conta_id = lim.id and e.data <= dias.data), 0)
             - coalesce((select sum(e.valor) from public.extrato_linhas e where e.conta_id = lim.id and e.data <= lim.saldo_banco_em), 0))
    from dias join lim on dias.data between lim.de and lim.ate
   group by dias.data
   order by dias.data
$$;
revoke execute on function public.fn_saldo_banco(date, date) from public, anon;
grant execute on function public.fn_saldo_banco(date, date) to authenticated;
