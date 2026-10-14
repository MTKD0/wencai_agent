import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { SecureOperationProvider } from './SecureOperation'

export function UIProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <SecureOperationProvider>{children}</SecureOperationProvider>
    </MotionConfig>
  )
}
