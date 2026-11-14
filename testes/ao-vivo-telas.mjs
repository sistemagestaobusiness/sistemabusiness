// Regra obrigatória: toda tela é ao vivo. Uma janela altera (Cadastros, Lançamentos, Conciliação) e a outra,
// aberta em OUTRA tela ligada ao mesmo dado, muda sozinha, sem recarregar e sem fechar nada.
// Uso: npx vite build -c vite.config.teste.ts && node testes/ao-vivo-telas.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { spawn } from 'node:child_process'

const srv = spawn('npx', ['vite', 'preview', '-c', 'vite.config.teste.ts', '--port', '4182', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const base = 'http://localhost:4182/'
const falhas = []
const ok = (cond, txt) => { console.log((cond ? '✓ ' : '✗ ') + txt); if (!cond) falhas.push(txt) }
const espera = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true).catch(() => false)
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } })
  const a = await ctx.newPage(), b = await ctx.newPage()
  a.on('dialog', (d) => d.accept()); b.on('dialog', (d) => d.accept())
  await a.goto(base + '#cadastros')
  const hoje = new Date().toISOString().slice(0, 10)
  await a.evaluate((hoje) => {
    localStorage.clear()
    const s = {
      contas: [{ id: 1, nome: 'C6', ativa: true, ordem: 1, saldo_banco: null, saldo_banco_em: null }],
      categorias: [
        { id: 1, nome: 'Cliente Teste', tipo: 'ENTRADA', secao: 'Clientes', ordem: 1, arquivada: false, cor: null },
        { id: 2, nome: 'Aluguel', tipo: 'SAIDA', secao: 'Pagamentos', ordem: 2, arquivada: false, cor: null }],
      lancamentos: [{ id: 1, data: hoje, valor: 300, categoria_id: 2, descricao: 'aluguel do mês', status: 'REALIZADO', versao: 1, excluido_em: null }],
      extrato_linhas: [{ id: 1, conta_id: 1, fitid: 'x1', data: hoje, valor: -12.34, descricao: 'TARIFA TESTE', lancamento_id: null, ignorada: false, dividida: false }],
    }
    for (const [t, v] of Object.entries(s)) localStorage.setItem('sim_' + t, JSON.stringify(v))
    localStorage.setItem('business_fluxo_modo', 'dias')
  }, hoje)
  await a.reload()
  await b.goto(base + '#fluxo')
  await b.locator('th', { hasText: 'Aluguel' }).first().waitFor()
  const saldoB = () => b.locator('tr.saldo td').last().textContent()
  const saldo0 = await saldoB()

  // Cadastros (A) → Fluxo (B)
  await a.fill('form.bloco label:has-text("Nome") input', 'Cliente Novo')
  await a.click('form.bloco >> text=Salvar')
  ok(await espera(b, () => [...document.querySelectorAll('th')].some((t) => t.textContent.includes('Cliente Novo'))), 'cliente novo criado em Cadastros apareceu no Fluxo da outra janela')
  await a.click('button:has-text("Linhas do fluxo")')
  await a.locator('tr', { hasText: 'Cliente Teste' }).locator('text=arquivar').click()
  ok(await espera(b, () => ![...document.querySelectorAll('th')].some((t) => t.textContent.includes('Cliente Teste'))), 'linha arquivada em Cadastros saiu do Fluxo da outra janela')
  await a.locator('tr', { hasText: 'Aluguel' }).locator('input[type=color]').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, '#ffcc00'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  ok(await espera(b, () => [...document.querySelectorAll('tr')].some((t) => t.textContent.includes('Aluguel') && (t.getAttribute('style') ?? '').includes('255, 204, 0'))), 'cor mudada em Cadastros pintou a linha no Fluxo da outra janela')

  // Lançamentos (A) → Fluxo (B): lixeira muda célula e saldo
  await a.goto(base + '#lancamentos')
  await a.locator('tr', { hasText: 'aluguel do mês' }).locator('td').nth(3).click()
  await a.click('.janela >> text=Excluir')
  ok(await espera(b, (s0) => document.querySelectorAll('tr.saldo td')[document.querySelectorAll('tr.saldo td').length - 1]?.textContent !== s0, saldo0), 'lançamento excluído em Lançamentos mudou o saldo do Fluxo da outra janela')

  // Projeções (A) → Lançamentos (B)
  await b.goto(base + '#lancamentos')
  await b.locator('text=Projeções recorrentes').waitFor()
  const projB = () => b.locator('.bloco', { hasText: 'Projeções recorrentes' }).textContent()
  await a.locator('.bloco', { hasText: 'Projeções recorrentes' }).locator('select').selectOption({ label: 'Aluguel' })
  await a.locator('.bloco', { hasText: 'Projeções recorrentes' }).locator('input[placeholder="1.234,56"]').fill('450')
  await a.locator('.bloco', { hasText: 'Projeções recorrentes' }).locator('label:has-text("Descrição") input').fill('aluguel projetado')
  await a.click('text=Criar projeção')
  await espera(b, () => document.body.textContent.includes('aluguel projetado'))
  ok((await projB()).includes('aluguel projetado'), 'projeção criada numa janela apareceu na lista da outra')

  // Conciliação (A) → Conciliação (B)
  await a.goto(base + '#conciliacao'); await b.goto(base + '#conciliacao')
  await b.locator('tr', { hasText: 'TARIFA TESTE' }).waitFor()
  await a.locator('tr', { hasText: 'TARIFA TESTE' }).locator('text=ignorar').click()
  ok(await espera(b, () => !document.body.textContent.includes('TARIFA TESTE')), 'linha do extrato tratada numa janela saiu dos pendentes da outra')
  await b.screenshot({ path: 'testes/ao-vivo-telas.png' })
} catch (e) { falhas.push(String(e)); console.log('✗ ' + e) } finally { await browser.close(); srv.kill() }
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo.')
process.exit(falhas.length ? 1 : 0)
