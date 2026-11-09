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
    ]))
    localStorage.setItem('sim_lancamentos', '[]')
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
  await a.screenshot({ path: 'testes/lancamentos.png' })
} catch (e) { falhas.push(String(e)); console.log('✗ ' + e) } finally { await browser.close(); srv.kill() }
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo.')
process.exit(falhas.length ? 1 : 0)
