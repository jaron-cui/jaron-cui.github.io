/**
 * Port of `projects/rodent/envs/arenas/floor.py`.
 *
 * The floor's spec (plane geom, textures, skybox, lights) is built in Python and baked into the
 * exported compiled model, so this entity only keeps its configuration.
 */
import * as cxe from '../../composer/mjx_env';

/** A flat floor with a checkered pattern, skybox, and skylight. */
export class Floor extends cxe.MjxEntity<null> {
  size: [number, number];
  reflectance: number;
  sky_color: 'blue' | 'white' | 'black';
  floor_color: 'blue' | 'white' | 'gray' | 'black';

  constructor({
    size = [10., 10.],
    reflectance = 0.,
    sky_color = 'white',
    floor_color = 'gray',
  }: {
    size?: [number, number],
    reflectance?: number,
    sky_color?: 'blue' | 'white' | 'black',
    floor_color?: 'blue' | 'white' | 'gray' | 'black',
  } = {}) {
    super();
    this.size = size;
    this.reflectance = reflectance;
    this.sky_color = sky_color;
    this.floor_color = floor_color;
  }
}
