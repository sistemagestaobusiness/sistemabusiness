// Versão nova publicada: os arquivos das telas têm nome único a cada entrega (build do Vite),
// então não existe tela velha presa no cache. Só o index.html poderia ficar velho numa aba aberta;
// por isso a tela confere versao.json (sem cache) ao voltar para a aba e a cada 5 minutos.
import { useEffect, useState } from 'react'

declare const __VERSAO__: string

async function lerVersao(): Promise<string | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}versao.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    return ((await r.json()) as { versao: string }).versao
  } catch { return null }
}

export function useVersaoNova() {
  const [nova, setNova] = useState(false)
  useEffect(() => {
    if (import.meta.env.DEV) return
    const conferir = async () => { const v = await lerVersao(); if (v && v !== __VERSAO__) setNova(true) }
    const id = setInterval(conferir, 5 * 60_000)
    const foco = () => { if (!document.hidden) conferir() }
    document.addEventListener('visibilitychange', foco)
    conferir()
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', foco) }
  }, [])
  return nova
}
