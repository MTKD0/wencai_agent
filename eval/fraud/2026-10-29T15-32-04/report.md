# 诱导转账识别评测（留出集）

> 生成时间 2026-10-29T15:33:08.149Z，代码版本 `0725bc9`，独立库 `file:./.scratch/fraud-2026-10-29T15-32-04.db`。第三层使用当前配置的模型，共 1 轮。
> 样本定义见 `src/server/security/fraud-corpus.ts`：写于第二层阈值确定之后、第三层动手之前，未用于调规则。情形由团队编写，不是真实案件数据。

## 识别率与误报率

| 层 | 诈骗样本识别 | 正常样本误报 | 波动 |
|---|---|---|---|
| ① 关键词 | 0 / 35（0.0%，0.0%–9.9%） | 1 / 20（5.0%） |  |
| ② 行为画像 | 26 / 35（74.3%，57.9%–85.8%） | 8 / 20（40.0%） |  |
| ③ 模型话术判断 | 30 / 35（85.7%，70.6%–93.7%） | 0 / 20（0.0%） |  |
| ①+② | 26 / 35（74.3%，57.9%–85.8%） | 8 / 20（40.0%） |  |
| ①+②+③（上线组合） | 34 / 35（97.1%，85.5%–99.5%） | 8 / 20（40.0%） |  |

“误报”的代价：第一、三层命中显示诈骗劝阻，第二层命中显示较温和的“与平时习惯差别较大”提醒；两者都升为红色强验证、要求勾选已核实，都**不拒绝交易**。只有话术命中（第一、三层）的转账在用户坚持确认后才进入冷静期。

## 逐条结果（最后一轮）

| 编号 | 类型 | 说明 | 金额 | ① | ② 行为信号 | ③ |
|---|---|---|---|---|---|---|
| fs-01 | 诈骗 | 杀猪盘 | 50000 |  | ✓ amount_spike、drains_balance、new_payee | ✓ |
| fs-02 | 诈骗 | 冒充客服关闭百万保障 | 8000 |  | ✓ amount_spike、new_payee | ✓ |
| fs-03 | 诈骗 | 虚假征信修复 | 10000 |  | ✓ amount_spike、drains_balance、new_payee | ✓ |
| fs-04 | 诈骗 | 注销校园贷 | 6000 |  | ✓ amount_spike、new_payee | ✓ |
| fs-05 | 诈骗 | 冒充亲属出事 | 20000 |  | ✓ amount_spike、drains_balance、new_payee | ✓ |
| fs-06 | 诈骗 | 刷单首笔试水 | 200 |  |  | ✓ |
| fs-07 | 诈骗 | 游戏交易保证金 | 2000 |  | ✓ amount_spike、new_payee | ✓ |
| fs-08 | 诈骗 | 中奖交税 | 3000 |  | ✓ amount_spike、new_payee | ✓ |
| fs-09 | 诈骗 | 快递理赔 | 500 |  | new_payee | ✓ |
| fs-10 | 诈骗 | 冒充医保监管 | 30000 |  | ✓ amount_spike、drains_balance、new_payee、liquidated_today | ✓ |
| fs-11 | 诈骗 | 冒充熟人新微信 | 5000 |  | ✓ amount_spike、new_payee | ✓ |
| fs-12 | 诈骗 | 荐股入金 | 20000 |  | ✓ amount_spike、drains_balance、new_payee | ✓ |
| fs-13 | 诈骗 | 网贷解冻 | 3000 |  | ✓ amount_spike、new_payee | ✓ |
| fs-14 | 诈骗 | 冒充领导 | 10000 |  | ✓ amount_spike、drains_balance、new_payee | ✓ |
| fs-15 | 诈骗 | 虚拟币 | 15000 |  | ✓ amount_spike、drains_balance、new_payee | ✓ |
| fs-16 | 诈骗 | 冒充公检法自证清白 | 80000 |  | ✓ amount_spike、drains_balance、new_payee、liquidated_today | ✓ |
| fs-17 | 诈骗 | 海外包裹罚款 | 8000 |  | ✓ amount_spike、new_payee | ✓ |
| fs-18 | 诈骗 | 直播返现垫付 | 600 |  | new_payee | ✓ |
| fs-19 | 诈骗 | 办卡手续费 | 1500 |  | new_payee | ✓ |
| fs-20 | 诈骗 | 会员扣费视频指导 | 4000 |  | ✓ amount_spike、new_payee | ✓ |
| fs-21 | 诈骗 | 冒充老师收费 | 380 |  |  | ✓ |
| fs-22 | 诈骗 | 养老投资 | 100000 |  | ✓ amount_spike、drains_balance、new_payee | ✓ |
| fs-23 | 诈骗 | 机票改签 | 1200 |  | new_payee | ✓ |
| fs-24 | 诈骗 | 深夜被催 | 50000 |  | ✓ amount_spike、drains_balance、new_payee、fresh_login | ✓ |
| fs-25 | 诈骗 | 冒充亲属换号 | 3000 |  | ✓ amount_spike、new_payee | ✓ |
| fs-26 | 诈骗 | 兼职押金 | 300 |  |  | ✓ |
| fs-27 | 诈骗 | 假冒电商退款 | 1000 |  | new_payee | ✓ |
| fs-28 | 诈骗 | 多笔分散转出 | 9000 |  | ✓ amount_spike、new_payee、many_new_payees | ✓ |
| fs-29 | 诈骗 | 赎回后转出 | 60000 |  | ✓ amount_spike、drains_balance、new_payee、liquidated_today | ✓ |
| fs-30 | 诈骗 | 熟人账户被盗用 | 10000 |  | ✓ amount_spike、drains_balance | ✓ |
| fs-31 | 诈骗 | 沉默型·大额 | 50000 |  | ✓ amount_spike、drains_balance、new_payee |  |
| fs-32 | 诈骗 | 沉默型·中额 | 3000 |  | ✓ amount_spike、new_payee |  |
| fs-33 | 诈骗 | 沉默型·赎回转出 | 60000 |  | ✓ amount_spike、drains_balance、new_payee、liquidated_today |  |
| fs-34 | 诈骗 | 沉默型·小额 | 800 |  | new_payee |  |
| fs-35 | 诈骗 | 沉默型·深夜 | 20000 |  | ✓ amount_spike、drains_balance、new_payee、fresh_login、late_night |  |
| fb-01 | 正常 | 日常生活费 | 500 |  |  |  |
| fb-02 | 正常 | 房租 | 3000 |  |  |  |
| fb-03 | 正常 | 垫付报销 | 2000 | ✓ | ✓ amount_spike、new_payee |  |
| fb-04 | 正常 | 首次交押金 | 6000 |  | ✓ amount_spike、new_payee |  |
| fb-05 | 正常 | 买车首付 | 50000 |  | ✓ amount_spike、new_payee |  |
| fb-06 | 正常 | 份子钱 | 600 |  | new_payee |  |
| fb-07 | 正常 | 还朋友钱 | 230 |  |  |  |
| fb-08 | 正常 | 学费 | 5800 |  | new_payee |  |
| fb-09 | 正常 | 孝敬父母 | 10000 |  | ✓ amount_spike、drains_balance |  |
| fb-10 | 正常 | 退款查询后转账 | 200 |  |  |  |
| fb-11 | 正常 | 装修尾款 | 20000 |  | ✓ amount_spike、new_payee |  |
| fb-12 | 正常 | 借给同事 | 200 |  |  |  |
| fb-13 | 正常 | 理财到期后转给家人 | 30000 |  | ✓ amount_spike、drains_balance、liquidated_today |  |
| fb-14 | 正常 | 深夜小额 | 45 |  |  |  |
| fb-15 | 正常 | 首次给家教 | 1600 |  | new_payee |  |
| fb-16 | 正常 | 提到客服但正常 | 500 |  |  |  |
| fb-17 | 正常 | 大额给配偶 | 20000 |  | ✓ amount_spike、drains_balance |  |
| fb-18 | 正常 | 首次买二手 | 3500 |  | ✓ amount_spike、new_payee |  |
| fb-19 | 正常 | 刚登录转小额 | 100 |  |  |  |
| fb-20 | 正常 | 月底还款给朋友 | 5000 |  | amount_spike |  |

## 解读边界

- 样本 50 条，置信区间很宽；比例只说明这份样本上的表现。
- 第二层的情形（收款人新旧、金额、余额）是按常见案发特征编写的，对第二层偏有利；正常样本里刻意放入了首次交押金、买车首付、大额孝敬父母等容易误报的情形。
- 第三层是模型判断，同一输入多次运行可能不同，用 `--repeat` 观察波动。
- fs-01 至 fs-30 中用户都讲出了来龙去脉（“对方说……让我……”），对第三层有利；fs-31 至 fs-35 是“沉默型”，用户只说要转账，话术层按设计无从判断，只能靠第二层。
