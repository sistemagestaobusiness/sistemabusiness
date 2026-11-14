// Camada única de dados ao vivo. TODA tela lê por aqui, então nenhuma tela "esquece" de se atualizar
// (lição da Drogarema, onde a atualização foi colocada tela por tela depois).
//
// Como funciona:
// 1. Um único canal Realtime escuta as tabelas do sistema. O banco empurra cada mudança na hora.
// 2. Cada consulta declara de quais tabelas depende; quando uma delas muda, a consulta recarrega sozinha.
// 3. Se a conexão cair, ou a aba ficar escondida e voltar, tudo recarrega (pode ter perdido aviso no meio).
// 4. Recarregar troca só os dados: janelas abertas e o que está sendo digitado continuam onde estavam.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Tabela = 'espacos' | 'espaco_membros' | 'contas' | 'clientes' | 'fornecedores' | 'categorias' | 'recorrencias' | 'lancamentos' | 'extrato_linhas'
const TABELAS: Tabela[] = ['espacos', 'espaco_membros', 'contas', 'clientes', 'fornecedores', 'categorias', 'recorrencias', 'lancamentos', 'extrato_linhas']

type Ouvinte = (t: Tabela | '*') => void
const ouvintes = new Set<Ouvinte>()
let canal: RealtimeChannel | null = null
let estado: 'conectando' | 'ao vivo' | 'desconectado' = 'desconectado'
let ultimaAtualizacao: Date | null = null
const ouvintesEstado = new Set<() => void>()

function avisar(t: Tabela | '*') {
  ultimaAtualizacao = new Date()
  ouvintes.forEach((o) => o(t))
  ouvintesEstado.forEach((o) => o())
}
function mudarEstado(e: typeof estado) {
  const caiu = estado === 'desconectado' && e === 'ao vivo' && ultimaAtualizacao !== null
  estado = e
  ouvintesEstado.forEach((o) => o())
  if (caiu) avisar('*') // voltou depois de cair: recarrega tudo
}

export function ligarTempoReal() {
  if (canal) return
  mudarEstado('conectando')
  let c = supabase.channel('sistema-business')
  for (const t of TABELAS) {
    c = c.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => avisar(t))
  }
  canal = c.subscribe((s) => {
    if (s === 'SUBSCRIBED') mudarEstado('ao vivo')
    else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') mudarEstado('desconectado')
  })
}

export function desligarTempoReal() {
  if (canal) supabase.removeChannel(canal)
  canal = null
  mudarEstado('desconectado')
}

// aba escondida e de volta: recarrega tudo (o navegador pode ter congelado a conexão)
let escondidaEm = 0
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) escondidaEm = Date.now()
    else if (escondidaEm && Date.now() - escondidaEm > 30_000) avisar('*')
  })
  window.addEventListener('online', () => avisar('*'))
}

export function useEstadoTempoReal() {
  return useSyncExternalStore(
    (cb) => { ouvintesEstado.add(cb); return () => { ouvintesEstado.delete(cb) } },
    () => `${estado}|${ultimaAtualizacao?.getTime() ?? 0}`,
  )
}

// Consulta ao vivo: `depende` diz quais tabelas, `chave` muda quando os filtros mudam.
export function useAoVivo<T>(depende: Tabela[], buscar: () => Promise<T>, chave: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const buscarRef = useRef(buscar)
  buscarRef.current = buscar
  const dependeKey = depende.join(',')

  useEffect(() => {
    let vivo = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let seq = 0
    const carregar = async () => {
      const meu = ++seq
      try {
        const r = await buscarRef.current()
        if (vivo && meu === seq) { setDados(r); setErro(null) }
      } catch (e) {
        if (vivo && meu === seq) setErro(e instanceof Error ? e.message : String(e))
      }
    }
    carregar()
    const deps = new Set(dependeKey.split(','))
    const ouvinte: Ouvinte = (t) => {
      if (t !== '*' && !deps.has(t)) return
      clearTimeout(timer)
      timer = setTimeout(carregar, 150) // junta várias mudanças seguidas (ex.: ajuste em massa)
    }
    ouvintes.add(ouvinte)
    return () => { vivo = false; clearTimeout(timer); ouvintes.delete(ouvinte) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependeKey, ...chave])

  return { dados, erro }
}
