/**
 * This module defines the `Node` interfaces/superclasses that compose a circuit.
 *
 * An architecture built with this circuits library is composed of a tree of `ModuleNode` instances,
 * which are `torch.nn.Module`/`torch.nn.ModuleDict` with additional methods and metadata. The
 * top-level node should be a `Simulator` node, which manages the computations of the circuit tree.
 * Only `ModuleNode` instances (not regular `torch.nn.Module`) may be used as intermediate nodes in
 * the circuit tree, but `PrimitiveNode` leaves may have additional `torch.nn.Module` as children.
 */
import * as torch from '../torch';
import * as collections from '../utils/collections';
import * as config from './config';

/**
 * Base class for nodes in the neural circuit.
 *
 * Attributes:
 *   id: Unique identifier of the node.
 *   meta: Metadata of the node, e.g. for rendering settings.
 */
export class Node extends torch.nn.Module {
  // Generator for unique `Node` IDs that are deterministic based on `Node` instatiation order.
  static _newid = 0;

  id: number;
  meta: collections.AttrDict;

  constructor(kwargs: collections.AttrDict = {}) {
    super();
    this.id = Node._newid++;
    this.meta = { ...kwargs };
  }

  /**
   * Initializes the node with the given simulator configuration.
   *
   * Args:
   *   cfg: Simulator configuration.
   */
  init(cfg: config.SimulatorConfig) {
  }

  /** Resets the node to its initial state. */
  reset(reset: torch.Tensor | null = null) {
  }
}

/** A circuit tree (leaf) node that cannot contain other nodes. */
export class PrimitiveNode extends Node {
}

/**
 * A circuit tree (intermediate) node that can contain other nodes.
 *
 * Python `torch.nn.ModuleDict` item access `node[name]` is property access `node[name]` here.
 */
export class ContainerNode extends Node {
  [name: string]: unknown;
}

/** Nodes that are `torch.nn.Module`/`torch.nn.ModuleDict` instances. */
export type ModuleNode = PrimitiveNode | ContainerNode;

/**
 * Traverses a `Node` tree , applying a visitor function to each node.
 *
 * The visitor function can control whether to continue traversing the subtree of a node.
 *
 * Args:
 *   root: Root node of the tree to traverse.
 *   visitor: Function to apply to each node. If the function returns `False` at a node, the
 *     subtree rooted at that node will not be traversed.
 */
export function visit(
  root: ModuleNode,
  visitor: (node: ModuleNode) => boolean | void,
) {
  function traverse(node: ModuleNode) {
    const traverse_subtree = visitor(node);
    if (traverse_subtree === false || node instanceof PrimitiveNode) return;
    for (const child of node.children()) {
      // Force unbroken subtree of `Node`s, only allowing regular `Module`s as leaves.
      if (child instanceof PrimitiveNode || child instanceof ContainerNode) {
        traverse(child);
      }
    }
  }

  traverse(root);
}
