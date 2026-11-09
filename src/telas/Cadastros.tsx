import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAoVivo } from '../lib/vivo'
import { dados, type Categoria, type Cliente } from '../lib/tipos'

export function Cadastros() {
  const [aba, setAba] = useState<'clientes' | 'linhas'>('clientes')
  return (
    <section className="pagina">
      <div className="abas">
        <button className={aba === 'clientes' ? 'ativo' : ''} onClick={() => setAba('clientes')}>Clientes</button>
        <button className={aba === 'linhas' ? 'ativo' : ''} onClick={() => setAba('linhas')}>Linhas do fluxo</button>
      </div>
      {aba === 'clientes' ? <Clientes /> : <Linhas />}
    </section>
  )
}

const VAZIO: Omit<Cliente, 'id'> = { nome: '', documento: '', contato: '', email: '', telefone: '', forma_cobranca: 'BOLETO', situacao: 'ATIVO', obs: '' }
const COBRANCA = { BOLETO: 'Boleto', TRANSFERENCIA: 'Transferência', PIX: 'Pix' }

function Clientes() {
  const clientes = useAoVivo(['clientes'], () => dados<Cliente[]>(supabase.from('clientes').select('*').order('nome')))
  const [f, setF] = useState<Omit<Cliente, 'id'> & { id?: number }>(VAZIO)
  const [busca, setBusca] = useState('')
  const [situacao, setSituacao] = useState<'ATIVO' | 'ENCERRADO' | 'TODOS'>('ATIVO')
  const [msg, setMsg] = useState('')
  const salvar = async (e: FormEvent) => {
    e.preventDefault(); setMsg('')
    const { id, ...campos } = f
    const limpo = Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v === '' ? null : v])) as never
    const r = id ? await supabase.from('clientes').update(limpo).eq('id', id).select('id').single()
      : await supabase.from('clientes').insert(limpo).select('id').single()
    if (r.error) { setMsg(r.error.message); return }
    const cid = (r.data as { id: number }).id
    // todo cliente tem a sua linha no fluxo (seção Clientes): é nela que entram os recebimentos e as projeções.
    // Encerrado: a linha sai do fluxo (fica arquivada, os lançamentos continuam no saldo); reativado: volta.
    const linhas = await dados<Categoria[]>(supabase.from('categorias').select('*').eq('cliente_id', cid))
    const arquivada = f.situacao === 'ENCERRADO'
    if (linhas.length) {
      const a = await supabase.from('categorias').update({ arquivada } as never).eq('cliente_id', cid)
      if (a.error) { setMsg(a.error.message); return }
    } else {
      const ult = await dados<{ ordem: number }[]>(supabase.from('categorias').select('ordem').eq('secao', 'Clientes').order('ordem', { ascending: false }).limit(1))
      const n = await supabase.from('categorias').insert({
        nome: f.nome.trim(), tipo: 'ENTRADA', secao: 'Clientes', ordem: (ult[0]?.ordem ?? 0) + 1, arquivada, cliente_id: cid,
      } as never)
      if (n.error) { setMsg(n.error.message); return }
    }
    setF(VAZIO); setMsg(arquivada ? 'Salvo. A linha do cliente saiu do fluxo.' : linhas.length ? 'Salvo.' : 'Salvo. O cliente ganhou a linha dele no fluxo (seção Clientes).')
  }
  const lista = (clientes.dados ?? []).filter((c) => c.nome.toLowerCase().includes(busca.toLowerCase())
    && (situacao === 'TODOS' || c.situacao === situacao))
  return (
    <div className="dois">
      <div>
        <div className="busca">
          <input placeholder="Buscar cliente" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)} aria-label="Situação">
            <option value="ATIVO">Ativos</option><option value="ENCERRADO">Encerrados</option><option value="TODOS">Todos</option>
          </select>
        </div>
        <ul className="lista">
          {lista.map((c) => (
            <li key={c.id} onClick={() => setF({ ...VAZIO, ...c })} className={f.id === c.id ? 'ativo' : ''} style={{ cursor: 'pointer' }}>
              <span className="desc"><b>{c.nome}</b> · {COBRANCA[c.forma_cobranca]}</span>
              <span className={`status ${c.situacao === 'ATIVO' ? 's-conciliado' : ''}`}>{c.situacao.toLowerCase()}</span>
            </li>
          ))}
          {clientes.dados && lista.length === 0 && <li className="sub">Nenhum cliente.</li>}
        </ul>
      </div>
      <form onSubmit={salvar} className="bloco">
        <h3>{f.id ? 'Editar cliente' : 'Novo cliente'}</h3>
        <label>Nome<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required /></label>
        <label>CPF/CNPJ<input value={f.documento ?? ''} onChange={(e) => setF({ ...f, documento: e.target.value })} /></label>
        <label>Contato<input value={f.contato ?? ''} onChange={(e) => setF({ ...f, contato: e.target.value })} /></label>
        <label>E-mail<input type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Telefone<input value={f.telefone ?? ''} onChange={(e) => setF({ ...f, telefone: e.target.value })} /></label>
        <label>Cobrança<select value={f.forma_cobranca} onChange={(e) => setF({ ...f, forma_cobranca: e.target.value as Cliente['forma_cobranca'] })}>
          <option value="BOLETO">Boleto</option><option value="TRANSFERENCIA">Só transferência (sem boleto)</option><option value="PIX">Pix</option></select></label>
        <label>Situação<select value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value as Cliente['situacao'] })}>
          <option value="ATIVO">Ativo</option><option value="ENCERRADO">Encerrado</option></select></label>
        <label>Observação<input value={f.obs ?? ''} onChange={(e) => setF({ ...f, obs: e.target.value })} /></label>
        {msg && <p className="sub">{msg}</p>}
        <div className="acoes">{f.id && <button type="button" className="link" onClick={() => setF(VAZIO)}>Novo</button>}<button>Salvar</button></div>
      </form>
    </div>
  )
}

function Linhas() {
  const cats = useAoVivo(['categorias'], () => dados<Categoria[]>(supabase.from('categorias').select('*').order('ordem')))
  const [verArquivadas, setVerArquivadas] = useState(false)
  const [nova, setNova] = useState({ nome: '', tipo: 'ENTRADA', secao: 'Clientes' })
  const [msg, setMsg] = useState('')
  const lista = cats.dados ?? []
  const alterar = async (c: Categoria, campos: Partial<Categoria>) => {
    const { error } = await supabase.from('categorias').update(campos).eq('id', c.id)
    if (error) setMsg(error.message)
  }
  const mover = async (c: Categoria, dir: -1 | 1) => {
    const mesmas = lista.filter((x) => x.tipo === c.tipo && x.secao === c.secao)
    const i = mesmas.findIndex((x) => x.id === c.id), o = mesmas[i + dir]
    if (!o) return
    await alterar(c, { ordem: o.ordem }); await alterar(o, { ordem: c.ordem })
  }
  const criar = async (e: FormEvent) => {
    e.preventDefault(); setMsg('')
    const ordem = Math.max(0, ...lista.filter((x) => x.secao === nova.secao).map((x) => x.ordem)) + 1
    const { error } = await supabase.from('categorias').insert({ ...nova, ordem })
    if (error) { setMsg(error.message); return }
    setNova({ ...nova, nome: '' })
  }
  const secoes = [...new Set(lista.map((c) => c.secao))]
  return (
    <div>
      <p className="sub">Linha arquivada sai da tela de fluxo, mas os lançamentos dela continuam no saldo: no fluxo eles aparecem somados na linha “Arquivadas (somadas)”. Cliente marcado como encerrado arquiva a linha dele sozinho.</p>
      <label className="check"><input type="checkbox" checked={verArquivadas} onChange={(e) => setVerArquivadas(e.target.checked)} /> mostrar arquivadas</label>
      {msg && <p className="aviso">{msg}</p>}
      <form className="filtros" onSubmit={criar}>
        <label>Nova linha<input value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} required /></label>
        <label>Tipo<select value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value })}><option value="ENTRADA">Entrada</option><option value="SAIDA">Pagamento</option></select></label>
        <label>Seção<input list="secoes" value={nova.secao} onChange={(e) => setNova({ ...nova, secao: e.target.value })} required /></label>
        <datalist id="secoes">{secoes.map((s) => <option key={s} value={s} />)}</datalist>
        <button>Adicionar</button>
      </form>
      <div className="tabela">
        <table>
          <thead><tr><th>Linha</th><th>Tipo</th><th>Seção</th><th>Cor</th><th>Ordem</th><th></th></tr></thead>
          <tbody>
            {lista.filter((c) => verArquivadas || !c.arquivada).map((c) => (
              <tr key={c.id} className={c.arquivada ? 'arquivada' : ''}>
                <td style={c.cor ? { background: c.cor } : undefined}>{c.nome}</td>
                <td>{c.tipo === 'ENTRADA' ? 'Entrada' : 'Pagamento'}</td>
                <td>{c.secao}</td>
                <td><input type="color" value={c.cor ?? '#ffffff'} onChange={(e) => alterar(c, { cor: e.target.value === '#ffffff' ? null : e.target.value })} style={{ width: 40, padding: 0 }} /></td>
                <td><button className="link" onClick={() => mover(c, -1)}>↑</button><button className="link" onClick={() => mover(c, 1)}>↓</button></td>
                <td><button className="link" onClick={() => alterar(c, { arquivada: !c.arquivada })}>{c.arquivada ? 'desarquivar' : 'arquivar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
