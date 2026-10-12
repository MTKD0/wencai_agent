import { HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: '文财 · 银行 AI 智能体' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }, { rel: 'icon', href: '/favicon.svg' }],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <div className="mx-auto flex h-dvh max-w-md flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <p className="m-0 text-xl font-bold tracking-tight text-foreground">页面不存在</p>
      <p className="m-0 text-xs text-muted-foreground">该页面可能已被移动或不存在。</p>
      <a className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors" href="/">
        返回文财首页
      </a>
    </div>
  ),
  errorComponent: ({ error }: { error: unknown }) => (
    <div className="mx-auto flex h-dvh max-w-md flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <p className="m-0 text-xl font-bold tracking-tight text-foreground">系统发生错误</p>
      <p className="m-0 max-w-xs text-xs text-muted-foreground">{error instanceof Error ? error.message : '未知异常，请稍后重试'}</p>
      <a className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors" href="/">
        返回文财首页
      </a>
    </div>
  ),
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere]">
        {children}
        {import.meta.env.DEV && (
          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[{ name: 'Tanstack Router', render: <TanStackRouterDevtoolsPanel /> }, TanStackQueryDevtools]}
          />
        )}
        <Scripts />
      </body>
    </html>
  )
}
