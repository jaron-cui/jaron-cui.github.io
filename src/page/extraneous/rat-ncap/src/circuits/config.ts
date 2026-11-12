/**
 * This module defines `SimulatorConfig`, which holds configuration settings for the simulator.
 */

export class SimulatorConfig {
  /** Time (in milliseconds) represented by a single step of the simulation. */
  timestep: number;

  constructor({ timestep = 10 }: { timestep?: number } = {}) {
    this.timestep = timestep;
  }
}
