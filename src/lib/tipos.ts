export type Categoria = { id: number; nome: string; tipo: 'ENTRADA' | 'SAIDA'; secao: string; ordem: number; arquivada: boolean; cor: string | null; cliente_id: number | null }
export type Status = 'PREVISTO' | 'REALIZADO' | 'CONCILIADO'
export type Lancamento = { id: number; data: string; valor: number; categoria_id: number; descricao: string | null; status: Status; versao: number; recorrencia_id: number | null }
export type Cliente = { id: number; nome: string; documento: string | null; contato: string | null; email: string | null; telefone: string | null; forma_cobranca: 'BOLETO' | 'TRANSFERENCIA' | 'PIX'; situacao: 'ATIVO' | 'ENCERRADO'; obs: string | null }
export type Recorrencia = { id: number; descricao: string | null; categoria_id: number; valor: number; dia: number; inicio: string; fim: string | null; ativa: boolean }

export async function dados<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as T
}

// leitura com mais de 1.000 linhas: o Supabase devolve no máximo 1.000 por vez
export async function todas<T>(montar: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const saida: T[] = []
  for (let de = 0; ; de += 1000) {
    const parte = await dados<T[]>(montar(de, de + 999))
    saida.push(...parte)
    if (parte.length < 1000) return saida
  }
}
