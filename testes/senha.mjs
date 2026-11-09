// Trocar senha de dentro do sistema. Uso: npx vite build -c vite.config.teste.ts && node testes/senha.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { spawn } from 'node:child_process'

const srv = spawn('npx', ['vite', 'preview', '-c', 'vite.config.teste.ts', '--port', '4174', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const falhas = []
const ok = (cond, txt) => { console.log((cond ? '✓ ' : '✗ ') + txt); if (!cond) falhas.push(txt) }
const browser = await chromium.launch()
try {
  const p = await browser.newPage()
  await p.goto('http://localhost:4174/#fluxo')
  await p.evaluate(() => localStorage.removeItem('sim_senha_nova'))
  await p.click('text=Trocar senha')
  const campos = p.locator('.janela input[type=password]')
  ok(await campos.count() === 3, 'pede senha atual, nova e repetir')
  await campos.nth(0).fill('atual1234'); await campos.nth(1).fill('curta'); await campos.nth(2).fill('curta')
  await p.locator('.janela button:not(.link)').click()
  ok(await p.locator('text=pelo menos 8').count() === 1, 'senha curta recusada')
  await campos.nth(1).fill('novaSenha99'); await campos.nth(2).fill('outraCoisa')
  await p.locator('.janela button:not(.link)').click()
  ok(await p.locator('text=não estão iguais').count() === 1, 'senhas diferentes recusadas')
  await campos.nth(0).fill('errada99'); await campos.nth(2).fill('novaSenha99')
  await p.locator('.janela button:not(.link)').click()
  await p.waitForSelector('text=não confere')
  ok(await p.evaluate(() => localStorage.getItem('sim_senha_nova')) === null, 'senha atual errada: não troca')
  await campos.nth(0).fill('atual1234')
  await p.locator('.janela button:not(.link)').click()
  await p.waitForFunction(() => localStorage.getItem('sim_senha_nova') === 'novaSenha99')
  await p.waitForSelector('text=Senha trocada'); ok(true, 'senha atual certa: troca e avisa')
  await p.screenshot({ path: 'testes/senha.png' })
} catch (e) { falhas.push(String(e)); console.log('✗ ' + e) } finally { await browser.close(); srv.kill() }
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo.')
process.exit(falhas.length ? 1 : 0)
