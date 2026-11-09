import './linkSenha' // precisa ler o endereço antes do createClient
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const configurado = Boolean(url && chave)

// Queda de internet aparece como "TypeError: Failed to fetch": troca por uma mensagem que diz o que fazer.
// A tela mostra "nome: mensagem" do erro, por isso o nome vira "Sem conexão com o servidor".
const fetchComAviso: typeof fetch = async (...a) => {
  try { return await fetch(...a) } catch (e) {
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
