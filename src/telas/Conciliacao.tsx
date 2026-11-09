import { useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAoVivo } from '../lib/vivo'
import { dataBR, isoDia, lerValor, moeda } from '../lib/formato'
import { decodificar, lerOfx, normalizar } from '../lib/ofx'
import { dados, todas, type Categoria, type Conta, type Lancamento, type LinhaExtrato } from '../lib/tipos'
import { SelectCategoria } from './Lancamentos'

const DIAS = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000)

export function Conciliacao() {
  const [contaId, setContaId] = useState('')
  const [msg, setMsg] = useState('')
  const [verFeitas, setVerFeitas] = useState(false)
  const contas = useAoVivo(['contas'], () => dados<Conta[]>(supabase.from('contas').select('id,nome,ativa,ordem,saldo_banco,saldo_banco_em').order('ordem').order('id')))
  const conta = contaId || String(contas.dados?.[0]?.id ?? '')
  const cats = useAoVivo(['categorias'], () => dados<Categoria[]>(supabase.from('categorias').select('*').order('ordem')))
  const linhas = useAoVivo(['extrato_linhas'], () => todas<LinhaExtrato>((a, b) =>
    supabase.from('extrato_linhas').select('id,conta_id,fitid,data,valor,descricao,lancamento_id,ignorada,dividida').order('data', { ascending: false }).order('id').range(a, b)))
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

  const pend = (linhas.dados ?? []).filter((l) => !l.lancamento_id && !l.ignorada && !l.dividida)
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
    return !error
  }
  const [conciliandoTodas, setConciliandoTodas] = useState(false)
  const conciliarTodas = async () => {
    setConciliandoTodas(true)
    let ok = 0
    for (const l of certeiras) if (await conciliar(l.id, sugestoes.get(l.id)![0].id)) ok++
    setConciliandoTodas(false)
    setMsg(`${ok} linhas conciliadas.`)
  }

  return (
    <section className="pagina">
      <h2>Conciliação</h2>
      <div className="filtros">
        <label>Conta<select value={conta} onChange={(e) => setContaId(e.target.value)}>
          {(contas.dados ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        <label>Importar a partir de<input type="date" value={desde} onChange={(e) => setAPartirDe(e.target.value)} /></label>
        <label>Extrato OFX do C6<input type="file" accept=".ofx,.OFX" onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = '' }} /></label>
        {certeiras.length > 0 && <button className="primario" disabled={conciliandoTodas} onClick={conciliarTodas}>Conciliar as {certeiras.length} sugestões certeiras</button>}
      </div>
      {contas.dados?.find((c) => String(c.id) === conta) && <SaldoBanco conta={contas.dados.find((c) => String(c.id) === conta)!} />}
      {msg && <p className="sub">{msg}</p>}
      {(linhas.erro || lancs.erro) && <p className="aviso">{linhas.erro || lancs.erro}</p>}
      <p className="sub">Certeira = um único lançamento não conciliado com o mesmo valor, mesmo tipo e até 3 dias de diferença. Ao conciliar, o lançamento fica com a data e o valor do extrato.</p>

      <div className="tabela">
        <table>
          <thead><tr><th>Data</th><th>Extrato</th><th className="num">Valor</th><th>Lançamento no sistema</th></tr></thead>
          <tbody>
            {pend.map((l) => (
              <LinhaPendente key={l.id} linha={l} cands={sugestoes.get(l.id) ?? []} cats={cats.dados ?? []} tipo={tipo}
                abertos={(lancs.dados ?? []).filter((x) => !ligados.has(x.id) && DIAS(x.data, l.data) <= 10 && (tipo.get(x.categoria_id)?.tipo === 'ENTRADA') === (l.valor > 0))}
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
            {(linhas.dados ?? []).filter((l) => l.lancamento_id || l.ignorada || l.dividida).slice(0, 300).map((l) => (
              <tr key={l.id}>
                <td>{dataBR(l.data)}</td><td className="sub">{l.descricao}</td>
                <td className={`num ${l.valor < 0 ? 'neg' : ''}`}>{moeda(l.valor)}</td>
                <td>{l.ignorada ? 'ignorada' : l.dividida ? 'dividida em vários lançamentos' : `conciliada · ${tipo.get((conciliadas.dados ?? []).find((c) => c.linha.id === l.id)?.categoria_id ?? 0)?.nome ?? ''}`}</td>
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

// O OFX do C6 não traz o saldo da conta: o sócio informa o saldo do app do banco num dia e o fluxo
// calcula o saldo do banco dos outros dias pelas linhas do extrato (fn_saldo_banco), para comparar com o saldo do sistema.
function SaldoBanco({ conta }: { conta: Conta }) {
  const [valor, setValor] = useState('')
  const [dia, setDia] = useState(() => isoDia(new Date()))
  const [aviso, setAviso] = useState('')
  const [gravando, setGravando] = useState(false)
  const gravar = async () => {
    const v = lerValor(valor)
    if (v === null) { setAviso('Digite o saldo como aparece no app do banco, ex.: 12.345,67 (negativo com -).'); return }
    setGravando(true)
    const { error } = await supabase.from('contas').update({ saldo_banco: v, saldo_banco_em: dia } as never).eq('id', conta.id)
    setGravando(false)
    if (error) { setAviso(error.message); return }
    setValor(''); setAviso('Gravado. O Fluxo de caixa mostra o saldo do banco e a diferença dia a dia.')
  }
  return (
    <div className="filtros saldo-banco">
      <span>Saldo do {conta.nome} no app do banco{conta.saldo_banco !== null && conta.saldo_banco_em
        ? <>: <strong>{moeda(Number(conta.saldo_banco))}</strong> no fim de {dataBR(conta.saldo_banco_em)}</> : ': ainda não informado'}</span>
      <label>Novo saldo<input className="valor" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
      <label>no fim do dia<input type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
      <button disabled={gravando || !valor} onClick={gravar}>Gravar saldo</button>
      {aviso && <span className="sub">{aviso}</span>}
    </div>
  )
}

function LinhaPendente({ linha, cands, cats, tipo, abertos, sugestaoCat, conciliar, erro }: {
  linha: LinhaExtrato; cands: Lancamento[]; cats: Categoria[]; tipo: Map<number, Categoria>; abertos: Lancamento[]; sugestaoCat?: number
  conciliar: (linha: number, lanc: number) => Promise<boolean>; erro: (m: string) => void
}) {
  const entrada = linha.valor > 0
  const [cat, setCat] = useState(sugestaoCat ? String(sugestaoCat) : '')
  const [dividindo, setDividindo] = useState(false)
  // Enquanto grava, os botões ficam travados: clique repetido criava lançamentos em dobro (caso AMIL 07/10/2026).
  // Depois de conciliar, continua travado até a linha sumir da lista.
  const [ocupado, setOcupadoTela] = useState(false)
  const travado = useRef(false) // a trava vale já no clique seguinte, antes de a tela redesenhar
  const setOcupado = (v: boolean) => { travado.current = v; setOcupadoTela(v) }
  // só linhas ativas: arquivada (cliente encerrado, linha antiga) não aparece para escolher
  const opcoes = cats.filter((c) => (c.tipo === 'ENTRADA') === entrada && !c.arquivada)
  // Pix enviado para a Cora (Alexandre) ou o Nubank (Rodrigo) = pró-labore: um clique cria e concilia na linha certa.
  // O extrato do C6 não traz o nome de quem recebeu o Pix, por isso a escolha é de quem concilia.
  const prolabore = entrada ? [] : cats.filter((c) => c.tipo === 'SAIDA' && !c.arquivada && /pr[oó].?labore/i.test(c.nome))
  const conciliarCom = async (lanc: number) => {
    if (travado.current) return
    setOcupado(true)
    if (!(await conciliar(linha.id, lanc))) setOcupado(false)
  }
  const criar = async (categoria = cat) => {
    if (travado.current) return
    if (!categoria) { erro('Escolha a linha do fluxo para criar o lançamento.'); return }
    setOcupado(true)
    const { data, error } = await supabase.from('lancamentos').insert({
      data: linha.data, valor: Math.abs(linha.valor), categoria_id: Number(categoria), conta_id: linha.conta_id, descricao: linha.descricao, status: 'REALIZADO',
    } as never).select('id').single()
    if (error) { erro(error.message); setOcupado(false); return }
    const id = (data as { id: number }).id
    if (!(await conciliar(linha.id, id))) {
      // não conciliou: o lançamento recém-criado vai para a lixeira, senão fica solto e duplica o valor no fluxo
      await supabase.from('lancamentos').update({ excluido_em: new Date().toISOString() } as never).eq('id', id)
      setOcupado(false)
    }
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
            <button className="link" disabled={ocupado} onClick={() => conciliarCom(c.id)}>conciliar com</button>
            {tipo.get(c.categoria_id)?.nome} · {dataBR(c.data)} · {moeda(Number(c.valor))} <span className={`status s-${c.status.toLowerCase()}`}>{c.status.toLowerCase()}</span>
          </div>
        ))}
        <div className="cand">
          <SelectCategoria cats={opcoes} value={cat} onChange={setCat} vazio={cands.length ? 'ou criar novo em…' : 'criar lançamento em…'} />
          <button className="link" disabled={ocupado} onClick={() => criar()}>{ocupado ? 'gravando…' : 'criar e conciliar'}</button>
          <button className="link" onClick={() => setDividindo(!dividindo)} title="Um movimento do extrato vira vários lançamentos (ex.: fatura do cartão, crédito de vários clientes)">dividir</button>
          <button className="link" onClick={ignorar} title="Só para o que não é movimento da empresa (ex.: Pix recusado e estornado)">ignorar</button>
        </div>
        {dividindo && <Dividir linha={linha} opcoes={opcoes} abertos={abertos} tipo={tipo} erro={erro} fechar={() => setDividindo(false)} />}
        {!dividindo && cands.length === 0 && prolabore.length > 0 && (
          <div className="cand prolabore">é pró-labore:
            {prolabore.map((c) => <button key={c.id} className="chip" disabled={ocupado} style={c.cor ? { background: c.cor } : undefined} onClick={() => criar(String(c.id))}>{c.nome}</button>)}
          </div>
        )}
      </td>
    </tr>
  )
}

let contadorParte = 0
type Parte = { chave: number; categoria: string; valor: string; descricao: string; lancamento_id?: number }

// Divide um movimento do extrato em vários lançamentos. Ex.: fatura do cartão Caixa (Business, Rodrigo, Alexandre)
// ou um crédito que junta pagamentos de vários clientes (usa os previstos que já existem).
// Só grava quando a soma das partes fecha com o extrato (o banco confere de novo).
function Dividir({ linha, opcoes, abertos, tipo, erro, fechar }: {
  linha: LinhaExtrato; opcoes: Categoria[]; abertos: Lancamento[]; tipo: Map<number, Categoria>; erro: (m: string) => void; fechar: () => void
}) {
  const total = Math.abs(linha.valor)
  const nova = (p: Partial<Parte> = {}): Parte => ({ chave: ++contadorParte, categoria: '', valor: '', descricao: '', ...p })
  const [partes, setPartes] = useState<Parte[]>(() => [nova(), nova()])
  const [gravando, setGravando] = useState(false)
  const soma = partes.reduce((a, p) => a + (lerValor(p.valor) ?? 0), 0)
  const falta = Math.round((total - soma) * 100) / 100
  const mudar = (i: number, m: Partial<Parte>) => setPartes((ps) => ps.map((p, j) => (j === i ? { ...p, ...m } : p)))
  const usados = new Set(partes.map((p) => p.lancamento_id).filter(Boolean))
  const usarPrevisto = (l: Lancamento) => setPartes((ps) => {
    const vazia = ps.findIndex((p) => !p.categoria && !p.valor)
    const p = nova({ categoria: String(l.categoria_id), valor: moeda(Number(l.valor)), descricao: l.descricao ?? '', lancamento_id: l.id })
    return vazia >= 0 ? ps.map((x, j) => (j === vazia ? p : x)) : [...ps, p]
  })
  const gravar = async () => {
    if (partes.some((p) => !p.categoria || !lerValor(p.valor))) { erro('Cada parte precisa da linha do fluxo e do valor.'); return }
    if (falta !== 0) { erro(`As partes somam ${moeda(soma)} e o extrato é ${moeda(total)}.`); return }
    setGravando(true)
    const { error } = await supabase.rpc('fn_conciliar_dividido', {
      p_linha: linha.id,
      p_partes: partes.map((p) => ({ categoria_id: Number(p.categoria), valor: lerValor(p.valor), descricao: p.descricao || null, lancamento_id: p.lancamento_id ?? null })),
    })
    setGravando(false)
    if (error) { erro(error.message); return }
    fechar()
  }
  return (
    <div className="dividir">
      {abertos.length > 0 && (
        <div className="cand">usar previsto:
          {abertos.filter((l) => !usados.has(l.id)).slice(0, 12).map((l) => (
            <button key={l.id} className="chip" onClick={() => usarPrevisto(l)} title={dataBR(l.data)}>{tipo.get(l.categoria_id)?.nome} {moeda(Number(l.valor))}</button>
          ))}
        </div>
      )}
      {partes.map((p, i) => (
        <div key={p.chave} className="parte">
          <SelectCategoria cats={p.lancamento_id ? [...opcoes, ...(tipo.get(Number(p.categoria)) ? [tipo.get(Number(p.categoria))!] : [])] : opcoes}
            value={p.categoria} onChange={(v) => mudar(i, { categoria: v })} vazio="linha do fluxo…" />
          <input className="valor" value={p.valor} onChange={(e) => mudar(i, { valor: e.target.value })} placeholder="valor" />
          <input value={p.descricao} onChange={(e) => mudar(i, { descricao: e.target.value })} placeholder="descrição (opcional)" />
          {p.lancamento_id && <span className="tag">previsto</span>}
          {partes.length > 2 && <button className="link" onClick={() => setPartes((ps) => ps.filter((_, j) => j !== i))}>tirar</button>}
        </div>
      ))}
      <div className="cand">
        <button className="link" onClick={() => setPartes((ps) => [...ps, nova({ valor: falta > 0 ? moeda(falta) : '' })])} title="A parte nova já vem com o valor que falta">+ parte</button>
        <span className={falta === 0 ? 's-conciliado status' : 'sub'}>{falta === 0 ? 'fecha com o extrato' : falta > 0 ? `falta ${moeda(falta)}` : `passou ${moeda(-falta)}`}</span>
        <button className="primario" disabled={gravando || falta !== 0} onClick={gravar}>Conciliar dividido</button>
        <button className="link" onClick={fechar}>cancelar</button>
      </div>
    </div>
  )
}
