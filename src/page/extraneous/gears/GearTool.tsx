// The gears page: one section per kind of gear, each generating a profile from its parameters and
// showing it as a dimensioned drawing on a 10 mm grid, with SVG export.
import type { JSX } from 'react';
import { DEFAULT_FONT, DEFAULT_MARGIN } from '../../../util/styles';
import { MUTED } from './drawing';
import SpurSection from './SpurSection';

const SECTIONS = [
  { id: 'spur', title: 'Spur gear', Section: SpurSection },
];

export default function GearTool(): JSX.Element {
  return (
    <div style={{ ...DEFAULT_FONT, ...DEFAULT_MARGIN }}>
      <h4>Gear generators</h4>
      <p style={{ color: MUTED, maxWidth: 760, marginBottom: 8 }}>
        Exact involute profiles from standard parameters, drawn to scale on a 10 mm grid.
      </p>
      {SECTIONS.length > 1 && (
        // The site routes on the hash, so these scroll instead of linking to #ids.
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 28 }}>
          {SECTIONS.map(({ id, title }) => (
            <a key={id} href={`#/gears`} onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }}>
              {title}
            </a>
          ))}
        </div>
      )}
      {SECTIONS.map(({ id, Section }) => <Section key={id}/>)}
    </div>
  );
}
