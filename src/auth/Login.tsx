import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Etapa } from './sessao'

export function Login({ etapa }: { etapa: Etapa }) {
  return (
    <div className="login">
      <div className="login-card">
        <h1>Sistema Business</h1>
        {etapa === 'entrar' && <EmailSenha />}
        {etapa === 'cadastrar-2fa' && <Cadastrar2FA />}
        {etapa === 'confirmar-2fa' && <Confirmar2FA />}
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

function Cadastrar2FA() {
  const [qr, setQr] = useState('')
  const [fatorId, setFatorId] = useState('')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  useEffect(() => {
    supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Autenticador' }).then(({ data, error }) => {
      if (error) { setErro(error.message); return }
      setQr(data.totp.qr_code); setFatorId(data.id)
    })
  }, [])
  const confirmar = async (e: FormEvent) => {
    e.preventDefault(); setErro('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo.trim() })
    if (error) setErro('Código não confere. Confira a hora do celular e tente de novo.')
  }
  return (
    <form onSubmit={confirmar}>
      <p>Primeiro acesso: leia o QR code com o app autenticador (Google Authenticator, Microsoft Authenticator…) e digite o código de 6 números.</p>
      {qr && <img src={qr} alt="QR code" className="qr" />}
      <label>Código<input inputMode="numeric" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value)} required /></label>
      {erro && <p className="aviso">{erro}</p>}
      <button>Confirmar</button>
    </form>
  )
}

function Confirmar2FA() {
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const confirmar = async (e: FormEvent) => {
    e.preventDefault(); setErro('')
    const { data } = await supabase.auth.mfa.listFactors()
    const f = data?.totp?.[0]
    if (!f) { setErro('Nenhum autenticador cadastrado.'); return }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code: codigo.trim() })
    if (error) setErro('Código não confere.')
  }
  return (
    <form onSubmit={confirmar}>
      <p>Digite o código de 6 números do app autenticador.</p>
      <label>Código<input inputMode="numeric" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value)} autoFocus required /></label>
      {erro && <p className="aviso">{erro}</p>}
      <button>Entrar</button>
      <button type="button" className="link" onClick={() => supabase.auth.signOut()}>Sair</button>
    </form>
  )
}
