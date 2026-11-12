/**
 * Port of `libs/utils/torch/block.py`.
 *
 * Not ported (training-only; weights and constraints come from the checkpoint instead):
 * `block_initializer`, `_initialize_block_parameters`, `resolve_indices`, `broadcast_indices`,
 * `match_globstrings`, and `BlockLinear.resolve_key`/`__getitem__`/`__setitem__`.
 */
import * as torch from '../../torch';
import * as gymnasium from '../../gymnasium';
import * as builtins from '../builtins';
import * as collections from '../collections';
import * as cxg from '../../composer/utils/gym';

const { bool, str, zip } = builtins;

// ==================================================================================================
// Types

export type WeightId = string;
export type BiasId = string;
export type DimLabels = ReadonlySet<string>[];  // All string aliases per index along a dimension.

export type WeightTransform = 'negate';
export interface WeightTransformSpec {
  prefix: string;
  suffix: string;
  apply: (x: torch.Tensor) => torch.Tensor;
}

export const WEIGHT_TRANSFORMS: ReadonlyMap<WeightTransform, WeightTransformSpec> = new Map([
  ['negate', {
    prefix: '-',
    suffix: '',
    apply: (x: torch.Tensor) => x.neg(),
  }],
]);

export const WEIGHT_ID_RESERVED_CHARACTERS = new Set('()-');

type Id = WeightId | 0 | null;
type ResolvedId = WeightId | 0;
type Shape = number[];
type Labels = (string[] | null)[];

// ==================================================================================================
// Shared weight modules

/**
 * A set of parallel element-wise scalings that operate on entries of a mapping. Like
 * `ParallelLinear`, but each block's weight is a 1D scale vector applied element-wise rather than a
 * 2D weight matrix applied via matrix multiplication; the corresponding input and output boxes for
 * each block must therefore have matching (1D) shape.
 *
 * As in `BlockLinear`, each key is assigned a string identifier: keys with the same identifier
 * share a scale (and, independently, a shift), `'-(id)'` shares a negated view, `None` is a unique
 * (unshared) parameter, and `0` disables it (a constant zero). Biases draw from the same identifier
 * namespace as the scales.
 */
export class BlockScaleShift extends torch.nn.Module {
  keys: string[];
  _weight_ids: Id[];
  _bias_ids: Id[] | false;
  on_initialize: ((module: BlockScaleShift) => void) | null;
  initialized: boolean;

  input_sizes!: number[];
  input_labels!: (string[] | null)[];
  weight_shapes!: Shape[];
  weight_ids!: ResolvedId[];
  weights!: torch.nn.ParameterDict;
  weight_labels!: ReadonlyMap<WeightId, DimLabels[]>;
  bias_ids!: ResolvedId[] | false;
  bias_shapes!: Shape[];
  biases!: torch.nn.ParameterDict;
  bias_labels!: ReadonlyMap<BiasId, DimLabels[]>;

  /**
   * Args:
   *   input_keys: The `input_space` keys corresponding to the values to scale and shift.
   *   weight_ids: One identifier per key in `input_keys`. Equal identifiers share a scale, `'-(id)'`
   *     shares a negated view, `None` is a unique (unshared) scale, and `0` disables scaling for
   *     that key (a constant zero). If `None`, every scale is unique.
   *   bias_ids: One identifier per key in `input_keys`, with the same semantics as `weight_ids`. If
   *     `False`, no key has a bias. If `True`, every bias is unique.
   *   on_initialize: A callable that is invoked after initialization.
   */
  constructor({
    input_keys,
    weight_ids = null,
    bias_ids = true,
    on_initialize = null,
  }: {
    input_keys: string[],
    weight_ids?: Id[] | null,
    bias_ids?: Id[] | boolean,
    on_initialize?: ((module: BlockScaleShift) => void) | null,
  }) {
    super();
    // Unshared weights.
    if (weight_ids === null) {
      weight_ids = input_keys.map(() => null);
    }
    if (bias_ids === true) {
      bias_ids = input_keys.map(() => null);
    }

    // Shape validation.
    console.assert(input_keys.length === weight_ids.length);

    this.keys = input_keys;
    this._weight_ids = weight_ids;
    this._bias_ids = bias_ids;
    this.on_initialize = on_initialize;
    this.initialized = false;
  }

  initialize(input_space: gymnasium.spaces.Dict) {
    // Extract the size and labels from each box.
    [this.input_sizes, this.input_labels] = get_flat_box_info(input_space, this.keys);
    // One `(size,)` shape per key, parallel to weight_ids; broadcasts disabled (`0`) scales.
    this.weight_shapes = this.input_sizes.map(s => [s]);

    // Create ParameterDicts for the shared weights and biases.
    [this.weight_ids, this.weights] = initialize_shared_weights(
      this._weight_ids,
      this.weight_shapes,
      'scale',
    );
    // Find and aggregate all labels per unique weight ID.
    this.weight_labels = collate_labels(
      this.weight_ids, this.weight_shapes, this.input_labels.map(l => [l]),
    );

    // `bias_ids` is the single guard for bias-related state: when biases are disabled, none of
    // `biases`/`bias_shapes`/`bias_labels` are set, so every read of them must be gated on it.
    if (this._bias_ids === false) {
      this.bias_ids = false;
    } else {
      // Biases share the same block structure (IDs, shapes, labels) as the scale weights.
      this.bias_shapes = this.weight_shapes;
      [this.bias_ids, this.biases] = initialize_shared_weights(
        this._bias_ids,
        this.bias_shapes,
        'bias',
      );
      // Find and aggregate all labels per unique bias ID.
      this.bias_labels = collate_labels(
        this.bias_ids, this.bias_shapes, this.input_labels.map(l => [l]),
      );
    }

    // Call the user-provided initialization function.
    if (this.on_initialize) {
      this.on_initialize(this);
    }

    this.initialized = true;
  }

  override forward(inputs: collections.Mapping<torch.Tensor>): collections.OrderedDict<torch.Tensor> {
    const outputs = new collections.OrderedDict<torch.Tensor>();
    this.keys.forEach((key, i) => {
      const scale = get_parameter(this.weights, this.weight_ids[i]).broadcast_to(this.weight_shapes[i]);
      let output = inputs.getitem(key).mul(scale);
      if (bool(this.bias_ids)) {
        const bias_id = (this.bias_ids as ResolvedId[])[i];
        const shift = get_parameter(this.biases, bias_id).broadcast_to(this.bias_shapes[i]);
        output = output.add(shift);
      }
      outputs.setitem(key, output);
    });
    return outputs;
  }

  extra_repr(): string {
    // Transposed relative to BlockLinear's table: keys run across columns (there are typically many
    // of them), and rows are the Weight/Bias identifiers -- biases share the weight identifiers.
    let key_headers: string[];
    let weight_ids: Id[];
    let bias_ids: Id[] | false;
    if (this.initialized) {
      key_headers = zip(this.keys, this.input_sizes).map(([k, s]) => `${k} (${s})`);
      [weight_ids, bias_ids] = [this.weight_ids, this.bias_ids];
    } else {
      key_headers = [...this.keys];
      [weight_ids, bias_ids] = [this._weight_ids, this._bias_ids];
    }
    const table: unknown[][] = [['KEY', ...key_headers], ['WEIGHT', ...weight_ids]];
    if (bool(bias_ids)) {
      table.push(['BIAS', ...(bias_ids as Id[])]);
    }
    return format_block_table(table);
  }

  __repr__(): string {
    return format_module_repr(this);
  }
}

/**
 * A linear layer that subdivides its weight matrix into an uneven grid of blocks based on the
 * input and output spaces. `c` input keys correspond to `c` columns, and `r` output keys
 * correspond to `r` rows. The size of each block is determined by the length of the boxes
 * corresponding to the input and output keys.
 *
 * The user has the ability to assign a string identifier to each block, where blocks with the same
 * identifier share the same weights. The same applies to biases. The string identifiers can also
 * represent transforms on shared weights, e.g. '-(A)' indicates that the block should use a negated
 * view of the shared weight identified by 'A'. A `None` identifier is a unique (unshared) block,
 * and a `0` identifier disables the block, which then contributes a constant zero.
 */
export class BlockLinear extends torch.nn.Module {
  input_keys: string[];
  output_keys: string[];
  _weight_ids: Id[][];
  _bias_ids: Id[] | false;
  on_initialize: ((module: BlockLinear) => void) | null;
  initialized: boolean;

  input_sizes!: number[];
  input_labels!: (string[] | null)[];
  output_sizes!: number[];
  output_labels!: (string[] | null)[];
  weight_ids!: ResolvedId[][];
  weight_shapes!: Shape[][];
  weights!: torch.nn.ParameterDict;
  weight_labels!: ReadonlyMap<WeightId, DimLabels[]>;
  bias_ids!: ResolvedId[] | false;
  bias_shapes!: Shape[];
  biases!: torch.nn.ParameterDict;
  bias_labels!: ReadonlyMap<BiasId, DimLabels[]>;

  /**
   * Initializes the BlockLinear layer.
   *
   * Args:
   *   input_keys: A list of input keys corresponding to the columns of the weight matrix.
   *   output_keys: A list of output keys corresponding to the rows of the weight matrix.
   *   weight_ids: An `r` x `c` list of identifiers for the weight-matrix blocks. Equal identifiers
   *     share a weight, `'-(id)'` shares a negated view, `None` is a unique (unshared) block, and
   *     `0` disables the block (a constant zero). If `None`, every block is unique.
   *   bias_ids: A list of `r` identifiers for the bias-vector blocks, with the same semantics. If
   *     `False`, no block has a bias. If `True`, every block's bias is unique.
   *   on_initialize: A callable that is invoked after the layer is initialized.
   */
  constructor({
    input_keys,
    output_keys,
    weight_ids = null,
    bias_ids = false,
    on_initialize = null,
  }: {
    input_keys: string[],
    output_keys: string[],
    weight_ids?: Id[][] | null,
    bias_ids?: Id[] | boolean,
    on_initialize?: ((module: BlockLinear) => void) | null,
  }) {
    super();
    // Unshared weights.
    if (weight_ids === null) {
      weight_ids = output_keys.map(() => input_keys.map(() => null));
    }
    if (bias_ids === true) {
      bias_ids = output_keys.map(() => null);
    }

    // Shape validation.
    console.assert(input_keys.length === new Set(input_keys).size, `Duplicate input keys: ${input_keys}.`);
    console.assert(output_keys.length === new Set(output_keys).size, `Duplicate output keys: ${output_keys}.`);
    console.assert(output_keys.length === weight_ids.length);
    console.assert(weight_ids.every(w => w.length === input_keys.length));
    console.assert(bias_ids === false || bias_ids.length === output_keys.length);

    this.input_keys = input_keys;
    this.output_keys = output_keys;
    this._weight_ids = weight_ids;
    this._bias_ids = bias_ids;
    this.on_initialize = on_initialize;
    this.initialized = false;
  }

  initialize(input_space: gymnasium.spaces.Dict, output_space: gymnasium.spaces.Dict) {
    // Extract the size and labels from each box.
    [this.input_sizes, this.input_labels] = get_flat_box_info(input_space, this.input_keys);
    [this.output_sizes, this.output_labels] = get_flat_box_info(output_space, this.output_keys);

    // Create parallel lists of weight IDs, shapes, and labels for each block.
    const weight_ids: Id[] = this._weight_ids.flat();
    const labels: Labels[] = this.output_labels.flatMap(o => this.input_labels.map(i => [o, i]));
    const shapes: Shape[] = this.output_sizes.flatMap(o => this.input_sizes.map(i => [o, i]));

    // Create ParameterDicts for the shared weights and biases.
    let resolved_weight_ids: ResolvedId[];
    [resolved_weight_ids, this.weights] = initialize_shared_weights(
      weight_ids,
      shapes,
      'weight',
    );
    // Regroup the flat resolved IDs and shapes back into the `r` x `c` block grid. `weight_shapes`
    // is parallel to `weight_ids` and used to broadcast disabled (`0`) blocks during assembly.
    const ncols = this.input_keys.length;
    this.weight_ids = builtins.range(0, resolved_weight_ids.length, ncols).map(
      i => resolved_weight_ids.slice(i, i + ncols),
    );
    this.weight_shapes = builtins.range(0, shapes.length, ncols).map(i => shapes.slice(i, i + ncols));
    // Find and aggregate all labels per unique weight ID.
    this.weight_labels = collate_labels(resolved_weight_ids, shapes, labels);

    // Initialize the bias parameters. `bias_ids` is the single guard for bias-related state: when
    // biases are disabled, none of `biases`/`bias_shapes`/`bias_labels` are set, so every read of
    // them must be gated on it. `bias_shapes` is parallel to `bias_ids` (one `(size,)` per output
    // key).
    if (this._bias_ids === false) {
      this.bias_ids = false;
    } else {
      this.bias_shapes = this.output_sizes.map(s => [s]);
      [this.bias_ids, this.biases] = initialize_shared_weights(
        this._bias_ids,
        this.bias_shapes,
        'bias',
      );
      this.bias_labels = collate_labels(
        this.bias_ids, this.bias_shapes, this.output_labels.map(l => [l]),
      );
    }

    // Call the user-provided initialization function.
    if (this.on_initialize) {
      this.on_initialize(this);
    }

    this.initialized = true;
  }

  override forward(inputs: collections.Mapping<torch.Tensor>): collections.OrderedDict<torch.Tensor> {
    const [weight, bias] = this.assemble_parameters();

    // Concatenate the input tensors and compute the output tensor.
    const input_tensor = torch.cat(this.input_keys.map(k => inputs.getitem(k)), 0);
    let output_tensor = input_tensor.matmul(weight.T);
    if (bias !== null) {
      output_tensor = output_tensor.add(bias);
    }

    // Split the output tensor into a dictionary of output tensors.
    const outputs = new collections.OrderedDict<torch.Tensor>();
    let start = 0;
    this.output_keys.forEach((output_key, i) => {
      const end = start + this.output_sizes[i];
      outputs.setitem(output_key, output_tensor.slice(start, end));
      start = end;
    });
    return outputs;
  }

  /**
   * Assembles the shared weight and bias parameters into a weight matrix and a bias vector.
   *
   * Returns:
   *   A tuple of (weight_tensor, bias_tensor).
   */
  assemble_parameters(): [torch.Tensor, torch.Tensor | null] {
    const weight = torch.cat(
      zip(this.weight_ids, this.weight_shapes).map(([id_row, shape_row]) => torch.cat(
        zip(id_row, shape_row).map(([id, shape]) => get_parameter(this.weights, id).broadcast_to(shape)),
        1,
      )),
      0,
    );
    const bias = bool(this.bias_ids) ? torch.cat(
      zip(this.bias_ids as ResolvedId[], this.bias_shapes).map(
        ([id, shape]) => get_parameter(this.biases, id).broadcast_to(shape),
      ),
      0,
    ) : null;
    return [weight, bias];
  }

  extra_repr(): string {
    let input_headers: string[];
    let output_headers: string[];
    let weight_ids: Id[][];
    let bias_ids: Id[] | false;
    if (this.initialized) {
      input_headers = zip(this.input_keys, this.input_sizes).map(([k, s]) => `${k} (${s})`);
      output_headers = zip(this.output_keys, this.output_sizes).map(([k, s]) => `${k} (${s})`);
      [weight_ids, bias_ids] = [this.weight_ids, this.bias_ids];
    } else {
      input_headers = [...this.input_keys];
      output_headers = [...this.output_keys];
      [weight_ids, bias_ids] = [this._weight_ids, this._bias_ids];
    }
    let table: unknown[][] = [['', ...input_headers], ...zip(output_headers, weight_ids).map(
      ([output_key, row]) => [output_key, ...row],
    )];
    if (bool(bias_ids)) {
      table = zip(['BIAS', ...(bias_ids as Id[])], table).map(([bias_id, row]) => [bias_id, ...row]);
    }
    return format_block_table(table);
  }

  __repr__(): string {
    return format_module_repr(this);
  }
}

/**
 * A list of independent ("parallel") dense linear blocks. Each block maps a group of input keys
 * (concatenated) to a group of output keys (concatenated); unlike `BlockLinear`, whose input and
 * output keys index a single dense grid, every block here has its own private input/output keys, so
 * the overall structure is block-diagonal.
 *
 * Each block is itself a miniature `BlockLinear`: its weight matrix is subdivided into an
 * `output_group` x `input_group` grid of sub-blocks, and sub-blocks (within or across blocks) may
 * share a weight - or a transformed view of one, e.g. `'-(A)'` - via a common identifier. A
 * `None` identifier is a unique (unshared) sub-block, and a `0` identifier disables it (a constant
 * zero).
 */
export class SparseBlockLinear extends torch.nn.Module {
  input_keys: string[][];
  output_keys: string[][];
  _weight_ids: Id[][][];
  _bias_ids: Id[][] | false;
  on_initialize: ((module: SparseBlockLinear) => void) | null;
  initialized: boolean;

  input_sizes!: number[][];
  output_sizes!: number[][];
  weight_ids!: ResolvedId[][][];
  weight_shapes!: Shape[][][];
  weights!: torch.nn.ParameterDict;
  weight_labels!: ReadonlyMap<WeightId, DimLabels[]>;
  bias_ids!: ResolvedId[][] | false;
  bias_shapes!: Shape[][];
  biases!: torch.nn.ParameterDict;
  bias_labels!: ReadonlyMap<BiasId, DimLabels[]>;

  /**
   * Args:
   *   input_keys: A list of groups of input keys, one group per block; a group's keys are
   *     concatenated to form that block's input. The same input key may appear in multiple groups.
   *   output_keys: A list of groups of output keys, one group per block, parallel to `input_keys`.
   *     Every output key must appear in exactly one group across the entire list.
   *   weight_ids: A list of 2D lists, one per block, parallel to `input_keys`/`output_keys`. Each
   *     block's 2D list is a `len(output_group)` x `len(input_group)` grid of sub-block
   *     identifiers, with the sharing/`'-(id)'`/`None`/`0` semantics described above. If `None`,
   *     every sub-block is unique.
   *   bias_ids: A list of lists, one per block, parallel to `output_keys`; each holds one identifier
   *     per output key, with the same semantics as `weight_ids`. If `False`, no block has a bias.
   *     If `True`, every block's biases are unique.
   *   on_initialize: A callable that is invoked after the layer is initialized.
   */
  constructor({
    input_keys,
    output_keys,
    weight_ids = null,
    bias_ids = true,
    on_initialize = null,
  }: {
    input_keys: string[][],
    output_keys: string[][],
    weight_ids?: Id[][][] | null,
    bias_ids?: Id[][] | boolean,
    on_initialize?: ((module: SparseBlockLinear) => void) | null,
  }) {
    super();
    // Unshared weights.
    if (weight_ids === null) {
      weight_ids = zip(input_keys, output_keys).map(
        ([in_group, out_group]) => out_group.map(() => in_group.map(() => null)),
      );
    }
    if (bias_ids === true) {
      bias_ids = output_keys.map(out_group => out_group.map(() => null));
    }

    // Parallel input/output key group validation.
    for (const group of input_keys) {
      console.assert(group.length === new Set(group).size, `Duplicate input keys within a group: ${group}.`);
    }
    for (const group of output_keys) {
      console.assert(group.length === new Set(group).size, `Duplicate output keys within a group: ${group}.`);
    }
    const all_output_keys = output_keys.flat();
    console.assert(
      all_output_keys.length === new Set(all_output_keys).size,
      `Every output key must appear in exactly one group; got: ${all_output_keys}.`,
    );

    // Shape validation.
    console.assert(
      input_keys.length === output_keys.length && output_keys.length === weight_ids.length,
      `input_keys (${input_keys.length}), output_keys (${output_keys.length}), and weight_ids ` +
      `(${weight_ids.length}) must all have the same length.`,
    );
    console.assert(
      bias_ids === false || bias_ids.length === weight_ids.length,
      `bias_ids must match the number of blocks (${weight_ids.length}).`,
    );
    console.assert(
      zip(input_keys, output_keys, weight_ids).every(([input_group, output_group, weight_group]) =>
        weight_group.length === output_group.length &&
        weight_group.every(row => row.length === input_group.length)),
      `Weight IDs must match the shape of the input/output key groups: ${weight_ids}.`,
    );
    console.assert(
      bias_ids === false || zip(output_keys, bias_ids).every(
        ([output_group, bias_group]) => bias_group.length === output_group.length,
      ),
      `Bias IDs must match the shape of the output key groups: ${bias_ids}.`,
    );

    this.input_keys = input_keys;
    this.output_keys = output_keys;
    this._weight_ids = weight_ids;
    this._bias_ids = bias_ids;
    this.on_initialize = on_initialize;
    this.initialized = false;
  }

  initialize(input_space: gymnasium.spaces.Dict, output_space: gymnasium.spaces.Dict) {
    // Extract the size and labels from each individual key's box.
    const flat_input_keys = builtins.sorted(new Set(this.input_keys.flat()));
    const flat_output_keys = this.output_keys.flat();
    const [input_sizes, input_labels] = get_flat_box_info(input_space, flat_input_keys);
    const [output_sizes, output_labels] = get_flat_box_info(output_space, flat_output_keys);
    const input_size_by_key = new Map(zip(flat_input_keys, input_sizes));
    const input_labels_by_key = new Map(zip(flat_input_keys, input_labels));
    const output_size_by_key = new Map(zip(flat_output_keys, output_sizes));
    const output_labels_by_key = new Map(zip(flat_output_keys, output_labels));

    // Per-block, per-key sizes, parallel to input_keys/output_keys -- used for splitting `forward`'s
    // concatenated output and for annotating sizes in `extra_repr`.
    this.input_sizes = this.input_keys.map(group => group.map(k => input_size_by_key.get(k)!));
    this.output_sizes = this.output_keys.map(group => group.map(k => output_size_by_key.get(k)!));

    // Flatten every block's `output_group` x `input_group` sub-block grid into parallel lists of
    // weight IDs, shapes, and labels (block-major, then row-major), mirroring `BlockLinear`.
    const weight_ids: Id[] = this._weight_ids.flatMap(block => block.flat());
    const shapes: Shape[] = zip(this.input_keys, this.output_keys).flatMap(([in_group, out_group]) =>
      out_group.flatMap(o => in_group.map(i => [output_size_by_key.get(o)!, input_size_by_key.get(i)!])));
    const labels: Labels[] = zip(this.input_keys, this.output_keys).flatMap(([in_group, out_group]) =>
      out_group.flatMap(o => in_group.map(i => [output_labels_by_key.get(o)!, input_labels_by_key.get(i)!])));

    // Create the shared weight ParameterDict, then regroup the flat resolved IDs and shapes back
    // into each block's sub-block grid. `weight_shapes` is parallel to `weight_ids` and used to
    // broadcast disabled (`0`) sub-blocks during assembly.
    let resolved_weight_ids: ResolvedId[];
    [resolved_weight_ids, this.weights] = initialize_shared_weights(
      weight_ids,
      shapes,
      'weight',
    );
    this.weight_ids = [];
    this.weight_shapes = [];
    let cursor = 0;
    for (const [in_group, out_group] of zip(this.input_keys, this.output_keys)) {
      const id_block: ResolvedId[][] = [];
      const shape_block: Shape[][] = [];
      for (const _ of out_group) {
        id_block.push(resolved_weight_ids.slice(cursor, cursor + in_group.length));
        shape_block.push(shapes.slice(cursor, cursor + in_group.length));
        cursor += in_group.length;
      }
      this.weight_ids.push(id_block);
      this.weight_shapes.push(shape_block);
    }
    // Find and aggregate all labels per unique weight ID.
    this.weight_labels = collate_labels(resolved_weight_ids, shapes, labels);

    // Initialize the bias parameters. Biases are 1D and indexed per output key (one entry per
    // sub-block row), sharing the block structure of the weights' rows. `bias_ids` is the single
    // guard for bias-related state: when biases are disabled, none of `biases`/`bias_shapes`/
    // `bias_labels` are set, so every read of them must be gated on it. `bias_shapes` is parallel
    // to `bias_ids`.
    if (this._bias_ids === false) {
      this.bias_ids = false;
    } else {
      const bias_ids: Id[] = this._bias_ids.flat();
      const bias_shapes: Shape[] = this.output_keys.flatMap(out_group => out_group.map(o => [output_size_by_key.get(o)!]));
      const bias_labels: Labels[] = this.output_keys.flatMap(out_group => out_group.map(o => [output_labels_by_key.get(o)!]));
      let resolved_bias_ids: ResolvedId[];
      [resolved_bias_ids, this.biases] = initialize_shared_weights(
        bias_ids,
        bias_shapes,
        'bias',
      );
      this.bias_ids = [];
      this.bias_shapes = [];
      cursor = 0;
      for (const out_group of this.output_keys) {
        this.bias_ids.push(resolved_bias_ids.slice(cursor, cursor + out_group.length));
        this.bias_shapes.push(bias_shapes.slice(cursor, cursor + out_group.length));
        cursor += out_group.length;
      }
      this.bias_labels = collate_labels(resolved_bias_ids, bias_shapes, bias_labels);
    }

    if (this.on_initialize) {
      this.on_initialize(this);
    }

    this.initialized = true;
  }

  override forward(inputs: collections.Mapping<torch.Tensor>): collections.OrderedDict<torch.Tensor> {
    const outputs = new collections.OrderedDict<torch.Tensor>();
    zip(this.input_keys, this.output_keys, this.output_sizes).forEach(([in_group, out_group, out_sizes], i) => {
      const [weight, bias] = this.assemble_parameters(i);

      // Concatenate the block's inputs, apply its dense weight (and bias), and split the result back
      // into individual output keys.
      const input_tensor = torch.cat(in_group.map(k => inputs.getitem(k)), 0);
      let output_tensor = input_tensor.matmul(weight.T);
      if (bias !== null) {
        output_tensor = output_tensor.add(bias);
      }

      let start = 0;
      for (const [k, size] of zip(out_group, out_sizes)) {
        outputs.setitem(k, output_tensor.slice(start, start + size));
        start += size;
      }
    });
    return outputs;
  }

  /**
   * Assembles block `block_index`'s shared sub-block weights (and biases) into a single dense weight
   * matrix and bias vector, mirroring `BlockLinear.assemble_parameters`.
   *
   * Returns:
   *   A tuple of (weight_tensor, bias_tensor).
   */
  assemble_parameters(block_index: number): [torch.Tensor, torch.Tensor | null] {
    const weight = torch.cat(
      zip(this.weight_ids[block_index], this.weight_shapes[block_index]).map(([id_row, shape_row]) => torch.cat(
        zip(id_row, shape_row).map(([id, shape]) => get_parameter(this.weights, id).broadcast_to(shape)),
        1,
      )),
      0,
    );
    const bias = bool(this.bias_ids) ? torch.cat(
      zip((this.bias_ids as ResolvedId[][])[block_index], this.bias_shapes[block_index]).map(
        ([id, shape]) => get_parameter(this.biases, id).broadcast_to(shape),
      ),
      0,
    ) : null;
    return [weight, bias];
  }

  extra_repr(): string {
    // One row per sub-block weight. Blocks form an arbitrary list rather than a grid, and each block
    // is itself an uneven `output_group` x `input_group` grid, flattened here to one row per
    // (output key, input key) pair. The output key and bias are shown once per row group.
    const [weight_ids, bias_ids] = this.initialized
      ? [this.weight_ids as Id[][][], this.bias_ids as Id[][] | false]
      : [this._weight_ids, this._bias_ids];
    const header = ['INPUT', 'OUTPUT', 'WEIGHT', ...(bool(bias_ids) ? ['BIAS'] : [])];
    const table: unknown[][] = [header];
    zip(this.input_keys, this.output_keys).forEach(([in_group, out_group], i) => {
      const in_sizes = this.initialized ? this.input_sizes[i] : in_group.map(() => null);
      const out_sizes = this.initialized ? this.output_sizes[i] : out_group.map(() => null);
      zip(out_group, out_sizes).forEach(([out_key, out_size], row_index) => {
        zip(in_group, in_sizes).forEach(([in_key, in_size], col_index) => {
          const row: unknown[] = [
            this.initialized ? `${in_key} (${in_size})` : in_key,
            col_index === 0 ? (this.initialized ? `${out_key} (${out_size})` : out_key) : '',
            weight_ids[i][row_index][col_index],
          ];
          if (bool(bias_ids)) {
            row.push(col_index === 0 ? (bias_ids as Id[][])[i][row_index] : '');
          }
          table.push(row);
        });
      });
    });
    return format_block_table(table);
  }

  __repr__(): string {
    return format_module_repr(this);
  }
}

// ==================================================================================================
// Label and indexing utilities

/**
 * Given a gymnasium Dict space and a sequence of keys, verifies that the corresponding values are
 * 1D Box spaces and extracts their sizes, and if present, dimension labels.
 *
 * Args:
 *   space: A dictionary of gymnasium Box spaces.
 *   keys: A sequence of keys expected to be present in `space`.
 *
 * Returns:
 *   A tuple of (`sizes`, `labels`), where `sizes` is a list of the sizes of the Box spaces,
 *   and `labels` is a list of the labels of the Box spaces (or None if no labels are available).
 *   Both lists are ordered according to `keys`.
 */
export function get_flat_box_info(
  space: gymnasium.spaces.Dict,
  keys: string[],
): [number[], (string[] | null)[]] {
  // Validate space keys and types.
  if (!keys.every(k => space.spaces.has(k))) {
    throw new Error(
      `ValueError: Missing keys: ${keys.filter(k => !space.spaces.has(k))}. ` +
      `Space keys: ${space.spaces.keys()}.`,
    );
  }
  const non_box = keys.filter(k => !(space.spaces.getitem(k) instanceof gymnasium.spaces.Box));
  if (non_box.length) {
    throw new Error(`ValueError: Got non-Box spaces: ${non_box}.`);
  }
  // Validate box shapes for each key.
  const shapes = keys.map(k => (space.getitem(k) as gymnasium.spaces.Box).shape);
  const invalid = zip(keys, shapes).filter(([, shape]) => shape === null || shape.length !== 1);
  if (invalid.length) {
    throw new Error(`ValueError: Got non-1D shapes: ${invalid.map(([k, s]) => `${k}: [${s}]`)}.`);
  }
  const sizes = shapes.map(shape => shape[0]);

  // Extract labels for each key, if available.
  const labels: (string[] | null)[] = [];
  for (const k of keys) {
    const box = space.spaces.getitem(k);
    if (box instanceof cxg.Box) {
      const label = box.labels;
      if (
        Array.isArray(label) &&                           // labels=T.Sequence[T.Any]
        label.length === 1 &&                             // labels=[T.Any]
        Array.isArray(label[0]) &&                        // labels=[T.Sequence[T.Any]], labels!=[str]
        label[0].every(l => typeof l === 'string')        // labels=[T.Sequence[str]]
      ) {
        labels.push([...label[0]]);
        continue;
      }
    }
    labels.push(null);
  }

  return [sizes, labels];
}

/**
 * Collate the labels for a set of weights into a single structure.
 *
 * Args:
 *   weight_ids: A sequence of weight IDs.
 *   weight_shapes: A sequence of shapes for each weight.
 *   weight_labels: A 2D list of labels that matches the corresponding shape in `weight_shapes`.
 *
 * Returns:
 *   A mapping from unique weight IDs to a `tuple[tuple[frozenset[str], ...], ...]]`, with semantics
 *   ```
 *   [
 *     [set(aliases[index]) for index in range(size)]
 *     for size, aliases in zip(weight.shape, weight.labels)
 *   ]
 *   ```
 */
export function collate_labels(
  weight_ids: ResolvedId[],
  weight_shapes: Shape[],
  weight_labels: Labels[],
): ReadonlyMap<WeightId, DimLabels[]> {
  // Filter out any disabled weights.
  weight_shapes = zip(weight_ids, weight_shapes).filter(([id]) => id !== 0).map(([, shape]) => shape);
  weight_labels = zip(weight_ids, weight_labels).filter(([id]) => id !== 0).map(([, labels]) => labels);
  const ids = weight_ids.filter(id => id !== 0).map(w => parse_weight_transform(w as WeightId, true)[0]);
  // Set up the empty indexing structure.
  const collated_labels = new Map<WeightId, Set<string>[][]>();
  for (const [weight_id, shape] of zip(ids, weight_shapes)) {
    if (!collated_labels.has(weight_id)) {
      collated_labels.set(weight_id, shape.map(dim => builtins.range(dim).map(() => new Set<string>())));
      continue;
    }
    const existing = collated_labels.get(weight_id)!;
    if (existing.length !== shape.length) {
      throw new Error(
        `ValueError: Inconsistent number of dimensions for weight ${weight_id}: ` +
        `${existing.length} vs ${shape.length}.`,
      );
    }
    if (zip(existing, shape).some(([dim_labels, dim]) => dim_labels.length !== dim)) {
      throw new Error(
        `ValueError: Inconsistent dimension sizes for weight ${weight_id}: ` +
        `${existing.map(d => d.length)} vs ${shape}.`,
      );
    }
  }
  // Insert any provided labels into the indexing structure.
  for (const [weight_id, labels] of zip(ids, weight_labels)) {
    const collated = collated_labels.get(weight_id)!;
    if (labels.length !== collated.length) {
      throw new Error(
        `ValueError: Inconsistent number of dimensions for weight ${weight_id}: ` +
        `${labels.length} vs ${collated.length}.`,
      );
    }
    // `labels` has a length equal to the number of dimensions in the weight.
    for (const [dim_labels, dim_collated] of zip(labels, collated)) {
      // Proceed if no labels were provided for the dimension.
      if (dim_labels === null) {
        continue;
      }
      if (dim_labels.length !== dim_collated.length) {
        throw new Error(
          `ValueError: Inconsistent dimension sizes for weight ${weight_id}: ` +
          `${dim_labels.length} vs ${dim_collated.length}.`,
        );
      }
      // Add each label to the corresponding set for each index in the dimension.
      for (const [label, set] of zip(dim_labels, dim_collated)) {
        set.add(label);
      }
    }
  }
  return collated_labels;
}

// ==================================================================================================
// Shared weight management utilities

export function format_weight_transform(
  weight_id: WeightId | BiasId,
  transform: WeightTransform | null,
): WeightId | BiasId {
  if (transform === null) {
    return weight_id;
  }
  const spec = WEIGHT_TRANSFORMS.get(transform)!;
  return `${spec.prefix}(${weight_id})${spec.suffix}`;
}

export function parse_weight_transform(
  weight_id: WeightId | BiasId,
  allow_private: boolean = true,
): [WeightId | BiasId, (x: torch.Tensor) => torch.Tensor] {
  // Parse transform prefix and suffix.
  const prefix_sentinel_parts = builtins.split1(weight_id, '(');
  const suffix_sentinel_parts = builtins.rsplit1(weight_id, ')');
  const prefix_sentinel_found = prefix_sentinel_parts.length === 2;
  const suffix_sentinel_found = suffix_sentinel_parts.length === 2;
  if (prefix_sentinel_found !== suffix_sentinel_found) {
    throw new Error(`ValueError: Mismatched weight transform parentheses in ${weight_id}.`);
  }

  // No transform on weight ID.
  if (!prefix_sentinel_found) {
    const reserved_characters = new Set(
      [...WEIGHT_ID_RESERVED_CHARACTERS].filter(c => weight_id.startsWith(c) || weight_id.endsWith(c)),
    );
    if (allow_private) {
      reserved_characters.delete('$');
    }
    if (reserved_characters.size) {
      throw new Error(
        `ValueError: Weight ID ${weight_id} starts or ends with reserved characters ${[...reserved_characters]}.`,
      );
    }
    return [weight_id, (x) => x];
  }

  // Identify the transform by matching the prefix and suffix against known transforms.
  const [prefix, suffix] = [prefix_sentinel_parts[0], suffix_sentinel_parts[1]];
  const matching_transforms = [...WEIGHT_TRANSFORMS].filter(
    ([, spec]) => prefix === spec.prefix && suffix === spec.suffix,
  );
  if (!matching_transforms.length) {
    throw new Error(`ValueError: Invalid weight transform in ${weight_id}.`);
  }
  console.assert(matching_transforms.length === 1);
  const [, spec] = matching_transforms[0];

  // Strip the prefix/suffix and parentheses.
  weight_id = weight_id.slice(spec.prefix.length + 1, -spec.suffix.length - 1);
  const outer_transform = spec.apply;

  // Recursively parse nested transforms.
  let inner_transform: (x: torch.Tensor) => torch.Tensor;
  [weight_id, inner_transform] = parse_weight_transform(weight_id, allow_private);
  const transform = (x: torch.Tensor) => outer_transform(inner_transform(x));

  return [weight_id, transform];
}

/** Returns the parameter corresponding to a weight ID, with transforms applied. */
export function get_parameter(
  parameter_dict: torch.nn.ParameterDict,
  weight_id: WeightId | BiasId | 0,
): torch.Tensor {
  if (weight_id === 0) {
    return torch.zeros(1);
  }
  const [base_id, transform] = parse_weight_transform(weight_id, true);
  const parameter = parameter_dict.getitem(base_id);
  return transform(parameter);
}

/** Creates a parameter dict for unique base weight IDs. */
export function initialize_shared_weights(
  weight_ids: Id[],
  weight_shapes: Shape[],
  unique_weight_namespace: string,
): [ResolvedId[], torch.nn.ParameterDict] {
  let new_unique_weight_ids = 0;
  function unique_weight_id() {
    const weight_id = `$${unique_weight_namespace}${new_unique_weight_ids}`;
    new_unique_weight_ids += 1;
    return weight_id;
  }

  // Validate that no weight ID is a private ID (starts with `$`).
  for (const w of weight_ids) {
    if (typeof w === 'string') {
      parse_weight_transform(w, false);
    }
  }

  // Replace `None` weight IDs with unique private IDs.
  const resolved: ResolvedId[] = weight_ids.map(w =>
    typeof w === 'string' ? w : (w === null ? unique_weight_id() : w),
  );

  const weight_shapes_by_id = new collections.Dict<Set<string>>();
  for (const [weight_id, shape] of zip(resolved, weight_shapes)) {
    // Disabled (`0`) blocks contribute no parameter, so skip them -- but only after zipping against
    // the full `weight_shapes` so the remaining IDs stay aligned with their shapes.
    if (weight_id === 0) {
      continue;
    }
    const base_id = parse_weight_transform(weight_id, true)[0];
    if (!weight_shapes_by_id.has(base_id)) weight_shapes_by_id.setitem(base_id, new Set());
    weight_shapes_by_id.getitem(base_id).add(shape.join(','));
  }

  const inconsistent_weight_shapes = weight_shapes_by_id.items().filter(([, shapes]) => shapes.size !== 1);
  if (inconsistent_weight_shapes.length) {
    throw new Error(`ValueError: Inconsistent weight shapes for identifiers: ${inconsistent_weight_shapes.map(([id, s]) => `${id}: ${[...s].join(' | ')}`)}.`);
  }

  return [resolved, new torch.nn.ParameterDict(new collections.Dict(
    weight_shapes_by_id.items().map(([weight_id, shapes]) => [
      weight_id,
      new torch.nn.Parameter(torch.zeros([...shapes][0].split(',').map(Number))),
    ]),
  ))];
}

// ==================================================================================================
// String utilities

/**
 * Renders a 2D table (first row treated as the header) as an aligned, `|`-separated string, for use
 * in the `extra_repr` of a block-structured module (`BlockLinear`, `BlockScaleShift`,
 * `ParallelLinear`). Pair with `format_module_repr` for the `ClassName(...)` wrapping and indent.
 */
export function format_block_table(table: unknown[][]): string {
  const max_widths = table[0].map((_, c) => Math.max(...table.map(row => str(row[c]).length)));
  const rows = table.map(row => zip(row, max_widths).map(([cell, width]) => str(cell).padEnd(width)).join(' | '));
  rows.splice(1, 0, max_widths.map(width => '-'.repeat(width)).join('---'));
  return rows.join('\n');
}

/**
 * Renders `module.extra_repr()` wrapped in `ClassName(...)`, in place of `torch.nn.Module`'s default
 * `__repr__` -- which would otherwise additionally dump every child submodule (e.g. a `weights` or
 * `biases` `ParameterDict`) after `extra_repr`'s own output.
 */
export function format_module_repr(module: torch.nn.Module & { extra_repr(): string }): string {
  return `${module.constructor.name}(\n  ` + module.extra_repr().replaceAll('\n', '\n  ') + '\n)';
}

export type BlockModule = BlockScaleShift | BlockLinear | SparseBlockLinear;
