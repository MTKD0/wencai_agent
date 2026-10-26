/** Wilson 95% 置信区间：样本少时比正态近似可靠，评测报告与红队统计共用 */
export function wilson(passed: number, total: number): [number, number] {
  if (!total) return [0, 0]
  const z = 1.96, p = passed / total
  const denominator = 1 + z * z / total
  const centre = (p + z * z / (2 * total)) / denominator
  const margin = (z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / denominator
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)]
}
