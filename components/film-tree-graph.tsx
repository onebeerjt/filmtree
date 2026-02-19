"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide } from "d3-force";
import type { ForceGraphMethods } from "react-force-graph-2d";
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

type ForceCharge = {
  strength: (value: number) => void;
  distanceMax: (value: number) => void;
};

type ForceLink = {
  distance: (fn: (link: GraphLinkWithResolvedNodes) => number) => void;
  strength: (fn: (link: GraphLinkWithResolvedNodes) => number) => void;
};

type GraphLinkWithResolvedNodes = {
  source: GraphNode;
  target: GraphNode;
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

function nodeRadius(node: GraphNode) {
  if (node.type === "person") return 18;
  return node.isCenter ? 54 : 35;
}

export function FilmTreeGraph({ nodes, links, onMovieClick }: Props) {
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);
  const graphRef = useRef<ForceGraphMethods>();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    function updateViewport() {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight
      });
    }

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    const charge = fg.d3Force("charge") as ForceCharge | undefined;
    if (charge) {
      charge.strength(-420);
      charge.distanceMax(1800);
    }

    const link = fg.d3Force("link") as ForceLink | undefined;
    if (link) {
      link.distance((linkValue) => {
        const source = linkValue.source;
        const target = linkValue.target;
        const movieToPerson = source.type !== target.type;
        return movieToPerson ? 230 : 280;
      });
      link.strength((linkValue) => {
        const source = linkValue.source;
        const target = linkValue.target;
        return source.type !== target.type ? 0.88 : 0.72;
      });
    }

    fg.d3Force(
      "collide",
      forceCollide((node) => nodeRadius(node as GraphNode) + 14).strength(1).iterations(3)
    );

    fg.d3ReheatSimulation();
    setTimeout(() => {
      if (fg.zoomToFit) {
        fg.zoomToFit(700, 100);
      }
    }, 450);
  }, [nodes, links]);

  return (
    <div className="h-full w-full">
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={viewport.width}
        height={viewport.height}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={6}
        linkWidth={1.6}
        linkColor={() => "rgba(255,255,255,0.28)"}
        cooldownTicks={220}
        warmupTicks={90}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.2}
        minZoom={0.35}
        maxZoom={7}
        onNodeHover={(node) => {
          const graphNode = node as GraphNode | null;
          setHoveredId(graphNode?.id ?? null);
        }}
        onNodeClick={(node) => {
          const graphNode = node as GraphNode;
          if (graphNode.type === "movie") {
            onMovieClick(graphNode.tmdbId);
          }
        }}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const graphNode = node as GraphNode;
          const x = graphNode.x ?? 0;
          const y = graphNode.y ?? 0;

          if (graphNode.type === "movie") {
            const size = nodeRadius(graphNode);
            const isHovered = hoveredId === graphNode.id;

            if (isHovered) {
              ctx.beginPath();
              ctx.arc(x, y, size + 8, 0, 2 * Math.PI);
              ctx.fillStyle = "rgba(247,216,138,0.25)";
              ctx.fill();
            }

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
            ctx.strokeStyle = graphNode.isCenter ? "#f7d88a" : "rgba(255,255,255,0.76)";
            ctx.lineWidth = graphNode.isCenter ? 4 : 1.8;
            ctx.stroke();

            const fontSize = Math.max(11, 14 / globalScale);
            const subtitleSize = Math.max(10, 11 / globalScale);
            const showTitle = graphNode.isCenter || isHovered || globalScale > 1.3;
            const showSubtitle = graphNode.isCenter || isHovered || globalScale > 2.4;

            if (showTitle) {
              ctx.fillStyle = "#f5f5f5";
              ctx.font = `700 ${fontSize}px IBM Plex Sans, sans-serif`;
              ctx.textAlign = "center";
              ctx.fillText(graphNode.title ?? "Untitled", x, y + size + fontSize + 7);
            }

            if (showSubtitle) {
              const subtitle = `${graphNode.year ?? "N/A"} • ${graphNode.rating?.toFixed(1) ?? "N/A"}`;
              ctx.fillStyle = "#c9c9ce";
              ctx.font = `500 ${subtitleSize}px IBM Plex Sans, sans-serif`;
              ctx.fillText(subtitle, x, y + size + fontSize + subtitleSize + 10);
            }

            return;
          }

          const radius = nodeRadius(graphNode);
          const isHovered = hoveredId === graphNode.id;

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = isHovered ? "#6b7280" : "#3f3f46";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.62)";
          ctx.lineWidth = 1.2;
          ctx.stroke();

          const showLabel = isHovered || globalScale > 2.1;
          if (showLabel) {
            const label = `${graphNode.name} (${graphNode.role})`;
            const fontSize = Math.max(10, 12 / globalScale);
            ctx.font = `500 ${fontSize}px IBM Plex Sans, sans-serif`;
            ctx.fillStyle = "#d4d4d8";
            ctx.textAlign = "left";
            ctx.fillText(label, x + radius + 7, y + 4);
          }
        }}
      />
    </div>
  );
}
