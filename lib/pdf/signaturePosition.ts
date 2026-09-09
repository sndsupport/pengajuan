export type SignaturePositionPx = { x: number; y: number; width: number; height: number };

export function clampSignaturePosition(
  position: SignaturePositionPx,
  canvasWidthPx: number,
  canvasHeightPx: number
): SignaturePositionPx {
  const maxX = Math.max(0, canvasWidthPx - position.width);
  const maxY = Math.max(0, canvasHeightPx - position.height);
  return {
    x: Math.min(Math.max(position.x, 0), maxX),
    y: Math.min(Math.max(position.y, 0), maxY),
    width: position.width,
    height: position.height,
  };
}
