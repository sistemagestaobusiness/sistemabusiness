// Lido ANTES de o Supabase abrir: ele apaga o #access_token...&type=recovery do endereço logo ao iniciar.
const bruto = location.hash.slice(1) || location.search.slice(1)
const p = new URLSearchParams(bruto)
export const veioDoLinkDeSenha = p.get('type') === 'recovery'
export const erroDoLink: string | null = !p.get('error') ? null
  : p.get('error_code') === 'otp_expired'
    ? 'O link de troca de senha venceu ou já foi usado. Digite o e-mail e peça outro.'
    : 'Não foi possível usar o link de troca de senha. Peça outro.'
