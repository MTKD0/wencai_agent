import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  // A second React instance during lazy-page HMR breaks every motion component.
  resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['radix-ui', 'motion/react', 'embla-carousel-react'] },
  // SSR logs must stay on the server: forwarding them in both directions can loop.
  server: { forwardConsole: false },
  plugins: [devtools({ consolePiping: { enabled: false } }), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
