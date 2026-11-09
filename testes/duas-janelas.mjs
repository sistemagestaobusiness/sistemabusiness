// Teste obrigatório antes de cada entrega: duas janelas abertas, lança numa, a outra muda sozinha.
// Uso: npx vite build -c vite.config.teste.ts && node testes/duas-janelas.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { spawn } from 'node:child_process'

const srv = spawn('npx', ['vite', 'preview', '-c', 'vite.config.teste.ts', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const url = 'http://localhost:4173/#fluxo'
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
      { id: 2, nome: 'Cliente Antigo', tipo: 'ENTRADA', secao: 'Clientes', ordem: 2, arquivada: true, cor: null },
      { id: 3, nome: 'Prolabore Rodrigo', tipo: 'SAIDA', secao: 'Pagamentos', ordem: 3, arquivada: false, cor: '#FFF2A8' },
    ]))
    const d = new Date(); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    localStorage.setItem('sim_lancamentos', JSON.stringify([{ id: 1, data: iso.slice(0, 8) + '01', valor: 100, categoria_id: 2, status: 'CONCILIADO', versao: 1, excluido_em: null }]))
  })
  await a.reload()
  const b = await ctx.newPage()
  await b.goto(url)
  await a.waitForSelector('text=Cliente Teste'); await b.waitForSelector('text=Cliente Teste')
  ok(await b.locator('text=● ao vivo').count() === 1, 'indicador "ao vivo" na janela B')
  ok(await a.locator('text=Cliente Antigo').count() === 0, 'linha arquivada não aparece no fluxo')
  ok((await a.locator('tr', { hasText: 'Arquivadas (somadas)' }).textContent()).includes('100,00'), 'movimento da arquivada aparece somado (o total continua batendo)')
  await a.click('text=mostrar arquivadas')
  ok(await a.locator('text=Cliente Antigo').count() === 1 && await a.locator('text=Arquivadas (somadas)').count() === 0, '"mostrar arquivadas" mostra a linha e tira a soma')
  await a.click('text=mostrar arquivadas')

  // B abre a mesma célula que A vai lançar e começa a digitar
  const celula = (p) => p.locator('tr', { hasText: 'Cliente Teste' }).locator('td.cel').nth(9)
  await celula(b).click()
  await b.fill('input[placeholder^="1.234,56"]', '77')
  const saldoAntes = await b.locator('tr.saldo td').last().textContent()

  await celula(a).click()
  await a.fill('input[placeholder^="1.234,56"]', '=1000+234,56')
  await a.click('text=Salvar')
  const t0 = Date.now()
  await b.locator('.janela .lista li', { hasText: '1.234,56' }).waitFor({ timeout: 3000 }).catch(() => {})
  const ms = Date.now() - t0
  ok(await b.locator('.janela .lista li', { hasText: '1.234,56' }).count() === 1, `janela aberta em B recebeu o lançamento de A (${ms} ms)`)
  ok(await b.inputValue('input[placeholder^="1.234,56"]') === '77', 'o que B estava digitando continuou lá')
  ok(await b.locator('.janela').count() === 1, 'a janela de B não fechou')
  await b.click('text=Fechar')
  ok((await celula(b).textContent()).includes('1.234,56'), 'célula da grade em B atualizada sem recarregar')
  ok((await b.locator('tr.saldo td').last().textContent()) !== saldoAntes, 'saldo em B mudou sozinho')

  // edição ao mesmo tempo: A e B abrem o mesmo lançamento, A salva primeiro, B é avisado
  await celula(a).click(); await a.click('.janela .lista li >> text=editar')
  await celula(b).click(); await b.click('.janela .lista li >> text=editar')
  await a.fill('input[placeholder^="1.234,56"]', '2000'); await a.click('text=Salvar')
  await b.waitForTimeout(400)
  await b.fill('input[placeholder^="1.234,56"]', '3000'); await b.click('text=Salvar')
  await b.locator('text=alterado por outra pessoa').waitFor({ timeout: 3000 }).catch(() => {})
  ok(await b.locator('text=alterado por outra pessoa').count() === 1, 'edição ao mesmo tempo: B foi avisado em vez de sobrescrever A')

  // visão por mês: B olha o ano fechado, A lança no dia a dia, o total do mês muda sozinho em B
  await b.click('.janela >> text=Fechar')
  await b.click('.alternar >> text=Meses')
  const mesB = b.locator('tr', { hasText: 'Cliente Teste' }).locator('td.cel').nth(0)
  await mesB.waitFor()
  ok((await mesB.textContent()).includes('2.000,00'), 'visão por mês soma o mês')
  await celula(a).click()
  await a.fill('input[placeholder^="1.234,56"]', '500'); await a.click('text=Salvar')
  await b.waitForFunction(() => [...document.querySelectorAll('tr')].some((t) => t.textContent.includes('Cliente Teste') && t.textContent.includes('2.500,00')), null, { timeout: 3000 }).catch(() => {})
  ok((await mesB.textContent()).includes('2.500,00'), 'visão por mês em B atualizou sozinha')
  await b.screenshot({ path: 'testes/fluxo-meses.png' })
  await mesB.click()
  await celula(b).waitFor({ timeout: 3000 }).catch(() => {})
  ok(await b.locator('.alternar button.ativo', { hasText: 'Dias' }).count() === 1 && await celula(b).count() === 1, 'clique no mês abre o dia a dia daquele mês')

  await a.screenshot({ path: 'testes/fluxo.png' })
} finally {
  await browser.close(); srv.kill()
}
if (falhas.length) { console.log(`\n${falhas.length} falha(s)`); process.exit(1) } else console.log('\nTudo certo.')
