export const moeda = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const dataBR = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
export const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function diasDoMes(ano: number, mes: number): string[] {
  const n = new Date(ano, mes, 0).getDate()
  return Array.from({ length: n }, (_, i) => isoDia(new Date(ano, mes - 1, i + 1)))
}
// "1.234,56" ou "1234.56" ou "=1000+500" (como na planilha) -> número
export function lerValor(txt: string): number | null {
  const s = txt.trim().replace(/^=/, '')
  if (!s) return null
  const partes = s.split('+').map((p) => {
    const t = p.trim()
    const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t)
    return n
  })
  if (partes.some((n) => !Number.isFinite(n))) return null
  return Math.round(partes.reduce((a, b) => a + b, 0) * 100) / 100
}
