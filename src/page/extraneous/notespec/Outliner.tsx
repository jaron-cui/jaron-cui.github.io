// Tracks and folders, in lane order. Click a track to make it active, double click to rename, drag to
// move: onto a folder puts an item inside it, onto a track puts it just before that track, onto the
// empty space below goes to the end. Each row has solo, mute and hide, which a folder passes down.
import type { JSX } from 'react';
import { PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, Eye, EyeSlash, FolderFill, FolderPlus, Headphones, MusicNoteBeamed, Plus, VolumeMuteFill, VolumeUpFill, X,
} from 'react-bootstrap-icons';
import { Drop } from './editing';
import { Score, TreeNode, Visibility } from './score';

const INDENT = 14;
const DRAG_THRESHOLD = 5;
const ROOT = 'root';

export type ItemKind = 'track' | 'folder';

type OutlinerProps = {
  score: Score;
  activeTrack: string;
  onActivate: (track: string) => void;
  onToggle: (kind: ItemKind, id: string, flag: keyof Visibility) => void;
  onRename: (kind: ItemKind, id: string, name: string) => void;
  onDelete: (kind: ItemKind, id: string) => void;
  onAddTrack: () => void;
  onAddFolder: () => void;
  onMove: (id: string, drop: Drop) => void;
};

type Dragging = { id: string; label: string; x: number; y: number; target: string | null };

// The drop target under the pointer, as `into:<id>`, `before:<id>` or `root`.
function targetUnderPointer(x: number, y: number): string | null {
  return document.elementFromPoint(x, y)?.closest('[data-drop]')?.getAttribute('data-drop') ?? null;
}

function dropOf(target: string): Drop {
  if (target === ROOT) {
    return { root: true };
  }
  const [kind, id] = target.split(':');
  return kind === 'into' ? { into: id } : { before: id };
}

export const Outliner = ({ score, activeTrack, onActivate, onToggle, onRename, onDelete, onAddTrack, onAddFolder, onMove }: OutlinerProps) => {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const draggingRef = useRef<Dragging | null>(null);

  const beginDrag = (event: ReactPointerEvent, id: string, label: string) => {
    if (event.button !== 0 || renaming === id) {
      return;
    }
    const [startX, startY] = [event.clientX, event.clientY];
    const onMovePointer = (move: PointerEvent) => {
      if (!draggingRef.current && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) {
        return;
      }
      draggingRef.current = { id, label, x: move.clientX, y: move.clientY, target: targetUnderPointer(move.clientX, move.clientY) };
      setDragging(draggingRef.current);
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMovePointer);
      window.removeEventListener('pointerup', finish);
      const active = draggingRef.current;
      draggingRef.current = null;
      setDragging(null);
      if (active?.target) {
        onMove(active.id, dropOf(active.target));
      }
    };
    window.addEventListener('pointermove', onMovePointer);
    window.addEventListener('pointerup', finish);
  };

  const renameInput = (kind: ItemKind, id: string, name: string) => (
    <input
      autoFocus
      type='text'
      aria-label={`Rename ${name}`}
      defaultValue={name}
      onFocus={event => event.target.select()}
      onBlur={event => {
        onRename(kind, id, event.target.value.trim() || name);
        setRenaming(null);
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setRenaming(null);
        }
      }}
      style={{ flex: 1, width: '100%', minWidth: 0 }}
    />
  );

  const toggles = (kind: ItemKind, id: string, name: string, item: Visibility) => (
    <>
      <button
        aria-label={`${item.solo ? 'Unsolo' : 'Solo'} ${name}`}
        aria-pressed={item.solo}
        title='Solo: only soloed tracks sound'
        className='notespec-icon-button'
        style={{ color: item.solo ? '#ffc06a' : undefined, opacity: item.solo ? 1 : 0.45 }}
        onPointerDown={event => event.stopPropagation()}
        onClick={() => onToggle(kind, id, 'solo')}
      >
        <Headphones size={13} />
      </button>
      <button
        aria-label={`${item.muted ? 'Unmute' : 'Mute'} ${name}`}
        aria-pressed={item.muted}
        title='Mute'
        className='notespec-icon-button'
        onPointerDown={event => event.stopPropagation()}
        onClick={() => onToggle(kind, id, 'muted')}
      >
        {item.muted ? <VolumeMuteFill size={13} style={{ opacity: 0.5 }} /> : <VolumeUpFill size={13} />}
      </button>
      <button
        aria-label={`${item.hidden ? 'Show' : 'Hide'} ${name}`}
        aria-pressed={item.hidden}
        title='Hide the lane'
        className='notespec-icon-button'
        onPointerDown={event => event.stopPropagation()}
        onClick={() => onToggle(kind, id, 'hidden')}
      >
        {item.hidden ? <EyeSlash size={13} style={{ opacity: 0.5 }} /> : <Eye size={13} />}
      </button>
    </>
  );

  const deleteButton = (kind: ItemKind, id: string, name: string) => (
    <button
      aria-label={kind === 'folder' ? `Delete folder ${name}, keeping its contents` : `Delete track ${name}`}
      title={kind === 'folder' ? 'Delete folder, keeping its contents' : 'Delete track'}
      className='notespec-icon-button'
      onPointerDown={event => event.stopPropagation()}
      onClick={() => onDelete(kind, id)}
    >
      <X size={14} />
    </button>
  );

  const rowStyle = (depth: number, highlighted: boolean, dim: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: `2px 6px 2px ${10 + depth * INDENT}px`,
    background: highlighted ? '#2f5f94' : undefined,
    opacity: dim ? 0.55 : 1,
  });

  const renderNode = (node: TreeNode, depth: number): JSX.Element | null => {
    if (node.kind === 'track') {
      const track = score.tracks[node.id];
      if (!track) {
        return null;
      }
      const active = track.id === activeTrack;
      return (
        <div
          key={track.id}
          role='treeitem'
          aria-selected={active}
          data-testid='outliner-track'
          data-drop={`before:${track.id}`}
          className='notespec-row'
          onPointerDown={event => {
            if (event.button === 0 && renaming !== track.id) {
              onActivate(track.id);
            }
            beginDrag(event, track.id, track.name);
          }}
          onDoubleClick={() => setRenaming(track.id)}
          style={{
            ...rowStyle(depth, false, track.hidden),
            color: active ? '#ffc06a' : 'inherit',
            background: active ? '#3a4560' : undefined,
            // Dropping here puts the dragged item just above this track.
            boxShadow: dragging?.target === `before:${track.id}` ? 'inset 0 2px 0 #5aa9ff' : undefined,
          }}
        >
          <MusicNoteBeamed size={12} style={{ flexShrink: 0, color: '#8fc8e8' }} />
          {renaming === track.id ? renameInput('track', track.id, track.name) : (
            <>
              <span data-testid='item-name' style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</span>
              {toggles('track', track.id, track.name, track)}
              {deleteButton('track', track.id, track.name)}
            </>
          )}
        </div>
      );
    }
    const folder = score.folders[node.id];
    if (!folder) {
      return null;
    }
    const isCollapsed = collapsed.includes(folder.id);
    return (
      <div key={folder.id} role='group'>
        <div
          role='treeitem'
          aria-expanded={!isCollapsed}
          data-testid='outliner-folder'
          data-drop={`into:${folder.id}`}
          className='notespec-row'
          onPointerDown={event => beginDrag(event, folder.id, folder.name)}
          onDoubleClick={() => setRenaming(folder.id)}
          style={rowStyle(depth, dragging?.target === `into:${folder.id}`, folder.hidden)}
        >
          <button
            aria-label={isCollapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`}
            className='notespec-icon-button'
            onPointerDown={event => event.stopPropagation()}
            onClick={() => setCollapsed(isCollapsed ? collapsed.filter(other => other !== folder.id) : [...collapsed, folder.id])}
          >
            {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          </button>
          <FolderFill size={12} style={{ color: '#d8b870', flexShrink: 0 }} />
          {renaming === folder.id ? renameInput('folder', folder.id, folder.name) : (
            <>
              <span data-testid='item-name' style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</span>
              {toggles('folder', folder.id, folder.name, folder)}
              {deleteButton('folder', folder.id, folder.name)}
            </>
          )}
        </div>
        {!isCollapsed && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div role='tree' aria-label='Outliner' style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderBottom: '1px solid #2a2e39' }}>
        <span style={{ flex: 1, opacity: 0.7 }}>Outliner</span>
        <button aria-label='New track' title='New track' onClick={onAddTrack} className='notespec-icon-button'><Plus size={16} /></button>
        <button aria-label='New folder' title='New folder' onClick={onAddFolder} className='notespec-icon-button'><FolderPlus size={15} /></button>
      </div>
      <div
        data-testid='outliner-root'
        data-drop={ROOT}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: dragging?.target === ROOT ? '#232a38' : 'transparent' }}
      >
        {score.tree.map(node => renderNode(node, 0))}
      </div>
      {dragging && (
        <div style={{ position: 'fixed', left: dragging.x + 12, top: dragging.y + 8, background: '#262a35', border: '1px solid #4a5060', borderRadius: 3, padding: '1px 6px', pointerEvents: 'none', fontSize: 13 }}>
          {dragging.label}
        </div>
      )}
    </div>
  );
};
