import { expect, type Page } from "@playwright/test";

export interface MomentState {
  phase: string;
  tau: number;
  timed: boolean;
  arrival: number;
  result: null | { grade: number; correct: boolean; outcome: string; choice: string | null; best: string; inputToFrameMs: number | null; reactionMs: number | null };
}

/** Collects page errors and console errors so a test can assert there were none. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __game?: unknown }).__game, null, { timeout: 60_000 });
}

export function state(page: Page): Promise<MomentState | null> {
  return page.evaluate(() => {
    const g = (window as any).__game.game;
    const m = g.moment;
    if (!m) return null;
    const r = m.result;
    return {
      phase: m.phase,
      tau: m.tau,
      timed: m.timed,
      arrival: m.scenario.arrival,
      result: r
        ? { grade: r.grade, correct: r.correct, outcome: r.outcome, choice: r.choice?.option.id ?? null, best: r.best.option.id, inputToFrameMs: r.inputToFrameMs, reactionMs: r.reactionMs }
        : null,
    };
  });
}

/** Stepped clock: advance n frames. */
export function step(page: Page, n = 1): Promise<void> {
  return page.evaluate((k) => (window as any).__game.step(k), n);
}

export async function stepUntil(page: Page, phase: string, max = 1200): Promise<MomentState> {
  for (let i = 0; i < max; i += 10) {
    const s = await state(page);
    if (s?.phase === phase) return s;
    await step(page, 10);
  }
  throw new Error(`never reached phase ${phase}`);
}

/** Where on the page a pitch point is, using the frame on screen. */
export function screenOf(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([px, py]) => (window as any).__game.toScreen(px, py), [x, y] as const);
}

/** The best option's target right now (computed by the game's own evaluator), as a page point. */
export async function bestTargetOnScreen(page: Page): Promise<{ x: number; y: number; id: string }> {
  const t = await page.evaluate(() => (window as any).__game.bestTarget());
  return { x: t.sx, y: t.sy, id: t.id };
}

/** A real touch on the screen (falls back to a mouse click on non-touch projects). */
export async function tap(page: Page, x: number, y: number): Promise<void> {
  const touch = await page.evaluate(() => "ontouchstart" in window);
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

export async function noHorizontalOverflow(page: Page): Promise<void> {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw, "page is wider than the screen").toBeLessThanOrEqual(o.cw);
}

/** No email address or phone number anywhere in the visible text (Upwork rule for bid material). */
export async function noContactDetails(page: Page): Promise<void> {
  // Each text node on its own line (WebKit's innerText runs absolutely placed chips together),
  // skipping the shirt-number chips over the players.
  const text = await page.evaluate(() => {
    const out: string[] = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest(".hud-labels, script, style")) continue;
      out.push(n.textContent ?? "");
    }
    return out.join(String.fromCharCode(10));
  });
  expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  // Nine or more digits on one line, optionally separated by single spaces, dots, dashes or brackets.
  expect(text).not.toMatch(/\+?\d(?:[ .()-]?\d){8,}/);
}
