import { useEffect, useState } from 'react'
import { configurado, supabase } from './lib/supabase'
import { desligarTempoReal, ligarTempoReal, useAoVivo, useEstadoTempoReal } from './lib/vivo'
import { setEspaco, useEspaco } from './lib/espaco'
import { dados } from './lib/tipos'
import { useVersaoNova } from './lib/versao'
import { useInatividade, useSessao } from './auth/sessao'
import { FormSenha, Login } from './auth/Login'
import { Fluxo } from './telas/Fluxo'
import { Lancamentos } from './telas/Lancamentos'
import { Cadastros } from './telas/Cadastros'
import { Conciliacao } from './telas/Conciliacao'

const TELAS = { fluxo: 'Fluxo de caixa', lancamentos: 'Lançamentos', conciliacao: 'Conciliação', cadastros: 'Cadastros' } as const
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

  return <Dentro email={sessao?.user.email} versaoNova={versaoNova} saindo={saindo} tela={tela} />
}

type Espaco = { id: number; nome: string }

function Dentro({ email, versaoNova, saindo, tela }: { email?: string; versaoNova: boolean; saindo: boolean; tela: Tela }) {
  const [trocandoSenha, setTrocandoSenha] = useState(false)
  const [senhaTrocada, setSenhaTrocada] = useState(false)
  // espaços que a pessoa pode ver (o banco só devolve os dela). Business sempre é o 1.
  const espacos = useAoVivo(['espacos'], () => dados<Espaco[]>(supabase.from('espacos').select('id,nome').order('id')))
  const esp = useEspaco()
  const lista = espacos.dados ?? []
  const valido = lista.some((e) => e.id === esp)
  const primeiro = lista[0]?.id
  useEffect(() => { if (primeiro !== undefined && !valido) setEspaco(primeiro) }, [primeiro, valido])
  const nome = lista.find((e) => e.id === esp)?.nome ?? 'Business'

  return (
    <div className="app">
      {versaoNova && (
        <div className="faixa-versao">O sistema foi atualizado. <button onClick={() => location.reload()}>Atualizar agora</button></div>
      )}
      {saindo && <div className="faixa-versao">Sem uso há 28 minutos: o sistema sai em 2 minutos. Mexa o mouse para continuar.</div>}
      <header className="topo">
        {lista.length > 1
          ? <select className="espaco" value={esp} onChange={(e) => setEspaco(Number(e.target.value))} title="Controle aberto">
              {lista.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
          : <strong>{nome}</strong>}
        <nav>{(Object.keys(TELAS) as Tela[]).map((t) => <a key={t} href={`#${t}`} className={tela === t ? 'ativo' : ''}>{TELAS[t]}</a>)}</nav>
        <IndicadorAoVivo />
        <span className="usuario">{email}</span>
        <button className="link" onClick={() => { setTrocandoSenha(true); setSenhaTrocada(false) }}>Trocar senha</button>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sair</button>
      </header>
      {trocandoSenha && (
        <div className="fundo" onClick={() => setTrocandoSenha(false)}>
          <div className="janela login-card" onClick={(e) => e.stopPropagation()}>
            <header><strong>Trocar senha</strong><button className="link" onClick={() => setTrocandoSenha(false)}>Fechar</button></header>
            {senhaTrocada ? <p>Senha trocada. Use a nova no próximo acesso.</p>
              : <FormSenha emailAtual={email} aoTerminar={() => setSenhaTrocada(true)} />}
          </div>
        </div>
      )}
      {espacos.erro && <p className="aviso">Não consegui carregar: {espacos.erro}</p>}
      {valido && <main key={esp}>{tela === 'fluxo' ? <Fluxo /> : tela === 'lancamentos' ? <Lancamentos /> : tela === 'conciliacao' ? <Conciliacao /> : <Cadastros />}</main>}
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
