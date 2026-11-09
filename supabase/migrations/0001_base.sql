-- Sistema Business · 0001 · estrutura base
-- Aplicada pela rotina do GitHub (.github/workflows/banco.yml) numa transação só (psql -1).
-- Princípios: tudo fechado por padrão (RLS), nada é apagado de verdade (excluido_em),
-- toda alteração fica na auditoria, e o banco avisa as telas em tempo real (publication supabase_realtime).


-- ---------------------------------------------------------------- perfis
create table public.perfis (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nome      text not null,
  papel     text not null check (papel in ('SOCIO', 'CONTABILIDADE')),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create or replace function public.papel_atual() returns text
language sql stable security definer set search_path = public as $$
  select p.papel from public.perfis p where p.user_id = auth.uid() and p.ativo
$$;

create or replace function public.pode_ler() returns boolean
language sql stable security definer set search_path = public as $$
  select public.papel_atual() in ('SOCIO', 'CONTABILIDADE')
$$;

create or replace function public.eh_socio() returns boolean
language sql stable security definer set search_path = public as $$
  select public.papel_atual() = 'SOCIO'
$$;

revoke execute on function public.papel_atual(), public.pode_ler(), public.eh_socio() from public, anon;
grant execute on function public.papel_atual(), public.pode_ler(), public.eh_socio() to authenticated;

-- ---------------------------------------------------------------- cadastros
create table public.contas (
  id            bigint generated always as identity primary key,
  nome          text not null,                       -- C6, CEF, Dinheiro
  saldo_inicial numeric(14,2) not null default 0,
  data_inicial  date not null,                       -- saldo_inicial vale no começo deste dia
  ativa         boolean not null default true,
  ordem         int not null default 0
);

create table public.clientes (
  id             bigint generated always as identity primary key,
  nome           text not null,
  documento      text,                               -- CPF/CNPJ
  contato        text,
  email          text,
  telefone       text,
  forma_cobranca text not null default 'BOLETO' check (forma_cobranca in ('BOLETO', 'TRANSFERENCIA', 'PIX')),
  situacao       text not null default 'ATIVO' check (situacao in ('ATIVO', 'ENCERRADO')),
  obs            text,
  criado_em      timestamptz not null default now()
);

create table public.fornecedores (
  id        bigint generated always as identity primary key,
  nome      text not null,
  documento text,
  obs       text,
  ativo     boolean not null default true
);

-- linhas do fluxo (uma linha por cliente/serviço ou por tipo de pagamento)
create table public.categorias (
  id            bigint generated always as identity primary key,
  nome          text not null,
  tipo          text not null check (tipo in ('ENTRADA', 'SAIDA')),
  secao         text not null,                       -- Clientes, BPO, Outros, Pagamentos, Dívidas
  ordem         int not null default 0,
  cliente_id    bigint references public.clientes(id),
  fornecedor_id bigint references public.fornecedores(id),
  arquivada     boolean not null default false,      -- some da grade, continua no saldo
  cor           text                                 -- destaque da linha (ex.: pró-labore)
);

create table public.recorrencias (
  id            bigint generated always as identity primary key,
  descricao     text,
  categoria_id  bigint not null references public.categorias(id),
  conta_id      bigint references public.contas(id),
  valor         numeric(14,2) not null check (valor > 0),
  dia           int not null check (dia between 1 and 31),
  inicio        date not null,
  fim           date,
  ativa         boolean not null default true
);

-- ---------------------------------------------------------------- lançamentos
create table public.lancamentos (
  id             bigint generated always as identity primary key,
  data           date not null,
  valor          numeric(14,2) not null check (valor <> 0),  -- o sinal vem da categoria; negativo = estorno
  categoria_id   bigint not null references public.categorias(id),
  conta_id       bigint references public.contas(id),
  cliente_id     bigint references public.clientes(id),
  fornecedor_id  bigint references public.fornecedores(id),
  descricao      text,
  status         text not null default 'PREVISTO' check (status in ('PREVISTO', 'REALIZADO', 'CONCILIADO')),
  recorrencia_id bigint references public.recorrencias(id),
  versao         int not null default 1,             -- edição ao mesmo tempo: update só se a versão bater
  excluido_em    timestamptz,                        -- lixeira
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now(),
  alterado_por   uuid,
  alterado_em    timestamptz
);
create index lancamentos_data_idx on public.lancamentos (data) where excluido_em is null;
create index lancamentos_categoria_idx on public.lancamentos (categoria_id);

create or replace function public.tg_lancamento_versao() returns trigger
language plpgsql set search_path = public as $$
begin
  new.versao := old.versao + 1;
  new.alterado_por := auth.uid();
  new.alterado_em := now();
  new.criado_por := old.criado_por;
  new.criado_em := old.criado_em;
  return new;
end $$;
create trigger lancamentos_versao before update on public.lancamentos
  for each row execute function public.tg_lancamento_versao();

-- saldo de todas as contas no começo do dia p_data (o saldo é sempre do banco, nunca só da tela)
create or replace function public.fn_saldo_ate(p_data date) returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce((select sum(c.saldo_inicial) from public.contas c where c.data_inicial <= p_data), 0)
       + coalesce((select sum(case when k.tipo = 'ENTRADA' then l.valor else -l.valor end)
                     from public.lancamentos l join public.categorias k on k.id = l.categoria_id
                    where l.excluido_em is null and l.data < p_data), 0)
$$;
revoke execute on function public.fn_saldo_ate(date) from public, anon;
grant execute on function public.fn_saldo_ate(date) to authenticated;

-- ajuste em massa (tela Lançamentos). security invoker: valem as regras de acesso de quem chama (só sócio altera)
create or replace function public.fn_ajuste_massa(
  p_ids bigint[], p_valor numeric default null, p_percentual numeric default null,
  p_dias int default null, p_categoria bigint default null, p_status text default null, p_excluir boolean default false
) returns int language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if not public.eh_socio() then raise exception 'Sem permissão'; end if;
  update public.lancamentos l set
    valor        = coalesce(p_valor, case when p_percentual is not null then round(l.valor * (1 + p_percentual / 100), 2) end, l.valor),
    data         = l.data + coalesce(p_dias, 0),
    categoria_id = coalesce(p_categoria, l.categoria_id),
    status       = coalesce(p_status, l.status),
    excluido_em  = case when p_excluir then now() else l.excluido_em end
  where l.id = any(p_ids) and l.excluido_em is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.fn_ajuste_massa(bigint[], numeric, numeric, int, bigint, text, boolean) from public, anon;
grant execute on function public.fn_ajuste_massa(bigint[], numeric, numeric, int, bigint, text, boolean) to authenticated;

-- projeção recorrente: cria os lançamentos PREVISTOS de uma recorrência, mês a mês, de inicio até fim
-- (sem fim: 24 meses). Não duplica mês que já tem lançamento dessa recorrência.
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
        and date_trunc('month', l.data) = m) then
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

-- ---------------------------------------------------------------- auditoria
create table public.auditoria (
  id          bigint generated always as identity primary key,
  tabela      text not null,
  registro_id text,
  acao        text not null,
  antes       jsonb,
  depois      jsonb,
  usuario     uuid default auth.uid(),
  em          timestamptz not null default now()
);

create or replace function public.tg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria (tabela, registro_id, acao, antes, depois)
  values (tg_table_name,
          coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id')),
          tg_op,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['contas','clientes','fornecedores','categorias','recorrencias','lancamentos','perfis'] loop
    execute format('create trigger %I_auditoria after insert or update or delete on public.%I for each row execute function public.tg_auditoria()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- acesso (RLS)
do $$
declare t text;
begin
  foreach t in array array['contas','clientes','fornecedores','categorias','recorrencias','lancamentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.pode_ler())', t || '_ler', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.eh_socio())', t || '_incluir', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.eh_socio()) with check (public.eh_socio())', t || '_alterar', t);
    -- sem política de delete: nada é apagado pela tela
  end loop;
end $$;

alter table public.perfis enable row level security;
revoke all on public.perfis from anon, authenticated;
grant select on public.perfis to authenticated;
create policy perfis_ler on public.perfis for select to authenticated using (user_id = auth.uid() or public.eh_socio());

alter table public.auditoria enable row level security;
revoke all on public.auditoria from anon, authenticated;
grant select on public.auditoria to authenticated;
create policy auditoria_ler on public.auditoria for select to authenticated using (public.eh_socio());

-- ---------------------------------------------------------------- tempo real
alter publication supabase_realtime add table
  public.contas, public.clientes, public.fornecedores, public.categorias, public.recorrencias, public.lancamentos;
