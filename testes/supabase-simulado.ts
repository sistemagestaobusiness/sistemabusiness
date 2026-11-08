// Supabase simulado para o teste de duas janelas (Playwright). Os dados ficam no localStorage, que as duas
// janelas do mesmo navegador compartilham, e cada gravação avisa a outra janela pelo BroadcastChannel,
// fazendo o papel do Realtime do Supabase. Usado só por vite.config.teste.ts.
type Linha = Record<string, unknown> & { id: number }
const ler = (t: string): Linha[] => JSON.parse(localStorage.getItem('sim_' + t) || '[]')
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
  single() { this.umSo = true; return this }
  insert(v: Record<string, unknown>) { this.op = 'insert'; this.valores = v; return this }
  update(v: Record<string, unknown>) { this.op = 'update'; this.valores = v; return this }
  executar() {
    let ls = ler(this.tabela)
    if (this.op === 'insert') {
      const n = { id: proximoId(this.tabela), versao: 1, excluido_em: null, recorrencia_id: null, arquivada: false, ...this.valores } as Linha
      gravar(this.tabela, [...ls, n]); avisar(this.tabela)
      return { data: this.umSo ? n : [n], error: null }
    }
    if (this.op === 'update') {
      const alvo = ls.filter((l) => this.filtros.every((f) => f(l)))
      ls = ls.map((l) => alvo.includes(l) ? { ...l, ...this.valores, versao: Number(l.versao ?? 1) + 1 } : l)
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
    const s = ler('lancamentos').filter((l) => !l.excluido_em && String(l.data) < String(p.p_data))
      .reduce((a, l) => a + (tipo.get(l.categoria_id as number) === 'SAIDA' ? -1 : 1) * Number(l.valor), 0)
    return Promise.resolve({ data: 1000 + s, error: null })
  }
  return Promise.resolve({ data: 0, error: null })
}

export const configurado = true
export const supabase = {
  from: (t: string) => new Consulta(t),
  rpc,
  auth: {
    getSession: async () => ({ data: { session: { user: { email: 'teste@business' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2', nextLevel: 'aal2' } }) },
    signOut: async () => ({}),
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
