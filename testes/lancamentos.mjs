// Tela Lançamentos: novo lançamento, edição ao clicar, caixinha só seleciona. Duas janelas, como o Realtime.
// Uso: npx vite build -c vite.config.teste.ts && node testes/lancamentos.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { spawn } from 'node:child_process'

const srv = spawn('npx', ['vite', 'preview', '-c', 'vite.config.teste.ts', '--port', '4176', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const url = 'http://localhost:4176/#lancamentos'
const falhas = []
const ok = (cond, txt) => { console.log((cond ? '✓ ' : '✗ ') + txt); if (!cond) falhas.push(txt) }
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const a = await ctx.newPage()
  await a.goto(url)
  await a.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sim_categorias', JSON.stringify([
      { id: 1, nome: 'Cliente Teste', tipo: 'ENTRADA', secao: 'Clientes', ordem: 1, arquivada: false, cor: null },
      { id: 3, nome: 'Aluguel', tipo: 'SAIDA', secao: 'Pagamentos', ordem: 3, arquivada: false, cor: null },
      { id: 4, nome: 'Cliente Antigo', tipo: 'ENTRADA', secao: 'Clientes', ordem: 4, arquivada: true, cor: null },
    ]))
    const hoje = new Date().toISOString().slice(0, 10)
    localStorage.setItem('sim_lancamentos', JSON.stringify([
      { id: 900, data: hoje, valor: 100, categoria_id: 1, descricao: 'receita teste', status: 'PREVISTO', versao: 1, recorrencia_id: null, excluido_em: null },
      { id: 901, data: hoje, valor: 50, categoria_id: 4, descricao: 'receita antiga', status: 'PREVISTO', versao: 1, recorrencia_id: null, excluido_em: null },
    ]))
  })
  await a.reload()
  const b = await ctx.newPage(); await b.goto(url)
  await a.waitForSelector('text=+ Novo lançamento')

  const d = new Date(); d.setDate(d.getDate() + 5)
  const iso = d.toISOString().slice(0, 10)
  await a.click('text=+ Novo lançamento')
  await a.fill('.janela input[type=date]', iso)
  ok(await a.inputValue('.janela select >> nth=1') === 'PREVISTO', 'data futura sugere "previsto"')
  await a.selectOption('.janela select >> nth=0', { label: 'Aluguel' })
  await a.fill('.janela input[placeholder^="1.234,56"]', '2.345,67')
  await a.fill('.janela label:has-text("Descrição") input', 'aluguel sala')
  await a.click('.janela >> text=Salvar')
  await a.locator('.janela').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
  ok(await a.locator('.janela').count() === 0, 'salvou e fechou a janela')
  await b.locator('tr', { hasText: 'aluguel sala' }).waitFor({ timeout: 3000 }).catch(() => {})
  ok(await b.locator('tr', { hasText: 'aluguel sala' }).count() === 1, 'lançamento novo apareceu sozinho na outra janela')

  await b.locator('tr', { hasText: 'aluguel sala' }).locator('td').first().click()
  ok(await b.locator('.janela').count() === 0 && await b.locator('text=1 selecionados').count() === 1, 'caixinha só seleciona (não abre)')
  await b.locator('tr', { hasText: 'aluguel sala' }).locator('td').nth(3).click()
  ok(await b.inputValue('.janela input[placeholder^="1.234,56"]') === '2.345,67', 'clicar no lançamento abre para editar')
  await b.fill('.janela input[placeholder^="1.234,56"]', '2500')
  await b.click('.janela >> text=Salvar')
  const linhaA = a.locator('tbody tr', { hasText: 'aluguel sala' })
  await a.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((t) => t.textContent.includes('aluguel sala') && t.textContent.includes('2.500,00')), null, { timeout: 3000 }).catch(() => {})
  ok((await linhaA.textContent()).includes('2.500,00'), 'edição apareceu sozinha na outra janela')

  // filtros: só linhas ativas por padrão e Tipo crédito/débito, ao vivo
  const opcoes = async (p) => p.locator('.filtros').first().locator('label:has-text("Linha do fluxo") option').allTextContents()
  ok(!(await opcoes(b)).some((t) => t.includes('Cliente Antigo')), 'linha arquivada não aparece no filtro por padrão')
  ok(await b.locator('tbody tr', { hasText: 'receita antiga' }).count() === 0, 'lançamento de linha arquivada escondido por padrão')
  await b.check('.filtros .check input')
  ok((await opcoes(b)).some((t) => t.includes('Cliente Antigo (arquivada)')) && await b.locator('tbody tr', { hasText: 'receita antiga' }).count() === 1, '"mostrar arquivadas" traz a linha e o lançamento')
  await b.uncheck('.filtros .check input')
  await b.selectOption('.filtros label:has-text("Tipo") select', 'SAIDA')
  ok(await b.locator('tbody tr', { hasText: 'receita teste' }).count() === 0 && await b.locator('tbody tr', { hasText: 'aluguel sala' }).count() === 1, 'Tipo débito mostra só pagamentos')
  ok(!(await opcoes(b)).some((t) => t.includes('Cliente Teste')), 'Tipo débito tira as linhas de entrada do filtro')
  ok(await b.locator('tbody tr', { hasText: 'aluguel sala' }).locator('td').nth(3).textContent() === 'débito', 'coluna Tipo diz débito')
  await b.selectOption('.filtros label:has-text("Tipo") select', 'ENTRADA')
  ok(await b.locator('tbody tr', { hasText: 'receita teste' }).count() === 1 && await b.locator('tbody tr', { hasText: 'aluguel sala' }).count() === 0, 'Tipo crédito mostra só entradas')
  // outra janela, em OUTRA tela, arquiva a linha: some da lista de quem está em Lançamentos sem recarregar
  const c = await ctx.newPage(); await c.goto(url.replace('#lancamentos', '#cadastros')); await c.click('text=Linhas do fluxo')
  await c.locator('tr', { hasText: 'Cliente Teste' }).locator('text=arquivar').click()
  await b.locator('tbody tr', { hasText: 'receita teste' }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
  ok(await b.locator('tbody tr', { hasText: 'receita teste' }).count() === 0, 'linha arquivada em Cadastros some na hora da tela Lançamentos aberta')
  await b.selectOption('.filtros label:has-text("Tipo") select', '')
  await b.screenshot({ path: 'testes/lancamentos-filtros.png' })
  await a.screenshot({ path: 'testes/lancamentos.png' })
} catch (e) { falhas.push(String(e)); console.log('✗ ' + e) } finally { await browser.close(); srv.kill() }
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo.')
process.exit(falhas.length ? 1 : 0)
