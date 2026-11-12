import { ReactNode } from 'react';

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox='0 0 16 16'
    width={16}
    height={16}
    fill='none'
    stroke='currentColor'
    strokeWidth={1.3}
    strokeLinejoin='round'
    strokeLinecap='round'
    aria-hidden
    style={{ display: 'block', flexShrink: 0 }}
  >
    {children}
  </svg>
);

const CUBE = 'M8 1.5 14 4.7v6.6L8 14.5 2 11.3V4.7Z M2 4.7 8 8l6-3.3 M8 8v6.5';

export const ObjectModeIcon = () => <Icon><path d={CUBE} fill='currentColor' fillOpacity={0.25} /></Icon>;

export const EditModeIcon = () => (
  <Icon>
    <path d={CUBE} strokeWidth={0.9} />
    {[[8, 1.5], [14, 4.7], [14, 11.3], [8, 14.5], [2, 11.3], [2, 4.7], [8, 8]].map(([x, y]) => (
      <rect key={`${x},${y}`} x={x - 1.2} y={y - 1.2} width={2.4} height={2.4} fill='currentColor' stroke='none' />
    ))}
  </Icon>
);

export const VertexModeIcon = () => (
  <Icon>
    <path d='M3 13V5.5L10.5 3' strokeWidth={0.9} opacity={0.6} />
    <rect x={1.2} y={1.2} width={4} height={4} fill='currentColor' stroke='none' transform='translate(1.3 1.8)' />
  </Icon>
);

export const LineModeIcon = () => (
  <Icon>
    <path d='M3 13 13 3' strokeWidth={2.4} />
    <path d='M3 13h10V3' strokeWidth={0.9} opacity={0.6} />
  </Icon>
);

export const FaceModeIcon = () => <Icon><path d='M3 3h10v10H3Z' fill='currentColor' fillOpacity={0.75} /></Icon>;

export const CameraIcon = () => (
  <Icon>
    <rect x={1.5} y={4.5} width={9} height={7.5} rx={1} />
    <path d='M10.5 7.2 14.5 5v6.5l-4-2.2' />
  </Icon>
);

export const OverlaysIcon = () => (
  <Icon>
    <circle cx={6} cy={8} r={4.2} />
    <circle cx={10} cy={8} r={4.2} />
  </Icon>
);

export const XRayIcon = () => (
  <Icon>
    <rect x={2} y={2} width={8.5} height={8.5} fill='currentColor' fillOpacity={0.3} />
    <rect x={5.5} y={5.5} width={8.5} height={8.5} strokeDasharray='1.6 1.4' />
  </Icon>
);

export const PlayIcon = () => <Icon><path d='M4 2.5 13 8l-9 5.5Z' fill='currentColor' /></Icon>;

export const PauseIcon = () => (
  <Icon>
    <rect x={3.5} y={2.5} width={3} height={11} fill='currentColor' stroke='none' />
    <rect x={9.5} y={2.5} width={3} height={11} fill='currentColor' stroke='none' />
  </Icon>
);

export const InsertKeyIcon = () => <Icon><path d='M8 2 14 8l-6 6-6-6Z' fill='currentColor' /></Icon>;

export const DeleteKeyIcon = () => (
  <Icon>
    <path d='M8 2 14 8l-6 6-6-6Z' />
    <path d='M2 2 14 14' />
  </Icon>
);

export const WorldIcon = () => (
  <Icon>
    <circle cx={8} cy={8} r={6.2} />
    <ellipse cx={8} cy={8} rx={2.6} ry={6.2} />
    <path d='M2 8h12' />
  </Icon>
);

export const VertexIcon = () => <Icon><rect x={5.5} y={5.5} width={5} height={5} fill='currentColor' stroke='none' /></Icon>;
export const PlaneIcon = () => <Icon><path d='M5 4h9l-3 8H2Z' fill='currentColor' fillOpacity={0.25} /></Icon>;
export const CircleIcon = () => <Icon><circle cx={8} cy={8} r={5.8} /></Icon>;
export const TorusIcon = () => (
  <Icon>
    <ellipse cx={8} cy={8} rx={6.5} ry={4.6} fill='currentColor' fillOpacity={0.25} />
    <ellipse cx={8} cy={8} rx={2.6} ry={1.4} />
  </Icon>
);
export const EllipsoidIcon = () => (
  <Icon>
    <path d='M5.5 3.2a2.6 2.6 0 0 1 5 0l1.3 9.4a2.6 2.6 0 0 1-7.6 0Z' transform='rotate(35 8 8)' fill='currentColor' fillOpacity={0.25} />
  </Icon>
);
export const MeshIcon = () => <Icon><path d='M2.5 12.5 6 3.5h7.5L10 12.5Z M6 3.5 10 12.5' fill='currentColor' fillOpacity={0.2} /></Icon>;

const BONE = 'M3 13 5.2 7.6 13 3 8.4 10.8Z M3 13 13 3';

export const BoneIcon = () => <Icon><path d={BONE} fill='currentColor' fillOpacity={0.25} /></Icon>;

export const PoseModeIcon = () => (
  <Icon>
    <path d='M2.5 13.5 7 8.5l6.5-1' />
    <circle cx={7} cy={8.5} r={1.7} fill='currentColor' stroke='none' />
    <path d='M11 2.5a3 3 0 0 1 2.5 3' />
  </Icon>
);

export const WeightModeIcon = () => (
  <Icon>
    <path d='M10 2.5 13.5 6 7.5 12H4v-3.500Z' fill='currentColor' fillOpacity={0.3} />
    <path d='M4 14.500h9' />
  </Icon>
);

export const ConnectedIcon = () => (
  <Icon>
    <circle cx={3.5} cy={12.5} r={1.8} fill='currentColor' stroke='none' />
    <circle cx={8} cy={5} r={1.8} fill='currentColor' stroke='none' />
    <circle cx={12.5} cy={12.5} r={1.8} fill='currentColor' stroke='none' />
    <path d='M3.500 12.500 8 5l4.500 7.500' />
  </Icon>
);

export const RenderIcon = () => (
  <Icon>
    <rect x={2} y={3.500} width={12} height={9} rx={1} />
    <path d='M5 3.500v9 M11 3.500v9 M2 6.500h3 M2 9.500h3 M11 6.500h3 M11 9.500h3' strokeWidth={0.9} />
  </Icon>
);

export const SelectableIcon = () => <Icon><path d='M4 2.500 12 9l-3.600.4L10.500 13.500 8.800 14.300 6.900 10.200 4 12.500Z' fill='currentColor' fillOpacity={0.3} /></Icon>;

export const ProportionalIcon = () => (
  <Icon>
    <circle cx={8} cy={8} r={6.2} strokeDasharray='1.8 1.6' />
    <circle cx={8} cy={8} r={2} fill='currentColor' stroke='none' />
  </Icon>
);
