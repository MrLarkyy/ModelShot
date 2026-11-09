/**
 * The first index whose CDF value exceeds u, by bisection over `count` values from `at(0)`: the TS mirror of
 * `marginalSearch` and `conditionalSearch` of the path tracer's environmentMap chunk.
 */
export function cdfSearch(count: number, u: number, at: (i: number) => number): number {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid) > u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
