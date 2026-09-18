"use client";

const RADIUS = 4;

type ShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  value?: number;
};

/**
 * Recharts hands custom shapes raw geometry, which carries a negative width or
 * height for bars below the baseline — its built-in Rectangle normalises that
 * internally. Normalising here is what keeps loss bars from vanishing.
 */
function normalise({ x = 0, y = 0, width = 0, height = 0 }: ShapeProps) {
  return {
    x: width < 0 ? x + width : x,
    y: height < 0 ? y + height : y,
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

function isPositive(value: number | undefined, rawExtent: number): boolean {
  if (typeof value === "number") return value >= 0;
  return rawExtent >= 0;
}

function clamp(extent: number): number {
  return Math.max(0, Math.min(RADIUS, extent / 2));
}

/** Rounds only the data end; the baseline end stays square and anchored. */
export function VerticalRoundedBar(props: ShapeProps) {
  const { x, y, width, height } = normalise(props);
  if (width <= 0 || height <= 0) return null;

  const up = isPositive(props.value, props.height ?? 0);
  const r = clamp(Math.min(width, height));

  const path = up
    ? `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y}
       L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r}
       L${x + width},${y + height} Z`
    : `M${x},${y} L${x},${y + height - r} Q${x},${y + height} ${x + r},${y + height}
       L${x + width - r},${y + height} Q${x + width},${y + height} ${x + width},${y + height - r}
       L${x + width},${y} Z`;

  return <path d={path} fill={props.fill} />;
}

export function HorizontalRoundedBar(props: ShapeProps) {
  const { x, y, width, height } = normalise(props);
  if (width <= 0 || height <= 0) return null;

  const right = isPositive(props.value, props.width ?? 0);
  const r = clamp(Math.min(width, height));

  const path = right
    ? `M${x},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r}
       L${x + width},${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height}
       L${x},${y + height} Z`
    : `M${x + width},${y} L${x + r},${y} Q${x},${y} ${x},${y + r}
       L${x},${y + height - r} Q${x},${y + height} ${x + r},${y + height}
       L${x + width},${y + height} Z`;

  return <path d={path} fill={props.fill} />;
}
