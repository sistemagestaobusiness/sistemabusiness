-- Sistema Business · limpeza das cópias criadas por clique repetido em "criar e conciliar" / "é pró-labore"
-- Cópia = lançamento REALIZADO, criado a partir de 08/11/2026, sem ligação com o extrato,
-- que tem um gêmeo CONCILIADO (mesma data, valor, linha do fluxo, conta e descrição).
-- Nada é apagado: as cópias vão para a lixeira (excluido_em) e ficam na auditoria.

-- 1) Conferir antes: lista as cópias que serão enviadas para a lixeira
select l.id, to_char(l.data, 'DD/MM/YYYY') as data, l.valor, c.nome as linha, l.descricao, l.criado_em
from public.lancamentos l
join public.categorias c on c.id = l.categoria_id
where l.status = 'REALIZADO' and l.excluido_em is null
  and l.criado_em >= '2026-11-08'
  and l.extrato_linha_id is null
  and not exists (select 1 from public.extrato_linhas e where e.lancamento_id = l.id)
  and exists (select 1 from public.lancamentos g
              where g.id <> l.id and g.status = 'CONCILIADO' and g.excluido_em is null
                and g.data = l.data and g.valor = l.valor and g.categoria_id = l.categoria_id
                and g.conta_id is not distinct from l.conta_id and g.descricao is not distinct from l.descricao)
order by l.data, l.id;

-- 2) Enviar para a lixeira (mesmo filtro)
update public.lancamentos l set excluido_em = now()
where l.status = 'REALIZADO' and l.excluido_em is null
  and l.criado_em >= '2026-11-08'
  and l.extrato_linha_id is null
  and not exists (select 1 from public.extrato_linhas e where e.lancamento_id = l.id)
  and exists (select 1 from public.lancamentos g
              where g.id <> l.id and g.status = 'CONCILIADO' and g.excluido_em is null
                and g.data = l.data and g.valor = l.valor and g.categoria_id = l.categoria_id
                and g.conta_id is not distinct from l.conta_id and g.descricao is not distinct from l.descricao);
