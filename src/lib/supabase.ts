import './linkSenha' // precisa ler o endereço antes do createClient
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const configurado = Boolean(url && chave)

// Queda de internet aparece como "TypeError: Failed to fetch": troca por uma mensagem que diz o que fazer.
// A tela mostra "nome: mensagem" do erro, por isso o nome vira "Sem conexão com o servidor".
// Depois de cada gravação bem-sucedida, avisa as telas desta janela na hora (vivo.ts recarrega as consultas
// que dependem da tabela). Assim quem grava vê o resultado sem esperar o aviso do Realtime, que às vezes demora.
// As outras janelas continuam sendo avisadas pelo Realtime. Tabela '*' = função do banco que grava (pode mexer em várias).
// Funções só de leitura (fn_saldo_*) também vão por POST e não contam: senão cada leitura recarregaria tudo de novo.
const SO_LEITURA = /^fn_saldo_/
export const aoGravar = new Set<(tabela: string) => void>()
function avisarGravacao(a: Parameters<typeof fetch>, r: Response) {
  if (!r.ok) return
  const req = a[0] instanceof Request ? a[0] : null
  const metodo = (a[1]?.method ?? req?.method ?? 'GET').toUpperCase()
  if (metodo === 'GET' || metodo === 'HEAD') return
  const m = /\/rest\/v1\/(rpc\/)?([^/?#]+)/.exec(String(req?.url ?? a[0]))
  if (!m) return
  const nome = decodeURIComponent(m[2])
  if (m[1] && SO_LEITURA.test(nome)) return
  const t = m[1] ? '*' : nome
  aoGravar.forEach((f) => { try { f(t) } catch { /* um ouvinte com erro não impede os outros */ } })
}

const fetchComAviso: typeof fetch = async (...a) => {
  try { const r = await fetch(...a); avisarGravacao(a, r); return r } catch (e) {
    if (e instanceof TypeError) {
      const x = new Error('confira a internet e tente de novo (a tela se atualiza sozinha quando a conexão volta).')
      x.name = 'Sem conexão com o servidor'
      throw x
    }
    throw e
  }
}

// Sem as variáveis (.env.local), a tela mostra um aviso em vez de quebrar.
export const supabase = createClient(url ?? 'http://localhost', chave ?? 'sem-chave', {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: fetchComAviso },
})
