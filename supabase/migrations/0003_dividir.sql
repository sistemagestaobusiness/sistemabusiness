-- Sistema Business · 0003 · dividir uma linha do extrato em vários lançamentos
-- Ex.: fatura do cartão Caixa (parte Business, parte Rodrigo, parte Alexandre) ou um crédito que junta pagamentos de vários clientes.
-- A linha dividida fica marcada (dividida = true) e cada lançamento aponta para ela (lancamentos.extrato_linha_id).
-- A conciliação de 1 para 1 continua como antes (extrato_linhas.lancamento_id).

alter table public.extrato_linhas add column dividida boolean not null default false;
alter table public.lancamentos add column extrato_linha_id bigint references public.extrato_linhas(id);
create index lancamentos_extrato_linha_idx on public.lancamentos (extrato_linha_id) where extrato_linha_id is not null;

-- valor no formato brasileiro (1.234,56) para as mensagens de erro
create or replace function public.fn_moeda(v numeric) returns text language sql immutable set search_path = public as $$
  select translate(to_char(v, 'FM999,999,999,990.00'), ',.', '.,')
$$;
revoke execute on function public.fn_moeda(numeric) from public, anon;
grant execute on function public.fn_moeda(numeric) to authenticated;

-- p_partes: [{"categoria_id": 1, "valor": 100.5, "descricao": "...", "lancamento_id": 123 (opcional: usa um previsto que já existe)}]
create or replace function public.fn_conciliar_dividido(p_linha bigint, p_partes jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare e public.extrato_linhas; p jsonb; k text; soma numeric := 0; n int := 0; v numeric; lid bigint;
begin
  if not public.eh_socio() then raise exception 'Sem permissão'; end if;
  select * into e from public.extrato_linhas where id = p_linha for update;
  if not found then raise exception 'Linha do extrato não existe'; end if;
  if e.lancamento_id is not null or e.dividida then raise exception 'Essa linha do extrato já foi conciliada'; end if;
  if jsonb_typeof(p_partes) <> 'array' or jsonb_array_length(p_partes) < 2 then raise exception 'Divida em pelo menos 2 partes'; end if;

  for p in select * from jsonb_array_elements(p_partes) loop
    v := round((p->>'valor')::numeric, 2);
    if v is null or v <= 0 then raise exception 'Cada parte precisa de um valor maior que zero'; end if;
    soma := soma + v;
    select c.tipo into k from public.categorias c where c.id = (p->>'categoria_id')::bigint;
    if k is null then raise exception 'Linha do fluxo não existe'; end if;
    if (k = 'ENTRADA') <> (e.valor > 0) then
      raise exception 'O extrato é % e uma das partes é %', case when e.valor > 0 then 'crédito' else 'débito' end,
        case when k = 'ENTRADA' then 'entrada' else 'pagamento' end;
    end if;
  end loop;
  if soma <> abs(e.valor) then
    raise exception 'As partes somam % e o extrato é %', public.fn_moeda(soma), public.fn_moeda(abs(e.valor));
  end if;

  for p in select * from jsonb_array_elements(p_partes) loop
    v := round((p->>'valor')::numeric, 2);
    lid := nullif(p->>'lancamento_id', '')::bigint;
    if lid is not null then
      if exists (select 1 from public.extrato_linhas x where x.lancamento_id = lid)
         or exists (select 1 from public.lancamentos l where l.id = lid and (l.extrato_linha_id is not null or l.status = 'CONCILIADO')) then
        raise exception 'Um dos lançamentos escolhidos já está conciliado';
      end if;
      update public.lancamentos set data = e.data, valor = v, categoria_id = (p->>'categoria_id')::bigint, status = 'CONCILIADO',
             conta_id = e.conta_id, extrato_linha_id = e.id, descricao = coalesce(nullif(p->>'descricao', ''), descricao)
       where id = lid and excluido_em is null;
      if not found then raise exception 'Lançamento não existe'; end if;
    else
      insert into public.lancamentos (data, valor, categoria_id, conta_id, descricao, status, extrato_linha_id)
      values (e.data, v, (p->>'categoria_id')::bigint, e.conta_id, coalesce(nullif(p->>'descricao', ''), e.descricao), 'CONCILIADO', e.id);
    end if;
    n := n + 1;
  end loop;
  update public.extrato_linhas set dividida = true, ignorada = false where id = p_linha;
  return n;
end $$;

-- desfazer também vale para linha dividida: os lançamentos continuam, voltam a ser "realizado" e soltam do extrato
create or replace function public.fn_desconciliar(p_linha bigint) returns void
language plpgsql security invoker set search_path = public as $$
declare l bigint;
begin
  if not public.eh_socio() then raise exception 'Sem permissão'; end if;
  select lancamento_id into l from public.extrato_linhas where id = p_linha;
  update public.extrato_linhas set lancamento_id = null, dividida = false where id = p_linha;
  if l is not null then update public.lancamentos set status = 'REALIZADO' where id = l; end if;
  update public.lancamentos set status = 'REALIZADO', extrato_linha_id = null where extrato_linha_id = p_linha;
end $$;

-- conciliar 1 para 1 não pode usar lançamento que já está numa divisão
create or replace function public.fn_conciliar(p_linha bigint, p_lancamento bigint) returns void
language plpgsql security invoker set search_path = public as $$
declare e public.extrato_linhas; k text;
begin
  if not public.eh_socio() then raise exception 'Sem permissão'; end if;
  select * into e from public.extrato_linhas where id = p_linha for update;
  if not found then raise exception 'Linha do extrato não existe'; end if;
  if e.lancamento_id is not null or e.dividida then raise exception 'Essa linha do extrato já foi conciliada'; end if;
  if exists (select 1 from public.extrato_linhas x where x.lancamento_id = p_lancamento)
     or exists (select 1 from public.lancamentos l where l.id = p_lancamento and l.extrato_linha_id is not null) then
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

revoke execute on function public.fn_conciliar_dividido(bigint, jsonb) from public, anon;
grant execute on function public.fn_conciliar_dividido(bigint, jsonb) to authenticated;
revoke execute on function public.fn_conciliar(bigint, bigint), public.fn_desconciliar(bigint) from public, anon;
grant execute on function public.fn_conciliar(bigint, bigint), public.fn_desconciliar(bigint) to authenticated;
