/**
 * 后台演示用的合成客户与反诈案例。只追加、可重复执行（按标记判断），不清空、不改动已有数据。
 * 所有合成客户 ID 以 cust_ 开头、手机号以 1990001 开头，便于识别与清理。
 */
import { eq } from 'drizzle-orm'
import { auth, db, schema } from './client'
import { ensureCardSchema } from '#/server/cards/service'
import { ensureHoldSchema } from '#/server/payments/holds'
import { ensureFraudEventSchema } from '#/server/fraud/events'
import { fraudReason, type FraudSignal } from '#/server/policy/fraud'
import { BEHAVIOR_SIGNAL_TEXT, type BehaviorSignal } from '#/server/policy/behavior'
import { UNUSUAL_REASON_PREFIX } from '#/lib/fraud'

export const CUSTOMER_FIXTURE_MARKER = 'customer_demo_fixture_v1'
const DAY = 86_400_000, HOUR = 3_600_000

type Style = 'thrifty' | 'regular' | 'spender' | 'retired'
const CUSTOMERS: { name: string; salary: number; balance: number; savings: number; risk: 'R1' | 'R2' | 'R3' | 'R4' | 'R5'; style: Style }[] = [
  { name: '王桂芳', salary: 420_000, balance: 6_820_000, savings: 18_000_000, risk: 'R1', style: 'retired' },
  { name: '陈志强', salary: 980_000, balance: 1_250_000, savings: 0, risk: 'R3', style: 'spender' },
  { name: '刘婷', salary: 1_250_000, balance: 3_460_000, savings: 5_000_000, risk: 'R2', style: 'regular' },
  { name: '赵磊', salary: 760_000, balance: 380_000, savings: 0, risk: 'R2', style: 'spender' },
  { name: '孙丽华', salary: 1_580_000, balance: 5_200_000, savings: 12_000_000, risk: 'R3', style: 'regular' },
  { name: '周建平', salary: 2_600_000, balance: 4_100_000, savings: 30_000_000, risk: 'R4', style: 'regular' },
  { name: '吴敏', salary: 1_120_000, balance: 2_900_000, savings: 8_000_000, risk: 'R3', style: 'thrifty' },
  { name: '郑秀英', salary: 380_000, balance: 2_150_000, savings: 9_600_000, risk: 'R1', style: 'retired' },
  { name: '黄海', salary: 1_380_000, balance: 1_760_000, savings: 3_000_000, risk: 'R4', style: 'spender' },
  { name: '冯晓东', salary: 890_000, balance: 1_020_000, savings: 0, risk: 'R2', style: 'regular' },
  { name: '何静', salary: 1_450_000, balance: 3_800_000, savings: 6_000_000, risk: 'R3', style: 'thrifty' },
  { name: '马俊', salary: 2_100_000, balance: 6_400_000, savings: 20_000_000, risk: 'R5', style: 'regular' },
  { name: '林晓雨', salary: 680_000, balance: 420_000, savings: 0, risk: 'R2', style: 'spender' },
  { name: '高建国', salary: 450_000, balance: 3_100_000, savings: 15_000_000, risk: 'R1', style: 'retired' },
  { name: '罗佳', salary: 1_020_000, balance: 1_880_000, savings: 2_000_000, risk: 'R3', style: 'regular' },
  { name: '谢文涛', salary: 1_760_000, balance: 2_480_000, savings: 10_000_000, risk: 'R4', style: 'thrifty' },
  { name: '韩雪', salary: 930_000, balance: 960_000, savings: 0, risk: 'R2', style: 'spender' },
  { name: '唐志远', salary: 3_200_000, balance: 9_600_000, savings: 40_000_000, risk: 'R5', style: 'regular' },
  { name: '曹秀兰', salary: 360_000, balance: 1_450_000, savings: 7_200_000, risk: 'R1', style: 'retired' },
  { name: '彭博', salary: 1_180_000, balance: 1_360_000, savings: 1_500_000, risk: 'R3', style: 'regular' },
  { name: '邓丽', salary: 1_340_000, balance: 2_250_000, savings: 4_000_000, risk: 'R3', style: 'thrifty' },
  { name: '许振华', salary: 1_900_000, balance: 3_380_000, savings: 8_800_000, risk: 'R4', style: 'regular' },
  { name: '宋雅琪', salary: 820_000, balance: 610_000, savings: 0, risk: 'R2', style: 'spender' },
  { name: '蒋卫东', salary: 2_400_000, balance: 5_700_000, savings: 16_000_000, risk: 'R4', style: 'thrifty' },
]

const SPEND: Record<Style, { share: number; mix: [string, string, number][] }> = {
  thrifty: { share: 0.35, mix: [['餐饮', '社区食堂', 0.4], ['生活缴费', '水电燃气', 0.25], ['交通', '地铁', 0.15], ['购物', '超市', 0.2]] },
  regular: { share: 0.55, mix: [['餐饮', '外卖平台', 0.3], ['购物', '电商平台', 0.25], ['交通', '网约车', 0.15], ['娱乐', '电影院', 0.1], ['生活缴费', '电费', 0.2]] },
  spender: { share: 0.92, mix: [['餐饮', '外卖平台', 0.25], ['购物', '电商平台', 0.35], ['娱乐', '游戏充值', 0.2], ['交通', '网约车', 0.2]] },
  retired: { share: 0.45, mix: [['餐饮', '菜市场', 0.35], ['生活缴费', '水电燃气', 0.2], ['购物', '超市', 0.3], ['医疗', '社区药房', 0.15]] },
}

/** 反诈案例：分布在识别后的各个阶段，供后台工作台、识别事件和回访工作台演示 */
type Outcome = 'awaiting' | 'abandoned' | 'expired' | 'held' | 'released' | 'cancelled_by_user' | 'cancelled_by_admin' | 'executed'
const CASES: {
  customer: number; payee: string; bank: string; amount: number; hoursAgo: number; signals: FraudSignal[]; layer?: 'keyword' | 'model'
  evidence?: string; behavior: BehaviorSignal[]; outcome: Outcome; ticket?: { attempts: number; outcome?: 'confirmed_safe' | 'confirmed_scam' | 'unreachable'; note?: string }
}[] = [
  { customer: 0, payee: '国家安全账户（核查）', bank: '某村镇银行', amount: 5_000_000, hoursAgo: 3, signals: ['safe_account'], layer: 'keyword', behavior: ['amount_spike', 'drains_balance', 'new_payee'], outcome: 'held', ticket: { attempts: 0 } },
  { customer: 1, payee: '李晓峰', bank: '某农商银行', amount: 300_000, hoursAgo: 15, signals: ['task_rebate'], layer: 'keyword', behavior: ['new_payee', 'many_new_payees'], outcome: 'held', ticket: { attempts: 1, outcome: 'unreachable', note: '两次致电未接，已发短信提醒' } },
  { customer: 2, payee: 'Daniel Wong', bank: '某城商银行', amount: 2_000_000, hoursAgo: 30, signals: ['romance'], layer: 'model', evidence: '他说在国外做项目，让我先转2万帮他周转，回国就还', behavior: ['amount_spike', 'new_payee'], outcome: 'cancelled_by_admin', ticket: { attempts: 1, outcome: 'confirmed_scam', note: '客户承认与对方仅网上认识，已劝阻并撤销' } },
  { customer: 3, payee: '速贷金融服务', bank: '某城商银行', amount: 180_000, hoursAgo: 26, signals: ['loan_fee'], layer: 'keyword', behavior: ['new_payee'], outcome: 'abandoned' },
  { customer: 4, payee: '王总', bank: '某股份制银行', amount: 4_600_000, hoursAgo: 52, signals: ['impersonation'], layer: 'model', evidence: '老板微信说在开会不方便接电话，让我先把款转过去', behavior: ['amount_spike', 'new_payee'], outcome: 'cancelled_by_user', ticket: { attempts: 1, outcome: 'confirmed_scam', note: '客户打电话给老板本人核实后自行撤销' } },
  { customer: 5, payee: '某汽车销售服务有限公司', bank: '建设银行', amount: 12_000_000, hoursAgo: 75, signals: [], behavior: ['amount_spike', 'liquidated_today', 'drains_balance'], outcome: 'executed' },
  { customer: 6, payee: '张女士（房东）', bank: '招商银行', amount: 900_000, hoursAgo: 40, signals: ['pressure'], layer: 'model', evidence: '中介说今天之内必须把定金付完，不然房子就给别人了', behavior: ['new_payee'], outcome: 'released', ticket: { attempts: 1, outcome: 'confirmed_safe', note: '客户提供了租房合同，确认是正常定金' } },
  { customer: 7, payee: '提现解冻中心', bank: '某村镇银行', amount: 880_000, hoursAgo: 0.2, signals: ['unlock_fee'], layer: 'keyword', behavior: ['new_payee', 'drains_balance'], outcome: 'awaiting' },
  { customer: 8, payee: '金牛投资导师', bank: '某农商银行', amount: 3_000_000, hoursAgo: 1, signals: ['investment_lure'], layer: 'keyword', behavior: ['amount_spike', 'new_payee'], outcome: 'held', ticket: { attempts: 0 } },
  { customer: 9, payee: '陈某', bank: '中国银行', amount: 600_000, hoursAgo: 100, signals: [], behavior: ['new_payee', 'late_night'], outcome: 'expired' },
  { customer: 12, payee: '某平台退款客服', bank: '某城商银行', amount: 260_000, hoursAgo: 120, signals: ['refund_service'], layer: 'keyword', behavior: ['new_payee'], outcome: 'abandoned' },
  { customer: 16, payee: '中奖税费代收', bank: '某村镇银行', amount: 150_000, hoursAgo: 140, signals: ['prize_fee'], layer: 'model', evidence: '说我抽中了二等奖，要先交1500元个税才能发奖金', behavior: ['new_payee'], outcome: 'abandoned' },
]

const phoneOf = (index: number) => `1990001${String(index).padStart(4, '0')}`
const idOf = (index: number) => `cust_${String(index + 1).padStart(2, '0')}`

export async function seedDemoCustomers(now: Date) {
  await Promise.all([ensureCardSchema(), ensureHoldSchema(), ensureFraudEventSchema()])
  const [existing] = await db.select().from(schema.settings).where(eq(schema.settings.key, CUSTOMER_FIXTURE_MARKER))
  if (existing) return false
  const t = now.getTime()
  await db.transaction(async (tx) => {
    for (const [index, c] of CUSTOMERS.entries()) {
      const id = idOf(index), main = `${id}_main`, save = `${id}_save`
      await tx.insert(schema.users).values({ id, name: c.name, riskRating: c.risk, riskAssessedAt: new Date(t - 60 * DAY).toISOString() })
      await tx.insert(auth.baUser).values({ id, name: c.name, email: `${id}@wencai.local`, emailVerified: true, phoneNumber: phoneOf(index), phoneNumberVerified: true,
        createdAt: new Date(t - (400 + index * 20) * DAY), updatedAt: new Date(t - 2 * DAY) })
      await tx.insert(schema.accounts).values({ id: main, userId: id, name: '工资卡', balanceCents: c.balance })
      await tx.insert(schema.cards).values({ id: `${id}_card`, userId: id, accountId: main, last4: String(3100 + index * 37).slice(-4), kind: 'debit', status: 'active', dailyLimitCents: 5_000_000 })
      await tx.insert(schema.bankCardProfiles).values({ cardId: `${id}_card`, remark: '工资卡' })
      if (c.savings) {
        await tx.insert(schema.accounts).values({ id: save, userId: id, name: '储蓄账户', balanceCents: c.savings })
        await tx.insert(schema.cards).values({ id: `${id}_card_save`, userId: id, accountId: save, last4: String(5200 + index * 41).slice(-4), kind: 'debit', status: 'active', dailyLimitCents: 5_000_000 })
        await tx.insert(schema.bankCardProfiles).values({ cardId: `${id}_card_save`, remark: '储蓄账户' })
      }
      // 近四个月：每月工资与按消费风格分布的支出；每人有两位常用收款人
      const txs: (typeof schema.transactions.$inferInsert)[] = []
      for (let m = 0; m < 4; m++) {
        const month = t - m * 30 * DAY
        txs.push({ id: `${id}_salary_${m}`, accountId: main, amountCents: c.salary, counterparty: c.style === 'retired' ? '养老金发放' : '公司代发工资', memo: null, category: '工资', occurredAt: new Date(month - 5 * DAY) })
        const budget = c.salary * SPEND[c.style].share
        for (const [k, [category, counterparty, share]] of SPEND[c.style].mix.entries()) {
          for (let n = 0; n < 3; n++) {
            txs.push({ id: `${id}_tx_${m}_${k}_${n}`, accountId: main, amountCents: -Math.round(budget * share / 3 * (0.8 + ((index + k + n) % 5) / 10)), counterparty, memo: null, category,
              occurredAt: new Date(month - (2 + k * 7 + n * 3) * DAY - (index % 9) * HOUR) })
          }
        }
        txs.push({ id: `${id}_family_${m}`, accountId: main, amountCents: -Math.round(c.salary * 0.1), counterparty: '家人', memo: '生活费', category: '转账', occurredAt: new Date(month - 8 * DAY) })
      }
      await tx.insert(schema.transactions).values(txs.filter((row) => row.occurredAt!.getTime() < t))
      await tx.insert(schema.payees).values({ id: `${id}_payee_family`, userId: id, name: '家人', alias: '家里', accountNo: `62220202${String(index).padStart(8, '0')}`, bank: '工商银行', createdAt: new Date(t - 300 * DAY) })
    }

    for (const [n, k] of CASES.entries()) {
      const userId = idOf(k.customer), created = new Date(t - k.hoursAgo * HOUR), actionId = `pa_demo_case_${n + 1}`, payeeId = `${userId}_payee_case_${n + 1}`
      const reasons = [...(k.signals.length ? [fraudReason(k.signals)] : []), ...(k.behavior.length >= 2 ? [`${UNUSUAL_REASON_PREFIX}：${k.behavior.map((s) => BEHAVIOR_SIGNAL_TEXT[s]).join('、')}，已升级为强验证`] : [])]
      await tx.insert(schema.payees).values({ id: payeeId, userId, name: k.payee, accountNo: `6230${String(900000000000 + n * 7919).slice(-12)}`, bank: k.bank, createdAt: new Date(created.getTime() - 20 * 60_000) })
      const args = { fromAccountId: `${userId}_main`, payeeId, amount: k.amount / 100 }
      const status = k.outcome === 'awaiting' ? 'pending' : k.outcome === 'abandoned' ? 'cancelled' : k.outcome === 'expired' ? 'expired' : 'consumed'
      await tx.insert(schema.pendingActions).values({ id: actionId, userId, sessionId: `demo-case-${n + 1}`, tool: 'transfer', argsJson: JSON.stringify(args), paramsHash: 'demo-fixture',
        level: 'red', reasonsJson: JSON.stringify(reasons), summaryJson: JSON.stringify({ title: '确认转账', fields: [{ label: '金额', value: `¥${(k.amount / 100).toFixed(2)}` }, { label: '收款人 / 账户', value: k.payee }] }),
        integrity: 'demo-fixture-not-confirmable', expiresAt: new Date(k.outcome === 'awaiting' ? t + 10 * 60_000 : created.getTime() + 10 * 60_000), status, createdAt: created })
      const customer = CUSTOMERS[k.customer]
      await tx.insert(schema.bankFraudEvents).values({ id: `fe_demo_case_${n + 1}`, userId, actionId, tool: 'transfer', amountCents: k.amount, payeeId, payeeName: k.payee,
        layersJson: JSON.stringify([...(k.signals.length ? [k.layer ?? 'keyword'] : []), ...(k.behavior.length >= 2 ? ['behavior'] : [])]), signalsJson: JSON.stringify(k.signals),
        evidence: k.evidence ?? null, behaviorJson: JSON.stringify(k.behavior),
        baselineJson: JSON.stringify({ medianOutCents: 80_000 + (k.customer % 4) * 50_000, sampleCount: 4, liquidBalanceCents: customer.balance + customer.savings, monthlyIncomeCents: customer.salary, payeePaidBefore: false }),
        reasonsJson: JSON.stringify(reasons), createdAt: created })
      const debit = (at: Date) => tx.insert(schema.transactions).values({ id: `${actionId}_debit`, accountId: `${userId}_main`, amountCents: -k.amount, counterparty: k.payee, memo: null, category: '转账', occurredAt: at })
      if (k.outcome === 'executed') await debit(new Date(created.getTime() + 3 * 60_000))
      if (!['held', 'released', 'cancelled_by_user', 'cancelled_by_admin'].includes(k.outcome)) continue
      const releaseAt = new Date(created.getTime() + 24 * HOUR), holdId = `hold_demo_case_${n + 1}`
      const holdStatus = k.outcome === 'held' ? 'held' : k.outcome === 'released' ? 'released' : 'cancelled'
      const resolvedAt = k.outcome === 'held' ? null : new Date(created.getTime() + (k.outcome === 'released' ? 6 : 4) * HOUR)
      await tx.insert(schema.bankTransferHolds).values({ id: holdId, userId, actionId, tool: 'transfer', inputJson: JSON.stringify({ input: { fromAccountId: `${userId}_main`, payeeId, amountCents: k.amount } }),
        amountCents: k.amount, payeeName: k.payee, reasonsJson: JSON.stringify(reasons), status: holdStatus, createdAt: created, releaseAt, resolvedAt,
        resolvedBy: k.outcome === 'held' ? null : k.outcome === 'cancelled_by_user' ? 'user' : 'admin' })
      if (k.outcome === 'released') await debit(resolvedAt!)
      if (k.ticket) {
        await tx.insert(schema.bankCallbackTickets).values({ id: `cb_demo_case_${n + 1}`, userId, holdId, actionId, reasonsJson: JSON.stringify(reasons), amountCents: k.amount, payeeName: k.payee,
          status: k.outcome === 'held' ? 'open' : 'closed', outcome: k.ticket.outcome ?? null, note: k.ticket.note ?? null, handledBy: k.ticket.outcome ? '演示坐席' : null,
          attempts: k.ticket.attempts, createdAt: created, updatedAt: resolvedAt ?? new Date(created.getTime() + 2 * HOUR) })
      }
    }
    await tx.insert(schema.settings).values({ key: CUSTOMER_FIXTURE_MARKER, value: now.toISOString() })
  })
  return true
}

export const FRAUD_CASE_COUNT = CASES.length
