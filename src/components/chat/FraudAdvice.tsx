/**
 * 诱导转账劝阻文案：固定写在前端，不使用模型文字。
 * 对话中由服务端识别到话术时单独显示（data-fraud），确认卡在原因含“疑似诈骗”时嵌入显示。
 */
export function FraudAdvice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="bank-fraud-warning" role="alert">
      <p className="bank-fraud-title">请先停一下，这可能是诈骗</p>
      <ul>
        <li>公安、检察院、法院不会通过电话要求转账，也没有所谓的“安全账户”。</li>
        <li>刷单返利、先交保证金或解冻费才能放款、提现，都是诈骗。</li>
        <li>任何人索要验证码或要求屏幕共享，请立即拒绝。</li>
      </ul>
      <p className="bank-fraud-hotline">拿不准时，请先挂断电话，联系家人或拨打 96110 反诈专线核实。</p>
      {children}
    </div>
  )
}
