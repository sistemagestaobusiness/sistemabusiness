// Leitura de extrato OFX (SGML 1.x ou XML 2.x). Cada <STMTTRN> vira um movimento.
export type Movimento = { fitid: string; data: string; valor: number; descricao: string; documento: string | null }

// O C6 manda o arquivo em UTF-8 mesmo dizendo CHARSET:1252 no cabeçalho, então tenta UTF-8 primeiro
// e só usa o 1252 se o arquivo não for UTF-8 válido.
export function decodificar(bytes: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return new TextDecoder('windows-1252').decode(bytes) }
}

function campo(bloco: string, tag: string): string | null {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'))
  return m ? m[1].trim() : null
}

export function lerOfx(texto: string): { movimentos: Movimento[]; conta: string | null; ate: string | null } {
  const blocos = texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0])
  const vistos = new Map<string, number>()
  const movimentos = blocos.map((b) => {
    const dt = campo(b, 'DTPOSTED') ?? ''
    const data = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`
    const valor = Number((campo(b, 'TRNAMT') ?? '0').replace(',', '.'))
    const descricao = [campo(b, 'NAME'), campo(b, 'MEMO')].filter(Boolean).join(' · ')
    let fitid = campo(b, 'FITID')
    if (!fitid) {
      // sem código do banco: monta um a partir do conteúdo (mesmo dia/valor/descrição repetidos ganham sequência)
      const base = `${data}|${valor}|${descricao}`
      const n = (vistos.get(base) ?? 0) + 1
      vistos.set(base, n)
      fitid = `sem-fitid:${base}|${n}`
    }
    return { fitid, data, valor: Math.round(valor * 100) / 100, descricao, documento: campo(b, 'CHECKNUM') ?? campo(b, 'REFNUM') }
  }).filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.data) && Number.isFinite(m.valor) && m.valor !== 0)
  const dtFim = campo(texto, 'DTEND')
  return { movimentos, conta: campo(texto, 'ACCTID'), ate: dtFim ? `${dtFim.slice(0, 4)}-${dtFim.slice(4, 6)}-${dtFim.slice(6, 8)}` : null }
}

// texto para comparar descrições ("PIX RECEBIDO - FULANO LTDA" ~ "Pix recebido fulano ltda")
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\d+/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()
