// Espaços: Business e Pessoal com dados separados. Troca pelo seletor do topo, cada espaço mostra só o que é dele,
// e o que é criado no Pessoal fica no Pessoal. (A proteção de verdade é a RLS do banco, testada no Postgres local.)
// Uso: npx vite build -c vite.config.teste.ts && node testes/espacos.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { spawn } from 'node:child_process'

const srv = spawn('npx', ['vite', 'preview', '-c', 'vite.config.teste.ts', '--port', '4181', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const base = 'http://localhost:4181/'
const falhas = []
const ok = (cond, txt) => { console.log((cond ? '✓ ' : '✗ ') + txt); if (!cond) falhas.push(txt) }
const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const a = await ctx.newPage()
  await a.goto(base + '#fluxo')
  const hoje = new Date().toISOString().slice(0, 10)
  await a.evaluate((hoje) => {
    localStorage.clear()
    const s = {
      espacos: [{ id: 1, nome: 'Business' }, { id: 2, nome: 'Pessoal Alexandre' }],
      contas: [{ id: 1, nome: 'C6', espaco_id: 1, saldo_inicial: 0 }, { id: 2, nome: 'Mercado Pago', espaco_id: 2, saldo_inicial: 500, data_inicial: '2019-01-01' }],
      categorias: [
        { id: 1, nome: 'Cliente Business', tipo: 'ENTRADA', secao: 'Clientes', ordem: 1, arquivada: false, espaco_id: 1 },
        { id: 2, nome: 'Condomínio', tipo: 'SAIDA', secao: 'Despesas', ordem: 1, arquivada: false, espaco_id: 2 }],
      lancamentos: [
        { id: 1, data: hoje, valor: 100, categoria_id: 1, status: 'REALIZADO', versao: 1, excluido_em: null, espaco_id: 1 },
        { id: 2, data: hoje, valor: 70, categoria_id: 2, status: 'REALIZADO', versao: 1, excluido_em: null, espaco_id: 2 }],
    }
    for (const [t, v] of Object.entries(s)) localStorage.setItem('sim_' + t, JSON.stringify(v))
    localStorage.setItem('business_fluxo_modo', 'dias')
  }, hoje)
  await a.reload()
  await a.locator('select.espaco').waitFor()
  ok(await a.locator('select.espaco option').count() === 2, 'seletor mostra os dois espaços')
  await a.locator('text=Cliente Business').first().waitFor()
  ok(await a.locator('th', { hasText: 'Condomínio' }).count() === 0, 'Business não mostra linha do Pessoal')

  await a.locator('select.espaco').selectOption({ label: 'Pessoal Alexandre' })
  await a.locator('th', { hasText: 'Condomínio' }).first().waitFor()
  ok(await a.locator('th', { hasText: 'Cliente Business' }).count() === 0, 'Pessoal não mostra linha da Business')
  ok(await a.locator('text=Saldo inicial: 500,00').count() === 1, 'saldo inicial é o do Pessoal')

  // cria uma linha no Pessoal pelos Cadastros
  await a.goto(base + '#cadastros')
  await a.reload()
  await a.locator('button', { hasText: 'Linhas do fluxo' }).click()
  await a.waitForTimeout(500)
  const cats = async () => a.evaluate(() => JSON.parse(localStorage.getItem('sim_categorias')))
  const antes = (await cats()).length
  // procura o formulário de nova linha (campo nome + botão Criar/Adicionar)
  const form = a.locator('form', { has: a.locator('button', { hasText: /Criar|Adicionar|Incluir/ }) }).last()
  await form.locator('input').first().fill('Farmácia')
  await form.locator('button', { hasText: /Criar|Adicionar|Incluir/ }).click()
  await a.waitForTimeout(800)
  const nova = (await cats()).find((c) => c.nome === 'Farmácia')
  ok((await cats()).length === antes + 1 && nova?.espaco_id === 2, `linha criada no Pessoal fica no Pessoal (espaço ${nova?.espaco_id})`)

  await a.locator('select.espaco').selectOption({ label: 'Business' })
  await a.waitForTimeout(500)
  ok(await a.locator('text=Farmácia').count() === 0, 'linha nova do Pessoal não aparece na Business')
  await a.screenshot({ path: 'testes/espacos.png' })
} catch (e) { falhas.push(String(e)); console.log('✗ ' + e) } finally { await browser.close(); srv.kill() }
console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\nTudo certo.')
process.exit(falhas.length ? 1 : 0)
