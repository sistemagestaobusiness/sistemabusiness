import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAoVivo } from '../lib/vivo'
import { dataBR, isoDia, moeda } from '../lib/formato'
import { decodificar, lerOfx, normalizar } from '../lib/ofx'
import { dados, todas, type Categoria, type Conta, type Lancamento, type LinhaExtrato } from '../lib/tipos'
import { SelectCategoria } from './Lancamentos'

const DIAS = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000)

export function Conciliacao() {
  const [contaId, setContaId] = useState('')
  const [msg, setMsg] = useState('')
  const [verFeitas, setVerFeitas] = useState(false)
  const contas = useAoVivo(['contas'], () => dados<Conta[]>(supabase.from('contas').select('id,nome,ativa,ordem').order('ordem').order('id')))
  const conta = contaId || String(contas.dados?.[0]?.id ?? '')
  const cats = useAoVivo(['categorias'], () => dados<Categoria[]>(supabase.from('categorias').select('*').order('ordem')))
  const linhas = useAoVivo(['extrato_linhas'], () => todas<LinhaExtrato>((a, b) =>
    supabase.from('extrato_linhas').select('id,conta_id,fitid,data,valor,descricao,lancamento_id,ignorada').order('data', { ascending: false }).order('id').range(a, b)))
  const [aPartirDe, setAPartirDe] = useState('')
  // o que já foi conciliado (inclusive na planilha) não precisa voltar: por padrão importa a partir do dia
  // seguinte ao último lançamento conciliado
  const ultimoConciliado = useAoVivo(['lancamentos'], () => dados<{ data: string }[]>(supabase.from('lancamentos').select('data')
    .eq('status', 'CONCILIADO').is('excluido_em', null).lte('data', isoDia(new Date())).order('data', { ascending: false }).limit(1)))
  const inicioPadrao = ultimoConciliado.dados?.[0] ? isoDia(new Date(Date.parse(ultimoConciliado.dados[0].data + 'T12:00:00') + 86_400_000)) : ''
  // primeiro extrato: começa no dia seguinte ao último conciliado (o que veio da planilha já está conferido).
  // Depois: começa onde o primeiro extrato começou (o código único de cada movimento evita duplicar).
  const daConta = (linhas.dados ?? []).filter((l) => String(l.conta_id) === conta)
  const inicioExtrato = daConta.reduce<string>((m, l) => (!m || l.data < m ? l.data : m), '')
  const desde = aPartirDe || inicioExtrato || inicioPadrao

  const pend = (linhas.dados ?? []).filter((l) => !l.lancamento_id && !l.ignorada)
  const menor = pend.reduce((m, l) => (l.data < m ? l.data : m), isoDia(new Date()))
  const maior = pend.reduce((m, l) => (l.data > m ? l.data : m), menor)
  // candidatos: lançamentos ainda não conciliados perto das datas do extrato pendente
  const lancs = useAoVivo(['lancamentos', 'extrato_linhas'], () => todas<Lancamento>((a, b) =>
    supabase.from('lancamentos').select('id,data,valor,categoria_id,descricao,status,versao,recorrencia_id').is('excluido_em', null)
      .neq('status', 'CONCILIADO').gte('data', isoDia(new Date(Date.parse(menor) - 10 * 86_400_000))).lte('data', isoDia(new Date(Date.parse(maior) + 10 * 86_400_000)))
      .order('id').range(a, b)), [menor, maior])

  const tipo = useMemo(() => new Map((cats.dados ?? []).map((c) => [c.id, c])), [cats.dados])
  const ligados = useMemo(() => new Set((linhas.dados ?? []).map((l) => l.lancamento_id).filter(Boolean)), [linhas.dados])

  // aprendizado: descrição do extrato já conciliada antes -> linha do fluxo usada
  const historico = new Map<string, number>()
  const conciliadas = useAoVivo(['extrato_linhas', 'lancamentos'], async () => {
    const ls = (linhas.dados ?? []).filter((l) => l.lancamento_id).slice(0, 300)
    if (!ls.length) return [] as { linha: LinhaExtrato; categoria_id: number }[]
    const r = await dados<{ id: number; categoria_id: number }[]>(supabase.from('lancamentos').select('id,categoria_id').in('id', ls.map((l) => l.lancamento_id!)))
    const cat = new Map(r.map((x) => [x.id, x.categoria_id]))
    return ls.map((linha) => ({ linha, categoria_id: cat.get(linha.lancamento_id!) ?? 0 }))
  }, [linhas.dados])
  for (const c of conciliadas.dados ?? []) if (c.categoria_id && c.linha.descricao) historico.set(normalizar(c.linha.descricao), c.categoria_id)

  const sugestoes = useMemo(() => {
    const usados = new Set<number>()
    const s = new Map<number, Lancamento[]>()
    for (const l of [...pend].sort((a, b) => a.data.localeCompare(b.data))) {
      const entrada = l.valor > 0
      const cands = (lancs.dados ?? []).filter((x) => !ligados.has(x.id) && !usados.has(x.id)
        && (tipo.get(x.categoria_id)?.tipo === 'ENTRADA') === entrada
        && Math.abs(Number(x.valor) - Math.abs(l.valor)) < 0.01 && DIAS(x.data, l.data) <= 7)
        .sort((a, b) => DIAS(a.data, l.data) - DIAS(b.data, l.data))
      if (cands.length === 1 && DIAS(cands[0].data, l.data) <= 3) usados.add(cands[0].id)
      s.set(l.id, cands)
    }
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas.dados, lancs.dados, tipo, ligados])
  const certeiras = pend.filter((l) => { const c = sugestoes.get(l.id) ?? []; return c.length === 1 && DIAS(c[0].data, l.data) <= 3 })

  const importar = async (arquivo: File) => {
    setMsg('Lendo o arquivo…')
    try {
      const { movimentos, ate } = lerOfx(decodificar(await arquivo.arrayBuffer()))
      if (!movimentos.length) { setMsg('Não achei movimentos nesse arquivo. Confira se é o OFX do extrato.'); return }
      const antes = new Set((linhas.dados ?? []).filter((l) => String(l.conta_id) === conta).map((l) => l.fitid))
      const noPeriodo = movimentos.filter((m) => !desde || m.data >= desde)
      const novos = noPeriodo.filter((m) => !antes.has(m.fitid)).map((m) => ({ ...m, conta_id: Number(conta) }))
      for (let i = 0; i < novos.length; i += 500) {
        const { error } = await supabase.from('extrato_linhas').upsert(novos.slice(i, i + 500) as never, { onConflict: 'conta_id,fitid', ignoreDuplicates: true })
        if (error) { setMsg(error.message); return }
      }
      const fora = movimentos.length - noPeriodo.length
      setMsg(`${movimentos.length} movimentos no arquivo${ate ? ` (até ${dataBR(ate)})` : ''}: ${novos.length} novos, ${noPeriodo.length - novos.length} já estavam no sistema`
        + (fora ? `, ${fora} antes de ${dataBR(desde)} deixados de fora (já conciliados na planilha).` : '.'))
    } catch (e) { setMsg(`Não consegui ler o arquivo: ${e instanceof Error ? e.message : e}`) }
  }
  const conciliar = async (linha: number, lanc: number) => {
    const { error } = await supabase.rpc('fn_conciliar', { p_linha: linha, p_lancamento: lanc })
    if (error) setMsg(error.message)
  }
  const conciliarTodas = async () => {
    for (const l of certeiras) await conciliar(l.id, sugestoes.get(l.id)![0].id)
    setMsg(`${certeiras.length} linhas conciliadas.`)
  }

  return (
    <section className="pagina">
      <h2>Conciliação</h2>
      <div className="filtros">
        <label>Conta<select value={conta} onChange={(e) => setContaId(e.target.value)}>
          {(contas.dados ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        <label>Importar a partir de<input type="date" value={desde} onChange={(e) => setAPartirDe(e.target.value)} /></label>
        <label>Extrato OFX do C6<input type="file" accept=".ofx,.OFX" onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = '' }} /></label>
        {certeiras.length > 0 && <button className="primario" onClick={conciliarTodas}>Conciliar as {certeiras.length} sugestões certeiras</button>}
      </div>
      {msg && <p className="sub">{msg}</p>}
      {(linhas.erro || lancs.erro) && <p className="aviso">{linhas.erro || lancs.erro}</p>}
      <p className="sub">Certeira = um único lançamento não conciliado com o mesmo valor, mesmo tipo e até 3 dias de diferença. Ao conciliar, o lançamento fica com a data e o valor do extrato.</p>

      <div className="tabela">
        <table>
          <thead><tr><th>Data</th><th>Extrato</th><th className="num">Valor</th><th>Lançamento no sistema</th></tr></thead>
          <tbody>
            {pend.map((l) => (
              <LinhaPendente key={l.id} linha={l} cands={sugestoes.get(l.id) ?? []} cats={cats.dados ?? []} tipo={tipo}
                sugestaoCat={l.descricao ? historico.get(normalizar(l.descricao)) : undefined} conciliar={conciliar} erro={setMsg} />
            ))}
            {linhas.dados && pend.length === 0 && <tr><td colSpan={4} className="sub">Nada pendente. Suba um extrato OFX para conciliar.</td></tr>}
          </tbody>
        </table>
      </div>

      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={verFeitas} onChange={(e) => setVerFeitas(e.target.checked)} /> ver conciliadas e ignoradas</label>
      {verFeitas && (
        <div className="tabela">
          <table><tbody>
            {(linhas.dados ?? []).filter((l) => l.lancamento_id || l.ignorada).slice(0, 300).map((l) => (
              <tr key={l.id}>
                <td>{dataBR(l.data)}</td><td className="sub">{l.descricao}</td>
                <td className={`num ${l.valor < 0 ? 'neg' : ''}`}>{moeda(l.valor)}</td>
                <td>{l.ignorada ? 'ignorada' : `conciliada · ${tipo.get((conciliadas.dados ?? []).find((c) => c.linha.id === l.id)?.categoria_id ?? 0)?.nome ?? ''}`}</td>
                <td><button className="link" onClick={async () => {
                  const r = l.ignorada ? await supabase.from('extrato_linhas').update({ ignorada: false } as never).eq('id', l.id) : await supabase.rpc('fn_desconciliar', { p_linha: l.id })
                  if (r.error) setMsg(r.error.message)
                }}>desfazer</button></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </section>
  )
}

function LinhaPendente({ linha, cands, cats, tipo, sugestaoCat, conciliar, erro }: {
  linha: LinhaExtrato; cands: Lancamento[]; cats: Categoria[]; tipo: Map<number, Categoria>; sugestaoCat?: number
  conciliar: (linha: number, lanc: number) => Promise<void>; erro: (m: string) => void
}) {
  const entrada = linha.valor > 0
  const [cat, setCat] = useState(sugestaoCat ? String(sugestaoCat) : '')
  const opcoes = cats.filter((c) => (c.tipo === 'ENTRADA') === entrada)
  // Pix enviado para a Cora (Alexandre) ou o Nubank (Rodrigo) = pró-labore: um clique cria e concilia na linha certa.
  // O extrato do C6 não traz o nome de quem recebeu o Pix, por isso a escolha é de quem concilia.
  const prolabore = entrada ? [] : cats.filter((c) => c.tipo === 'SAIDA' && !c.arquivada && /pr[oó].?labore/i.test(c.nome))
  const criar = async (categoria = cat) => {
    if (!categoria) { erro('Escolha a linha do fluxo para criar o lançamento.'); return }
    const { data, error } = await supabase.from('lancamentos').insert({
      data: linha.data, valor: Math.abs(linha.valor), categoria_id: Number(categoria), conta_id: linha.conta_id, descricao: linha.descricao, status: 'REALIZADO',
    } as never).select('id').single()
    if (error) { erro(error.message); return }
    await conciliar(linha.id, (data as { id: number }).id)
  }
  const ignorar = async () => {
    const { error } = await supabase.from('extrato_linhas').update({ ignorada: true } as never).eq('id', linha.id)
    if (error) erro(error.message)
  }
  return (
    <tr>
      <td>{dataBR(linha.data)}</td>
      <td className="sub">{linha.descricao}</td>
      <td className={`num ${entrada ? '' : 'neg'}`}>{moeda(linha.valor)}</td>
      <td>
        {cands.slice(0, 3).map((c) => (
          <div key={c.id} className="cand">
            <button className="link" onClick={() => conciliar(linha.id, c.id)}>conciliar com</button>
            {tipo.get(c.categoria_id)?.nome} · {dataBR(c.data)} · {moeda(Number(c.valor))} <span className={`status s-${c.status.toLowerCase()}`}>{c.status.toLowerCase()}</span>
          </div>
        ))}
        <div className="cand">
          <SelectCategoria cats={opcoes} value={cat} onChange={setCat} vazio={cands.length ? 'ou criar novo em…' : 'criar lançamento em…'} />
          <button className="link" onClick={() => criar()}>criar e conciliar</button>
          <button className="link" onClick={ignorar} title="Só para o que não é movimento da empresa (ex.: Pix recusado e estornado)">ignorar</button>
        </div>
        {cands.length === 0 && prolabore.length > 0 && (
          <div className="cand prolabore">é pró-labore:
            {prolabore.map((c) => <button key={c.id} className="chip" style={c.cor ? { background: c.cor } : undefined} onClick={() => criar(String(c.id))}>{c.nome}</button>)}
          </div>
        )}
      </td>
    </tr>
  )
}
