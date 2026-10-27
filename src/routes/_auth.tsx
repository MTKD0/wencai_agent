import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { AuthPage } from '#/components/banking/AuthPage'

export const Route = createFileRoute('/_auth')({ component: AuthLayout })

/** Keep the brand scene and its one-shot animation alive across both auth tabs. */
function AuthLayout() {
  const register = useRouterState({ select: (state) => state.location.pathname === '/register' })
  return (
    <>
      <AuthPage register={register} />
      <Outlet />
    </>
  )
}
