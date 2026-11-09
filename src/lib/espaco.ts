// Espaço atual (Business, Pessoal…). Cada espaço tem dados separados; quem pode ver cada um é decidido
// pelo banco (espaco_membros + RLS). A tela só escolhe qual dos espaços da pessoa está aberto.
import { useSyncExternalStore } from 'react'

const CHAVE = 'business_espaco'
let atual = (() => { try { return Number(localStorage.getItem(CHAVE)) || 1 } catch { return 1 } })()
const ouvintes = new Set<() => void>()

export function setEspaco(id: number) {
  if (id === atual) return
  atual = id
  try { localStorage.setItem(CHAVE, String(id)) } catch { /* só não lembra na próxima vez */ }
  ouvintes.forEach((o) => o())
}

export function useEspaco() {
  return useSyncExternalStore((cb) => { ouvintes.add(cb); return () => { ouvintes.delete(cb) } }, () => atual)
}

// para consultas e gravações: a tela inteira é remontada quando o espaço muda (App usa key={espaço})
export const espacoId = () => atual
