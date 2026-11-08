# Sistema Business · instruções para o Claude

Fluxo de caixa e gestão financeira da Business (Alexandre e Rodrigo; contabilidade só leitura).
React + TypeScript (Vite) nas telas, Supabase (org "Sistema Business", conta contato@) no banco. Textos em português, datas dd/mm/aaaa, valores 1.234,56.

## Regras que não se quebram
- Nunca enviar ao GitHub (push, merge) sem o OK explícito do Alexandre para aquela entrega. Commit local pode.
- O conector do Supabase NÃO enxerga este projeto (fica na org da Drogarema). Mudança de banco = arquivo novo em `supabase/migrations/NNNN_assunto.sql`, que o Alexandre roda no SQL Editor depois de autorizar.
- Testar toda migração antes num Postgres local (stub do schema `auth` + roles `anon`/`authenticated`), incluindo: sócio com 2FA grava, sem 2FA não vê nada, contabilidade só lê, delete negado.

## Atualização automática (o erro da Drogarema não pode voltar)
- TODA leitura de dados nas telas passa por `useAoVivo` (`src/lib/vivo.ts`), declarando as tabelas de que depende. Nunca buscar dados só no carregamento da tela.
- Tabela nova que aparece em tela entra na `publication supabase_realtime` e na lista `TABELAS` de `vivo.ts`.
- Saldo é calculado no banco (`fn_saldo_ate`), nunca só na tela.
- Atualização troca só os dados: não fechar janela aberta nem apagar o que está sendo digitado.
- Edição grava com `.eq('versao', v)`; 0 linhas = alguém alterou antes, avisar.
- Versão nova: o build gera `versao.json`; a tela avisa sozinha (`src/lib/versao.ts`). Não usar `?v=` manual.

## Banco
- Tudo com RLS; `pode_ler()` / `eh_socio()` exigem 2FA (aal2). Nada de `using (true)`, nada para `anon`.
- Sem delete: lixeira por `excluido_em`. Auditoria por trigger em toda tabela.
- Função nova: `set search_path = public`; `revoke execute ... from public, anon; grant ... to authenticated`.

## Testar antes de entregar
- `npm run build` e `npx oxlint`.
- Duas janelas (obrigatório): `npx vite build -c vite.config.teste.ts && node testes/duas-janelas.mjs`. Usa um Supabase simulado (`testes/supabase-simulado.ts`) em que as duas janelas dividem os dados e se avisam como o Realtime.
- Banco: rodar as migrações num Postgres local com stub de `auth` e testar as regras de acesso.

## Importação da planilha
`python3 -I scripts/importar_planilha.py PLANILHA.xlsx SAIDA.sql --realizado-ate AAAA-MM-DD` gera o SQL e confere o saldo de cada mês com a linha Saldo da planilha. A saída tem nomes de clientes: nunca versionar (está no .gitignore).
Cores da planilha: linha 118 amarela = pró-labore Rodrigo, linha 119 salmão = pró-labore Alexandre (não é "previsto").
