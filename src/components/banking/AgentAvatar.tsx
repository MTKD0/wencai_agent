export function AgentAvatar({ small = false }: { small?: boolean }) {
  return (
    <span className={`bank-agent-avatar${small ? ' is-small' : ''}`} aria-hidden="true">
      <span className="bank-robot-face">
        <i />
        <i />
      </span>
    </span>
  )
}
