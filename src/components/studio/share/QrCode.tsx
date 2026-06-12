import { useMemo } from 'react';
import { makeQrMatrix } from './qr';

/**
 * QrCode — renders a self-contained QR code as inline SVG (no external deps,
 * no network). Falls back to nothing if encoding fails (e.g. payload too long).
 */
export function QrCode({ value, size = 92 }: { value: string; size?: number }) {
  const matrix = useMemo(() => {
    try {
      return makeQrMatrix(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) return null;

  const n = matrix.length;
  const quiet = 2; // quiet-zone modules
  const dim = n + quiet * 2;

  const rects: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        rects.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      role="img"
      aria-label="QR code for the share link"
      shapeRendering="crispEdges"
    >
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={rects.join('')} fill="#0b0b10" />
    </svg>
  );
}
