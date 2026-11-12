/**
 * Loaders for the JSON files written by `python/export.py`.
 */
import * as torch from './torch';
import * as gymnasium from './gymnasium';
import * as cxg from './composer/utils/gym';
import * as collections from './utils/collections';

/** Strict JSON has no Infinity/NaN, so `export.py` writes non-finite floats as strings. */
export type FloatJson = number | 'inf' | '-inf' | 'nan';

export function float_from_json(x: FloatJson): number {
  switch (x) {
    case 'inf': return Infinity;
    case '-inf': return -Infinity;
    case 'nan': return NaN;
    default: return x;
  }
}

export interface TensorJson {
  shape: number[];
  dtype: torch.DType;
  data: FloatJson[];
}

export function tensor_from_json({ shape, dtype, data }: TensorJson): torch.Tensor {
  return torch.tensor(data.map(float_from_json), { dtype }).reshape(...shape);
}

export function state_dict_from_json(json: Record<string, TensorJson>, prefix: string = ''): torch.nn.StateDict {
  const state_dict: torch.nn.StateDict = new Map();
  for (const [key, value] of Object.entries(json)) {
    if (key.startsWith(prefix)) state_dict.set(key.slice(prefix.length), tensor_from_json(value));
  }
  return state_dict;
}

export interface BoxJson {
  shape: number[];
  low: FloatJson[];
  high: FloatJson[];
  labels: (string | string[])[] | null;
}

/** Builds a `gymnasium.spaces.Dict` of `cxg.Box`es, keeping the exported key order. */
export function space_from_json(json: Record<string, BoxJson>): gymnasium.spaces.Dict {
  return new gymnasium.spaces.Dict(Object.entries(json).map(([key, box]) => [key, new cxg.Box({
    low: box.low.map(float_from_json),
    high: box.high.map(float_from_json),
    shape: box.shape,
    labels: box.labels,
  })]));
}

/** Converts `{key: number[]}` into a `Dict` of 1D float32 tensors. */
export function tensors_from_json(json: Record<string, number[]>): collections.Dict<torch.Tensor> {
  return new collections.Dict(Object.entries(json).map(([key, data]) => [key, torch.tensor(data)]));
}
