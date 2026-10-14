import { createFileRoute, redirect } from '@tanstack/react-router'

/** Keep existing registration links working after registration moved into login. */
export const Route = createFileRoute('/register')({
  beforeLoad: () => {
    throw redirect({ href: '/login?register=1', replace: true })
  },
})
