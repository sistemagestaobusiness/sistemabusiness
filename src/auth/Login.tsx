import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { erroDoLink, type Etapa } from './sessao'

export function Login({ etapa }: { etapa: Etapa }) {
  return (
    <div className="login">
      <div className="login-card">
        <h1>Sistema Business</h1>
        {etapa === 'entrar' && <EmailSenha />}
        {etapa === 'nova-senha' && <NovaSenha />}
      </div>
    </div>
  )
}

function EmailSenha() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(erroDoLink ?? '')
  const [enviando, setEnviando] = useState(false)
  const entrar = async (e: FormEvent) => {
    e.preventDefault(); setEnviando(true); setErro('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setEnviando(false)
    if (error) setErro('E-mail ou senha incorretos.')
  }
  const esqueci = async () => {
    if (!email) { setErro('Digite o e-mail acima e clique de novo em "Esqueci a senha".'); return }
    setEnviando(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })
    setEnviando(false)
    setErro(error && /rate|seconds/i.test(error.message)
      ? 'Já foi enviado um link agora há pouco. Espere um minuto e tente de novo.'
      : 'Se o e-mail estiver cadastrado, o link para criar uma senha nova chega em instantes. Confira também o spam.')
  }
  return (
    <form onSubmit={entrar}>
      <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
      <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required /></label>
      {erro && <p className="aviso">{erro}</p>}
      <button disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      <button type="button" className="link" onClick={esqueci}>Esqueci a senha</button>
    </form>
  )
}

// tela que abre pelo link do e-mail: cria a senha nova e entra
function NovaSenha() {
  return (
    <>
      <p>Crie a sua senha nova.</p>
      <FormSenha aoTerminar={() => history.replaceState(null, '', location.pathname)} />
      <button type="button" className="link" onClick={() => supabase.auth.signOut()}>Cancelar</button>
    </>
  )
}

// usado no link do e-mail e no "Trocar senha" de dentro do sistema
export function FormSenha({ emailAtual, aoTerminar }: { emailAtual?: string; aoTerminar: () => void }) {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [repete, setRepete] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const salvar = async (e: FormEvent) => {
    e.preventDefault(); setErro('')
    if (nova.length < 8) { setErro('A senha precisa ter pelo menos 8 caracteres.'); return }
    if (nova !== repete) { setErro('As duas senhas não estão iguais.'); return }
    setEnviando(true)
    if (emailAtual) {
      // trocar de dentro do sistema: confere a senha atual antes
      const { error } = await supabase.auth.signInWithPassword({ email: emailAtual, password: atual })
      if (error) { setEnviando(false); setErro('A senha atual não confere.'); return }
    }
    const { error } = await supabase.auth.updateUser({ password: nova })
    setEnviando(false)
    if (error) { setErro(/different|same/i.test(error.message) ? 'A senha nova precisa ser diferente da atual.' : error.message); return }
    aoTerminar()
  }
  return (
    <form onSubmit={salvar}>
      {emailAtual && <label>Senha atual<input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" required /></label>}
      <label>Senha nova<input type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" required /></label>
      <label>Repita a senha nova<input type="password" value={repete} onChange={(e) => setRepete(e.target.value)} autoComplete="new-password" required /></label>
      {erro && <p className="aviso">{erro}</p>}
      <button disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar senha'}</button>
    </form>
  )
}
