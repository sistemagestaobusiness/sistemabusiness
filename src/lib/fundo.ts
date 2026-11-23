import { useRef, type MouseEvent } from 'react'

// Fundo escuro de janela (popup): fecha só num clique que começou E terminou no próprio fundo.
// Sem isso, arrastar o mouse para selecionar o texto de um campo e soltar fora da janela
// dispara um "click" no fundo e a janela fecha no meio da edição.
export function useFundo(fechar: () => void) {
  const comecouFora = useRef(false)
  return {
    onMouseDown: (e: MouseEvent) => { comecouFora.current = e.target === e.currentTarget },
    onClick: (e: MouseEvent) => {
      const fora = comecouFora.current && e.target === e.currentTarget
      comecouFora.current = false
      if (fora) fechar()
    },
  }
}
