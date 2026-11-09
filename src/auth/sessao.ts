import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type Etapa = 'carregando' | 'entrar' | 'dentro'

// Login com e-mail e senha (como na Drogarema). Quem protege os dados é o banco: sem perfil cadastrado, não vê nada.
export function useSessao() {
  const [sessao, setSessao] = useState<Session | null>(null)
  const [etapa, setEtapa] = useState<Etapa>('carregando')
  useEffect(() => {
    const avaliar = (s: Session | null) => { setSessao(s); setEtapa(s ? 'dentro' : 'entrar') }
    supabase.auth.getSession().then(({ data }) => avaliar(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => avaliar(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  return { sessao, etapa }
}

// Sai sozinho depois de 30 min sem uso, com aviso 2 min antes (mesma regra da Drogarema).
// Vale para todas as abas abertas: o último uso fica no localStorage.
const LIMITE = 30 * 60_000, AVISO = 2 * 60_000, CHAVE = 'business_ultimo_uso'
export function useInatividade(ativo: boolean) {
  const [avisando, setAvisando] = useState(false)
  useEffect(() => {
    if (!ativo) return
    let gravado = 0
    const marcar = () => {
      const agora = Date.now()
      if (agora - gravado > 5000) { gravado = agora; try { localStorage.setItem(CHAVE, String(agora)) } catch { /* sem localStorage: conta só esta aba */ } }
      setAvisando(false)
    }
    marcar()
    const eventos = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const
    eventos.forEach((e) => window.addEventListener(e, marcar, { passive: true }))
    const id = setInterval(() => {
      let ultimo = gravado
      try { ultimo = Math.max(ultimo, Number(localStorage.getItem(CHAVE) || 0)) } catch { /* idem */ }
      const parado = Date.now() - ultimo
      if (parado >= LIMITE) supabase.auth.signOut()
      else setAvisando(parado >= LIMITE - AVISO)
    }, 15_000)
    return () => { clearInterval(id); eventos.forEach((e) => window.removeEventListener(e, marcar)) }
  }, [ativo])
  return avisando
}
