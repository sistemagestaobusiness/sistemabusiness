// Saldo do banco no fluxo: informar o saldo do app do banco na Conciliação e ver "Saldo no banco" e "Diferença"
// dia a dia no Fluxo (também na outra janela, sem recarregar).
// Uso: npx vite build -c vite.config.teste.ts && node testes/saldo-banco.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { spawn } from 'node:child_process'

const srv = spawn('npx', ['vite', 'preview', '-c', 'vite.config.teste.ts', '--port', '4180', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const base = 'http://localhost:4180/'
const falhas = []
const ok = (cond, txt) => { console.log((cond ? '✓ ' : '✗ ') + txt); if (!cond) falhas.push(txt) }
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } })
  const a = await ctx.newPage()
  await a.goto(base + '#conciliacao')
  await a.evaluate(() => {
    localStorage.clear()
    // simulado: fn_saldo_ate começa em 1.000,00. Sistema: +500 em 02/10, −200 em 05/10 e −200 a mais (duplicado) em 05/10.
    // Banco: +500 em 02/10 e −200 em 05/10. Logo, a diferença aparece a partir de 05/10.
    const s = {
      contas: [{ id: 1, nome: 'C6', ativa: true, ordem: 1, saldo_banco: null, saldo_banco_em: null }],
      categorias: [
        { id: 1, nome: 'Cliente A', tipo: 'ENTRADA', secao: 'Clientes', ordem: 1, arquivada: false, cor: null },
        { id: 2, nome: 'Plano de Saúde', tipo: 'SAIDA', secao: 'Pagamentos', ordem: 2, arquivada: false, cor: null }],
      lancamentos: [
        { id: 1, data: '2026-10-02', valor: 500, categoria_id: 1, status: 'CONCILIADO', versao: 1, excluido_em: null },
        { id: 2, data: '2026-10-05', valor: 200, categoria_id: 2, status: 'CONCILIADO', versao: 1, excluido_em: null },
        { id: 3, data: '2026-10-05', valor: 200, categoria_id: 2, status: 'REALIZADO', versao: 1, excluido_em: null }],
      extrato_linhas: [
        { id: 1, conta_id: 1, fitid: 'f1', data: '2026-10-02', valor: 500, descricao: 'PIX RECEBIDO', lancamento_id: 1, ignorada: false, dividida: false },
        { id: 2, conta_id: 1, fitid: 'f2', data: '2026-10-05', valor: -200, descricao: 'AMIL', lancamento_id: 2, ignorada: false, dividida: false }],
    }
    for (const [t, v] of Object.entries(s)) localStorage.setItem('sim_' + t, JSON.stringify(v))
    sessionStorage.clear(); localStorage.setItem('business_fluxo_modo', 'dias')
  })
  await a.reload()
  const b = await ctx.newPage()
  await b.goto(base + '#fluxo')
  await b.locator('text=‹').first().waitFor()
  // vai para outubro/2026 na janela B
  for (let i = 0; i < 24 && !(await b.locator('strong', { hasText: 'Outubro / 2026' }).count()); i++) await b.locator('button', { hasText: '‹' }).first().click()
  ok(await b.locator('strong', { hasText: 'Outubro / 2026' }).count() === 1, 'fluxo em outubro/2026')
  const linhaBanco = b.locator('tr.banco')
  ok((await linhaBanco.locator('td').allTextContents()).every((t) => t === ''), 'sem saldo informado, a linha do banco fica vazia')

  await a.locator('text=ainda não informado').waitFor()
  await a.locator('.saldo-banco input.valor').fill('1.300,00')
  await a.locator('.saldo-banco input[type=date]').fill('2026-10-05')
  await a.locator('button', { hasText: 'Gravar saldo' }).click()
  await a.locator('text=no fim de 05/10/2026').waitFor()
  ok(true, 'saldo informado aparece na Conciliação')

  await b.waitForFunction(() => document.querySelectorAll('tr.banco td')[0]?.textContent !== '', null, { timeout: 4000 }).catch(() => {})
  const banco = await linhaBanco.locator('td').allTextContents()
  const dif = await b.locator('tr.diferenca td').allTextContents()
  ok(banco[0] === '1.000,00' && banco[1] === '1.500,00' && banco[4] === '1.300,00', `saldo no banco dia a dia (${banco.slice(0, 5).join(' | ')})`)
  ok(banco[5] === '', 'depois do último dia conhecido, fica vazio')
  ok(dif[0] === 'ok' && dif[1] === 'ok' && dif[3] === 'ok', 'dias batidos mostram ok')
  ok(dif[4] === '-200,00', `diferença no dia do lançamento duplicado (${dif[4]})`)
  ok(await b.locator('tr.diferenca td.dif').count() === 1, 'só o dia com diferença fica destacado')
  await b.screenshot({ path: 'testes/saldo-banco.png' })
} catch (e) { falhas.push(String(e)); console.log('✗ ' + e) } finally { await browser.close(); srv.kill() }
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo.')
process.exit(falhas.length ? 1 : 0)
