import { ViewportSize } from '../types/index.js';

export const DEFAULT_VIEWPORTS: ViewportSize[] = [
  { width: 320, height: 568, name: 'iPhone SE' },
  { width: 375, height: 667, name: 'iPhone 8' },
  { width: 390, height: 844, name: 'iPhone 14' },
  { width: 480, height: 854, name: 'Mobile Large' },
  { width: 640, height: 960, name: 'sm (Tailwind)' },
  { width: 768, height: 1024, name: 'md (Tailwind)' },
  { width: 1024, height: 768, name: 'lg (Tailwind)' },
  { width: 1280, height: 800, name: 'xl (Tailwind)' },
  { width: 1536, height: 864, name: '2xl (Tailwind)' },
];

export const TAILWIND_BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export function getTailwindBreakpoint(width: number): string {
  if (width < 640) return 'default (mobile)';
  if (width < 768) return 'sm';
  if (width < 1024) return 'md';
  if (width < 1280) return 'lg';
  if (width < 1536) return 'xl';
  return '2xl';
}
