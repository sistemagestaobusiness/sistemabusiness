import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type Etapa = 'carregando' | 'entrar' | 'cadastrar-2fa' | 'confirmar-2fa' | 'dentro'

// Login em duas etapas obrigatório: e-mail e senha (aal1) e depois o código do app autenticador (aal2).
// O banco só libera os dados com aal2 (função mfa_ok), então pular a tela não adianta.
export function useSessao() {
  const [sessao, setSessao] = useState<Session | null>(null)
  const [etapa, setEtapa] = useState<Etapa>('carregando')

  useEffect(() => {
    const avaliar = async (s: Session | null) => {
      setSessao(s)
      if (!s) { setEtapa('entrar'); return }
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (data?.currentLevel === 'aal2') setEtapa('dentro')
      else if (data?.nextLevel === 'aal2') setEtapa('confirmar-2fa')
      else setEtapa('cadastrar-2fa')
    }
    supabase.auth.getSession().then(({ data }) => avaliar(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setTimeout(() => avaliar(s), 0) })
    return () => sub.subscription.unsubscribe()
  }, [])

  return { sessao, etapa }
}
