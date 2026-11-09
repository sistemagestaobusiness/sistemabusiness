-- Sistema Business · cria o controle pessoal de uma pessoa (só ela vê)
-- Rodar DEPOIS da migração 0006_espacos e de as telas novas estarem no ar.
-- Troque EMAIL_DO_DONO pelo e-mail de login da pessoa e o nome do espaço, se quiser.
with novo as (
  insert into public.espacos (nome)
  select 'Pessoal Alexandre' where not exists (select 1 from public.espacos where nome = 'Pessoal Alexandre') -- rodar 2x não duplica
  returning id
)
insert into public.espaco_membros (espaco_id, user_id, papel)
select novo.id, u.id, 'SOCIO' from novo join auth.users u on lower(u.email) = lower('EMAIL_DO_DONO');

-- conferência: o espaço novo com UM membro (o dono)
select e.id, e.nome, u.email, m.papel
from public.espacos e join public.espaco_membros m on m.espaco_id = e.id join auth.users u on u.id = m.user_id
order by e.id, u.email;
