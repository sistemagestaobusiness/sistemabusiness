// Linhas do fluxo: Seção é lista fixa por tipo (não cria seção nova digitando) e cada linha tem "editar".
// Duas janelas: A em Cadastros, B no Fluxo (outra tela) e C também em Cadastros com a edição da mesma linha aberta.
// Uso: npx vite build -c vite.config.teste.ts && node testes/linhas.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { spawn } from 'node:child_process'

const srv = spawn('npx', ['vite', 'preview', '-c', 'vite.config.teste.ts', '--port', '4184', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const base = 'http://localhost:4184/'
const falhas = []
const ok = (cond, txt) => { console.log((cond ? '✓ ' : '✗ ') + txt); if (!cond) falhas.push(txt) }
const espera = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true).catch(() => false)
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const a = await ctx.newPage(), b = await ctx.newPage(), c = await ctx.newPage()
  await a.goto(base + '#cadastros')
  await a.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sim_categorias', JSON.stringify([
      { id: 1, nome: 'TudoCar', tipo: 'ENTRADA', secao: 'Clientes', ordem: 1, arquivada: false, cor: null },
      { id: 2, nome: 'BNI', tipo: 'SAIDA', secao: 'Pagamentos', ordem: 2, arquivada: false, cor: null },
      { id: 3, nome: 'IA - Claude', tipo: 'SAIDA', secao: 'Pagamento', ordem: 3, arquivada: false, cor: null }]))
    localStorage.setItem('business_fluxo_modo', 'meses')
  })
  await a.reload(); await a.click('text=Linhas do fluxo')
  await b.goto(base + '#fluxo')
  await c.goto(base + '#cadastros'); await c.click('text=Linhas do fluxo')

  const form = a.locator('form.filtros')
  const opcoes = () => form.locator('label:has-text("Seção") select option').allTextContents()
  ok((await form.locator('label:has-text("Seção") input').count()) === 0, 'Seção não é mais campo de digitar')
  await form.locator('label:has-text("Tipo") select').selectOption('SAIDA')
  ok(JSON.stringify(await opcoes()) === JSON.stringify(['Pagamentos', 'Dívidas, consórcios e aplicações']), 'Pagamento: mostra as duas seções de pagamento')
  await form.locator('label:has-text("Tipo") select').selectOption('ENTRADA')
  ok(JSON.stringify(await opcoes()) === JSON.stringify(['Sócios', 'Clientes', 'BPO', 'Outros']), 'Entrada: mostra as quatro seções de entrada')

  // C abre a edição do BNI e começa a digitar; A cria uma linha nova
  await c.locator('tbody tr', { hasText: 'BNI' }).locator('text=editar').click()
  await c.locator('input[aria-label="Nome da linha"]').fill('BNI mensalidade')
  await form.locator('label:has-text("Tipo") select').selectOption('SAIDA')
  await form.locator('label:has-text("Nova linha") input').fill('Contador')
  await form.locator('label:has-text("Seção") select').selectOption('Dívidas, consórcios e aplicações')
  await a.click('text=Adicionar')
  ok(await espera(c, () => [...document.querySelectorAll('tbody tr')].some((t) => t.textContent.includes('Contador'))), 'linha nova apareceu na outra janela de Cadastros')
  ok(await c.locator('input[aria-label="Nome da linha"]').inputValue() === 'BNI mensalidade', 'edição aberta na outra janela não perdeu o que estava digitado')
  ok(await espera(b, () => document.body.textContent.includes('Contador')), 'linha nova apareceu no Fluxo da outra janela')

  // A corrige a IA - Claude da seção errada "Pagamento" para "Pagamentos"
  const linhaIA = a.locator('tbody tr', { hasText: 'IA - Claude' })
  await linhaIA.locator('text=editar').click()
  const sel = a.locator('select[aria-label="Seção"]')
  ok((await sel.locator('option').allTextContents()).includes('Pagamento (fora da lista)'), 'seção antiga fora da lista aparece marcada na edição')
  await sel.selectOption('Pagamentos')
  await a.click('text=salvar')
  ok(await espera(b, () => ![...document.querySelectorAll('tr.secao')].some((t) => t.textContent.trim() === 'Pagamento')), 'Fluxo da outra janela: seção "Pagamento" sumiu sozinha')
  ok(await espera(c, () => [...document.querySelectorAll('tbody tr')].some((t) => t.textContent.includes('IA - Claude') && t.textContent.includes('Pagamentos'))), 'Cadastros da outra janela mostra IA - Claude em Pagamentos')

  // A renomeia o BNI enquanto C está editando: C salva e é avisada
  await a.locator('tbody tr', { hasText: 'BNI' }).locator('text=editar').click()
  await a.locator('input[aria-label="Nome da linha"]').fill('BNI anual')
  await a.click('text=salvar')
  ok(await espera(b, () => document.body.textContent.includes('BNI anual')), 'nome editado apareceu no Fluxo da outra janela')
  await c.click('text=salvar')
  ok(await espera(c, () => document.body.textContent.includes('Outra pessoa alterou esta linha antes')), 'quem salvou depois foi avisado, sem gravar por cima')
  ok(await a.evaluate(() => JSON.parse(localStorage.getItem('sim_categorias')).find((x) => x.id === 2).nome) === 'BNI anual', 'nome gravado continua o da primeira edição')
} catch (e) { ok(false, String(e)) } finally { await browser.close(); srv.kill() }
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo.')
process.exit(falhas.length ? 1 : 0)
