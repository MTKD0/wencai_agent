import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // SSR logs must stay on the server: forwarding them in both directions can loop.
  server: { forwardConsole: false },
  plugins: [devtools({ consolePiping: { enabled: false } }), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
