// Feriados em que o banco não compensa: nacionais + Carnaval (segunda e terça), Sexta-feira Santa e Corpus Christi.
// A mesma regra está no banco (fn_eh_feriado / fn_dia_util, migração 0004): mudar nos dois lugares.
const FIXOS: Record<string, string> = {
  '01-01': 'Confraternização Universal', '04-21': 'Tiradentes', '05-01': 'Dia do Trabalho', '09-07': 'Independência',
  '10-12': 'Nossa Senhora Aparecida', '11-02': 'Finados', '11-15': 'Proclamação da República',
  '11-20': 'Consciência Negra', '12-25': 'Natal',
}

function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return new Date(Date.UTC(ano, Math.floor(n / 31) - 1, (n % 31) + 1))
}

const cache = new Map<number, Map<string, string>>()
function doAno(ano: number) {
  let m = cache.get(ano)
  if (m) return m
  m = new Map(Object.entries(FIXOS).map(([md, nome]) => [`${ano}-${md}`, nome]))
  const p = pascoa(ano).getTime()
  for (const [dias, nome] of [[-48, 'Carnaval'], [-47, 'Carnaval'], [-2, 'Sexta-feira Santa'], [60, 'Corpus Christi']] as const) {
    m.set(new Date(p + dias * 86_400_000).toISOString().slice(0, 10), nome)
  }
  cache.set(ano, m)
  return m
}

/** nome do feriado no dia (AAAA-MM-DD), ou null */
export const feriado = (iso: string): string | null => doAno(Number(iso.slice(0, 4))).get(iso) ?? null
const diaSemana = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay() // 0 domingo, 6 sábado
export const fimDeSemana = (iso: string) => [0, 6].includes(diaSemana(iso))
export const ehDiaUtil = (iso: string) => !fimDeSemana(iso) && !feriado(iso)
export const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
export const siglaDia = (iso: string) => SEMANA[diaSemana(iso)]
/** próximo dia útil a partir do dia (o próprio, se for útil) */
export function proximoDiaUtil(iso: string): string {
  let d = iso
  while (!ehDiaUtil(d)) d = new Date(Date.parse(d + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10)
  return d
}
