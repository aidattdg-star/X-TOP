import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from "reactflow";
import { X } from "lucide-react";

export function DeletableEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style } = props;
  const { setEdges } = useReactFlow();
  const [hover, setHover] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const active = hover || selected;

  return (
    <>
      {/* visible edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: active ? "oklch(0.45 0.01 90)" : "oklch(0.7 0.005 90)",
          strokeWidth: active ? 2 : 1.5,
          transition: "stroke 120ms, stroke-width 120ms",
          ...style,
        }}
      />
      {/* invisible wide hit area for easy hovering / clicking */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <button
            type="button"
            aria-label="Remover ligação"
            onClick={(e) => {
              e.stopPropagation();
              setEdges((es) => es.filter((edge) => edge.id !== id));
            }}
            className={`h-5 w-5 rounded-full bg-foreground text-background flex items-center justify-center shadow-md transition-opacity ${
              active ? "opacity-100" : "opacity-0"
            } hover:scale-110`}
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = { deletable: DeletableEdge };
