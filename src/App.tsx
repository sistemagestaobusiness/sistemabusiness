import { useEffect, useState } from 'react'
import { configurado, supabase } from './lib/supabase'
import { desligarTempoReal, ligarTempoReal, useEstadoTempoReal } from './lib/vivo'
import { useVersaoNova } from './lib/versao'
import { useInatividade, useSessao } from './auth/sessao'
import { Login } from './auth/Login'
import { Fluxo } from './telas/Fluxo'
import { Lancamentos } from './telas/Lancamentos'
import { Cadastros } from './telas/Cadastros'

const TELAS = { fluxo: 'Fluxo de caixa', lancamentos: 'Lançamentos', cadastros: 'Cadastros' } as const
type Tela = keyof typeof TELAS
const telaDoEndereco = (): Tela => { const h = location.hash.slice(1); return h in TELAS ? (h as Tela) : 'fluxo' }

export default function App() {
  const { sessao, etapa } = useSessao()
  const versaoNova = useVersaoNova()
  const saindo = useInatividade(etapa === 'dentro')
  const [tela, setTela] = useState<Tela>(telaDoEndereco)
  useEffect(() => { const f = () => setTela(telaDoEndereco()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])

  useEffect(() => {
    if (etapa === 'dentro') ligarTempoReal()
    else desligarTempoReal()
  }, [etapa])

  if (!configurado) return <div className="login"><div className="login-card"><h1>Sistema Business</h1><p>Falta configurar a conexão com o banco (arquivo .env.local).</p></div></div>
  if (etapa === 'carregando') return <div className="login"><p>Carregando…</p></div>
  if (etapa !== 'dentro') return <Login etapa={etapa} />

  return (
    <div className="app">
      {versaoNova && (
        <div className="faixa-versao">O sistema foi atualizado. <button onClick={() => location.reload()}>Atualizar agora</button></div>
      )}
      {saindo && <div className="faixa-versao">Sem uso há 28 minutos: o sistema sai em 2 minutos. Mexa o mouse para continuar.</div>}
      <header className="topo">
        <strong>Business</strong>
        <nav>{(Object.keys(TELAS) as Tela[]).map((t) => <a key={t} href={`#${t}`} className={tela === t ? 'ativo' : ''}>{TELAS[t]}</a>)}</nav>
        <IndicadorAoVivo />
        <span className="usuario">{sessao?.user.email}</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sair</button>
      </header>
      <main>{tela === 'fluxo' ? <Fluxo /> : tela === 'lancamentos' ? <Lancamentos /> : <Cadastros />}</main>
    </div>
  )
}

function IndicadorAoVivo() {
  const [estado, ts] = useEstadoTempoReal().split('|')
  const hora = Number(ts) ? new Date(Number(ts)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null
  return (
    <span className={`aovivo ${estado === 'ao vivo' ? 'ok' : 'off'}`} title={hora ? `Última mudança recebida às ${hora}` : ''}>
      ● {estado === 'ao vivo' ? 'ao vivo' : estado === 'conectando' ? 'conectando…' : 'sem conexão, tentando de novo'}
    </span>
  )
}
