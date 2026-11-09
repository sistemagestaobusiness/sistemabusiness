// Conciliação: dividir um movimento em vários lançamentos (cartão e crédito de vários clientes) e lista só com linhas ativas.
// Uso: npx vite build -c vite.config.teste.ts && node testes/dividir.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { spawn } from 'node:child_process'

const srv = spawn('npx', ['vite', 'preview', '-c', 'vite.config.teste.ts', '--port', '4179', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const url = 'http://localhost:4179/#conciliacao'
const falhas = []
const ok = (cond, txt) => { console.log((cond ? '✓ ' : '✗ ') + txt); if (!cond) falhas.push(txt) }
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const a = await ctx.newPage()
  await a.goto(url)
  await a.evaluate(() => {
    localStorage.clear()
    const s = {
      contas: [{ id: 1, nome: 'C6', ativa: true, ordem: 1 }],
      categorias: [
        { id: 1, nome: 'Cliente A', tipo: 'ENTRADA', secao: 'Clientes', ordem: 1, arquivada: false, cor: null },
        { id: 2, nome: 'Cliente B', tipo: 'ENTRADA', secao: 'Clientes', ordem: 2, arquivada: false, cor: null },
        { id: 9, nome: 'Cliente Velho', tipo: 'ENTRADA', secao: 'Clientes', ordem: 3, arquivada: true, cor: null },
        { id: 3, nome: 'Despesas Business', tipo: 'SAIDA', secao: 'Pagamentos', ordem: 4, arquivada: false, cor: null },
        { id: 118, nome: 'Prolabore Rodrigo', tipo: 'SAIDA', secao: 'Pagamentos', ordem: 5, arquivada: false, cor: '#FFF2A8' },
        { id: 119, nome: 'Prolabore Ale', tipo: 'SAIDA', secao: 'Pagamentos', ordem: 6, arquivada: false, cor: '#F8C9B4' }],
      lancamentos: [
        { id: 1, data: '2026-10-10', valor: 4000, categoria_id: 1, status: 'PREVISTO', versao: 1, excluido_em: null },
        { id: 2, data: '2026-10-12', valor: 2000, categoria_id: 2, status: 'PREVISTO', versao: 1, excluido_em: null }],
      extrato_linhas: [
        { id: 1, conta_id: 1, fitid: 'f1', data: '2026-10-14', valor: -1788.2, descricao: 'CARTOES CAIXA VISA PJ', lancamento_id: null, ignorada: false, dividida: false },
        { id: 2, conta_id: 1, fitid: 'f2', data: '2026-10-13', valor: 6090.37, descricao: 'Ref. Liq. Boleto Comp Externo', lancamento_id: null, ignorada: false, dividida: false }],
    }
    for (const [t, v] of Object.entries(s)) localStorage.setItem('sim_' + t, JSON.stringify(v))
  })
  await a.reload()
  const b = await ctx.newPage(); await b.goto(url)
  const credito = (p) => p.locator('tr', { hasText: 'Ref. Liq. Boleto' })
  const cartao = (p) => p.locator('tr', { hasText: 'CARTOES CAIXA' })
  await credito(a).waitFor()
  const opcoes = await credito(a).locator('select option').allTextContents()
  ok(!opcoes.some((o) => o.includes('Cliente Velho')), 'lista de linhas só com as ativas')

  // cartão: Business + Rodrigo + Alexandre
  await cartao(a).locator('text=dividir').click()
  const partes = cartao(a).locator('.parte')
  await partes.nth(0).locator('select').selectOption({ label: 'Despesas Business' })
  await partes.nth(0).locator('input.valor').fill('1000')
  await partes.nth(1).locator('select').selectOption({ label: 'Prolabore Rodrigo' })
  await partes.nth(1).locator('input.valor').fill('500,10')
  ok(await cartao(a).locator('text=falta 288,10').count() === 1, 'mostra quanto falta para fechar')
  ok(await cartao(a).locator('button:has-text("Conciliar dividido")').isDisabled(), 'não deixa gravar sem fechar')
  await cartao(a).locator('text=+ parte').click()
  await partes.nth(2).locator('select').selectOption({ label: 'Prolabore Ale' })
  ok(await partes.nth(2).locator('input.valor').inputValue() === '288,10', 'parte nova já vem com o que falta')
  await cartao(a).locator('button:has-text("Conciliar dividido")').click()
  await cartao(b).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
  ok(await cartao(b).count() === 0, 'cartão dividido saiu dos pendentes (também na outra janela)')

  // crédito: 2 previstos de clientes + diferença
  await credito(a).locator('text=dividir').click()
  await credito(a).locator('button.chip', { hasText: 'Cliente A' }).click()
  await credito(a).locator('button.chip', { hasText: 'Cliente B' }).click()
  ok(await credito(a).locator('text=falta 90,37').count() === 1, 'previstos dos clientes entram como partes')
  await credito(a).locator('text=+ parte').click()
  const p3 = credito(a).locator('.parte').nth(2)
  await p3.locator('select').selectOption({ label: 'Cliente B' })
  await p3.locator('input[placeholder^="descrição"]').fill('juros')
  await a.screenshot({ path: 'testes/dividir.png' })
  await credito(a).locator('button:has-text("Conciliar dividido")').click()
  await credito(a).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
  const ls = await a.evaluate(() => JSON.parse(localStorage.getItem('sim_lancamentos')))
  ok(ls.filter((l) => l.status === 'CONCILIADO').length === 6, 'cartão virou 3 lançamentos e o crédito usou os 2 previstos + 1 novo')
  ok(ls.find((l) => l.id === 1).status === 'CONCILIADO' && ls.find((l) => l.id === 1).data === '2026-10-13', 'previsto do cliente ficou conciliado na data do extrato')
  await a.click('text=ver conciliadas e ignoradas')
  ok(await a.locator('text=dividida em vários lançamentos').count() === 2, 'aparece em "conciliadas" como dividida')
} catch (e) { falhas.push(String(e)); console.log('✗ ' + e) } finally { await browser.close(); srv.kill() }
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo.')
process.exit(falhas.length ? 1 : 0)
