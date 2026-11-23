// Projeções: editar uma projeção muda todas as parcelas previstas de uma vez, menos as já conciliadas/realizadas.
// Duas janelas, como o Realtime: a outra janela (na mesma tela e em OUTRA tela, o Fluxo) muda sozinha,
// e a janela de edição aberta na outra não perde o que está sendo digitado.
// Uso: npx vite build -c vite.config.teste.ts && node testes/projecoes.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { spawn } from 'node:child_process'

const srv = spawn('npx', ['vite', 'preview', '-c', 'vite.config.teste.ts', '--port', '4183', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const base = 'http://localhost:4183/'
const falhas = []
const ok = (cond, txt) => { console.log((cond ? '✓ ' : '✗ ') + txt); if (!cond) falhas.push(txt) }
const espera = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true).catch(() => false)
const linhas = (p, txt) => p.$$eval('tbody tr', (ts, txt) => ts.map((t) => t.textContent).filter((t) => t.includes(txt)), txt)
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const a = await ctx.newPage(), b = await ctx.newPage()
  a.on('dialog', (d) => d.accept()); b.on('dialog', (d) => d.accept())
  await a.goto(base + '#lancamentos')
  await a.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sim_categorias', JSON.stringify([
      { id: 1, nome: 'TudoCar', tipo: 'ENTRADA', secao: 'Clientes', ordem: 1, arquivada: false, cor: null }]))
    localStorage.setItem('business_fluxo_modo', 'meses')
  })
  await a.reload()
  await b.goto(base + '#lancamentos')
  const projA = a.locator('.bloco', { hasText: 'Projeções recorrentes' })
  await projA.locator('select').selectOption({ label: 'TudoCar' })
  await projA.locator('input[placeholder="1.234,56"]').fill('750')
  await projA.locator('label:has-text("Parcelas") input').fill('6')
  await projA.locator('label:has-text("Descrição") input').fill('sistema de gestão')
  await a.click('text=Criar projeção')
  ok(await espera(b, () => [...document.querySelectorAll('tbody tr')].filter((t) => t.textContent.includes('parcela')).length === 6), 'projeção de 6 parcelas apareceu na outra janela')
  ok((await linhas(b, 'parcela 6/6')).length === 1, 'parcelas numeradas 1/6…6/6')

  // a parcela 1 é conciliada (não pode mudar)
  await a.locator('tbody tr', { hasText: 'parcela 1/6' }).locator('td').nth(3).click()
  await a.selectOption('.janela select >> nth=1', 'CONCILIADO')
  await a.click('.janela >> text=Salvar')
  await a.locator('.janela').waitFor({ state: 'detached', timeout: 3000 })

  // B abre a edição e começa a digitar; A edita e grava antes
  const projB = b.locator('.bloco', { hasText: 'Projeções recorrentes' })
  await projB.locator('button:text-is("editar")').click()
  ok((await b.inputValue('.janela label:has-text("Parcelas") input')) === '6', 'edição abre com as parcelas da projeção')
  await b.fill('.janela label:has-text("Descrição") input', 'digitando em B')

  await projA.locator('button:text-is("editar")').click()
  ok(await espera(a, () => document.querySelector('.janela')?.textContent.includes('5 parcelas previstas')), 'janela mostra 5 previstas e 1 conciliada')
  await a.fill('.janela label:has-text("Valor") input', '700')
  await a.fill('.janela label:has-text("Dia") input', '25')
  await a.click('.janela >> text=Salvar em todas as previstas')
  await a.locator('.janela').waitFor({ state: 'detached', timeout: 3000 })
  ok(await a.locator('text=5 parcelas previstas alteradas').count() === 1, 'aviso: 5 alteradas, a conciliada ficou como estava')

  ok(await espera(b, () => [...document.querySelectorAll('tbody tr')].filter((t) => t.textContent.includes('700,00')).length === 5), 'na outra janela as 5 previstas foram para 700,00 sozinhas')
  const conc = await linhas(b, 'parcela 1/6')
  ok(conc.length === 1 && conc[0].includes('750,00'), 'a conciliada continua 750,00')
  ok((await linhas(b, 'parcela 3/6'))[0]?.includes('/25/') || (await linhas(b, 'parcela 3/6'))[0]?.includes('25/'), 'dia mudou para 25')
  ok(await projB.locator('.lista').textContent().then((t) => t.includes('700,00')), 'lista de projeções da outra janela mostra 700,00')
  ok(await b.locator('.janela').count() === 1 && (await b.inputValue('.janela label:has-text("Descrição") input')) === 'digitando em B', 'janela aberta em B continuou aberta com o que estava digitado')
  ok(await b.locator('.janela >> text=Outra pessoa alterou esta projeção').count() === 1, 'B é avisado de que outra pessoa alterou')
  await b.click('.janela >> text=Fechar')

  // mais parcelas: cria as que faltam
  await projA.locator('button:text-is("editar")').click()
  await a.fill('.janela label:has-text("Parcelas") input', '8')
  await a.click('.janela >> text=Salvar em todas as previstas')
  ok(await espera(b, () => [...document.querySelectorAll('tbody tr')].filter((t) => t.textContent.includes('/8')).length === 7), 'com 8 parcelas: outra janela mostra 7 previstas numeradas /8 (+ a conciliada)')

  // outra tela: Fluxo na janela B muda sozinho
  await b.goto(base + '#fluxo')
  await b.locator('th', { hasText: 'TudoCar' }).first().waitFor()
  ok(await espera(b, () => document.body.textContent.includes('700,00')), 'Fluxo mostra 700,00')
  await projA.locator('button:text-is("editar")').click()
  await a.fill('.janela label:has-text("Valor") input', '690,50')
  await a.click('.janela >> text=Salvar em todas as previstas')
  ok(await espera(b, () => document.body.textContent.includes('690,50') && !document.body.textContent.includes('700,00')), 'edição da projeção mudou o Fluxo da outra janela sozinha')
  await a.screenshot({ path: 'testes/projecoes.png', fullPage: true })
} catch (e) { falhas.push(String(e)); console.log('✗ ' + e) } finally { await browser.close(); srv.kill() }
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo.')
process.exit(falhas.length ? 1 : 0)
