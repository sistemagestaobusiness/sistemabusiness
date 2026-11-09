import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAoVivo } from '../lib/vivo'
import { dataBR, diasDoMes, isoDia, lerValor, moeda } from '../lib/formato'

import { dados, todas, type Categoria, type Lancamento } from '../lib/tipos'

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

type Modo = 'dias' | 'meses'
const CHAVE_MODO = 'business_fluxo_modo'
const lerModo = (): Modo => { try { return localStorage.getItem(CHAVE_MODO) === 'meses' ? 'meses' : 'dias' } catch { return 'dias' } }

// Duas visões da mesma grade: dia a dia de um mês, ou o ano fechado por mês (para olhar a projeção).
export function Fluxo() {
  const hoje = new Date()
  const [modo, setModoBruto] = useState<Modo>(lerModo)
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false)
  const setModo = (m: Modo) => { setModoBruto(m); try { localStorage.setItem(CHAVE_MODO, m) } catch { /* só não lembra */ } }
  const alternar = (
    <span className="alternar">
      <button className={modo === 'dias' ? 'ativo' : ''} onClick={() => setModo('dias')}>Dias</button>
      <button className={modo === 'meses' ? 'ativo' : ''} onClick={() => setModo('meses')}>Meses</button>
    </span>
  )
  const arquivadas = <label className="check"><input type="checkbox" checked={mostrarArquivadas} onChange={(e) => setMostrarArquivadas(e.target.checked)} /> mostrar arquivadas</label>
  return modo === 'dias'
    ? <FluxoDias {...{ ano, setAno, mes, setMes, mostrarArquivadas }} topo={<>{alternar}{arquivadas}</>} />
    : <FluxoMeses {...{ ano, setAno, mostrarArquivadas }} topo={<>{alternar}{arquivadas}</>}
        abrirMes={(m) => { setMes(m); setModo('dias') }} />
}

type PropsDias = { ano: number; setAno: (n: number) => void; mes: number; setMes: (n: number) => void; mostrarArquivadas: boolean; topo: ReactNode }

function FluxoDias({ ano, setAno, mes, setMes, mostrarArquivadas, topo }: PropsDias) {
  const hoje = new Date()
  const [celula, setCelula] = useState<{ categoria: Categoria; dia: string } | null>(null)

  const dias = useMemo(() => diasDoMes(ano, mes), [ano, mes])
  const ini = dias[0], fim = dias[dias.length - 1]

  const cats = useAoVivo(['categorias'], () =>
    dados<Categoria[]>(supabase.from('categorias').select('*').order('ordem')))
  const lancs = useAoVivo(['lancamentos'], () =>
    todas<Lancamento>((de, ate) => supabase.from('lancamentos').select('id,data,valor,categoria_id,descricao,status,versao,recorrencia_id')
      .is('excluido_em', null).gte('data', ini).lte('data', fim).order('id').range(de, ate)), [ini, fim])
  // saldo vem do banco: tudo que aconteceu antes do dia 1 do mês, de todas as contas
  const saldoIni = useAoVivo(['lancamentos', 'contas', 'categorias'], () =>
    dados<number>(supabase.rpc('fn_saldo_ate', { p_data: ini })), [ini])

  const porCelula = useMemo(() => {
    const m = new Map<string, Lancamento[]>()
    for (const l of lancs.dados ?? []) {
      const k = `${l.categoria_id}|${l.data}`
      m.set(k, [...(m.get(k) ?? []), l])
    }
    return m
  }, [lancs.dados])

  const comMovimento = useMemo(() => new Set((lancs.dados ?? []).map((l) => l.categoria_id)), [lancs.dados])
  // arquivada some da grade, MAS aparece se tiver lançamento no mês (senão o saldo mudaria sem mostrar o porquê)
  const visiveis = (cats.dados ?? []).filter((c) => mostrarArquivadas || !c.arquivada || comMovimento.has(c.id))
  const tipoDe = useMemo(() => new Map((cats.dados ?? []).map((c) => [c.id, c.tipo])), [cats.dados])

  const totalDia = (dia: string, tipo: 'ENTRADA' | 'SAIDA') =>
    (lancs.dados ?? []).filter((l) => l.data === dia && tipoDe.get(l.categoria_id) === tipo).reduce((a, l) => a + Number(l.valor), 0)
  const saldos = useMemo(() => {
    let s = Number(saldoIni.dados ?? 0)
    return dias.map((d) => (s += totalDia(d, 'ENTRADA') - totalDia(d, 'SAIDA')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias, lancs.dados, saldoIni.dados, tipoDe])

  const secoes = (tipo: 'ENTRADA' | 'SAIDA') => {
    const lista = visiveis.filter((c) => c.tipo === tipo)
    return [...new Set(lista.map((c) => c.secao))].map((s) => ({ secao: s, cats: lista.filter((c) => c.secao === s) }))
  }
  const hojeIso = isoDia(hoje)
  const erro = cats.erro || lancs.erro || saldoIni.erro

  const linha = (c: Categoria) => {
    const total = dias.reduce((a, d) => a + (porCelula.get(`${c.id}|${d}`) ?? []).reduce((x, l) => x + Number(l.valor), 0), 0)
    return (
      <tr key={c.id} className={c.arquivada ? 'arquivada' : ''} style={c.cor ? { background: c.cor } : undefined}>
        <th className="fixa" style={c.cor ? { background: c.cor } : undefined}>{c.nome}{c.arquivada && <span className="tag">arquivada</span>}</th>
        {dias.map((d) => {
          const ls = porCelula.get(`${c.id}|${d}`) ?? []
          const v = ls.reduce((x, l) => x + Number(l.valor), 0)
          const previsto = ls.length > 0 && ls.every((l) => l.status === 'PREVISTO')
          return (
            <td key={d} className={`cel ${previsto ? 'previsto' : ''} ${d === hojeIso ? 'hoje' : ''}`}
                onClick={() => setCelula({ categoria: c, dia: d })} title={ls.map((l) => l.descricao).filter(Boolean).join('\n')}>
              {v ? moeda(v) : ''}
            </td>
          )
        })}
        <td className="total">{total ? moeda(total) : ''}</td>
      </tr>
    )
  }

  const blocoTipo = (tipo: 'ENTRADA' | 'SAIDA', titulo: string) => (
    <>
      {secoes(tipo).map(({ secao, cats: cs }) => (
        <tbody key={tipo + secao}>
          <tr className="secao"><th className="fixa" colSpan={1}>{secao}</th><td colSpan={dias.length + 1} /></tr>
          {cs.map(linha)}
        </tbody>
      ))}
      <tbody>
        <tr className="soma">
          <th className="fixa">{titulo}</th>
          {dias.map((d) => { const v = totalDia(d, tipo); return <td key={d}>{v ? moeda(v) : ''}</td> })}
          <td className="total">{moeda(dias.reduce((a, d) => a + totalDia(d, tipo), 0))}</td>
        </tr>
      </tbody>
    </>
  )

  return (
    <section>
      <div className="barra">
        <button onClick={() => { if (mes === 1) { setMes(12); setAno(ano - 1) } else setMes(mes - 1) }}>‹</button>
        <strong>{MESES[mes - 1]} / {ano}</strong>
        <button onClick={() => { if (mes === 12) { setMes(1); setAno(ano + 1) } else setMes(mes + 1) }}>›</button>
        <button onClick={() => { setMes(hoje.getMonth() + 1); setAno(hoje.getFullYear()) }}>Hoje</button>
        {topo}
        <span className="legenda"><i className="previsto" /> previsto (projeção) · clique na célula para lançar</span>
      </div>
      {erro && <p className="aviso">Não consegui carregar: {erro}</p>}
      <div className="grade">
        <table>
          <thead>
            <tr><th className="fixa">Saldo inicial: {moeda(Number(saldoIni.dados ?? 0))}</th>
              {dias.map((d) => <th key={d} className={d === hojeIso ? 'hoje' : ''}>{d.slice(8)}</th>)}
              <th>Total</th></tr>
          </thead>
          {blocoTipo('ENTRADA', 'Total entradas')}
          {blocoTipo('SAIDA', 'Total pagamentos')}
          <tbody>
            <tr className="saldo">
              <th className="fixa">Saldo</th>
              {saldos.map((s, i) => <td key={dias[i]} className={s < 0 ? 'neg' : ''}>{moeda(s)}</td>)}
              <td className="total">{moeda(saldos[saldos.length - 1] ?? 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {celula && (
        <JanelaCelula categoria={celula.categoria} dia={celula.dia}
          lancamentos={porCelula.get(`${celula.categoria.id}|${celula.dia}`) ?? []} fechar={() => setCelula(null)} />
      )}
    </section>
  )
}

type PropsMeses = { ano: number; setAno: (n: number) => void; mostrarArquivadas: boolean; topo: ReactNode; abrirMes: (m: number) => void }

// Ano fechado por mês: cada célula é a soma do mês; saldo no fim de cada mês. Clique leva para o mês, dia a dia.
function FluxoMeses({ ano, setAno, mostrarArquivadas, topo, abrirMes }: PropsMeses) {
  const hoje = new Date()
  const meses = Array.from({ length: 12 }, (_, i) => i + 1)
  const ini = `${ano}-01-01`, fim = `${ano}-12-31`
  const mesAtual = hoje.getFullYear() === ano ? hoje.getMonth() + 1 : 0

  const cats = useAoVivo(['categorias'], () =>
    dados<Categoria[]>(supabase.from('categorias').select('*').order('ordem')))
  const lancs = useAoVivo(['lancamentos'], () =>
    todas<Lancamento>((de, ate) => supabase.from('lancamentos').select('id,data,valor,categoria_id,descricao,status,versao,recorrencia_id')
      .is('excluido_em', null).gte('data', ini).lte('data', fim).order('id').range(de, ate)), [ini, fim])
  // saldo vem do banco: tudo antes de 1º de janeiro, de todas as contas
  const saldoIni = useAoVivo(['lancamentos', 'contas', 'categorias'], () =>
    dados<number>(supabase.rpc('fn_saldo_ate', { p_data: ini })), [ini])

  const porCelula = useMemo(() => {
    const m = new Map<string, Lancamento[]>()
    for (const l of lancs.dados ?? []) {
      const k = `${l.categoria_id}|${Number(l.data.slice(5, 7))}`
      m.set(k, [...(m.get(k) ?? []), l])
    }
    return m
  }, [lancs.dados])
  const comMovimento = useMemo(() => new Set((lancs.dados ?? []).map((l) => l.categoria_id)), [lancs.dados])
  const visiveis = (cats.dados ?? []).filter((c) => mostrarArquivadas || !c.arquivada || comMovimento.has(c.id))
  const tipoDe = useMemo(() => new Map((cats.dados ?? []).map((c) => [c.id, c.tipo])), [cats.dados])

  const totais = useMemo(() => {
    const t = meses.map(() => ({ ENTRADA: 0, SAIDA: 0 }))
    for (const l of lancs.dados ?? []) {
      const tipo = tipoDe.get(l.categoria_id)
      if (tipo) t[Number(l.data.slice(5, 7)) - 1][tipo] += Number(l.valor)
    }
    return t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lancs.dados, tipoDe])
  const saldos = useMemo(() => {
    let s = Number(saldoIni.dados ?? 0)
    return totais.map((t) => (s += t.ENTRADA - t.SAIDA))
  }, [totais, saldoIni.dados])

  const secoes = (tipo: 'ENTRADA' | 'SAIDA') => {
    const lista = visiveis.filter((c) => c.tipo === tipo)
    return [...new Set(lista.map((c) => c.secao))].map((s) => ({ secao: s, cats: lista.filter((c) => c.secao === s) }))
  }
  const erro = cats.erro || lancs.erro || saldoIni.erro

  const linha = (c: Categoria) => {
    let total = 0
    return (
      <tr key={c.id} className={c.arquivada ? 'arquivada' : ''} style={c.cor ? { background: c.cor } : undefined}>
        <th className="fixa" style={c.cor ? { background: c.cor } : undefined}>{c.nome}{c.arquivada && <span className="tag">arquivada</span>}</th>
        {meses.map((m) => {
          const ls = porCelula.get(`${c.id}|${m}`) ?? []
          const v = ls.reduce((x, l) => x + Number(l.valor), 0)
          total += v
          const prev = ls.filter((l) => l.status === 'PREVISTO').reduce((x, l) => x + Number(l.valor), 0)
          const classe = ls.length && ls.every((l) => l.status === 'PREVISTO') ? 'previsto' : ''
          return (
            <td key={m} className={`cel mes ${classe} ${m === mesAtual ? 'hoje' : ''}`} onClick={() => abrirMes(m)}
                title={prev && !classe ? `${moeda(prev)} ainda previsto` : 'Abrir o mês dia a dia'}>
              {v ? moeda(v) : ''}
            </td>
          )
        })}
        <td className="total">{total ? moeda(total) : ''}</td>
      </tr>
    )
  }
  const blocoTipo = (tipo: 'ENTRADA' | 'SAIDA', titulo: string) => (
    <>
      {secoes(tipo).map(({ secao, cats: cs }) => (
        <tbody key={tipo + secao}>
          <tr className="secao"><th className="fixa">{secao}</th><td colSpan={13} /></tr>
          {cs.map(linha)}
        </tbody>
      ))}
      <tbody>
        <tr className="soma">
          <th className="fixa">{titulo}</th>
          {totais.map((t, i) => <td key={i}>{t[tipo] ? moeda(t[tipo]) : ''}</td>)}
          <td className="total">{moeda(totais.reduce((a, t) => a + t[tipo], 0))}</td>
        </tr>
      </tbody>
    </>
  )

  return (
    <section>
      <div className="barra">
        <button onClick={() => setAno(ano - 1)}>‹</button>
        <strong>{ano}</strong>
        <button onClick={() => setAno(ano + 1)}>›</button>
        <button onClick={() => setAno(hoje.getFullYear())}>Hoje</button>
        {topo}
        <span className="legenda"><i className="previsto" /> mês todo previsto · clique no mês para ver dia a dia</span>
      </div>
      {erro && <p className="aviso">Não consegui carregar: {erro}</p>}
      <div className="grade">
        <table className="meses">
          <thead>
            <tr><th className="fixa">Saldo inicial: {moeda(Number(saldoIni.dados ?? 0))}</th>
              {meses.map((m) => <th key={m} className={m === mesAtual ? 'hoje' : ''}>{MESES[m - 1].slice(0, 3)}</th>)}
              <th>Total</th></tr>
          </thead>
          {blocoTipo('ENTRADA', 'Total entradas')}
          {blocoTipo('SAIDA', 'Total pagamentos')}
          <tbody>
            <tr className="soma">
              <th className="fixa">Resultado do mês</th>
              {totais.map((t, i) => { const r = t.ENTRADA - t.SAIDA; return <td key={i} className={r < 0 ? 'neg' : ''}>{moeda(r)}</td> })}
              <td className="total">{moeda(totais.reduce((a, t) => a + t.ENTRADA - t.SAIDA, 0))}</td>
            </tr>
            <tr className="saldo">
              <th className="fixa">Saldo no fim do mês</th>
              {saldos.map((s, i) => <td key={i} className={s < 0 ? 'neg' : ''}>{moeda(s)}</td>)}
              <td className="total">{moeda(saldos[11] ?? 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

// A janela recebe os lançamentos AO VIVO: se o Rodrigo lançar na mesma célula, aparece aqui sem fechar a janela.
function JanelaCelula({ categoria, dia, lancamentos, fechar }: { categoria: Categoria; dia: string; lancamentos: Lancamento[]; fechar: () => void }) {
  const [editando, setEditando] = useState<Lancamento | null>(null)
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [status, setStatus] = useState<Lancamento['status']>(() => (dia <= isoDia(new Date()) ? 'REALIZADO' : 'PREVISTO'))
  const [msg, setMsg] = useState('')

  const editar = (l: Lancamento) => { setEditando(l); setValor(moeda(Number(l.valor))); setDescricao(l.descricao ?? ''); setStatus(l.status); setMsg('') }
  const limpar = () => { setEditando(null); setValor(''); setDescricao(''); setMsg('') }

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    const v = lerValor(valor)
    if (!v) { setMsg('Valor inválido.'); return }
    if (editando) {
      // só grava se ninguém alterou esse lançamento enquanto você editava
      const { data, error } = await supabase.from('lancamentos')
        .update({ valor: v, descricao: descricao || null, status }).eq('id', editando.id).eq('versao', editando.versao).select('id')
      if (error) { setMsg(error.message); return }
      if (!data?.length) { setMsg('Esse lançamento foi alterado por outra pessoa enquanto você editava. Confira o valor atual na lista e edite de novo.'); return }
    } else {
      const { error } = await supabase.from('lancamentos').insert({ data: dia, valor: v, categoria_id: categoria.id, descricao: descricao || null, status })
      if (error) { setMsg(error.message); return }
    }
    fechar() // salvou: fecha e volta para a grade
  }
  const excluir = async (l: Lancamento) => {
    if (!confirm('Mandar este lançamento para a lixeira?')) return
    const { error } = await supabase.from('lancamentos').update({ excluido_em: new Date().toISOString() }).eq('id', l.id).eq('versao', l.versao)
    if (error) setMsg(error.message)
    if (editando?.id === l.id) limpar()
  }

  return (
    <div className="fundo" onClick={fechar}>
      <div className="janela" onClick={(e) => e.stopPropagation()}>
        <header><div><strong>{categoria.nome}</strong><span>{dataBR(dia)} · {categoria.tipo === 'ENTRADA' ? 'Entrada' : 'Pagamento'}</span></div>
          <button className="link" onClick={fechar}>Fechar</button></header>
        {lancamentos.length > 0 && (
          <ul className="lista">
            {lancamentos.map((l) => (
              <li key={l.id} className={editando?.id === l.id ? 'ativo' : ''}>
                <span className="valor">{moeda(Number(l.valor))}</span>
                <span className="desc">{l.descricao || '—'}</span>
                <span className={`status s-${l.status.toLowerCase()}`}>{l.status.toLowerCase()}</span>
                <button className="link" onClick={() => editar(l)}>editar</button>
                <button className="link" onClick={() => excluir(l)}>excluir</button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={salvar}>
          <h3>{editando ? 'Editar lançamento' : 'Novo lançamento'}</h3>
          <label>Valor<input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="1.234,56 ou =1000+500" autoFocus required /></label>
          <label>Descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
          <label>Situação
            <select value={status} onChange={(e) => setStatus(e.target.value as Lancamento['status'])}>
              <option value="PREVISTO">Previsto</option><option value="REALIZADO">Realizado</option><option value="CONCILIADO">Conciliado</option>
            </select>
          </label>
          {msg && <p className="aviso">{msg}</p>}
          <div className="acoes">{editando && <button type="button" className="link" onClick={limpar}>Cancelar edição</button>}<button>Salvar</button></div>
        </form>
      </div>
    </div>
  )
}
