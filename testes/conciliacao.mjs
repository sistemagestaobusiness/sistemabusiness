// Teste da conciliação com um extrato OFX de verdade e dados de exemplo (arquivos fora do git: têm dados reais).
// Uso: npx vite build -c vite.config.teste.ts && node testes/conciliacao.mjs SEED.json EXTRATO.ofx
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
const { chromium } = createRequire(import.meta.url)('playwright')
const [seedArq, ofx] = process.argv.slice(2)
const seed = JSON.parse(readFileSync(seedArq, 'utf8'))
const srv = spawn('npx', ['vite', 'preview', '-c', 'vite.config.teste.ts', '--port', '4174', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const browser = await chromium.launch()
try {
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
  await p.goto('http://localhost:4174/#conciliacao')
  await p.evaluate((s) => { localStorage.clear(); for (const [t, v] of Object.entries(s)) localStorage.setItem('sim_' + t, JSON.stringify(v)) }, seed)
  await p.reload()
  await p.waitForSelector('text=Nada pendente')
  console.log('importar a partir de (padrão):', await p.inputValue('input[type=date]'))
  await p.setInputFiles('input[type=file]', ofx)
  await p.waitForSelector('text=movimentos no arquivo')
  console.log(await p.locator('p.sub').first().textContent())
  console.log('no armazenamento:', await p.evaluate(() => JSON.parse(localStorage.getItem('sim_extrato_linhas') || '[]').length))
  p.on('console', (m) => console.log('console:', m.text()))
  await p.waitForTimeout(1000)
  const pend = await p.locator('.tabela tbody tr').count()
  const botao = p.locator('button.primario')
  const txt = (await botao.count()) ? await botao.textContent() : '(sem sugestões certeiras)'
  console.log('pendentes:', pend, '·', txt)
  await p.screenshot({ path: 'testes/conciliacao.png', fullPage: false })
  if (await botao.count()) { await botao.click(); await p.waitForTimeout(1500); console.log('depois de conciliar as certeiras, pendentes:', await p.locator('.tabela tbody tr').count()) }
  // subir de novo não duplica
  await p.setInputFiles('input[type=file]', ofx)
  await p.waitForTimeout(800)
  console.log('segunda vez:', await p.locator('p.sub').first().textContent())
} finally { await browser.close(); srv.kill() }
