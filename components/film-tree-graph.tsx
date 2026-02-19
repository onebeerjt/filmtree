"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
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

type PositionedNode = GraphNode & {
  x: number;
  y: number;
  fx: number;
  fy: number;
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
  if (node.type === "person") return 20;
  return node.isCenter ? 58 : 39;
}

function getLinkedMovieIds(personId: string, links: GraphLink[]) {
  return links
    .filter((link) => link.source === personId)
    .map((link) => String(link.target))
    .filter((targetId) => targetId.startsWith("movie-"));
}

function layoutNodes(nodes: GraphNode[], links: GraphLink[]): PositionedNode[] {
  const center = nodes.find((node) => node.type === "movie" && node.isCenter) ?? nodes.find((node) => node.type === "movie");
  if (!center) {
    return nodes.map((node) => ({
      ...node,
      x: node.x ?? 0,
      y: node.y ?? 0,
      fx: node.x ?? 0,
      fy: node.y ?? 0
    }));
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const personNodes = nodes.filter((node) => node.type === "person");
  const sortedPeople = [...personNodes].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const placed = new Map<string, PositionedNode>();
  placed.set(center.id, {
    ...center,
    x: 0,
    y: 0,
    fx: 0,
    fy: 0
  });

  const peopleGapX = 290;
  const peopleY = 390;
  const peopleStartX = -((sortedPeople.length - 1) * peopleGapX) / 2;

  sortedPeople.forEach((person, idx) => {
    const x = peopleStartX + idx * peopleGapX;
    const y = peopleY;
    placed.set(person.id, {
      ...person,
      x,
      y,
      fx: x,
      fy: y
    });
  });

  const seenMovies = new Set<string>([center.id]);
  sortedPeople.forEach((person, personIdx) => {
    const relatedMovieIds = getLinkedMovieIds(person.id, links)
      .filter((movieId) => !seenMovies.has(movieId))
      .filter((movieId) => nodeById.has(movieId));

    const localGapX = 260;
    const branchStartX = (placed.get(person.id)?.x ?? 0) - ((relatedMovieIds.length - 1) * localGapX) / 2;
    const branchY = 800 + personIdx * 320;

    relatedMovieIds.forEach((movieId, movieIdx) => {
      seenMovies.add(movieId);
      const movieNode = nodeById.get(movieId);
      if (!movieNode) return;

      const x = branchStartX + movieIdx * localGapX;
      const y = branchY;
      placed.set(movieId, {
        ...movieNode,
        x,
        y,
        fx: x,
        fy: y
      });
    });
  });

  const leftovers = nodes.filter((node) => !placed.has(node.id));
  leftovers.forEach((node, idx) => {
    const x = ((idx % 6) - 2.5) * 260;
    const y = 800 + sortedPeople.length * 320 + Math.floor(idx / 6) * 320;
    placed.set(node.id, {
      ...node,
      x,
      y,
      fx: x,
      fy: y
    });
  });

  const candidates = [...placed.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  const resolved: PositionedNode[] = [];

  for (const node of candidates) {
    if (node.id === center.id) {
      resolved.push(node);
      continue;
    }

    let y = node.y;
    let hasCollision = true;
    let guard = 0;

    while (hasCollision && guard < 120) {
      hasCollision = false;
      for (const other of resolved) {
        const dx = node.x - other.x;
        const dy = y - other.y;
        const minDistance = nodeRadius(node) + nodeRadius(other) + 36;
        if (Math.hypot(dx, dy) < minDistance) {
          y = other.y + minDistance + 12;
          hasCollision = true;
        }
      }
      guard += 1;
    }

    resolved.push({
      ...node,
      y,
      fy: y
    });
  }

  return resolved.map((node) => ({
    ...node,
    fx: node.x,
    fy: node.y
  }));
}

export function FilmTreeGraph({ nodes, links, onMovieClick }: Props) {
  const graphRef = useRef<ForceGraphMethods>();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });

  const graphData = useMemo(() => {
    return {
      nodes: layoutNodes(nodes, links),
      links
    };
  }, [nodes, links]);

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
    setTimeout(() => fg.zoomToFit?.(700, 200), 20);
  }, [graphData]);

  return (
    <div className="h-full w-full">
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={viewport.width}
        height={viewport.height}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={1}
        cooldownTicks={0}
        minZoom={0.08}
        maxZoom={8}
        enableNodeDrag={false}
        enablePointerInteraction
        linkWidth={1.2}
        linkColor={() => "rgba(255,255,255,0.24)"}
        nodePointerAreaPaint={(node, color, ctx) => {
          const graphNode = node as PositionedNode;
          const x = graphNode.x;
          const y = graphNode.y;
          const r = nodeRadius(graphNode) + 8;

          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fill();
        }}
        onNodeHover={(node) => {
          const graphNode = node as PositionedNode | null;
          setHoveredId(graphNode?.id ?? null);
        }}
        onNodeClick={(node) => {
          const graphNode = node as PositionedNode;
          if (graphNode.type !== "movie") return;

          graphRef.current?.centerAt(graphNode.x, graphNode.y, 260);
          onMovieClick(graphNode.tmdbId);
        }}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const graphNode = node as PositionedNode;
          const x = graphNode.x;
          const y = graphNode.y;

          if (graphNode.type === "movie") {
            const size = nodeRadius(graphNode);
            const isHovered = hoveredId === graphNode.id;

            if (isHovered) {
              ctx.beginPath();
              ctx.arc(x, y, size + 9, 0, 2 * Math.PI);
              ctx.fillStyle = "rgba(247,216,138,0.28)";
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
            ctx.strokeStyle = graphNode.isCenter ? "#f7d88a" : "rgba(255,255,255,0.78)";
            ctx.lineWidth = graphNode.isCenter ? 4 : 2;
            ctx.stroke();

            const showTitle = graphNode.isCenter || isHovered;
            if (showTitle) {
              const fontSize = Math.max(11, 14 / globalScale);
              const subtitleSize = Math.max(10, 11 / globalScale);

              ctx.fillStyle = "#f5f5f5";
              ctx.font = `700 ${fontSize}px IBM Plex Sans, sans-serif`;
              ctx.textAlign = "center";
              ctx.fillText(graphNode.title ?? "Untitled", x, y + size + fontSize + 7);

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
          ctx.fillStyle = isHovered ? "#71717a" : "#3f3f46";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.65)";
          ctx.lineWidth = 1.2;
          ctx.stroke();

          if (isHovered) {
            const label = `${graphNode.name} (${graphNode.role})`;
            const fontSize = Math.max(11, 13 / globalScale);
            ctx.font = `500 ${fontSize}px IBM Plex Sans, sans-serif`;
            ctx.fillStyle = "#d4d4d8";
            ctx.textAlign = "left";
            ctx.fillText(label, x + radius + 8, y + 4);
          }
        }}
      />
    </div>
  );
}
