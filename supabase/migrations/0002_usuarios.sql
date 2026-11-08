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

-- conferência: deve listar uma linha por pessoa
select p.nome, p.papel, u.email from public.perfis p join auth.users u on u.id = p.user_id;
