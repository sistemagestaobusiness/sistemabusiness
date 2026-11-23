-- Sistema Business · 0008 · editar projeção recorrente
-- Uma projeção já criada pode ser editada na tela (linha, valor, dia, descrição, início, fim ou parcelas).
-- A mudança vale para TODAS as parcelas PREVISTAS dela de uma vez, numa transação só.
-- Parcela realizada ou conciliada não muda. Nada é apagado: parcela prevista que sai do período vai para a lixeira.
-- Mês cuja parcela alguém mandou para a lixeira à mão não é recriado.

-- ---------------------------------------------------------------- colunas novas
alter table public.recorrencias add column parcelas int check (parcelas between 1 and 120);
alter table public.recorrencias add column versao int not null default 1;  -- edição ao mesmo tempo: grava só se a versão bater

-- projeções já criadas com parcelas: a quantidade está na descrição das parcelas ("… · parcela 3/18")
update public.recorrencias r set parcelas = x.n
  from (select recorrencia_id, max((regexp_match(descricao, 'parcela [0-9]+/([0-9]+)$'))[1]::int) as n
          from public.lancamentos where recorrencia_id is not null and excluido_em is null group by recorrencia_id) x
 where x.recorrencia_id = r.id and x.n between 1 and 120;

-- ---------------------------------------------------------------- datas das parcelas
-- data da parcela do mês p_mes (dia 31 vira o último dia do mês), antes do ajuste para dia útil
create or replace function public.fn_parcela_data(p_mes date, p_dia int) returns date
language sql immutable set search_path = public as $$
  select date_trunc('month', p_mes)::date
       + (least(p_dia, extract(day from (date_trunc('month', p_mes) + interval '1 month - 1 day'))::int) - 1)
$$;
-- de que mês é a parcela que caiu em p_data (o dia 31 num sábado vira o dia 2 do mês seguinte, mas é do mês anterior)
create or replace function public.fn_parcela_mes(p_data date, p_dia int) returns date
language sql immutable set search_path = public as $$
  select case
    when public.fn_dia_util(public.fn_parcela_data(p_data, p_dia)) = p_data then date_trunc('month', p_data)::date
    when public.fn_dia_util(public.fn_parcela_data((p_data - interval '1 month')::date, p_dia)) = p_data
      then date_trunc('month', p_data - interval '1 month')::date
    else date_trunc('month', p_data)::date end
$$;
revoke execute on function public.fn_parcela_data(date, int), public.fn_parcela_mes(date, int) from public, anon;
grant execute on function public.fn_parcela_data(date, int), public.fn_parcela_mes(date, int) to authenticated;

-- com parcelas, a data final é calculada aqui (mesma regra da tela): a primeira parcela é no mês do início,
-- ou no seguinte se o dia já passou; a última é N-1 meses depois
create or replace function public.tg_recorrencia() returns trigger
language plpgsql set search_path = public as $$
declare primeiro date;
begin
  if tg_op = 'UPDATE' then new.versao := old.versao + 1; end if;
  if new.parcelas is not null then
    primeiro := date_trunc('month', new.inicio)::date;
    if public.fn_parcela_data(primeiro, new.dia) < new.inicio then primeiro := (primeiro + interval '1 month')::date; end if;
    new.fim := public.fn_parcela_data((primeiro + make_interval(months => new.parcelas - 1))::date, new.dia);
  end if;
  if new.fim is not null and new.fim < new.inicio then raise exception 'A data final é antes do início'; end if;
  return new;
end $$;
revoke execute on function public.tg_recorrencia() from public, anon, authenticated;
create trigger recorrencias_regras before insert or update on public.recorrencias
  for each row execute function public.tg_recorrencia();

-- ---------------------------------------------------------------- aplicar a projeção nas parcelas
-- Deixa as parcelas PREVISTAS iguais à projeção: muda data, valor, linha e descrição das que existem,
-- cria as que faltam no período e manda para a lixeira as que ficaram fora dele.
-- p_dia_antigo: dia da projeção antes da edição (para saber de que mês é cada parcela que já existe).
create or replace function public.fn_aplicar_recorrencia(p_id bigint, p_dia_antigo int default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  r public.recorrencias; dia_ant int; m date; ultimo date; d date; i int := 0; descr text;
  feitos bigint[] := '{}'; ids bigint[]; novo bigint;
  alteradas int := 0; criadas int := 0; excluidas int := 0; mantidas int := 0;
begin
  select * into r from public.recorrencias where id = p_id;
  if not found then raise exception 'Projeção % não existe', p_id; end if;
  if not public.eh_socio_espaco(r.espaco_id) then raise exception 'Sem permissão'; end if;
  dia_ant := coalesce(p_dia_antigo, r.dia);

  -- período: mês a mês, do início até o fim (sem fim: 24 meses, como sempre foi)
  m := date_trunc('month', r.inicio)::date;
  if public.fn_parcela_data(m, r.dia) < r.inicio then m := (m + interval '1 month')::date; end if;
  if r.fim is null then
    ultimo := (date_trunc('month', r.inicio) + interval '23 months')::date;
  else
    ultimo := date_trunc('month', r.fim)::date;
    if public.fn_parcela_data(ultimo, r.dia) > r.fim then ultimo := (ultimo - interval '1 month')::date; end if;
  end if;

  -- previstas fora do período: lixeira (e saem da projeção, para poderem voltar se o período aumentar de novo)
  update public.lancamentos l set excluido_em = now(), recorrencia_id = null
   where l.recorrencia_id = r.id and l.excluido_em is null and l.status = 'PREVISTO'
     and (public.fn_parcela_mes(l.data, dia_ant) < m or public.fn_parcela_mes(l.data, dia_ant) > ultimo);
  get diagnostics excluidas = row_count;

  while m <= ultimo loop
    i := i + 1;
    d := public.fn_parcela_data(m, r.dia);
    descr := case when r.parcelas is not null
                  then coalesce(nullif(r.descricao, '') || ' · ', '') || 'parcela ' || i || '/' || r.parcelas
                  else r.descricao end;
    if exists (select 1 from public.lancamentos l where l.recorrencia_id = r.id and l.excluido_em is null
                 and l.status <> 'PREVISTO' and public.fn_parcela_mes(l.data, dia_ant) = m) then
      mantidas := mantidas + 1;  -- já realizada ou conciliada: fica como está
    else
      with u as (
        update public.lancamentos l set data = d, valor = r.valor, categoria_id = r.categoria_id, conta_id = r.conta_id, descricao = descr
         where l.recorrencia_id = r.id and l.excluido_em is null and l.status = 'PREVISTO'
           and public.fn_parcela_mes(l.data, dia_ant) = m and not (l.id = any(feitos))
        returning l.id)
      select coalesce(array_agg(id), '{}') into ids from u;
      if cardinality(ids) > 0 then
        feitos := feitos || ids; alteradas := alteradas + cardinality(ids);
      elsif not exists (select 1 from public.lancamentos l where l.recorrencia_id = r.id and l.excluido_em is not null
                          and public.fn_parcela_mes(l.data, dia_ant) = m) then
        insert into public.lancamentos (data, valor, categoria_id, conta_id, descricao, status, recorrencia_id)
        values (d, r.valor, r.categoria_id, r.conta_id, descr, 'PREVISTO', r.id)
        returning id into novo;
        feitos := feitos || novo; criadas := criadas + 1;
      end if;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  return jsonb_build_object('alteradas', alteradas, 'criadas', criadas, 'excluidas', excluidas, 'mantidas', mantidas);
end $$;
revoke execute on function public.fn_aplicar_recorrencia(bigint, int) from public, anon;
grant execute on function public.fn_aplicar_recorrencia(bigint, int) to authenticated;

-- criar: igual a antes, mas agora também numera as parcelas (1/18, 2/18…) aqui no banco
create or replace function public.fn_gerar_recorrencia(p_id bigint) returns int
language plpgsql security invoker set search_path = public as $$
begin
  return (public.fn_aplicar_recorrencia(p_id) ->> 'criadas')::int;
end $$;
revoke execute on function public.fn_gerar_recorrencia(bigint) from public, anon;
grant execute on function public.fn_gerar_recorrencia(bigint) to authenticated;

-- editar: grava a projeção (só se ninguém mudou desde que a tela abriu) e aplica nas parcelas previstas
create or replace function public.fn_editar_recorrencia(
  p_id bigint, p_versao int, p_categoria bigint, p_valor numeric, p_dia int, p_inicio date,
  p_fim date default null, p_parcelas int default null, p_descricao text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare antes public.recorrencias; v_inicio date := p_inicio; v_fim date := p_fim; m date;
begin
  select * into antes from public.recorrencias where id = p_id;
  if not found then raise exception 'Projeção % não existe', p_id; end if;
  if not public.eh_socio_espaco(antes.espaco_id) then raise exception 'Sem permissão'; end if;
  select * into antes from public.recorrencias where id = p_id for update;  -- trava: duas edições ao mesmo tempo esperam uma à outra
  if antes.versao <> p_versao then
    raise exception 'Esta projeção foi alterada por outra pessoa enquanto você editava. Feche, confira e edite de novo.';
  end if;
  -- só o dia mudou: as parcelas continuam nos mesmos meses (do dia 10 para o dia 25 não pode ganhar um mês
  -- no começo nem perder um no fim). Por isso o início vai para o dia 1 do mês da primeira parcela e o fim
  -- para o último dia do mês da última.
  if p_dia <> antes.dia then
    if p_inicio = antes.inicio then
      m := date_trunc('month', antes.inicio)::date;
      if public.fn_parcela_data(m, antes.dia) < antes.inicio then m := (m + interval '1 month')::date; end if;
      v_inicio := m;
    end if;
    if p_parcelas is null and p_fim = antes.fim then
      m := date_trunc('month', antes.fim)::date;
      if public.fn_parcela_data(m, antes.dia) > antes.fim then m := (m - interval '1 month')::date; end if;
      v_fim := (m + interval '1 month - 1 day')::date;
    end if;
  end if;
  update public.recorrencias set categoria_id = p_categoria, valor = p_valor, dia = p_dia, inicio = v_inicio,
         fim = case when p_parcelas is null then v_fim end, parcelas = p_parcelas, descricao = nullif(trim(p_descricao), '')
   where id = p_id;
  return public.fn_aplicar_recorrencia(p_id, antes.dia);
end $$;
revoke execute on function public.fn_editar_recorrencia(bigint, int, bigint, numeric, int, date, date, int, text) from public, anon;
grant execute on function public.fn_editar_recorrencia(bigint, int, bigint, numeric, int, date, date, int, text) to authenticated;
