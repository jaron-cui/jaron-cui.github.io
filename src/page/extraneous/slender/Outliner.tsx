import { Fragment, PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeSlash, FolderFill, FolderPlus, X } from 'react-bootstrap-icons';
import { Bone } from './armature';
import { EditorDocument, Folder, OutlinerItem, SceneObject } from './document';
import { BoneIcon, CameraIcon, EditModeIcon, MeshIcon, PoseModeIcon, SelectableIcon } from './icons';

const INDENT = 14;
const DRAG_THRESHOLD = 5;
const ROOT_DROP = '';

type OutlinerProps = {
  document: EditorDocument;
  onPick: (id: string, additive: boolean) => void;
  onPickBone: (armature: string, bone: string, additive: boolean) => void;
  onRenameBone: (id: string, name: string) => void;
  onRenameObject: (id: string, name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onToggleObject: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onToggleObjectSelectable: (id: string) => void;
  onToggleFolderSelectable: (id: string) => void;
  onAddFolder: () => void;
  onDeleteFolder: (id: string) => void;
  onMove: (items: OutlinerItem[], folder: string | null) => void;
};

type Dragging = { items: OutlinerItem[]; label: string; x: number; y: number; over: string | null };

function byName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function folderUnderPointer(x: number, y: number): string | null {
  const element = window.document.elementFromPoint(x, y)?.closest('[data-drop-folder]');
  return element ? element.getAttribute('data-drop-folder') : null;
}

// The document's folders and objects, sorted by name. Click selects, Ctrl or Shift click toggles,
// double click renames, and dragging moves items in and out of folders.
export const Outliner = ({
  document, onPick, onPickBone, onRenameBone, onRenameObject, onRenameFolder, onToggleObject, onToggleFolder, onToggleObjectSelectable, onToggleFolderSelectable, onAddFolder, onDeleteFolder, onMove,
}: OutlinerProps) => {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const documentRef = useRef(document);
  documentRef.current = document;

  const beginDrag = (event: ReactPointerEvent, item: OutlinerItem, label: string) => {
    if (event.button !== 0 || renaming === item.id) {
      return;
    }
    const [startX, startY] = [event.clientX, event.clientY];
    let active: Dragging | null = null;
    const onMovePointer = (move: PointerEvent) => {
      if (!active && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) {
        return;
      }
      // Dragging a selected object carries the whole selection.
      const { selectedObjects } = documentRef.current;
      const items: OutlinerItem[] = item.kind === 'object' && selectedObjects.includes(item.id)
        ? selectedObjects.map(id => ({ kind: 'object', id }))
        : [item];
      const count = items.length > 1 ? `${items.length} objects` : label;
      active = { items, label: count, x: move.clientX, y: move.clientY, over: folderUnderPointer(move.clientX, move.clientY) };
      setDragging(active);
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMovePointer);
      window.removeEventListener('pointerup', finish);
      if (active && active.over !== null) {
        onMove(active.items, active.over === ROOT_DROP ? null : active.over);
      }
      setDragging(null);
    };
    window.addEventListener('pointermove', onMovePointer);
    window.addEventListener('pointerup', finish);
  };

  const renameInput = (id: string, name: string, onRename: (id: string, name: string) => void) => (
    <input
      autoFocus
      type='text'
      aria-label={`Rename ${name}`}
      defaultValue={name}
      onFocus={event => event.target.select()}
      onBlur={event => {
        onRename(id, event.target.value);
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

  const visibilityButton = (name: string, visible: boolean, onToggle: () => void) => (
    <button
      data-testid='visibility'
      aria-label={`${visible ? 'Hide' : 'Show'} ${name}`}
      aria-pressed={!visible}
      onPointerDown={event => event.stopPropagation()}
      onClick={onToggle}
      className='slender-icon-button'
    >
      {visible ? <Eye size={13} /> : <EyeSlash size={13} style={{ opacity: 0.5 }} />}
    </button>
  );

  const selectableButton = (name: string, unselectable: boolean | undefined, onToggle: () => void) => (
    <button
      data-testid='selectable'
      aria-label={`${unselectable ? 'Allow selecting' : 'Disable selecting'} ${name}`}
      title={unselectable ? 'Selecting in the viewport is off' : 'Selecting in the viewport is on'}
      aria-pressed={Boolean(unselectable)}
      onPointerDown={event => event.stopPropagation()}
      onClick={onToggle}
      className='slender-icon-button'
      style={{ opacity: unselectable ? 0.3 : 0.8 }}
    >
      <SelectableIcon />
    </button>
  );

  const renderObject = (object: SceneObject, depth: number) => {
    const { id, name, vertices, camera, bones, parent, visible } = object;
    const isSelected = document.selectedObjects.includes(id);
    const isActive = document.activeObject === id;
    const parentName = document.objects.find(other => other.id === parent)?.name
      ?? document.objects.flatMap(other => other.bones ?? []).find(other => other.id === parent)?.name;
    return (
      <Fragment key={id}>
      <div
        role='treeitem'
        aria-selected={isSelected}
        data-testid='outliner-item'
        className='slender-row'
        data-drop-folder={object.folder ?? ROOT_DROP}
        onPointerDown={event => {
          if (event.button === 0 && renaming !== id) {
            onPick(id, event.ctrlKey || event.shiftKey);
          }
          beginDrag(event, { kind: 'object', id }, name);
        }}
        onDoubleClick={() => setRenaming(id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: `2px 6px 2px ${10 + depth * INDENT}px`,
          background: isSelected ? '#3a4560' : undefined,
          color: isActive ? '#ffc06a' : 'inherit',
          opacity: visible ? 1 : 0.55,
        }}
      >
        {renaming === id ? renameInput(id, name, onRenameObject) : (
          <>
            <span title={camera ? 'Camera' : bones ? `Armature, ${bones.length} bones` : `Mesh, ${vertices.length} vertices`} style={{ color: camera ? '#8fd18f' : bones ? '#8fc8e8' : '#e0a060' }}>
              {camera ? <CameraIcon /> : bones ? (isActive && document.mode === 'pose' ? <PoseModeIcon /> : <BoneIcon />) : isActive && document.mode === 'edit' ? <EditModeIcon /> : <MeshIcon />}
            </span>
            <span data-testid='item-name' style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            {parentName && <span title={`Parent: ${parentName}`} style={{ opacity: 0.5, fontSize: 11, whiteSpace: 'nowrap' }}>↳ {parentName}</span>}
            {selectableButton(name, object.unselectable, () => onToggleObjectSelectable(id))}
            {visibilityButton(name, visible, () => onToggleObject(id))}
          </>
        )}
      </div>
      {bones && renderBones(object, null, depth + 1)}
      </Fragment>
    );
  };

  // An armature's bones, nested by parent under it.
  const renderBones = (armature: SceneObject, parent: string | null, depth: number): JSX.Element[] => byName((armature.bones ?? []).filter(bone => bone.parent === parent)).map((bone: Bone) => (
    <Fragment key={bone.id}>
      <div
        role='treeitem'
        aria-selected={document.selectedBones.includes(bone.id)}
        data-testid='outliner-bone'
        className='slender-row'
        onPointerDown={event => {
          if (event.button === 0 && renaming !== bone.id) {
            onPickBone(armature.id, bone.id, event.ctrlKey || event.shiftKey);
          }
        }}
        onDoubleClick={() => setRenaming(bone.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: `2px 6px 2px ${10 + depth * INDENT}px`,
          background: document.selectedBones.includes(bone.id) ? '#3a4560' : undefined,
          color: document.activeBone === bone.id ? '#8fdcff' : 'inherit',
        }}
      >
        {renaming === bone.id ? renameInput(bone.id, bone.name, onRenameBone) : (
          <>
            <BoneIcon />
            <span data-testid='item-name' style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bone.name}</span>
          </>
        )}
      </div>
      {renderBones(armature, bone.id, depth + 1)}
    </Fragment>
  ));

  const renderFolder = (folder: Folder, depth: number) => {
    const { id, name, visible } = folder;
    const isCollapsed = collapsed.includes(id);
    return (
      <div key={id} role='group'>
        <div
          role='treeitem'
          aria-expanded={!isCollapsed}
          data-testid='outliner-folder'
          className='slender-row'
          data-drop-folder={id}
          onPointerDown={event => beginDrag(event, { kind: 'folder', id }, name)}
          onDoubleClick={() => setRenaming(id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: `2px 6px 2px ${10 + depth * INDENT}px`,
            background: dragging?.over === id ? '#2f5f94' : undefined,
            opacity: visible ? 1 : 0.55,
          }}
        >
          <button
            aria-label={isCollapsed ? `Expand ${name}` : `Collapse ${name}`}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => setCollapsed(isCollapsed ? collapsed.filter(other => other !== id) : [...collapsed, id])}
            className='slender-icon-button'
          >
            {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          </button>
          <FolderFill size={12} style={{ color: '#d8b870', flexShrink: 0 }} />
          {renaming === id ? renameInput(id, name, onRenameFolder) : (
            <>
              <span data-testid='item-name' style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <button
                aria-label={`Delete folder ${name}, keeping its contents`}
                title='Delete folder, keeping its contents'
                onPointerDown={event => event.stopPropagation()}
                onClick={() => onDeleteFolder(id)}
                className='slender-icon-button'
              >
                <X size={14} />
              </button>
              {selectableButton(name, folder.unselectable, () => onToggleFolderSelectable(id))}
              {visibilityButton(name, visible, () => onToggleFolder(id))}
            </>
          )}
        </div>
        {!isCollapsed && renderLevel(id, depth + 1)}
      </div>
    );
  };

  const renderLevel = (parent: string | null, depth: number): JSX.Element[] => [
    ...byName(document.folders.filter(folder => folder.parent === parent)).map(folder => renderFolder(folder, depth)),
    ...byName(document.objects.filter(object => object.folder === parent)).map(object => renderObject(object, depth)),
  ];

  return (
    <div
      role='tree'
      aria-label='Outliner'
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#1c1f27', userSelect: 'none' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 10px', borderBottom: '1px solid #2a2e39' }}>
        <span style={{ opacity: 0.7 }}>Outliner</span>
        <button aria-label='New folder' title='New folder' onClick={onAddFolder} className='slender-icon-button'><FolderPlus size={15} /></button>
      </div>
      <div
        data-testid='outliner-root'
        data-drop-folder={ROOT_DROP}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: dragging?.over === ROOT_DROP ? '#232a38' : 'transparent' }}
      >
        {renderLevel(null, 0)}
      </div>
      {dragging && (
        <div style={{ position: 'fixed', left: dragging.x + 12, top: dragging.y + 8, background: '#262a35', border: '1px solid #4a5060', borderRadius: 3, padding: '1px 6px', pointerEvents: 'none', fontSize: 13 }}>
          {dragging.label}
        </div>
      )}
    </div>
  );
};
