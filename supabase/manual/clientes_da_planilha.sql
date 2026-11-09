-- Sistema Business · cadastro de clientes a partir das linhas do fluxo (seções Clientes e BPO), com o nome igual ao da planilha.
-- Pode rodar mais de uma vez: só cria o cliente que ainda não existe (mesmo nome) e só liga a linha que ainda não tem cliente.
-- Linha arquivada (escondida na planilha) vira cliente ENCERRADO; o resto, ATIVO. Cobrança fica BOLETO (padrão): ajustar na tela.
insert into public.clientes (nome, situacao)
select min(trim(k.nome)), case when bool_and(k.arquivada) then 'ENCERRADO' else 'ATIVO' end
  from public.categorias k
 where k.tipo = 'ENTRADA' and k.secao in ('Clientes', 'BPO') and upper(trim(k.nome)) <> 'BPO'
   and not exists (select 1 from public.clientes c where lower(trim(c.nome)) = lower(trim(k.nome)))
 group by lower(trim(k.nome));

update public.categorias k set cliente_id = c.id
  from public.clientes c
 where k.cliente_id is null and k.tipo = 'ENTRADA' and k.secao in ('Clientes', 'BPO')
   and lower(trim(c.nome)) = lower(trim(k.nome));

-- conferência
select situacao, count(*) as clientes from public.clientes group by situacao
union all
select 'linhas do fluxo sem cliente', count(*) from public.categorias
 where tipo = 'ENTRADA' and secao in ('Clientes', 'BPO') and upper(trim(nome)) <> 'BPO' and cliente_id is null;
