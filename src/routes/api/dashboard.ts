import { createFileRoute } from '@tanstack/react-router'
import { getDashboard } from '#/server/dashboard'
import { requireSession } from '#/server/session'

export const Route = createFileRoute('/api/dashboard')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let session
        try {
          session = await requireSession(request)
        } catch {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        try {
          return Response.json(await getDashboard(session.userId), {
            headers: { 'Cache-Control': 'private, no-store' },
          })
        } catch (error) {
          console.error('[dashboard]', error)
          return Response.json({ message: '暂时无法读取账户数据，请稍后重试' }, { status: 500 })
        }
      },
    },
  },
})
