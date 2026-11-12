import { useRef } from 'react';

/** An entry in the parameter library: the export's own parameters, an epoch preset, or an upload. */
export interface ParameterEntry {
  id: string;
  name: string;
  source: 'export' | 'preset' | 'upload';
  url?: string;  // For the export's own parameters and presets (fetched by the worker).
  text?: string;  // For uploads (file contents).
  status: 'idle' | 'loading' | 'error';
  error?: string;
}

const SOURCE_LABELS: Record<ParameterEntry['source'], string> = {
  export: 'Exported',
  preset: 'Saved epochs',
  upload: 'Uploaded',
};

export function Parameters({
  entries,
  active,
  disabled,
  onSelect,
  onUpload,
  onRemove,
}: {
  entries: ParameterEntry[];
  active: string | null;
  disabled: boolean;
  onSelect: (entry: ParameterEntry) => void;
  onUpload: (files: File[]) => void;
  onRemove: (entry: ParameterEntry) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const groups = (['export', 'upload', 'preset'] as const)
    .map(source => [source, entries.filter(e => e.source === source)] as const)
    .filter(([, group]) => group.length > 0);

  return (
    <section className="parameters">
      <div className="parameters-header">
        <h2>Parameters</h2>
        <button className="small" onClick={() => input.current?.click()} disabled={disabled}>Upload…</button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={event => {
            onUpload(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </div>
      <p className="hint">Click to swap in mid-run (no reset). Uploads: <code>state_dict.json</code> files for this architecture.</p>
      {groups.map(([source, group]) => (
        <div key={source}>
          <h3>{SOURCE_LABELS[source]}</h3>
          <ul className="parameter-list">
            {group.map(entry => (
              <li key={entry.id} className={entry.id === active ? 'active' : ''}>
                <button
                  className="parameter"
                  onClick={() => onSelect(entry)}
                  disabled={disabled || entry.status === 'loading'}
                  title={entry.error ?? entry.name}
                >
                  <span className="parameter-name">{entry.name}</span>
                  <span className="parameter-status">
                    {entry.status === 'loading' ? '…' : entry.status === 'error' ? '⚠' : entry.id === active ? '●' : ''}
                  </span>
                </button>
                {entry.source === 'upload' && (
                  <button className="remove" onClick={() => onRemove(entry)} title="Remove from list">×</button>
                )}
                {entry.status === 'error' && <div className="parameter-error">{entry.error}</div>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
