/** Port of `libs/composer/utils/gym.py` (`Box` subset). */
import * as gymnasium from '../../gymnasium';

export interface BoxKwargs extends gymnasium.spaces.BoxKwargs {
  name?: string;
  desc?: string;
  labels?: (string | string[])[] | null;
}

/** A `gymnasium.spaces.Box` with a name, description, and per-dimension index labels. */
export class Box extends gymnasium.spaces.Box {
  name: string;
  desc: string;
  labels: (string | string[])[] | null;

  constructor({ name = '', desc = '', labels = null, ...kwargs }: BoxKwargs) {
    super(kwargs);
    this.name = name;
    this.desc = desc;
    this.labels = labels && labels.length ? labels.map(l => typeof l === 'string' ? l : [...l]) : null;
  }
}
