import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'
import { fileURLToPath } from 'node:url'

// Igual ao normal, mas troca src/lib/supabase.ts pelo Supabase simulado (testes/supabase-simulado.ts).
const simulado = fileURLToPath(new URL('./testes/supabase-simulado.ts', import.meta.url))
export default mergeConfig(base, defineConfig({
  build: { outDir: 'dist-teste' },
  plugins: [{
    name: 'supabase-simulado', enforce: 'pre',
    async resolveId(id, de, opc) {
      const r = await this.resolve(id, de, { ...opc, skipSelf: true })
      return r && r.id.replace(/\\/g, '/').endsWith('/src/lib/supabase.ts') ? simulado : null
    },
  }],
}))
