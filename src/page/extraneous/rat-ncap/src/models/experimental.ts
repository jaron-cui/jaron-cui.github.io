/**
 * Port of `projects/rodent/models/experimental.py`.
 *
 * Ported so far: `RhythmGenerationCircuit2`. Not ported: `BufferDict`,
 * `RhythmGenerationCircuitResidual`.
 */
import * as torch from '../torch';
import * as cc from '../circuits';
import * as utt from '../utils/torch';
import * as collections from '../utils/collections';
import * as models from './ncap';

export interface RhythmGenerationCircuit2Kwargs {
  // NOTE: Python defaults to `models.init_rg_mouse`, which is not ported.
  init: models.RhythmGenerationCircuitInitializer;
  ext_oscillator?: boolean;
  flx_delays?: number[];
  [key: string]: unknown;
}

/**
 * The Rhythm Generation (RG) circuit module coordinates gait between limbs. It is implemented
 * using the `circuits` library by connecting Oscillator and Basic units according to genetically
 * defined neural circuit models (Danner et al. 2019). The limbs are denoted "FL" (front left), "FR"
 * (front right), "HL" (hind left), and "HR" (hind right).
 */
export class RhythmGenerationCircuit2 extends cc.Group {
  declare params: utt.containers.ParameterManager;
  declare delay_units: string[];
  declare flx_FL: cc.Oscillator;
  declare flx_FR: cc.Oscillator;
  declare flx_HL: cc.Oscillator;
  declare flx_HR: cc.Oscillator;
  declare ext_FL: cc.Oscillator | cc.Basic;
  declare ext_FR: cc.Oscillator | cc.Basic;
  declare ext_HL: cc.Oscillator | cc.Basic;
  declare ext_HR: cc.Oscillator | cc.Basic;
  declare freq_L: cc.Signal;
  declare sync_L: cc.Signal;
  declare freq_R: cc.Signal;
  declare sync_R: cc.Signal;

  constructor({
    init,
    ext_oscillator = true,
    flx_delays = [0.07, 0.02, 0.07, 0.02],
    ...kwargs
  }: RhythmGenerationCircuit2Kwargs) {
    super(kwargs);
    // ----------------------------------------------------------------------------------------------
    // Parameters

    const p = this.params = new utt.containers.ParameterManager();
    p.config('zero', ['*'], 0., false);  // Parameters default to 0, unless initialized otherwise.
    const [flx_kwargs, ext_kwargs, basic_kwargs] = init(p);

    // ----------------------------------------------------------------------------------------------
    // Circuit units

    // Oscillator units.
    const XF = -20;
    const XH = -70;
    const XFLX = 0;
    const YFLX = 21;
    const XEXT = 0;
    const YEXT = 24;
    // FL
    this.flx_FL = new cc.Oscillator({
      bias: p.get('bias_flx_FL'),
      ...{
        ...flx_kwargs, 'quiet_delay': flx_delays[0],
      },
      xy: [XF - XFLX, +YFLX],
      anchor: 'y+',
    });
    if (ext_oscillator) {
      this.ext_FL = new cc.Oscillator({ bias: p.get('bias_ext_FL'), ...ext_kwargs, xy: [XF - XEXT, +YEXT] });
    } else {
      this.ext_FL = new cc.Basic({ bias: p.get('bias_ext_FL'), ...ext_kwargs, xy: [XF - XEXT, +YEXT] });
    }
    // FR
    this.flx_FR = new cc.Oscillator({
      bias: p.get('bias_flx_FR'),
      ...{
        ...flx_kwargs, 'quiet_delay': flx_delays[1],
      },
      xy: [XF - XFLX, -YFLX],
      anchor: 'y+',
    });
    if (ext_oscillator) {
      this.ext_FR = new cc.Oscillator({ bias: p.get('bias_ext_FR'), ...ext_kwargs, xy: [XF - XEXT, -YEXT] });
    } else {
      this.ext_FR = new cc.Basic({ bias: p.get('bias_ext_FR'), ...ext_kwargs, xy: [XF - XEXT, -YEXT] });
    }
    // HL
    this.flx_HL = new cc.Oscillator({
      bias: p.get('bias_flx_HL'),
      ...{
        ...flx_kwargs, 'quiet_delay': flx_delays[2],
      },
      xy: [XH - XFLX, +YFLX],
      anchor: 'y+',
    });
    if (ext_oscillator) {
      this.ext_HL = new cc.Oscillator({ bias: p.get('bias_ext_HL'), ...ext_kwargs, xy: [XH - XEXT, +YEXT] });
    } else {
      this.ext_HL = new cc.Basic({ bias: p.get('bias_ext_HL'), ...ext_kwargs, xy: [XH - XEXT, +YEXT] });
    }
    // HR
    this.flx_HR = new cc.Oscillator({
      bias: p.get('bias_flx_HR'),
      ...{
        ...flx_kwargs, 'quiet_delay': flx_delays[3],
      },
      xy: [XH - XFLX, -YFLX],
      anchor: 'y+',
    });
    if (ext_oscillator) {
      this.ext_HR = new cc.Oscillator({ bias: p.get('bias_ext_HR'), ...ext_kwargs, xy: [XH - XEXT, -YEXT] });
    } else {
      this.ext_HR = new cc.Basic({ bias: p.get('bias_ext_HR'), ...ext_kwargs, xy: [XH - XEXT, -YEXT] });
    }

    this.delay_units = [];
    for (const leg of ['FL', 'FR', 'HL', 'HR']) {
      let name = `flx2_${leg}`;
      this[name] = new cc.Basic().synapse(
        this[`flx_${leg}`] as cc.Signal,
        {
          weight: 1.0,
          delay: 2,
        },
      );
      this.delay_units.push(name);
      name = `ext2_${leg}`;
      this[name] = new cc.Basic({ bias: -0.3, activation: (x) => torch.clamp(x, { min: 0, max: 1 }), voltage_time: 80 }).synapse(
        this[`ext_${leg}`] as cc.Signal,
        {
          weight: 1.0,
          // delay: 2,
        },
      ).synapse(this[`flx_${leg}`] as cc.Signal, { weight: -1.0 });
      this.delay_units.push(name);
    }

    // Interneuron units.
    const XC_V0D = XFLX;
    const XC_V3F = XFLX - 5;
    const XC_V3E = XEXT - 5;
    const YC_V0D = YFLX - 13;
    const YC_V3F = YFLX - 11;
    const YC_V3E = YEXT + 4;
    const XD_V0D = 12;
    const XD_V0V = 12;
    const XD_IN2 = 6;
    const YD_V0D = 7;
    const YD_V0V = 11;
    const YD_IN2 = 5;
    const XA_V3A = -12;
    const YA_V3A = 11;
    // FL
    this.cross_v0d_FL = new cc.Basic({
      bias: p.get('bias_v0d_FL'), ...basic_kwargs, xy: [XF - XC_V0D, +YC_V0D], flow: 'x-', anchor: 'y+',
    });
    this.cross_v3f_FL = new cc.Basic({
      bias: p.get('bias_v3f_FL'), ...basic_kwargs, xy: [XF - XC_V3F, +YC_V3F], flow: 'x-', anchor: 'y+',
    });
    this.cross_v3e_FL = new cc.Basic({
      bias: p.get('bias_v3e_FL'), ...basic_kwargs, xy: [XF - XC_V3E, +YC_V3E], flow: 'x-',
    });
    this.diagd_v0d_FL = new cc.Basic({
      bias: p.get('bias_v0d_FL'), ...basic_kwargs, xy: [XF - XD_V0D, +YD_V0D], anchor: 'y+',
    });
    this.diagd_v0v_FL = new cc.Basic({
      bias: p.get('bias_v0v_FL'), ...basic_kwargs, xy: [XF - XD_V0V, +YD_V0V], anchor: 'y+',
    });
    this.diagd_in2_FL = new cc.Basic({
      bias: p.get('bias_in2_FL'), ...basic_kwargs, xy: [XF - XD_IN2, +YD_IN2], anchor: 'y+',
    });
    // FR
    this.cross_v0d_FR = new cc.Basic({
      bias: p.get('bias_v0d_FR'), ...basic_kwargs, xy: [XF - XC_V0D, -YC_V0D], flow: 'x-', anchor: 'y+',
    });
    this.cross_v3f_FR = new cc.Basic({
      bias: p.get('bias_v3f_FR'), ...basic_kwargs, xy: [XF - XC_V3F, -YC_V3F], flow: 'x-', anchor: 'y+',
    });
    this.cross_v3e_FR = new cc.Basic({
      bias: p.get('bias_v3e_FR'), ...basic_kwargs, xy: [XF - XC_V3E, -YC_V3E], flow: 'x-',
    });
    this.diagd_v0d_FR = new cc.Basic({
      bias: p.get('bias_v0d_FR'), ...basic_kwargs, xy: [XF - XD_V0D, -YD_V0D], anchor: 'y+',
    });
    this.diagd_v0v_FR = new cc.Basic({
      bias: p.get('bias_v0v_FR'), ...basic_kwargs, xy: [XF - XD_V0V, -YD_V0V], anchor: 'y+',
    });
    this.diagd_in2_FR = new cc.Basic({
      bias: p.get('bias_in2_FR'), ...basic_kwargs, xy: [XF - XD_IN2, -YD_IN2], anchor: 'y+',
    });
    // HL
    this.cross_v0d_HL = new cc.Basic({
      bias: p.get('bias_v0d_HL'), ...basic_kwargs, xy: [XH - XC_V0D, +YC_V0D], flow: 'x-', anchor: 'y+',
    });
    this.cross_v3f_HL = new cc.Basic({
      bias: p.get('bias_v3f_HL'), ...basic_kwargs, xy: [XH - XC_V3F, +YC_V3F], flow: 'x-', anchor: 'y+',
    });
    this.cross_v3e_HL = new cc.Basic({
      bias: p.get('bias_v3e_HL'), ...basic_kwargs, xy: [XH - XC_V3E, +YC_V3E], flow: 'x-',
    });
    this.diaga_v3a_HL = new cc.Basic({
      bias: p.get('bias_v3a_HL'), ...basic_kwargs, xy: [XH - XA_V3A, +YA_V3A], flow: 'x-', anchor: 'y+',
    });
    // HR
    this.cross_v0d_HR = new cc.Basic({
      bias: p.get('bias_v0d_HR'), ...basic_kwargs, xy: [XH - XC_V0D, -YC_V0D], flow: 'x-', anchor: 'y+',
    });
    this.cross_v3f_HR = new cc.Basic({
      bias: p.get('bias_v3f_HR'), ...basic_kwargs, xy: [XH - XC_V3F, -YC_V3F], flow: 'x-', anchor: 'y+',
    });
    this.cross_v3e_HR = new cc.Basic({
      bias: p.get('bias_v3e_HR'), ...basic_kwargs, xy: [XH - XC_V3E, -YC_V3E], flow: 'x-',
    });
    this.diaga_v3a_HR = new cc.Basic({
      bias: p.get('bias_v3a_HR'), ...basic_kwargs, xy: [XH - XA_V3A, -YA_V3A], flow: 'x-', anchor: 'y+',
    });

    // Afferent units.
    const XAF_FLX = XFLX - 5;
    const YAF_FLX = YFLX - 6;
    const YAF_FLXH = YFLX - 8;
    const XAF_EXT = XEXT - 5;
    const YAF_EXT = YEXT + 2;
    // FL
    this.aff_flx_FL = new cc.Signal({ xy: [XF - XAF_FLX, +YAF_FLX], anchor: 'y+' });
    this.aff_ext_FL = new cc.Signal({ xy: [XF - XAF_EXT, +YAF_EXT] });
    // FR
    this.aff_flx_FR = new cc.Signal({ xy: [XF - XAF_FLX, -YAF_FLX], anchor: 'y+' });
    this.aff_ext_FR = new cc.Signal({ xy: [XF - XAF_EXT, -YAF_EXT] });
    // HL
    this.aff_flx_HL = new cc.Signal({ xy: [XH - XAF_FLX, +YAF_FLXH], anchor: 'y+' });
    this.aff_ext_HL = new cc.Signal({ xy: [XH - XAF_EXT, +YAF_EXT] });
    // HR
    this.aff_flx_HR = new cc.Signal({ xy: [XH - XAF_FLX, -YAF_FLXH], anchor: 'y+' });
    this.aff_ext_HR = new cc.Signal({ xy: [XH - XAF_EXT, -YAF_EXT] });

    // Command units.
    const XCMD = -1;
    const YFREQ = 3;
    const YSYNC = 1;
    // R
    this.freq_R = new cc.Signal({ xy: [XCMD, -YFREQ], anchor: 'y+' });
    this.sync_R = new cc.Signal({ xy: [XCMD, -YSYNC] });
    // L
    this.freq_L = new cc.Signal({ xy: [XCMD, +YFREQ], anchor: 'y+' });
    this.sync_L = new cc.Signal({ xy: [XCMD, +YSYNC] });

    // ----------------------------------------------------------------------------------------------
    // Circuit connections

    // Alias self to ensure that named access of circuit units typechecks correctly.
    const u = this as unknown as Record<string, cc.Basic | cc.Oscillator>;

    // Oscillator connections (osc).
    for (const a of ['FL', 'FR', 'HL', 'HR']) {
      u[`flx_${a}`].synapse(u[`ext_${a}`], { weight: p.get(`osc_extflx_i_${a}`), sign: '-' });
      u[`ext_${a}`].synapse(u[`flx_${a}`], { weight: p.get(`osc_flxext_i_${a}`), sign: '-' });
    }

    // Cross-side connections (cross).
    for (const [a, b] of [['FR', 'FL'], ['FL', 'FR'], ['HR', 'HL'], ['HL', 'HR']]) {
      u[`cross_v3f_${a}`].synapse(u[`flx_${a}`], { weight: 1, sign: '+' });
      u[`cross_v0d_${a}`].synapse(u[`flx_${a}`], { weight: 1, sign: '+' });
      u[`cross_v3e_${a}`].synapse(u[`ext_${a}`], { weight: 1, sign: '+' });
      u[`flx_${b}`].synapse(u[`cross_v0d_${a}`], { weight: p.get(`cross_flxflx_i_${b}`), sign: '-' });
      u[`flx_${b}`].synapse(
        u[`cross_v3e_${a}`], { weight: p.get(`cross_extflx_i_${b}`), sign: '-', waypoints: [[-8, +4, 'y-']] },
      );
      u[`flx_${b}`].synapse(u[`cross_v3f_${a}`], { weight: p.get(`cross_flxflx_e_${b}`), sign: '+' });
      u[`ext_${b}`].synapse(
        u[`cross_v3e_${a}`], { weight: p.get(`cross_extext_e_${b}`), sign: '+', waypoints: [[-8, -1, 'y-']] },
      );
    }

    // Same-side, descending connections (sided).
    for (const [a, b] of [['FL', 'HL'], ['FR', 'HR']]) {
      u[`flx_${b}`].synapse(
        u[`ext_${a}`], { weight: p.get(`sided_extflx_e_${b}`), sign: '+', waypoints: [[-10, -2, 'y-']] },
      );
      u[`flx_${b}`].synapse(
        u[`flx_${a}`], { weight: p.get(`sided_flxflx_i_${b}`), sign: '-', waypoints: [[-11, +2, 'y+']] },
      );
    }

    // Same-side, ascending connections (sidea).
    for (const [a, b] of [['HL', 'FL'], ['HR', 'FR']]) {
      u[`flx_${b}`].synapse(
        u[`ext_${a}`], { weight: p.get(`sidea_extflx_e_${b}`), sign: '+', waypoints: [[-3, -7, 'y-']] },
      );
    }

    // Diagonal, descending connections (diagd).
    for (const [a, b] of [['FL', 'HR'], ['FR', 'HL']]) {
      u[`diagd_v0d_${a}`].synapse(u[`flx_${a}`], { weight: 1, sign: '+' });
      u[`diagd_v0v_${a}`].synapse(u[`flx_${a}`], { weight: 1, sign: '+' });
      u[`flx_${b}`].synapse(
        u[`diagd_v0d_${a}`],
        {
          weight: p.get(`diagd_flxflx_i_${b}`),
          sign: '-',
          waypoints: [[-35, +12, 'y-']],
        },
      );
      u[`flx_${b}`].synapse(
        u[`diagd_v0v_${a}`],
        {
          weight: p.get(`diagd_flxflx_e_${b}`),
          sign: '+',
          waypoints: [[-34, +12, 'y-']],
        },
      );
      u[`diagd_in2_${a}`].synapse(u[`cross_v3f_${a}`], { weight: 1, sign: '+' });
      u[`diagd_v0d_${a}`].synapse(u[`diagd_in2_${a}`], { weight: p.get(`diagd_in2v0d_i_${a}`), sign: '-' });
    }

    // Diagonal, ascending connections (diaga).
    for (const [a, b] of [['HL', 'FR'], ['HR', 'FL']]) {
      u[`diaga_v3a_${a}`].synapse(u[`flx_${a}`], { weight: 1, sign: '+' });
      u[`flx_${b}`].synapse(
        u[`diaga_v3a_${a}`],
        {
          weight: p.get(`diaga_flxflx_e_${b}`),
          sign: '+',
          waypoints: [[32, 8.5, 'x-'], [-3, 7, 'y-']],
        },
      );
      u[`diagd_in2_${b}`].synapse(
        u[`diaga_v3a_${a}`],
        {
          weight: p.get(`diaga_v3ain2_e_${b}`),
          sign: '+',
          waypoints: [[26, -7.5, 'x-']],
        },
      );
    }

    // Afferent connections (aff).
    for (const a of ['FL', 'FR', 'HL', 'HR']) {
      u[`flx_${a}`].synapse(u[`aff_flx_${a}`], { weight: p.get(`aff_flx_${a}`) });
      u[`ext_${a}`].synapse(u[`aff_ext_${a}`], { weight: p.get(`aff_ext_${a}`) });
    }

    // Command connections (freq, sync).
    for (const a of ['L', 'R']) {
      u[`flx_F${a}`].synapse(
        u[`freq_${a}`], { weight: p.get(`freq_flx_e_F${a}`), sign: '+', waypoints: [[-10, 12, 'y-']] },
      );
      u[`flx_H${a}`].synapse(
        u[`freq_${a}`], { weight: p.get(`freq_flx_e_H${a}`), sign: '+', waypoints: [[-10, 12, 'y-']] },
      );
      u[`ext_F${a}`].synapse(
        u[`freq_${a}`], { weight: p.get(`freq_ext_e_F${a}`), sign: '+', waypoints: [[-10, -15, 'y-']] },
      );
      u[`ext_H${a}`].synapse(
        u[`freq_${a}`], { weight: p.get(`freq_ext_e_H${a}`), sign: '+', waypoints: [[-9, -15, 'y-']] },
      );
      u[`cross_v3f_F${a}`].synapse(u[`freq_${a}`], { weight: p.get(`freq_cross_e_${a}`), sign: '+' });
      u[`cross_v3f_H${a}`].synapse(u[`freq_${a}`], { weight: p.get(`freq_cross_e_${a}`), sign: '+' });
      u[`diaga_v3a_H${a}`].synapse(
        u[`freq_${a}`], { weight: p.get(`freq_diaga_e_${a}`), sign: '+', waypoints: [[-2, 3, 'y-']] },
      );
      u[`cross_v0d_F${a}`].synapse(u[`sync_${a}`], { weight: p.get(`sync_cross_i_${a}`), sign: '-' });
      u[`cross_v0d_H${a}`].synapse(u[`sync_${a}`], { weight: p.get(`sync_cross_i_${a}`), sign: '-' });
      u[`diagd_v0d_F${a}`].synapse(
        u[`sync_${a}`], { weight: p.get(`sync_diagdi_i_${a}`), sign: '-', waypoints: [[-2, 3.5, 'y-']] },
      );
      u[`diagd_v0v_F${a}`].synapse(
        u[`sync_${a}`], { weight: p.get(`sync_diagde_i_${a}`), sign: '-', waypoints: [[-2, 3, 'y-']] },
      );
    }
  }

  override reset(reset: torch.Tensor | null = null) {
    // Initialize flexor units with staggered adaptation variale to prevent settling period.
    _conditional_set(this.flx_FL.a, torch.tensor(0.7).mul(this.flx_FL.quiet_bound_zero), reset);
    _conditional_set(this.flx_FR.a, torch.tensor(0.9).mul(this.flx_FR.quiet_bound_zero), reset);
    _conditional_set(this.flx_HL.a, torch.tensor(0.8).mul(this.flx_HL.quiet_bound_zero), reset);
    _conditional_set(this.flx_HR.a, torch.tensor(1.0).mul(this.flx_HR.quiet_bound_zero), reset);
  }

  get_output_units(): string[] {
    return (['FL', 'FR', 'HL', 'HR'] as const).flatMap(limb => [
      `flx_${limb}`,
      ...this.delay_units.filter(d => d.startsWith('flx') && d.endsWith(limb)),
      `ext_${limb}`,
      ...this.delay_units.filter(d => d.startsWith('ext') && d.endsWith(limb)),
    ]);
  }

  get_output(): collections.Dict<torch.Tensor> {
    return new collections.Dict((['FL', 'FR', 'HL', 'HR'] as const).map(limb => [
      limb,
      torch.concat(
        [
          (this[`flx_${limb}`] as cc.Signal).value,
          ...this.delay_units
            .filter(d => d.startsWith('flx') && d.endsWith(limb))
            .map(d => (this[d] as cc.Signal).value),
          (this[`ext_${limb}`] as cc.Signal).value,
          ...this.delay_units
            .filter(d => d.startsWith('ext') && d.endsWith(limb))
            .map(d => (this[d] as cc.Signal).value),
        ],
        -1,
      ),
    ]));
  }
}

/** Sets `field` to `value` where `condition` is true, otherwise leaves it unchanged. */
function _conditional_set(field: torch.Tensor, value: torch.Tensor, condition: torch.Tensor | null = null) {
  field.set_(condition === null ? value : condition.mul(value).add(condition.not().mul(field)));
}
