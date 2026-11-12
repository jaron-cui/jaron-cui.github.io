/**
 * This module defines the `Group` class, which is a container node that groups nodes together.
 */
import * as collections from '../utils/collections';
import * as nodes from './nodes';

/**
 * A container node that groups nodes together. It mainly is used for organizing nodes in a
 * modular, hierarchical way. Children may inherit the parent's metadata (e.g. rendering options,
 * layout relative to the parent's layout coordinates).
 */
export class Group extends nodes.ContainerNode {
  constructor(kwargs: collections.AttrDict = {}) {
    super(kwargs);
  }
}
