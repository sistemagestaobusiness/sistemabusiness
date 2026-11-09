-- Sistema Business · 0002 · quem acessa
-- ANTES: em Authentication > Users > Add user > Create new user, crie o usuário de cada pessoa
-- (e-mail + senha, marcando "Auto Confirm User"). Depois troque os e-mails abaixo e rode.
insert into public.perfis (user_id, nome, papel)
select u.id, x.nome, x.papel
from (values
  ('alexandre.bezerra@businessacf.com.br', 'Alexandre', 'SOCIO'),
  ('EMAIL_DO_RODRIGO', 'Rodrigo', 'SOCIO')
  -- , ('EMAIL_DA_CONTABILIDADE', 'Contabilidade', 'CONTABILIDADE')
) x(email, nome, papel)
join auth.users u on lower(u.email) = lower(x.email)
on conflict (user_id) do update set nome = excluded.nome, papel = excluded.papel, ativo = true;

-- quem entra acima acessa a Business (espaço 1) com o mesmo papel; controles pessoais são à parte (espaco_pessoal.sql)
insert into public.espaco_membros (espaco_id, user_id, papel)
select 1, p.user_id, p.papel from public.perfis p
on conflict (espaco_id, user_id) do update set papel = excluded.papel;

-- conferência: deve listar uma linha por pessoa
select p.nome, p.papel, u.email from public.perfis p join auth.users u on u.id = p.user_id;
