// Runs a document's animation: preset variables eased over time, and one expression per unit
// evaluated every simulated tick.
//
// Expressions are JavaScript, evaluated with these names in scope:
//   the current preset's variables (eased), `t` (simulated seconds), `phase` (cycles elapsed,
//   advancing by tick / period when a `period` variable exists), `u(id)` (another unit's activity
//   this tick, or last tick's if it has not been computed yet), `cyc(offset)` (phase minus offset,
//   wrapped to [0, 1)), `burst(p, duty)` (a half-sine over [0, duty)), `rest(p, duty)` (a flattened
//   half-sine over [duty, 1)), and abs, min, max, clamp, sin, cos, pow, sqrt, PI.
// Activity is clamped to [0, 1]. Project files are code: only open ones you trust.
import type { Animation } from './model';

const HELPERS = ['u', 'cyc', 'burst', 'rest', 'abs', 'min', 'max', 'clamp', 'sin', 'cos', 'pow', 'sqrt', 'PI', 't', 'phase'];

type Compiled = { fn: ((...args: unknown[]) => unknown) | null; error: string | null };

export type Runner = {
  // Advances one tick and returns every unit's activity.
  step(preset: string): Record<string, number>;
  caption(node: string): string | null;
  errors: Record<string, string>;
};

export function createRunner(animation: Animation): Runner {
  const varNames = [...new Set(animation.presets.flatMap(p => Object.keys(p.vars)))].filter(n => !HELPERS.includes(n) && /^[A-Za-z_$][\w$]*$/.test(n));
  const names = [...HELPERS, ...varNames];
  const errors: Record<string, string> = {};
  const compile = (key: string, expr: string): Compiled => {
    try {
      return { fn: new Function(...names, `"use strict"; return (${expr});`) as Compiled['fn'], error: null };
    } catch (error) {
      errors[key] = (error as Error).message;
      return { fn: null, error: (error as Error).message };
    }
  };
  const units = Object.entries(animation.activity).map(([id, expr]) => ({ id, ...compile(id, expr) }));
  const captions = Object.fromEntries(Object.entries(animation.captions).map(([id, expr]) => [id, compile('caption:' + id, expr)]));

  const presetOf = (key: string) => animation.presets.find(p => p.key === key) ?? animation.presets[0];
  const vars: Record<string, number> = { ...(animation.presets[0]?.vars ?? {}) };
  let phase = 0;
  let time = 0;
  let last: Record<string, number> = {};
  let started = false;

  const args = (current: Record<string, number>) => {
    const u = (id: string) => current[id] ?? last[id] ?? 0;
    const cyc = (offset: number) => (((phase - offset) % 1) + 1) % 1;
    const burst = (p: number, duty: number) => (p < duty ? Math.sin((Math.PI * p) / duty) : 0);
    const rest = (p: number, duty: number) => (p >= duty ? Math.pow(Math.sin((Math.PI * (p - duty)) / (1 - duty)), 0.6) : 0);
    const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
    return [u, cyc, burst, rest, Math.abs, Math.min, Math.max, clamp, Math.sin, Math.cos, Math.pow, Math.sqrt, Math.PI, time, phase, ...varNames.map(n => vars[n] ?? 0)];
  };

  return {
    errors,
    step(key: string) {
      const target = presetOf(key)?.vars ?? {};
      if (!started) {
        Object.assign(vars, target);
        started = true;
      }
      const k = Math.min(1, animation.tick * animation.ease);
      for (const [name, value] of Object.entries(target)) {
        let d = value - (vars[name] ?? value);
        if (animation.cyclic.includes(name)) d -= Math.round(d);
        vars[name] = (vars[name] ?? value) + d * k;
      }
      time += animation.tick;
      phase += animation.tick / (vars.period > 0 ? vars.period : 1);
      const current: Record<string, number> = {};
      for (const unit of units) {
        if (!unit.fn) continue;
        try {
          const v = Number(unit.fn(...args(current)));
          current[unit.id] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
          delete errors[unit.id];
        } catch (error) {
          current[unit.id] = 0;
          errors[unit.id] = (error as Error).message;
        }
      }
      last = current;
      return current;
    },
    caption(node: string) {
      const c = captions[node];
      if (!c?.fn) return null;
      try {
        return String(c.fn(...args(last)));
      } catch {
        return null;
      }
    },
  };
}
