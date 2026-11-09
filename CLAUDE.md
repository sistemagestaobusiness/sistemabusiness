# Sistema Business · instruções para o Claude

Fluxo de caixa e gestão financeira da Business (Alexandre e Rodrigo; contabilidade só leitura).
React + TypeScript (Vite) nas telas, Supabase (org "Sistema Business", conta contato@) no banco. Textos em português, datas dd/mm/aaaa, valores 1.234,56.

## Regras que não se quebram
- Nunca enviar ao GitHub (push, merge) sem o OK explícito do Alexandre para aquela entrega. Commit local pode.
- O conector do Supabase NÃO enxerga este projeto (fica na org da Drogarema). Mudança de banco = arquivo novo em `supabase/migrations/NNNN_assunto.sql` (sem begin/commit), entregue também em /mnt/project-files/sistema-business/sql/ envolvido em begin/commit; o Alexandre roda à mão no SQL Editor (decisão de 09/11/2026). Script com dado pessoal ou que depende de edição à mão vai em `supabase/manual/`.
- Acesso diário que impede a pausa do plano grátis: `.github/workflows/manter-ativo.yml` (só variáveis públicas). Backup é manual: `.github/workflows/backup.yml` (precisa dos segredos SUPABASE_DB_URL e BACKUP_SENHA), botão Run workflow. O arquivo sai criptografado (gpg AES256): o repositório pode ficar público, então BACKUP_SENHA precisa ser forte.
- Site: GitHub Pages pelo `.github/workflows/publicar.yml` a cada envio para a main (repositório público para o Pages grátis: nunca versionar dado de cliente). `base: './'` no Vite.
- Testar toda migração antes num Postgres local (stub do schema `auth` + roles `anon`/`authenticated`), incluindo: sócio grava, usuário sem perfil não vê nada, contabilidade só lê, delete negado.

## Atualização automática (o erro da Drogarema não pode voltar)
- TODA leitura de dados nas telas passa por `useAoVivo` (`src/lib/vivo.ts`), declarando as tabelas de que depende. Nunca buscar dados só no carregamento da tela.
- Tabela nova que aparece em tela entra na `publication supabase_realtime` e na lista `TABELAS` de `vivo.ts`.
- Saldo é calculado no banco (`fn_saldo_ate`; saldo do extrato: `fn_saldo_banco`), nunca só na tela.
- Atualização troca só os dados: não fechar janela aberta nem apagar o que está sendo digitado.
- Edição grava com `.eq('versao', v)`; 0 linhas = alguém alterou antes, avisar.
- Versão nova: o build gera `versao.json`; a tela avisa sozinha (`src/lib/versao.ts`). Não usar `?v=` manual.

## Banco
- Espaços (0006): Business = espaço 1; controle pessoal do Alexandre é outro espaço que o Rodrigo NÃO pode ver. Toda tabela de dados tem `espaco_id`; RLS por `pode_ler_espaco(espaco_id)` / `eh_socio_espaco(espaco_id)` (tabela `espaco_membros` + `perfis.ativo`). Toda leitura nas telas filtra `.eq('espaco_id', espacoId())` e todo insert de conta/cliente/linha manda `espaco_id`; lançamento, projeção e extrato herdam o espaço por gatilho. Testar sempre que um sócio da Business não vê nada do pessoal (inclusive auditoria e saldos).
- Tudo com RLS por espaço (acima) e papel na tabela `perfis`. Login só com e-mail e senha, sem 2FA (decisão do Alexandre, 08/11/2026), e saída após 30 min sem uso (`useInatividade`). Nada de `using (true)`, nada para `anon`.
- Sem delete: lixeira por `excluido_em`. Auditoria por trigger em toda tabela.
- Função nova: `set search_path = public`; `revoke execute ... from public, anon; grant ... to authenticated`.

## Testar antes de entregar
- `npm run build` e `npx oxlint`.
- Duas janelas (obrigatório): `npx vite build -c vite.config.teste.ts && node testes/duas-janelas.mjs`. Usa um Supabase simulado (`testes/supabase-simulado.ts`) em que as duas janelas dividem os dados e se avisam como o Realtime.
- Senha, Lançamentos, Conciliação dividida, Saldo no banco e Espaços: `node testes/senha.mjs`, `node testes/lancamentos.mjs`, `node testes/dividir.mjs`, `node testes/saldo-banco.mjs` e `node testes/espacos.mjs` (depois do mesmo build de teste).
- Banco: rodar as migrações num Postgres local com stub de `auth` e testar as regras de acesso.

## Importação da planilha
`python3 -I scripts/importar_planilha.py PLANILHA.xlsx SAIDA.sql --realizado-ate AAAA-MM-DD` gera o SQL e confere o saldo de cada mês com a linha Saldo da planilha. A saída tem nomes de clientes: nunca versionar (está no .gitignore).
Cores da planilha: linha 118 amarela = pró-labore Rodrigo, linha 119 salmão = pró-labore Alexandre (não é "previsto").
