// Supabase simulado para o teste de duas janelas (Playwright). Os dados ficam no localStorage, que as duas
// janelas do mesmo navegador compartilham, e cada gravação avisa a outra janela pelo BroadcastChannel,
// fazendo o papel do Realtime do Supabase. Usado só por vite.config.teste.ts.
type Linha = Record<string, unknown> & { id: number }
// espaços: sem nada gravado, existe só a Business (1); linha sem espaco_id é da Business (testes antigos)
const COM_ESPACO = new Set(['contas', 'clientes', 'fornecedores', 'categorias', 'recorrencias', 'lancamentos', 'extrato_linhas'])
const ler = (t: string): Linha[] => {
  const ls: Linha[] = JSON.parse(localStorage.getItem('sim_' + t) || '[]')
  if (t === 'espacos' && !ls.length) return [{ id: 1, nome: 'Business' }]
  return COM_ESPACO.has(t) ? ls.map((l) => ({ ...l, espaco_id: l.espaco_id ?? 1 })) : ls
}
// como o gatilho do banco: lançamento, projeção e extrato herdam o espaço da linha do fluxo / da conta
const herdarEspaco = (t: string, v: Record<string, unknown>) => {
  if (t === 'recorrencias') v = fimDasParcelas(v)
  if (t === 'lancamentos' || t === 'recorrencias') return { ...v, espaco_id: ler('categorias').find((c) => c.id === v.categoria_id)?.espaco_id ?? 1 }
  if (t === 'extrato_linhas') return { ...v, espaco_id: ler('contas').find((c) => c.id === v.conta_id)?.espaco_id ?? 1 }
  return v
}
// como o SQL 0008 (sem o ajuste para dia útil): mês a mês, dia 31 vira o último dia do mês
const mesDe = (iso: string) => { const [a, m] = iso.split('-').map(Number); return a * 12 + m - 1 }
const dataNoMes = (mes: number, dia: number) => {
  const a = Math.floor(mes / 12), m = mes % 12, ult = new Date(a, m + 1, 0).getDate()
  return `${a}-${String(m + 1).padStart(2, '0')}-${String(Math.min(dia, ult)).padStart(2, '0')}`
}
const primeiroMes = (r: Record<string, unknown>) => { const m = mesDe(String(r.inicio)); return dataNoMes(m, Number(r.dia)) < String(r.inicio) ? m + 1 : m }
function fimDasParcelas(v: Record<string, unknown>) {
  return v.parcelas ? { ...v, fim: dataNoMes(primeiroMes(v) + Number(v.parcelas) - 1, Number(v.dia)) } : v
}
function aplicarRecorrencia(id: number) {
  const r = ler('recorrencias').find((x) => x.id === id)!
  let ls = ler('lancamentos'); let novoId = proximoId('lancamentos')
  const ini = primeiroMes(r)
  let fimM = r.fim ? mesDe(String(r.fim)) : mesDe(String(r.inicio)) + 23
  if (r.fim && dataNoMes(fimM, Number(r.dia)) > String(r.fim)) fimM--
  const res = { alteradas: 0, criadas: 0, excluidas: 0, mantidas: 0 }
  const daRec = (l: Linha) => l.recorrencia_id === id
  ls = ls.map((l) => {
    if (!daRec(l) || l.excluido_em || l.status !== 'PREVISTO') return l
    const m = mesDe(String(l.data)); if (m >= ini && m <= fimM) return l
    res.excluidas++; return { ...l, excluido_em: new Date().toISOString(), recorrencia_id: null, versao: Number(l.versao) + 1 }
  })
  for (let m = ini, i = 1; m <= fimM; m++, i++) {
    const descricao = r.parcelas ? `${r.descricao ? r.descricao + ' · ' : ''}parcela ${i}/${r.parcelas}` : r.descricao ?? null
    const doMes = ls.filter((l) => daRec(l) && mesDe(String(l.data)) === m)
    if (doMes.some((l) => !l.excluido_em && l.status !== 'PREVISTO')) { res.mantidas++; continue }
    const prev = doMes.filter((l) => !l.excluido_em)
    if (prev.length) {
      ls = ls.map((l) => prev.includes(l) ? { ...l, data: dataNoMes(m, Number(r.dia)), valor: r.valor, categoria_id: r.categoria_id, descricao, versao: Number(l.versao) + 1 } : l)
      res.alteradas += prev.length
    } else if (!doMes.length) {
      ls.push({ id: novoId++, data: dataNoMes(m, Number(r.dia)), valor: r.valor, categoria_id: r.categoria_id, descricao, status: 'PREVISTO',
        recorrencia_id: id, espaco_id: r.espaco_id, versao: 1, excluido_em: null })
      res.criadas++
    }
  }
  gravar('lancamentos', ls); avisar('lancamentos')
  return res
}
const gravar = (t: string, ls: Linha[]) => localStorage.setItem('sim_' + t, JSON.stringify(ls))
const bc = new BroadcastChannel('sim-realtime')
const ouvintes: { tabela: string; cb: () => void }[] = []
bc.onmessage = (e) => ouvintes.filter((o) => o.tabela === e.data).forEach((o) => o.cb())
const avisar = (t: string) => { bc.postMessage(t); ouvintes.filter((o) => o.tabela === t).forEach((o) => o.cb()) }
const proximoId = (t: string) => Math.max(0, ...ler(t).map((l) => l.id)) + 1

class Consulta implements PromiseLike<{ data: unknown; error: null | { message: string } }> {
  filtros: ((l: Linha) => boolean)[] = []
  ordem: [string, boolean][] = []
  faixa: [number, number] | null = null
  op: 'select' | 'insert' | 'update' = 'select'
  valores: Record<string, unknown> | null = null
  umSo = false
  constructor(public tabela: string) {}
  select() { return this }
  eq(c: string, v: unknown) { this.filtros.push((l) => l[c] === v); return this }
  is(c: string, v: unknown) { this.filtros.push((l) => (l[c] ?? null) === v); return this }
  gte(c: string, v: string) { this.filtros.push((l) => String(l[c]) >= v); return this }
  lte(c: string, v: string) { this.filtros.push((l) => String(l[c]) <= v); return this }
  ilike(c: string, v: string) { const s = v.replaceAll('%', '').toLowerCase(); this.filtros.push((l) => String(l[c] ?? '').toLowerCase().includes(s)); return this }
  order(c: string, o?: { ascending?: boolean }) { this.ordem.push([c, o?.ascending !== false]); return this }
  range(a: number, b: number) { this.faixa = [a, b]; return this }
  limit(n: number) { this.faixa = [0, n - 1]; return this }
  neq(c: string, v: unknown) { this.filtros.push((l) => l[c] !== v); return this }
  in(c: string, vs: unknown[]) { this.filtros.push((l) => vs.includes(l[c])); return this }
  upsert(vs: Record<string, unknown>[]) {
    const ls = ler(this.tabela); let id = proximoId(this.tabela)
    const chave = (l: Record<string, unknown>) => `${l.conta_id}|${l.fitid}`
    const ja = new Set(ls.map(chave))
    const novos = vs.filter((v) => !ja.has(chave(v))).map((v) => herdarEspaco(this.tabela, { id: id++, lancamento_id: null, ignorada: false, ...v }) as Linha)
    gravar(this.tabela, [...ls, ...novos]); avisar(this.tabela)
    return Promise.resolve({ data: null, error: null })
  }
  single() { this.umSo = true; return this }
  insert(v: Record<string, unknown>) { this.op = 'insert'; this.valores = v; return this }
  update(v: Record<string, unknown>) { this.op = 'update'; this.valores = v; return this }
  executar() {
    let ls = ler(this.tabela)
    if (this.op === 'insert') {
      const n = herdarEspaco(this.tabela, { id: proximoId(this.tabela), versao: 1, excluido_em: null, recorrencia_id: null, arquivada: false, ...this.valores }) as Linha
      gravar(this.tabela, [...ls, n]); avisar(this.tabela)
      return { data: this.umSo ? n : [n], error: null }
    }
    if (this.op === 'update') {
      const alvo = ls.filter((l) => this.filtros.every((f) => f(l)))
      ls = ls.map((l) => alvo.includes(l) ? herdarEspaco(this.tabela, { ...l, ...this.valores, versao: Number(l.versao ?? 1) + 1 }) as Linha : l)
      gravar(this.tabela, ls); if (alvo.length) avisar(this.tabela)
      return { data: alvo.map((l) => ({ id: l.id })), error: null }
    }
    let r = ls.filter((l) => this.filtros.every((f) => f(l)))
    for (const [c, asc] of [...this.ordem].reverse()) r = [...r].sort((a, b) => (a[c]! > b[c]! ? 1 : a[c]! < b[c]! ? -1 : 0) * (asc ? 1 : -1))
    if (this.faixa) r = r.slice(this.faixa[0], this.faixa[1] + 1)
    return { data: this.umSo ? r[0] : r, error: null }
  }
  then<A, B>(ok?: ((v: { data: unknown; error: null }) => A | PromiseLike<A>) | null, falha?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return new Promise<{ data: unknown; error: null }>((res) => setTimeout(() => res(this.executar() as { data: unknown; error: null }), 20)).then(ok, falha)
  }
}

function rpc(nome: string, p: Record<string, unknown>) {
  if (nome === 'fn_saldo_ate') {
    const tipo = new Map(ler('categorias').map((c) => [c.id, c.tipo]))
    const esp = Number(p.p_espaco ?? 1)
    const inicial = esp === 1 ? 1000 : ler('contas').filter((c) => c.espaco_id === esp).reduce((a, c) => a + Number(c.saldo_inicial ?? 0), 0)
    const s = ler('lancamentos').filter((l) => l.espaco_id === esp && !l.excluido_em && String(l.data) < String(p.p_data))
      .reduce((a, l) => a + (tipo.get(l.categoria_id as number) === 'SAIDA' ? -1 : 1) * Number(l.valor), 0)
    return Promise.resolve({ data: inicial + s, error: null })
  }
  if (nome === 'fn_conciliar') {
    const ex = ler('extrato_linhas'), e = ex.find((x) => x.id === p.p_linha)!
    gravar('lancamentos', ler('lancamentos').map((l) => l.id === p.p_lancamento
      ? { ...l, data: e.data, valor: Math.abs(Number(e.valor)), status: 'CONCILIADO', versao: Number(l.versao) + 1 } : l))
    gravar('extrato_linhas', ex.map((x) => x.id === p.p_linha ? { ...x, lancamento_id: p.p_lancamento } : x))
    avisar('lancamentos'); avisar('extrato_linhas')
  }
  if (nome === 'fn_conciliar_dividido') {
    const ex = ler('extrato_linhas'), e = ex.find((x) => x.id === p.p_linha)!
    const partes = p.p_partes as { categoria_id: number; valor: number; descricao?: string; lancamento_id?: number }[]
    const soma = Math.round(partes.reduce((a, x) => a + x.valor, 0) * 100) / 100
    if (soma !== Math.abs(Number(e.valor))) return Promise.resolve({ data: null, error: { message: `As partes somam ${soma} e o extrato é ${Math.abs(Number(e.valor))}` } })
    let ls = ler('lancamentos'); let id = ls.reduce((m, l) => Math.max(m, Number(l.id)), 0)
    for (const x of partes) {
      if (x.lancamento_id) ls = ls.map((l) => l.id === x.lancamento_id ? { ...l, data: e.data, valor: x.valor, categoria_id: x.categoria_id, status: 'CONCILIADO', extrato_linha_id: e.id, versao: Number(l.versao) + 1 } : l)
      else ls.push({ id: ++id, data: e.data, valor: x.valor, categoria_id: x.categoria_id, descricao: x.descricao || e.descricao, status: 'CONCILIADO', extrato_linha_id: e.id, versao: 1, excluido_em: null })
    }
    gravar('lancamentos', ls)
    gravar('extrato_linhas', ex.map((y) => y.id === p.p_linha ? { ...y, dividida: true } : y))
    avisar('lancamentos'); avisar('extrato_linhas')
    return Promise.resolve({ data: partes.length, error: null })
  }
  if (nome === 'fn_gerar_recorrencia') return Promise.resolve({ data: aplicarRecorrencia(Number(p.p_id)).criadas, error: null })
  if (nome === 'fn_editar_recorrencia') {
    const rs = ler('recorrencias'), r = rs.find((x) => x.id === p.p_id)
    if (!r) return Promise.resolve({ data: null, error: { message: `Projeção ${p.p_id} não existe` } })
    if (Number(r.versao ?? 1) !== p.p_versao) return Promise.resolve({ data: null, error: { message: 'Esta projeção foi alterada por outra pessoa enquanto você editava. Feche, confira e edite de novo.' } })
    // como o SQL: só o dia mudou → mesmos meses (início no dia 1 do mês da primeira parcela, fim no último dia do da última)
    let inicio = p.p_inicio, fim = p.p_fim ?? null
    if (p.p_dia !== r.dia) {
      if (inicio === r.inicio) inicio = dataNoMes(primeiroMes(r), 1)
      if (!p.p_parcelas && r.fim && fim === r.fim) {
        let ult = mesDe(String(r.fim)); if (dataNoMes(ult, Number(r.dia)) > String(r.fim)) ult--
        fim = dataNoMes(ult, 31)
      }
    }
    const novo = herdarEspaco('recorrencias', { ...r, categoria_id: p.p_categoria, valor: p.p_valor, dia: p.p_dia, inicio,
      fim: p.p_parcelas ? null : fim, parcelas: p.p_parcelas ?? null, descricao: String(p.p_descricao ?? '').trim() || null, versao: Number(r.versao ?? 1) + 1 }) as Linha
    gravar('recorrencias', rs.map((x) => x.id === r.id ? novo : x)); avisar('recorrencias')
    return new Promise((res) => setTimeout(() => res({ data: aplicarRecorrencia(r.id), error: null }), 20))
  }
  if (nome === 'fn_saldo_banco') {
    // igual ao SQL 0005: saldo informado + extrato até o dia − extrato até o dia informado
    const r: { data: string; saldo: number }[] = []
    const ex = ler('extrato_linhas')
    for (let d = String(p.p_ini); d <= String(p.p_fim); d = new Date(Date.parse(d + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10)) {
      let soma: number | null = null
      for (const c of ler('contas').filter((c) => c.espaco_id === Number(p.p_espaco ?? 1) && c.saldo_banco != null && c.saldo_banco_em)) {
        const ls = ex.filter((e) => e.conta_id === c.id)
        if (!ls.length) continue
        const datas = ls.map((e) => String(e.data)).sort()
        const de = new Date(Date.parse(datas[0] + 'T12:00:00Z') - 86_400_000).toISOString().slice(0, 10)
        const ate = [datas[datas.length - 1], String(c.saldo_banco_em)].sort()[1]
        if (d < de || d > ate) continue
        const ateDia = (x: string) => ls.filter((e) => String(e.data) <= x).reduce((a, e) => a + Number(e.valor), 0)
        soma = (soma ?? 0) + Number(c.saldo_banco) + ateDia(d) - ateDia(String(c.saldo_banco_em))
      }
      if (soma !== null) r.push({ data: d, saldo: Math.round(soma * 100) / 100 })
    }
    return Promise.resolve({ data: r, error: null })
  }
  return Promise.resolve({ data: 0, error: null })
}

export const configurado = true
// o simulado já avisa a própria janela ao gravar; existe só para o vivo.ts importar
export const aoGravar = new Set<(tabela: string) => void>()
export const supabase = {
  from: (t: string) => new Consulta(t),
  rpc,
  auth: {
    getSession: async () => ({ data: { session: { user: { email: 'teste@business' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2', nextLevel: 'aal2' } }) },
    signOut: async () => ({}),
    // senha certa no simulado: 'atual1234'
    signInWithPassword: async ({ password }: { password: string }) => ({ error: password === 'atual1234' ? null : { message: 'Invalid login credentials' } }),
    updateUser: async ({ password }: { password: string }) => { localStorage.setItem('sim_senha_nova', password); return { data: {}, error: null } },
    resetPasswordForEmail: async () => ({ error: null }),
  },
  channel: () => {
    const c = {
      on: (_e: string, f: { table: string }, cb: () => void) => { ouvintes.push({ tabela: f.table, cb }); return c },
      subscribe: (cb: (s: string) => void) => { setTimeout(() => cb('SUBSCRIBED'), 10); return c },
    }
    return c
  },
  removeChannel: () => {},
}
