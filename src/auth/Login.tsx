import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Etapa } from './sessao'

export function Login({ etapa }: { etapa: Etapa }) {
  return (
    <div className="login">
      <div className="login-card">
        <h1>Sistema Business</h1>
        {etapa === 'entrar' && <EmailSenha />}
      </div>
    </div>
  )
}

function EmailSenha() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const entrar = async (e: FormEvent) => {
    e.preventDefault(); setEnviando(true); setErro('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setEnviando(false)
    if (error) setErro('E-mail ou senha incorretos.')
  }
  const esqueci = async () => {
    if (!email) { setErro('Digite o e-mail para receber o link.'); return }
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
    setErro('Se o e-mail estiver cadastrado, o link de troca de senha chega em instantes.')
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
