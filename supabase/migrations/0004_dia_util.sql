-- Sistema Business · 0004 · dia útil
-- Lançamento PREVISTO em sábado, domingo ou feriado vai sozinho para o próximo dia útil (o banco não compensa nesses dias).
-- Feriados: nacionais + Carnaval (segunda e terça), Sexta-feira Santa e Corpus Christi.
-- A mesma lista está em src/lib/feriados.ts (destaque na tela): mudar nos dois lugares.

create or replace function public.fn_pascoa(p_ano int) returns date
language plpgsql immutable set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mes int; dia int;
begin
  a := p_ano % 19; b := p_ano / 100; c := p_ano % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31; dia := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_ano, mes, dia);
end $$;

create or replace function public.fn_eh_feriado(p_data date) returns boolean
language sql immutable set search_path = public as $$
  select to_char(p_data, 'MM-DD') in ('01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25')
      or p_data - public.fn_pascoa(extract(year from p_data)::int) in (-48, -47, -2, 60)
$$;

create or replace function public.fn_dia_util(p_data date) returns date
language plpgsql immutable set search_path = public as $$
declare d date := p_data;
begin
  while extract(isodow from d) in (6, 7) or public.fn_eh_feriado(d) loop d := d + 1; end loop;
  return d;
end $$;

revoke execute on function public.fn_pascoa(int), public.fn_eh_feriado(date), public.fn_dia_util(date) from public, anon;
grant execute on function public.fn_pascoa(int), public.fn_eh_feriado(date), public.fn_dia_util(date) to authenticated;

create or replace function public.tg_previsto_dia_util() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'PREVISTO' and new.data is not null then new.data := public.fn_dia_util(new.data); end if;
  return new;
end $$;
create trigger lancamentos_previsto_dia_util before insert or update of data, status on public.lancamentos
  for each row execute function public.tg_previsto_dia_util();

-- projeção recorrente: confere pela data já ajustada (o dia 31 num sábado vira o dia 2 do mês seguinte e não pode
-- impedir a projeção daquele mês)
create or replace function public.fn_gerar_recorrencia(p_id bigint) returns int
language plpgsql security invoker set search_path = public as $$
declare r public.recorrencias; m date; d date; n int := 0;
begin
  if not public.eh_socio() then raise exception 'Sem permissão'; end if;
  select * into r from public.recorrencias where id = p_id;
  if not found then raise exception 'Recorrência % não existe', p_id; end if;
  m := date_trunc('month', r.inicio)::date;
  while m <= coalesce(r.fim, (date_trunc('month', r.inicio) + interval '23 months')::date) loop
    d := m + (least(r.dia, extract(day from (m + interval '1 month - 1 day'))::int) - 1);
    if d >= r.inicio and (r.fim is null or d <= r.fim) and not exists (
      select 1 from public.lancamentos l where l.recorrencia_id = r.id and l.excluido_em is null
        and l.data = public.fn_dia_util(d)) then
      insert into public.lancamentos (data, valor, categoria_id, conta_id, descricao, status, recorrencia_id)
      values (d, r.valor, r.categoria_id, r.conta_id, r.descricao, 'PREVISTO', r.id);
      n := n + 1;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end $$;
revoke execute on function public.fn_gerar_recorrencia(bigint) from public, anon;
grant execute on function public.fn_gerar_recorrencia(bigint) to authenticated;

-- os previstos que já estão em dia não útil vão para o próximo dia útil (o gatilho acima faz a conta)
update public.lancamentos set status = status
 where status = 'PREVISTO' and excluido_em is null and data <> public.fn_dia_util(data);
