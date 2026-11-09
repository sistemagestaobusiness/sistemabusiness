import { useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAoVivo } from '../lib/vivo'
import { dataBR, isoDia, lerValor, moeda } from '../lib/formato'
import { proximoDiaUtil } from '../lib/feriados'
import { dados, todas, type Categoria, type Lancamento, type Recorrencia, type Status } from '../lib/tipos'

export function Lancamentos() {
  const hoje = new Date()
  const [de, setDe] = useState(isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 1)))
  const [ate, setAte] = useState(isoDia(new Date(hoje.getFullYear(), hoje.getMonth() + 12, 0)))
  const [categoria, setCategoria] = useState('')
  const [status, setStatus] = useState('')
  const [texto, setTexto] = useState('')
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [aberto, setAberto] = useState<Lancamento | 'novo' | null>(null)

  const cats = useAoVivo(['categorias'], () => dados<Categoria[]>(supabase.from('categorias').select('*').order('ordem')))
  const lancs = useAoVivo(['lancamentos'], () => todas<Lancamento>((a, b) => {
    let q = supabase.from('lancamentos').select('id,data,valor,categoria_id,descricao,status,versao,recorrencia_id')
      .is('excluido_em', null).gte('data', de).lte('data', ate)
    if (categoria) q = q.eq('categoria_id', Number(categoria))
    if (status) q = q.eq('status', status)
    if (texto.trim()) q = q.ilike('descricao', `%${texto.trim()}%`)
    return q.order('data').order('id').range(a, b)
  }), [de, ate, categoria, status, texto])

  const nomeCat = useMemo(() => new Map((cats.dados ?? []).map((c) => [c.id, c])), [cats.dados])
  const lista = lancs.dados ?? []
  // a seleção só vale para o que está na lista agora (se alguém excluir, sai da seleção sozinho)
  const selecionados = lista.filter((l) => sel.has(l.id))
  const total = (ls: Lancamento[]) => ls.reduce((a, l) => a + (nomeCat.get(l.categoria_id)?.tipo === 'SAIDA' ? -1 : 1) * Number(l.valor), 0)
  const alternar = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <section className="pagina">
      <div className="titulo"><h2>Lançamentos</h2><button className="primario" onClick={() => setAberto('novo')}>+ Novo lançamento</button></div>
      <div className="filtros">
        <label>De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label>Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        <label>Linha do fluxo<SelectCategoria cats={cats.dados ?? []} value={categoria} onChange={setCategoria} vazio="Todas" /></label>
        <label>Situação<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option><option value="PREVISTO">Previsto</option><option value="REALIZADO">Realizado</option><option value="CONCILIADO">Conciliado</option></select></label>
        <label>Descrição contém<input value={texto} onChange={(e) => setTexto(e.target.value)} /></label>
      </div>
      {(lancs.erro || cats.erro) && <p className="aviso">{lancs.erro || cats.erro}</p>}

      {selecionados.length > 0 && <AjusteMassa ids={selecionados.map((l) => l.id)} cats={cats.dados ?? []} total={total(selecionados)} limpar={() => setSel(new Set())} />}

      <div className="tabela">
        <table>
          <thead><tr>
            <th><input type="checkbox" checked={lista.length > 0 && selecionados.length === lista.length}
              onChange={(e) => setSel(e.target.checked ? new Set(lista.map((l) => l.id)) : new Set())} /></th>
            <th>Data</th><th>Linha do fluxo</th><th>Descrição</th><th>Situação</th><th className="num">Valor</th></tr></thead>
          <tbody>
            {lista.map((l) => {
              const c = nomeCat.get(l.categoria_id)
              return (
                <tr key={l.id} className={`clicavel ${sel.has(l.id) ? 'sel' : ''}`} onClick={() => setAberto(l)} title="Clique para editar">
                  <td onClick={(e) => { e.stopPropagation(); alternar(l.id) }}><input type="checkbox" checked={sel.has(l.id)} readOnly /></td>
                  <td>{dataBR(l.data)}</td>
                  <td>{c?.nome}{l.recorrencia_id && <span className="tag">projeção</span>}</td>
                  <td className="sub">{l.descricao}</td>
                  <td><span className={`status s-${l.status.toLowerCase()}`}>{l.status.toLowerCase()}</span></td>
                  <td className={`num ${c?.tipo === 'SAIDA' ? 'neg' : ''}`}>{c?.tipo === 'SAIDA' ? '−' : ''}{moeda(Number(l.valor))}</td>
                </tr>
              )
            })}
            {lancs.dados && lista.length === 0 && <tr><td colSpan={6} className="sub">Nenhum lançamento com esses filtros.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={5}>{lista.length} lançamentos · entradas − pagamentos</td><td className="num">{moeda(total(lista))}</td></tr></tfoot>
        </table>
      </div>

      <Projecoes cats={cats.dados ?? []} />
      {aberto && <JanelaLancamento key={aberto === 'novo' ? 'novo' : aberto.id} original={aberto === 'novo' ? null : aberto}
        cats={cats.dados ?? []} fechar={() => setAberto(null)} />}
    </section>
  )
}

// Lançamento novo ou edição de um da lista: data, linha, valor, descrição e situação.
// Grava com a versão de quando abriu: se alguém mudou no meio, avisa em vez de sobrescrever.
function JanelaLancamento({ original, cats, fechar }: { original: Lancamento | null; cats: Categoria[]; fechar: () => void }) {
  const hojeIso = isoDia(new Date())
  const [data, setData] = useState(original?.data ?? hojeIso)
  const [categoria, setCategoria] = useState(original ? String(original.categoria_id) : '')
  const [valor, setValor] = useState(original ? moeda(Number(original.valor)) : '')
  const [descricao, setDescricao] = useState(original?.descricao ?? '')
  const [status, setStatus] = useState<Status>(original?.status ?? 'REALIZADO')
  const [mexeuStatus, setMexeuStatus] = useState(Boolean(original))
  const [msg, setMsg] = useState('')
  const mudarData = (d: string) => { setData(d); if (!mexeuStatus) setStatus(d <= hojeIso ? 'REALIZADO' : 'PREVISTO') }

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); setMsg('')
    const v = lerValor(valor)
    if (!data || !categoria) { setMsg('Preencha a data e a linha do fluxo.'); return }
    if (!v) { setMsg('Valor inválido.'); return }
    const campos = { data, categoria_id: Number(categoria), valor: v, descricao: descricao || null, status }
    if (original) {
      const { data: r, error } = await supabase.from('lancamentos').update(campos).eq('id', original.id).eq('versao', original.versao).select('id')
      if (error) { setMsg(error.message); return }
      if (!r?.length) { setMsg('Esse lançamento foi alterado por outra pessoa enquanto você editava. Feche, confira o valor atual na lista e edite de novo.'); return }
    } else {
      const { error } = await supabase.from('lancamentos').insert(campos)
      if (error) { setMsg(error.message); return }
    }
    fechar()
  }
  const excluir = async () => {
    if (!original || !confirm('Mandar este lançamento para a lixeira?')) return
    const { data: r, error } = await supabase.from('lancamentos').update({ excluido_em: new Date().toISOString() })
      .eq('id', original.id).eq('versao', original.versao).select('id')
    if (error) { setMsg(error.message); return }
    if (!r?.length) { setMsg('Esse lançamento foi alterado por outra pessoa. Feche e confira antes de excluir.'); return }
    fechar()
  }

  return (
    <div className="fundo" onClick={fechar}>
      <div className="janela" onClick={(e) => e.stopPropagation()}>
        <header><strong>{original ? 'Editar lançamento' : 'Novo lançamento'}</strong><button className="link" onClick={fechar}>Fechar</button></header>
        {original?.status === 'CONCILIADO' && <p className="sub">Este lançamento já foi conciliado com o extrato. Para mudar valor ou data, desfaça a conciliação na tela Conciliação.</p>}
        <form onSubmit={salvar}>
          <label>Data<input type="date" value={data} onChange={(e) => mudarData(e.target.value)} required /></label>
          <label>Linha do fluxo<SelectCategoria cats={cats.filter((c) => !c.arquivada || String(c.id) === categoria)} value={categoria} onChange={setCategoria} vazio="Escolha…" /></label>
          <label>Valor<input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="1.234,56 ou =1000+500" autoFocus={!original} required /></label>
          <label>Descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
          <label>Situação
            <select value={status} onChange={(e) => { setStatus(e.target.value as Status); setMexeuStatus(true) }}>
              <option value="PREVISTO">Previsto</option><option value="REALIZADO">Realizado</option><option value="CONCILIADO">Conciliado</option>
            </select>
          </label>
          {status === 'PREVISTO' && data && proximoDiaUtil(data) !== data && <p className="sub">Previsto em dia sem compensação: vai para {dataBR(proximoDiaUtil(data))}, o próximo dia útil.</p>}
          {msg && <p className="aviso">{msg}</p>}
          <div className="acoes">{original && <button type="button" className="link perigo" onClick={excluir}>Excluir</button>}<button>Salvar</button></div>
        </form>
      </div>
    </div>
  )
}

export function SelectCategoria({ cats, value, onChange, vazio }: { cats: Categoria[]; value: string; onChange: (v: string) => void; vazio: string }) {
  const grupos = [...new Set(cats.map((c) => `${c.tipo === 'ENTRADA' ? 'Entradas' : 'Pagamentos'} · ${c.secao}`))]
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{vazio}</option>
      {grupos.map((g) => (
        <optgroup key={g} label={g}>
          {cats.filter((c) => `${c.tipo === 'ENTRADA' ? 'Entradas' : 'Pagamentos'} · ${c.secao}` === g)
            .map((c) => <option key={c.id} value={c.id}>{c.nome}{c.arquivada ? ' (arquivada)' : ''}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

function AjusteMassa({ ids, cats, total, limpar }: { ids: number[]; cats: Categoria[]; total: number; limpar: () => void }) {
  const [acao, setAcao] = useState<'valor' | 'percentual' | 'dias' | 'categoria' | 'status' | 'excluir'>('valor')
  const [v, setV] = useState('')
  const [msg, setMsg] = useState('')
  const aplicar = async (e: FormEvent) => {
    e.preventDefault(); setMsg('')
    const p: Record<string, unknown> = { p_ids: ids }
    if (acao === 'valor') { const n = lerValor(v); if (!n) { setMsg('Valor inválido.'); return } p.p_valor = n }
    if (acao === 'percentual') { const n = lerValor(v); if (n === null) { setMsg('Percentual inválido.'); return } p.p_percentual = n }
    if (acao === 'dias') { const n = parseInt(v, 10); if (!Number.isFinite(n)) { setMsg('Número de dias inválido.'); return } p.p_dias = n }
    if (acao === 'categoria') { if (!v) { setMsg('Escolha a linha.'); return } p.p_categoria = Number(v) }
    if (acao === 'status') { if (!v) { setMsg('Escolha a situação.'); return } p.p_status = v }
    if (acao === 'excluir') { if (!confirm(`Mandar ${ids.length} lançamentos para a lixeira?`)) return; p.p_excluir = true }
    const { data, error } = await supabase.rpc('fn_ajuste_massa', p)
    if (error) { setMsg(error.message); return }
    setMsg(`${data} lançamentos ajustados.`); setV('')
  }
  return (
    <form className="massa" onSubmit={aplicar}>
      <strong>{ids.length} selecionados ({moeda(total)})</strong>
      <select value={acao} onChange={(e) => { setAcao(e.target.value as typeof acao); setV('') }}>
        <option value="valor">Trocar o valor para</option><option value="percentual">Reajustar em %</option>
        <option value="dias">Mover a data em dias</option><option value="categoria">Mudar a linha do fluxo para</option>
        <option value="status">Mudar a situação para</option><option value="excluir">Mandar para a lixeira</option>
      </select>
      {(acao === 'valor' || acao === 'percentual' || acao === 'dias') &&
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder={acao === 'valor' ? '1.234,56' : acao === 'percentual' ? '5 ou -3,5' : '30 ou -2'} />}
      {acao === 'categoria' && <SelectCategoria cats={cats} value={v} onChange={setV} vazio="Escolha…" />}
      {acao === 'status' && <select value={v} onChange={(e) => setV(e.target.value)}><option value="">Escolha…</option>
        <option value="PREVISTO">Previsto</option><option value="REALIZADO">Realizado</option><option value="CONCILIADO">Conciliado</option></select>}
      <button>Aplicar</button>
      <button type="button" className="link" onClick={limpar}>Limpar seleção</button>
      {msg && <span className="sub">{msg}</span>}
    </form>
  )
}

function Projecoes({ cats }: { cats: Categoria[] }) {
  const recs = useAoVivo(['recorrencias'], () => dados<Recorrencia[]>(supabase.from('recorrencias').select('*').order('id', { ascending: false })))
  const [f, setF] = useState({ categoria: '', valor: '', dia: '10', inicio: isoDia(new Date()), fim: '', descricao: '' })
  const [msg, setMsg] = useState('')
  const nomeCat = new Map(cats.map((c) => [c.id, c.nome]))
  const criar = async (e: FormEvent) => {
    e.preventDefault(); setMsg('')
    const valor = lerValor(f.valor)
    if (!f.categoria || !valor) { setMsg('Preencha a linha e o valor.'); return }
    const { data, error } = await supabase.from('recorrencias').insert({
      categoria_id: Number(f.categoria), valor, dia: Number(f.dia), inicio: f.inicio, fim: f.fim || null, descricao: f.descricao || null,
    }).select('id').single()
    if (error) { setMsg(error.message); return }
    const g = await supabase.rpc('fn_gerar_recorrencia', { p_id: data.id })
    if (g.error) { setMsg(g.error.message); return }
    setMsg(`Projeção criada: ${g.data} lançamentos previstos.`)
    setF({ ...f, valor: '', descricao: '' })
  }
  return (
    <div className="bloco">
      <h3>Projeções recorrentes</h3>
      <p className="sub">Cria um lançamento previsto por mês. Sem data final, projeta 24 meses. Para mudar depois, filtre a linha acima, selecione e use o ajuste em massa.</p>
      <form className="filtros" onSubmit={criar}>
        <label>Linha do fluxo<SelectCategoria cats={cats.filter((c) => !c.arquivada)} value={f.categoria} onChange={(v) => setF({ ...f, categoria: v })} vazio="Escolha…" /></label>
        <label>Valor<input value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} placeholder="1.234,56" /></label>
        <label>Dia do mês<input type="number" min={1} max={31} value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} /></label>
        <label>A partir de<input type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></label>
        <label>Até (opcional)<input type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} /></label>
        <label>Descrição<input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></label>
        <button>Criar projeção</button>
      </form>
      {msg && <p className="sub">{msg}</p>}
      {(recs.dados ?? []).length > 0 && (
        <ul className="lista">
          {(recs.dados ?? []).map((r) => (
            <li key={r.id}><span className="valor">{moeda(Number(r.valor))}</span>
              <span className="desc">{nomeCat.get(r.categoria_id)} · dia {r.dia} · {dataBR(r.inicio)}{r.fim ? ` até ${dataBR(r.fim)}` : ' (24 meses)'}{r.descricao ? ` · ${r.descricao}` : ''}</span></li>
          ))}
        </ul>
      )}
    </div>
  )
}

export type { Status }
