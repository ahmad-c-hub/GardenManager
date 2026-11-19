// Garden Walk helpers: pure functions, no React.

/**
 * Distance between two pins as it looks on screen. Pins are stored as
 * percentages of the image, so x is scaled by the aspect ratio (width/height)
 * to make one unit across equal one unit down.
 */
export function visualDistance(a, b, ratio = 1) {
  return Math.hypot((a.x_percent - b.x_percent) * ratio, a.y_percent - b.y_percent);
}

/**
 * Where "Next" goes from `currentId`: the nearest pin not yet visited this walk,
 * or, once everything has been seen, the nearest pin other than the current one.
 * Ties go to the older pin, so the order is stable. Returns null if there's nowhere to go.
 */
export function nextInWalk(pins, currentId, visited, ratio = 1) {
  const current = pins.find((p) => p.id === currentId);
  if (!current) return null;
  const others = pins.filter((p) => p.id !== currentId);
  const unvisited = others.filter((p) => !visited.has(p.id));
  const pool = unvisited.length > 0 ? unvisited : others;
  let best = null;
  let bestDistance = Infinity;
  for (const p of pool) {
    const d = visualDistance(current, p, ratio);
    if (d < bestDistance - 1e-9 || (Math.abs(d - bestDistance) <= 1e-9 && p.id < best.id)) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
}

/** Unit vector of travel from one pin to another, in on-screen space. {x: 0, y: 0} if they coincide. */
export function travelVector(from, to, ratio = 1) {
  if (!from || !to) return { x: 0, y: 0 };
  const dx = (to.x_percent - from.x_percent) * ratio;
  const dy = to.y_percent - from.y_percent;
  const len = Math.hypot(dx, dy);
  return len < 1e-6 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
}

/** Run `fn` over `items`, at most `limit` at a time. Every item runs; the first failure is rethrown at the end. */
export async function runLimited(items, limit, fn) {
  let next = 0;
  let firstError = null;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (err) {
        firstError ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (firstError) throw firstError;
}
