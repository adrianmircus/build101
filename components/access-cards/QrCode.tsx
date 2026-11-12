import { encodeQr, qrPathData, qrViewSize } from "@/lib/client/qr";

// The QR of a card, drawn as an SVG in the browser (lib/client/qr.ts). It is decorative for a screen reader: the
// card prints the same data as text next to it. The text it encodes (with the card token) is never written out.

export function QrCode({ value, className, quietZone = 1 }: { value: string; className?: string; quietZone?: number }) {
  const matrix = encodeQr(value);
  const side = qrViewSize(matrix, quietZone);
  return (
    <svg viewBox={`0 0 ${side} ${side}`} className={className} aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <path fill="#ffffff" d={`M0 0h${side}v${side}H0z`} />
      <path fill="#0f172a" d={qrPathData(matrix, quietZone)} />
    </svg>
  );
}
