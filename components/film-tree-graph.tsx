"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { GraphNode, GraphLink } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false
});

const imageCache = new Map<string, HTMLImageElement>();
const IMAGE_BASE = "https://image.tmdb.org/t/p/w185";

type Props = {
  nodes: GraphNode[];
  links: GraphLink[];
  onMovieClick: (movieId: number) => void;
};

function loadImage(src: string) {
  const cached = imageCache.get(src);
  if (cached) return cached;

  const img = new Image();
  img.src = src;
  img.crossOrigin = "anonymous";
  imageCache.set(src, img);
  return img;
}

export function FilmTreeGraph({ nodes, links, onMovieClick }: Props) {
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  return (
    <div className="h-[68vh] w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80">
      <ForceGraph2D
        graphData={graphData}
        nodeRelSize={6}
        linkWidth={1}
        linkColor={() => "rgba(255,255,255,0.26)"}
        cooldownTicks={120}
        d3AlphaDecay={0.035}
        d3VelocityDecay={0.28}
        onNodeClick={(node) => {
          const graphNode = node as GraphNode;
          if (graphNode.type === "movie") {
            onMovieClick(graphNode.tmdbId);
          }
        }}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const graphNode = node as GraphNode;

          if (graphNode.type === "movie") {
            const size = graphNode.isCenter ? 44 : 30;
            const x = graphNode.x ?? 0;
            const y = graphNode.y ?? 0;

            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            ctx.closePath();
            ctx.clip();

            if (graphNode.posterPath) {
              const image = loadImage(`${IMAGE_BASE}${graphNode.posterPath}`);
              if (image.complete) {
                ctx.drawImage(image, x - size, y - size, size * 2, size * 2);
              } else {
                ctx.fillStyle = "#1f2937";
                ctx.fillRect(x - size, y - size, size * 2, size * 2);
              }
            } else {
              ctx.fillStyle = "#1f2937";
              ctx.fillRect(x - size, y - size, size * 2, size * 2);
            }

            ctx.restore();

            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            ctx.strokeStyle = graphNode.isCenter ? "#f7d88a" : "rgba(255,255,255,0.75)";
            ctx.lineWidth = graphNode.isCenter ? 3 : 1.4;
            ctx.stroke();

            const fontSize = Math.max(11, 13 / globalScale);
            const subtitleSize = Math.max(10, 11 / globalScale);
            const subtitle = `${graphNode.year ?? "N/A"} • ${graphNode.rating?.toFixed(1) ?? "N/A"}`;

            ctx.fillStyle = "#f5f5f5";
            ctx.font = `600 ${fontSize}px IBM Plex Sans, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(graphNode.title ?? "Untitled", x, y + size + fontSize + 6);

            ctx.fillStyle = "#a1a1aa";
            ctx.font = `500 ${subtitleSize}px IBM Plex Sans, sans-serif`;
            ctx.fillText(subtitle, x, y + size + fontSize + subtitleSize + 9);
            return;
          }

          const radius = 16;
          const x = graphNode.x ?? 0;
          const y = graphNode.y ?? 0;

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = "#3f3f46";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 1;
          ctx.stroke();

          const label = `${graphNode.name} (${graphNode.role})`;
          const fontSize = Math.max(10, 12 / globalScale);
          ctx.font = `500 ${fontSize}px IBM Plex Sans, sans-serif`;
          ctx.fillStyle = "#d4d4d8";
          ctx.textAlign = "left";
          ctx.fillText(label, x + radius + 6, y + 4);
        }}
      />
    </div>
  );
}
