import { Rect, Shape } from 'react-konva';
import { adaptiveGrid, visibleWorld } from '@/app/canvas/viewport';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { canvasColors } from '@/styles/tokens';

/** Drafting-paper background with an adaptive grid, drawn in one Shape for speed. */
export function GridLayer() {
  const viewport = useUiStore((s) => s.viewport);
  const size = useUiStore((s) => s.canvasSize);
  const gridSize = useProjectStore((s) => s.project?.settings.gridSize ?? 152.4);
  const showGrid = useProjectStore((s) => s.project?.settings.showGrid ?? true);
  const vis = visibleWorld(viewport, size);
  const [minor, major] = adaptiveGrid(gridSize, viewport.scale);
  return (
    <>
      <Rect x={vis.minX} y={vis.minY} width={vis.maxX - vis.minX} height={vis.maxY - vis.minY} fill={canvasColors.paper} listening={false} />
      {showGrid && (
        <Shape
          listening={false}
          perfectDrawEnabled={false}
          sceneFunc={(ctx) => {
            const lw = 1 / viewport.scale;
            const draw = (step: number, color: string, skipMajor: boolean) => {
              ctx.beginPath();
              const x0 = Math.floor(vis.minX / step) * step;
              const y0 = Math.floor(vis.minY / step) * step;
              for (let x = x0; x <= vis.maxX; x += step) {
                if (skipMajor && Math.abs(x / major - Math.round(x / major)) < 1e-6) continue;
                ctx.moveTo(x, vis.minY);
                ctx.lineTo(x, vis.maxY);
              }
              for (let y = y0; y <= vis.maxY; y += step) {
                if (skipMajor && Math.abs(y / major - Math.round(y / major)) < 1e-6) continue;
                ctx.moveTo(vis.minX, y);
                ctx.lineTo(vis.maxX, y);
              }
              ctx.strokeStyle = color;
              ctx.lineWidth = lw;
              ctx.stroke();
            };
            draw(minor, canvasColors.gridMinor, true);
            if (major * viewport.scale >= 24) draw(major, canvasColors.gridMajor, false);
          }}
        />
      )}
    </>
  );
}
