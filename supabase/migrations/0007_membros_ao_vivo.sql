-- Sistema Business · 0007 · acesso a espaço também ao vivo
-- Dar ou tirar o acesso de alguém a um espaço aparece na hora para a pessoa (o seletor do topo se atualiza).
-- A RLS de espaco_membros (cada um vê só as próprias linhas) vale também para o tempo real.
alter publication supabase_realtime add table public.espaco_membros;
