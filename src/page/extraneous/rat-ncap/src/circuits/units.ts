/**
 * This module defines `Unit` classes, which model neurons and dynamical motifs.
 */
import * as torch from '../torch';
import * as activations from '../utils/torch/activations';
import * as config from './config';
import * as connector from './connector';
import * as signal from './signal';

type TensorOrFloat = torch.Tensor | number;

/** Sets `field` to `value` where `condition` is true, otherwise leaves it unchanged. */
function _conditional_set(field: torch.Tensor, value: torch.Tensor, condition: torch.Tensor | null = null) {
  field.set_(condition === null ? value : condition.mul(value).add(condition.not().mul(field)));
}

/** A primitive node representing an abstract computational unit in a neural circuit. */
export abstract class Unit extends signal.Signal {
  /** Advances the unit to the next state. */
  step() {
  }

  /** Populates the unit with any necessary internal state (e.g. inputs from connections). */
  populate() {
  }
}

export interface BasicKwargs {
  activation?: (x: torch.Tensor) => torch.Tensor;
  bias?: TensorOrFloat;
  voltage_time?: number;
  [key: string]: unknown;
}

/**
 * A basic neuron with an internal voltage variable. The activation function defines the
 * voltage-firing relationship.
 */
export class Basic extends Unit {
  activation: (x: torch.Tensor) => torch.Tensor;
  bias: TensorOrFloat;
  voltage_time: number;
  synapses: connector.Connector;
  v: torch.nn.Buffer;
  dt!: number;  // Timestep

  /**
   * Args:
   *   activation: Activation function.
   *   bias: Bias voltage between -1 and +1.
   *   voltage_time: Time constant of the voltage variable (in milliseconds).
   */
  constructor({
    activation = activations.unitrelu,
    bias = 0,
    voltage_time = 50,
    ...kwargs
  }: BasicKwargs = {}) {
    super(kwargs);
    console.assert(0 < voltage_time);

    this.activation = activation;
    this.bias = bias;
    this.voltage_time = voltage_time;

    this.synapses = new connector.Connector(this);

    this.v = new torch.nn.Buffer(torch.zeros(1), { persistent: false });  // Voltage variable
  }

  synapse(source: signal.Signal, kwargs: connector.ConnectKwargs = {}) {
    this.synapses.connect(source, kwargs);
    return this;
  }

  override init(cfg: config.SimulatorConfig) {
    this.dt = cfg.timestep;
  }

  override reset(reset: torch.Tensor | null = null) {
    this.synapses.reset(reset);
    _conditional_set(this.v, torch.zeros(1), reset);
    _conditional_set(this.value, torch.zeros(1), reset);
  }

  override step() {
    const v = this.v;
    const y = this.activation;

    const z = torch.clamp(this.synapses.integrate().add(this.bias), { min: -1, max: 1 });

    // Forward-Euler discretization (for reference).
    // dv = z - v
    // this.v[:] = v + 4 * dv / this.voltage_time * this.dt

    // Backward-Euler discretization.
    const kv = 4 / this.voltage_time * this.dt;
    this.v.set_(v.add(z.mul(kv)).div(1 + kv));

    this.value.set_(y(this.v));
  }

  override populate() {
    this.synapses.populate();
  }
}

export interface AdaptorKwargs extends BasicKwargs {
  adaptation?: number;
  adaptation_time?: number;
}

/**
 * An adapting neuron with an internal voltage and adaptation variable. The `adaptation` constant
 * defines if it is depressing (firing less for the same input) or facilitating (firing more for the
 * same input). The activation function defines the voltage-firing relationship.
 */
export class Adaptor extends Unit {
  activation: (x: torch.Tensor) => torch.Tensor;
  bias: TensorOrFloat;
  adaptation: number;
  adaptation_time: number;
  voltage_time: number;
  synapses: connector.Connector;
  v: torch.nn.Buffer;
  a: torch.nn.Buffer;
  dt!: number;  // Timestep

  /**
   * Args:
   *   activation: Activation function.
   *   bias: Bias voltage between -1 and +1.
   *   adaptation: Adaptation constant between -1 and +1, representing maximum depression (with
   *     asymptotic firing rate of zero) and +1 is maximum facilitation (with fastest time to maximum
   *     firing).
   *   adaptation_time: Time constant of the adaptation variable (in milliseconds).
   *   voltage_time: Time constant of the voltage variable (in milliseconds).
   */
  constructor({
    activation = activations.unitrelu,
    bias = 0,
    adaptation = 0,
    adaptation_time = 1000,
    voltage_time = 50,
    ...kwargs
  }: AdaptorKwargs = {}) {
    super(kwargs);
    console.assert(-1 <= adaptation && adaptation <= 1);
    console.assert(!(adaptation === 1 && bias === 0));
    console.assert(0 < adaptation_time);
    console.assert(0 < voltage_time);

    this.activation = activation;
    this.bias = bias;
    this.adaptation = adaptation;
    this.adaptation_time = adaptation_time;
    this.voltage_time = voltage_time;

    this.synapses = new connector.Connector(this);

    this.v = new torch.nn.Buffer(torch.zeros(1), { persistent: false });  // Voltage variable
    this.a = new torch.nn.Buffer(torch.zeros(1), { persistent: false });  // Adaptation variable
  }

  synapse(source: signal.Signal, kwargs: connector.ConnectKwargs = {}) {
    this.synapses.connect(source, kwargs);
    return this;
  }

  override init(cfg: config.SimulatorConfig) {
    this.dt = cfg.timestep;
  }

  override reset(reset: torch.Tensor | null = null) {
    this.synapses.reset(reset);
    _conditional_set(this.v, torch.zeros(1), reset);
    _conditional_set(this.a, torch.zeros(1), reset);
    _conditional_set(this.value, torch.zeros(1), reset);
  }

  override step() {
    const v = this.v;
    const a = this.a;
    const y = this.activation;

    const z = torch.clamp(this.synapses.integrate().add(this.bias), { min: -1, max: 1 });

    // Forward-Euler discretization (for reference).
    // dv = z - v + a
    // if this.adaptation > 0:
    //   # Positive adaptation -> facilitation.
    //   da = this.adaptation * y(v) * (1 - torch.clamp(z, 0, 1)) - a
    // else:
    //   # Negative adaptation -> depression.
    //   da = this.adaptation * torch.sign(y(v)) * torch.clamp(z, 0, 1) - a
    // this.v[:] = v + 4 * dv / this.voltage_time * this.dt
    // this.a[:] = a + 4 * da / this.adaptation_time * this.dt

    // Backward-Euler discretization.
    const kv = 4 / this.voltage_time * this.dt;
    this.v.set_(v.add(z.add(a).mul(kv)).div(1 + kv));
    let x: torch.Tensor;
    if (this.adaptation > 0) {
      // Positive adaptation -> facilitation.
      x = torch.mul(this.adaptation, y(this.v)).mul(torch.sub(1, torch.clamp(z, 0, 1)));
    } else {
      // Negative adaptation -> depression.
      x = torch.mul(this.adaptation, torch.sign(y(this.v))).mul(torch.clamp(z, 0, 1));
    }
    const ka = 4 / this.adaptation_time * this.dt;
    this.a.set_(a.add(x.mul(ka)).div(1 + ka));

    this.value.set_(y(this.v));
  }

  override populate() {
    this.synapses.populate();
  }
}

/** Interpolate linearly, such that z = 0 maps to `start` and z = 1 maps to `end`. */
export function interpolate_linear(start: number, end: number, z: number): number;
export function interpolate_linear(start: TensorOrFloat, end: TensorOrFloat, z: TensorOrFloat): torch.Tensor;
export function interpolate_linear(
  start: TensorOrFloat,
  end: TensorOrFloat,
  z: TensorOrFloat,
): TensorOrFloat {
  return torch.add(torch.mul(start, torch.sub(1, z)), torch.mul(end, z));
}

/** Interpolate logarithmically, such that z = 0 maps to `start` and z = 1 maps to `end`. */
export function interpolate_logarithmic(
  start: TensorOrFloat,
  end: TensorOrFloat,
  z: TensorOrFloat,
  { base = 2 }: { base?: number } = {},
): torch.Tensor {
  console.assert(base > 0 && base !== 1);
  const b = torch.as_tensor(base);
  return torch.add(
    start,
    torch.mul(torch.sub(end, start), torch.log(b.sub(1).mul(z).add(1))).div(torch.log(b)),
  );
}

/** Normalize linearly, such that z = `start` maps to 0 and z = `end` maps to 1. */
export function clip_normalized(
  start: TensorOrFloat,
  end: TensorOrFloat,
  z: TensorOrFloat,
): torch.Tensor {
  return torch.clip(torch.div(torch.sub(z, start), torch.sub(end, start)), 0, 1);
}

/** Keyword arguments supplied by `Oscillator.step` to its activation function. */
export interface OscillatorActivationBounds {
  active_bound: TensorOrFloat;
  quiet_bound: TensorOrFloat;
}

export type OscillatorActivation = (
  v: torch.Tensor,
  a: torch.Tensor,
  x: torch.Tensor,
  kwargs: OscillatorActivationBounds,
) => torch.Tensor;

export function rectangular(
  v: torch.Tensor,
  a: torch.Tensor,
  x: torch.Tensor,
  {
    active_bound,
    quiet_bound,
    active = 1.,
    quiet = 0.,
  }: OscillatorActivationBounds & { active?: TensorOrFloat, quiet?: TensorOrFloat },
): torch.Tensor {
  return v.ge(0).mul(active).add(v.lt(0).mul(quiet));
}

export function rectangular_amplitude_modulated(
  v: torch.Tensor,
  a: torch.Tensor,
  x: torch.Tensor,
  {
    active_bound,
    quiet_bound,
    active_start = 0.,
    active_end = 1.,
    quiet = 0.,
    base = 1.,
  }: OscillatorActivationBounds & {
    active_start?: TensorOrFloat, active_end?: TensorOrFloat, quiet?: TensorOrFloat, base?: number,
  },
): torch.Tensor {
  const pos = torch.clip(x, 0, 1);
  if (base === 1) {
    return v.ge(0).mul(interpolate_linear(active_start, active_end, pos)).add(v.lt(0).mul(quiet));
  } else {
    return v.ge(0).mul(interpolate_logarithmic(active_start, active_end, pos, { base: base }))
      .add(v.lt(0).mul(quiet));
  }
}

export function linear(
  v: torch.Tensor,
  a: torch.Tensor,
  x: torch.Tensor,
  {
    active_bound,
    quiet_bound,
    active_start = 1.0,
    active_end = 0.5,
    quiet = 0.,
  }: OscillatorActivationBounds & {
    active_start?: TensorOrFloat, active_end?: TensorOrFloat, quiet?: TensorOrFloat,
  },
): torch.Tensor {
  return (
    v.ge(0)
      .mul(interpolate_linear(active_end, active_start, clip_normalized(active_bound, quiet_bound, a)))
      .add(v.lt(0).mul(quiet))
  );
}

export function logarithmic(
  v: torch.Tensor,
  a: torch.Tensor,
  x: torch.Tensor,
  {
    active_bound,
    quiet_bound,
    active_start = 1.0,
    active_end = 0.5,
    quiet = 0.,
    base = 2.,
  }: OscillatorActivationBounds & {
    active_start?: TensorOrFloat, active_end?: TensorOrFloat, quiet?: TensorOrFloat, base?: number,
  },
): torch.Tensor {
  return v.ge(0).mul(interpolate_logarithmic(
    active_end, active_start, clip_normalized(active_bound, quiet_bound, a), { base: base },
  )).add(v.lt(0).mul(quiet));
}

export function adapting(
  v: torch.Tensor,
  a: torch.Tensor,
  x: torch.Tensor,
  {
    active_bound,
    quiet_bound,
    active_start = 1.0,
    active_end = 0.5,
    quiet = 0.,
  }: OscillatorActivationBounds & {
    active_start?: TensorOrFloat, active_end?: TensorOrFloat, quiet?: TensorOrFloat,
  },
): torch.Tensor {
  return v.ge(0).mul(interpolate_linear(active_end, active_start, a)).add(v.lt(0).mul(quiet));
}

export interface OscillatorKwargs {
  activation?: OscillatorActivation;
  bias?: TensorOrFloat;
  adaptation_time?: number;
  active_time?: number;
  quiet_time?: number;
  active_scale_pos?: number;
  quiet_scale_pos?: number;
  active_scale_neg?: number;
  quiet_scale_neg?: number;
  adaptation_scale_active_pos?: number;
  adaptation_scale_quiet_pos?: number;
  adaptation_scale_active_neg?: number;
  adaptation_scale_quiet_neg?: number;
  active_stable?: number;
  quiet_stable?: number;
  active_stable_margin?: number;
  quiet_stable_margin?: number;
  active_delay?: number;
  quiet_delay?: number;
  noise?: number;
  [key: string]: unknown;
}

/**
 * A bursting neruon with internal voltage and adaptation variables. The neuron switches its
 * voltage variable between active/quiet states based on the adaptation variable. Both excitatory
 * (positive) and inhibitory (negative) input scale the active/quiet durations, and possibly the
 * adaptation depletion/recovery timescale. Strong positive net input causes (stable) tonic firing,
 * while strong negative net input causes (stable) suppression.
 */
export class Oscillator extends Unit {
  activation: OscillatorActivation;
  bias: TensorOrFloat;
  adaptation_time: number;
  active_time: number;
  quiet_time: number;
  active_scale_pos: number;
  quiet_scale_pos: number;
  active_scale_neg: number;
  quiet_scale_neg: number;
  adaptation_scale_active_pos: number;
  adaptation_scale_quiet_pos: number;
  adaptation_scale_active_neg: number;
  adaptation_scale_quiet_neg: number;
  active_stable: number;
  quiet_stable: number;
  active_stable_margin: number;
  quiet_stable_margin: number;
  active_delay: number;
  quiet_delay: number;
  noise: number;
  active_bound_zero: number;
  quiet_bound_zero: number;
  active_bound_pos: number;
  quiet_bound_pos: number;
  active_bound_neg: number;
  quiet_bound_neg: number;
  synapses: connector.Connector;
  v: torch.nn.Buffer;
  a: torch.nn.Buffer;
  x: torch.nn.Buffer;
  dt!: number;  // Timestep

  /**
   * Args:
   *   activation: Activation function.
   *   bias: Bias voltage between -1 and +1.
   *   adaptation_time: Time constant of the adaptation variable (in milliseconds).
   *   active_time: Duration of the active state (in milliseconds).
   *   quiet_time: Duration of the quiet state (in milliseconds).
   *   active_scale_[pos/neg]: Scaling factor of the active state as input goes to [+1/-1].
   *   quiet_scale_[pos/neg]: Scaling factor of the quiet state as input goes to [+1/-1].
   *   adaptation_scale_[active/quiet]_[pos/neg]: Scaling factor of the adaptation time constant.
   *   active_stable: Input strength above which the active state is stable (tonic firing).
   *   quiet_stable: Input strength below which the quiet state is stable (suppressed).
   *   active_stable_margin: Time margin for active stable point clipping (in milliseconds).
   *   quiet_stable_margin: Time margin for quiet stable point clipping (in milliseconds).
   *   active_delay: Fraction of the active phase time appropriated for the delay.
   *   quiet_delay: Fraction of the quiet phase time appropriated for the delay.
   *   noise: Standard deviation of the multiplicative noise on dynamics (mean 1).
   */
  constructor({
    activation = adapting,
    bias = 0,
    adaptation_time = 2000,
    active_time = 500,
    quiet_time = 1000,
    active_scale_pos = 0.5,
    quiet_scale_pos = 0.1,
    active_scale_neg = 0.7,
    quiet_scale_neg = 1.3,
    adaptation_scale_active_pos = 1.,
    adaptation_scale_quiet_pos = 1.,
    adaptation_scale_active_neg = 1.,
    adaptation_scale_quiet_neg = 1.,
    active_stable = 1.,
    quiet_stable = 0.,
    active_stable_margin = 0.,
    quiet_stable_margin = 0.,
    active_delay = 0.,
    quiet_delay = 0.,
    noise = 0.,
    ...kwargs
  }: OscillatorKwargs = {}) {
    super(kwargs);
    console.assert(0 < adaptation_time);
    console.assert(0 < active_time);
    console.assert(0 < quiet_time);
    console.assert(0 < active_scale_pos);
    console.assert(0 < quiet_scale_pos);
    console.assert(0 < active_scale_neg);
    console.assert(0 < quiet_scale_neg);
    console.assert(0 < adaptation_scale_active_pos);
    console.assert(0 < adaptation_scale_quiet_pos);
    console.assert(0 < adaptation_scale_active_neg);
    console.assert(0 < adaptation_scale_quiet_neg);
    console.assert(quiet_stable <= 0 && 0 <= active_stable);
    console.assert(0 <= active_stable_margin);
    console.assert(0 <= quiet_stable_margin);
    console.assert(0 <= active_delay && active_delay < 1);
    console.assert(0 <= quiet_delay && quiet_delay < 1);
    console.assert(0 <= noise);

    this.activation = activation;
    this.bias = bias;
    this.adaptation_time = adaptation_time;
    this.active_time = active_time;
    this.quiet_time = quiet_time;
    this.active_scale_pos = active_scale_pos;
    this.quiet_scale_pos = quiet_scale_pos;
    this.active_scale_neg = active_scale_neg;
    this.quiet_scale_neg = quiet_scale_neg;
    this.adaptation_scale_active_pos = adaptation_scale_active_pos;
    this.adaptation_scale_quiet_pos = adaptation_scale_quiet_pos;
    this.adaptation_scale_active_neg = adaptation_scale_active_neg;
    this.adaptation_scale_quiet_neg = adaptation_scale_quiet_neg;
    this.active_stable = active_stable;
    this.quiet_stable = quiet_stable;
    this.active_stable_margin = active_stable_margin;
    this.quiet_stable_margin = quiet_stable_margin;
    this.active_delay = active_delay;
    this.quiet_delay = quiet_delay;
    this.noise = noise;

    const Ta = 4 * active_time / adaptation_time;
    const Tq = 4 * quiet_time / adaptation_time;
    const Ta_pos = Ta * active_scale_pos / adaptation_scale_active_pos;
    const Tq_pos = Tq * quiet_scale_pos / adaptation_scale_quiet_pos;
    const Ta_neg = Ta * active_scale_neg / adaptation_scale_active_neg;
    const Tq_neg = Tq * quiet_scale_neg / adaptation_scale_quiet_neg;
    this.active_bound_zero = (1 - Math.exp(Tq)) / (1 - Math.exp(Ta + Tq));
    this.quiet_bound_zero = this.active_bound_zero * Math.exp(Ta);
    this.active_bound_pos = (1 - Math.exp(Tq_pos)) / (1 - Math.exp(Ta_pos + Tq_pos));
    this.quiet_bound_pos = this.active_bound_pos * Math.exp(Ta_pos);
    this.active_bound_neg = (1 - Math.exp(Tq_neg)) / (1 - Math.exp(Ta_neg + Tq_neg));
    this.quiet_bound_neg = this.active_bound_neg * Math.exp(Ta_neg);

    this.synapses = new connector.Connector(this);

    this.v = new torch.nn.Buffer(torch.zeros(1), { persistent: false });  // Voltage variable
    this.a = new torch.nn.Buffer(torch.zeros(1), { persistent: false });  // Adaptation variable
    this.x = new torch.nn.Buffer(torch.zeros(1), { persistent: false });  // Input variable
  }

  synapse(source: signal.Signal, kwargs: connector.ConnectKwargs = {}) {
    this.synapses.connect(source, kwargs);
    return this;
  }

  override init(cfg: config.SimulatorConfig) {
    this.dt = cfg.timestep;
  }

  override reset(reset: torch.Tensor | null = null) {
    this.synapses.reset(reset);
    _conditional_set(this.v, torch.ones(1).neg(), reset);
    _conditional_set(this.a, torch.ones(1).mul(this.active_bound_zero), reset);
    _conditional_set(this.x, torch.zeros(1), reset);
    _conditional_set(this.value, torch.zeros(1), reset);
  }

  override step() {
    let v: torch.Tensor = this.v;
    let a: torch.Tensor = this.a;
    const y = this.activation;
    const dt = this.dt;

    let x = this.synapses.integrate();
    x = x.add(this.bias);
    const pos = torch.clamp(x, { min: 0, max: 1 });  // Interpolation amounts.
    const neg = torch.clamp(x.neg(), { min: 0, max: 1 });
    const pos_mask = x.ge(0);  // Element-wise masks.
    const neg_mask = x.lt(0);

    // Interpolate adaptation time constant.
    const k = 4 / this.adaptation_time;
    const k_active = torch.div(k,
      interpolate_linear(1, this.adaptation_scale_active_pos, pos).mul(pos_mask).add(
        interpolate_linear(1, this.adaptation_scale_active_neg, neg).mul(neg_mask))
    );
    const k_quiet = torch.div(k,
      interpolate_linear(1, this.adaptation_scale_quiet_pos, pos).mul(pos_mask).add(
        interpolate_linear(1, this.adaptation_scale_quiet_neg, neg).mul(neg_mask))
    );

    // Interpolate active/quiet bounds used for state switching.
    const active_bound = (
      interpolate_linear(this.active_bound_zero, this.active_bound_pos, pos).mul(pos_mask).add(
        interpolate_linear(this.active_bound_zero, this.active_bound_neg, neg).mul(neg_mask))
    );
    const quiet_bound = (
      interpolate_linear(this.quiet_bound_zero, this.quiet_bound_pos, pos).mul(pos_mask).add(
        interpolate_linear(this.quiet_bound_zero, this.quiet_bound_neg, neg).mul(neg_mask))
    );

    // Calculate multiplicative noise (mean 1, std `this.noise`), always positive.
    const noise = torch.clamp(torch.add(1, torch.mul(this.noise, torch.randn_like(v))), { min: 0 });

    // Adaptation constraints: Clip to bounds ...
    //   (1) before integration, if within stable point time margin --> moves to new stable point
    const active_bound_with_margin = active_bound.mul(torch.exp(torch.mul(-this.active_stable_margin, k_active)));
    const quiet_bound_with_margin = torch.add(1,
      quiet_bound.sub(1).mul(torch.exp(torch.mul(-this.quiet_stable_margin, k_quiet))));
    const update_active_stable = v.gt(0).and(active_bound_with_margin.le(a)).and(a.le(active_bound));
    const update_quiet_stable = v.lt(0).and(quiet_bound.le(a)).and(a.le(quiet_bound_with_margin));
    let clip = update_active_stable.or(update_quiet_stable);
    a = clip.not().mul(a).add(clip.mul(torch.clip(a, active_bound, quiet_bound)));

    // Adaptation derivative: Moves when within bounds.
    //
    // Forward-Euler discretization (for reference):
    // da = (
    //   if [inside active bound], [decrease a] [at adaptation timescale] [rescaled for delay]
    //   if [inside quiet bound], [increase a] [at adaptation timescale] [rescaled for delay]
    // ) * [speed-up/slow-down with noise]
    // da = (
    //   (v > 0) * (a > active_bound) * (0 - a) * k_active / (1 - this.active_delay) +
    //   (v < 0) * (a < quiet_bound) * (1 - a) * k_quiet  / (1 - this.quiet_delay)
    // ) * noise
    // a_new = a + da * dt
    // a_new = torch.clamp(a_new, min=0, max=1)
    //
    // Backward-Euler discretization:
    // Need to explicity list all cases unlike `da` above which uses zero when no conditions match.
    const t_active = k_active.div(1 - this.active_delay).mul(noise).mul(dt);
    const t_quiet = k_quiet.div(1 - this.quiet_delay).mul(noise).mul(dt);
    let inside_active_bound = v.gt(0).and(a.gt(active_bound));
    let inside_quiet_bound = v.lt(0).and(a.lt(quiet_bound));
    const otherwise = inside_active_bound.or(inside_quiet_bound).not();
    let a_new = (
      inside_active_bound.mul(a).div(torch.add(1, t_active)).add(
      inside_quiet_bound.mul(a.add(t_quiet)).div(torch.add(1, t_quiet))).add(
      otherwise.mul(a))
    );
    a_new = torch.clip(a_new, 0, 1);

    // Adaptation constraints: Clip to bounds ...
    //   (2) after integration, if just passed the bound on this timestep --> prevents overshoot
    // Clipping ensures the stable point is exactly at the bound elbow and any overshoot should
    // begin a state switch (e.g. for post-inhibitory rebound).
    const passed_active_bound = v.gt(0).and(a_new.le(active_bound)).and(a.ge(active_bound));
    const passed_quiet_bound = v.lt(0).and(a_new.ge(quiet_bound)).and(a.le(quiet_bound));
    clip = passed_active_bound.or(passed_quiet_bound);
    a_new = clip.not().mul(a_new).add(clip.mul(torch.clip(a_new, active_bound, quiet_bound)));
    a = a_new;  // Update for use in voltage derivative.

    // Voltage derivative: Moves to elbow when inside bounds, then moves either towards zero for
    // state switch or towards elbow if input strong enough for a stable point (tonic or suppressed).
    // The rate is inversely proportional to the delay time (phase time * delay fraction).
    // The direction is outwards (to +1 or -1) for a stable point, or inwards (to 0) otherwise.
    const active_delay = (
      torch.mul(this.active_delay, torch.log(quiet_bound).sub(torch.log(active_bound))).div(k_active)
    );
    const quiet_delay = (
      torch.mul(this.quiet_delay, torch.log(torch.sub(1, active_bound)).sub(torch.log(torch.sub(1, quiet_bound)))).div(k_quiet)
    );
    const active_rate = torch.div(1, torch.clamp(active_delay, { min: 1 }));  // Avoid division by zero.
    const quiet_rate = torch.div(1, torch.clamp(quiet_delay, { min: 1 }));
    inside_active_bound = v.gt(0).and(a.gt(active_bound));
    inside_quiet_bound = v.lt(0).and(a.lt(quiet_bound));
    const toward_active_stable = v.gt(0).and(a.eq(active_bound)).and(x.gt(this.active_stable));
    const toward_quiet_stable = v.lt(0).and(a.eq(quiet_bound)).and(x.lt(this.quiet_stable));
    const active_direction = torch.sign(torch.mul(+1, inside_active_bound.or(toward_active_stable)).sub(v));
    const quiet_direction = torch.sign(torch.mul(-1, inside_quiet_bound.or(toward_quiet_stable)).sub(v));
    // Forward-Euler discretization = Backward-Euler discretization for constant derivative:
    const dv = (
      v.gt(0).mul(active_rate).mul(active_direction).add(
      v.lt(0).mul(quiet_rate).mul(quiet_direction))
    ).mul(noise);
    // Clamp overshoots from large rates (resulting from small/zero delay fractions).
    let v_new = torch.clamp(v.add(dv.mul(dt)), { min: -1, max: +1 });

    // Voltage constraints: Flip if adaptation at/passed bounds and voltage at/passed threshold.
    const flip_to_quiet = a_new.le(active_bound).and(v_new.le(0));
    const flip_to_active = a_new.ge(quiet_bound).and(v_new.ge(0));
    v_new = flip_to_quiet.not().mul(v_new).add(flip_to_quiet.mul(-1));
    v_new = flip_to_active.not().mul(v_new).add(flip_to_active.mul(+1));
    v = v_new;  // Update after constraint.

    this.v.set_(v);
    this.a.set_(a);
    this.x.set_(x);
    this.value.set_(y(
      v,
      a,
      x,
      {
        active_bound: this.active_bound_pos,
        quiet_bound: this.quiet_bound_zero,
      },
    ));
  }

  override populate() {
    this.synapses.populate();
  }
}
