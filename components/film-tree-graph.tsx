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

type PositionedLink = {
  source: string;
  target: string;
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
  return node.isCenter ? 52 : 31;
}

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function roleColor(role?: string) {
  switch (role) {
    case "Director":
      return "#f7d88a";
    case "Producer":
      return "#a7f3d0";
    case "Writer":
      return "#93c5fd";
    default:
      return "#d4d4d8";
  }
}

function shortName(name?: string) {
  if (!name) return "Unknown";
  if (name.length <= 18) return name;
  return `${name.slice(0, 17)}…`;
}

function getLinkedMovieIds(personId: string, links: GraphLink[]) {
  return links
    .filter((link) => link.source === personId)
    .map((link) => String(link.target))
    .filter((targetId) => targetId.startsWith("movie-"));
}

const ROLE_WEIGHT: Record<string, number> = {
  Director: 0,
  Producer: 1,
  Writer: 2,
  Actor: 3
};

function resolveCollisions(nodes: PositionedNode[], iterations = 140) {
  const mutable = nodes.map((node) => ({ ...node }));

  for (let i = 0; i < iterations; i += 1) {
    let moved = false;
    for (let a = 0; a < mutable.length; a += 1) {
      for (let b = a + 1; b < mutable.length; b += 1) {
        const n1 = mutable[a];
        const n2 = mutable[b];
        if (n1.isCenter || n2.isCenter) continue;

        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const distance = Math.hypot(dx, dy) || 1;
        const minDistance = nodeRadius(n1) + nodeRadius(n2) + 18;

        if (distance < minDistance) {
          const overlap = minDistance - distance;
          const nx = dx / distance;
          const ny = dy / distance;

          n1.x -= nx * (overlap * 0.52);
          n1.y -= ny * (overlap * 0.52) + overlap * 0.12;
          n2.x += nx * (overlap * 0.52);
          n2.y += ny * (overlap * 0.52) + overlap * 0.12;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return mutable.map((node) => ({ ...node, fx: node.x, fy: node.y }));
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
  const sortedPeople = [...personNodes].sort((a, b) => {
    const roleDiff = (ROLE_WEIGHT[a.role ?? "Actor"] ?? 10) - (ROLE_WEIGHT[b.role ?? "Actor"] ?? 10);
    if (roleDiff !== 0) return roleDiff;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });

  const placed = new Map<string, PositionedNode>();
  placed.set(center.id, {
    ...center,
    x: 0,
    y: 0,
    fx: 0,
    fy: 0
  });

  const peopleRadius = 220;
  const peopleCount = sortedPeople.length || 1;
  sortedPeople.forEach((person, idx) => {
    const angle = (Math.PI * 2 * idx) / peopleCount - Math.PI / 2;
    const x = Math.cos(angle) * peopleRadius;
    const y = Math.sin(angle) * peopleRadius;
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

    const personPosition = placed.get(person.id);
    const anchorX = personPosition?.x ?? 0;
    const anchorY = personPosition?.y ?? 0;
    const branchCenterAngle = Math.atan2(anchorY, anchorX);
    const movieOrbitRadius = 390 + personIdx * 8;
    const spread = 0.5;
    const startAngle = branchCenterAngle - ((relatedMovieIds.length - 1) * spread) / 2;

    relatedMovieIds.forEach((movieId, movieIdx) => {
      seenMovies.add(movieId);
      const movieNode = nodeById.get(movieId);
      if (!movieNode) return;

      const angle = startAngle + movieIdx * spread;
      const x = Math.cos(angle) * movieOrbitRadius;
      const y = Math.sin(angle) * movieOrbitRadius;
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
    const angle = (Math.PI * 2 * idx) / Math.max(leftovers.length, 1);
    const radius = 430 + Math.floor(idx / 8) * 70;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    placed.set(node.id, {
      ...node,
      x,
      y,
      fx: x,
      fy: y
    });
  });

  return resolveCollisions([...placed.values()]);
}

export function FilmTreeGraph({ nodes, links, onMovieClick }: Props) {
  const graphRef = useRef<ForceGraphMethods>();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });

  const graphData = useMemo(() => {
    return {
      nodes: layoutNodes(nodes, links),
      links: links.map((link) => ({
        source: String(link.source),
        target: String(link.target)
      })) as PositionedLink[]
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
          graphRef.current?.centerAt(graphNode.x, graphNode.y, 260);
          if (graphNode.type === "movie") {
            onMovieClick(graphNode.tmdbId);
          }
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
          const accent = roleColor(graphNode.role);

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = isHovered ? "#52525b" : "#3f3f46";
          ctx.fill();
          ctx.strokeStyle = accent;
          ctx.lineWidth = isHovered ? 2 : 1.5;
          ctx.stroke();

          const initialsText = initials(graphNode.name);
          const initialsSize = Math.max(9, 10 / globalScale);
          ctx.fillStyle = "#f4f4f5";
          ctx.font = `700 ${initialsSize}px IBM Plex Sans, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(initialsText, x, y + 3);

          const labelText = `${shortName(graphNode.name)} • ${graphNode.role ?? "Person"}`;
          const labelSize = Math.max(10, 11 / globalScale);
          ctx.font = `600 ${labelSize}px IBM Plex Sans, sans-serif`;
          const textWidth = ctx.measureText(labelText).width;
          const chipPaddingX = 8;
          const chipHeight = labelSize + 8;
          const chipWidth = textWidth + chipPaddingX * 2;
          const chipX = x - chipWidth / 2;
          const chipY = y + radius + 8;

          ctx.fillStyle = "rgba(15,23,42,0.82)";
          ctx.beginPath();
          ctx.roundRect(chipX, chipY, chipWidth, chipHeight, 8);
          ctx.fill();
          ctx.strokeStyle = `${accent}88`;
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = accent;
          ctx.textAlign = "center";
          ctx.fillText(labelText, x, chipY + chipHeight - 6);
        }}
      />
    </div>
  );
}
