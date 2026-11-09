import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Cada build ganha uma versão única: vai dentro do código e no arquivo /versao.json.
// A tela compara as duas para saber se há versão nova publicada (ver src/lib/versao.ts).
const VERSAO = new Date().toISOString()

function versaoJson(): Plugin {
  return {
    name: 'versao-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'versao.json', source: JSON.stringify({ versao: VERSAO }) })
    },
  }
}

export default defineConfig({
  // caminho relativo: o site funciona em sistemagestaobusiness.github.io/sistemabusiness/ (as telas usam #endereço)
  base: './',
  plugins: [react(), versaoJson()],
  define: { __VERSAO__: JSON.stringify(VERSAO) },
})
