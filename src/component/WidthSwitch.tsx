import type { JSX } from 'react';
import { useEffect, useState } from "react";

export default function WidthSwitch(
  { breakpoint, children }: { breakpoint?: number, children: JSX.Element[] }
) {
  const [Wide, Narrow] = children;
  const [width, setWidth] = useState<number>(window.innerWidth);
  
  useEffect(() => {
    const updateWidth = () => setWidth(window.innerWidth);
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  return width > (breakpoint || 600) ? Wide : Narrow;
}