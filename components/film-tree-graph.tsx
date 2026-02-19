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

function movieSize(node: GraphNode) {
  if (node.isCenter) return { w: 94, h: 142 };
  return { w: 70, h: 105 };
}

function nodeRadius(node: GraphNode) {
  if (node.type === "person") return 18;
  const { w, h } = movieSize(node);
  return Math.hypot(w / 2, h / 2);
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

function getNeighbors(nodeId: string, links: GraphLink[]) {
  const neighbors = new Set<string>();
  for (const link of links) {
    const source = String(link.source);
    const target = String(link.target);
    if (source === nodeId) neighbors.add(target);
    if (target === nodeId) neighbors.add(source);
  }
  return [...neighbors];
}

const ROLE_WEIGHT: Record<string, number> = {
  Director: 0,
  Producer: 1,
  Writer: 2,
  Actor: 3
};

function resolveCollisions(nodes: PositionedNode[], iterations = 160) {
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

function layoutNodes(nodes: GraphNode[], links: GraphLink[], focusNodeId: string | null): PositionedNode[] {
  const defaultCenter = nodes.find((node) => node.type === "movie" && node.isCenter) ?? nodes.find((node) => node.type === "movie");
  if (!defaultCenter) {
    return nodes.map((node) => ({
      ...node,
      x: node.x ?? 0,
      y: node.y ?? 0,
      fx: node.x ?? 0,
      fy: node.y ?? 0
    }));
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const hub = (focusNodeId ? nodeById.get(focusNodeId) : null) ?? defaultCenter;
  const allNodes = [...nodeById.values()];
  const sortedNodes = [...allNodes].sort((a, b) => {
    const roleDiff = (ROLE_WEIGHT[a.role ?? "Actor"] ?? 10) - (ROLE_WEIGHT[b.role ?? "Actor"] ?? 10);
    if (roleDiff !== 0) return roleDiff;
    return (a.name ?? a.title ?? "").localeCompare(b.name ?? b.title ?? "");
  });

  const placed = new Map<string, PositionedNode>();
  placed.set(hub.id, {
    ...hub,
    x: 0,
    y: 0,
    fx: 0,
    fy: 0
  });

  const firstHop = getNeighbors(hub.id, links)
    .map((id) => nodeById.get(id))
    .filter((node): node is GraphNode => Boolean(node))
    .sort((a, b) => {
      const roleDiff = (ROLE_WEIGHT[a.role ?? "Actor"] ?? 10) - (ROLE_WEIGHT[b.role ?? "Actor"] ?? 10);
      if (roleDiff !== 0) return roleDiff;
      return (a.name ?? a.title ?? "").localeCompare(b.name ?? b.title ?? "");
    });

  const firstRingRadius = hub.type === "movie" ? 220 : 260;
  const firstCount = firstHop.length || 1;
  const firstAngles = new Map<string, number>();
  firstHop.forEach((node, idx) => {
    const angle = (Math.PI * 2 * idx) / firstCount - Math.PI / 2;
    firstAngles.set(node.id, angle);
    const x = Math.cos(angle) * firstRingRadius;
    const y = Math.sin(angle) * firstRingRadius;
    placed.set(node.id, { ...node, x, y, fx: x, fy: y });
  });

  const seen = new Set<string>([hub.id, ...firstHop.map((n) => n.id)]);
  for (const neighbor of firstHop) {
    const neighborAngle = firstAngles.get(neighbor.id) ?? 0;
    const secondHop = getNeighbors(neighbor.id, links)
      .filter((id) => !seen.has(id))
      .map((id) => nodeById.get(id))
      .filter((node): node is GraphNode => Boolean(node));

    const spread = 0.42;
    const startAngle = neighborAngle - ((secondHop.length - 1) * spread) / 2;
    secondHop.forEach((node, idx) => {
      seen.add(node.id);
      const angle = startAngle + idx * spread;
      const radius = 400 + idx * 6;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      placed.set(node.id, { ...node, x, y, fx: x, fy: y });
    });
  }

  const leftovers = sortedNodes.filter((node) => !placed.has(node.id));
  leftovers.forEach((node, idx) => {
    const angle = (Math.PI * 2 * idx) / Math.max(leftovers.length, 1);
    const radius = 470 + Math.floor(idx / 10) * 60;
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
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    const center = nodes.find((node) => node.type === "movie" && node.isCenter) ?? nodes.find((node) => node.type === "movie");
    setFocusNodeId(center?.id ?? null);
  }, [nodes]);

  const graphData = useMemo(() => {
    return {
      nodes: layoutNodes(nodes, links, focusNodeId),
      links: links.map((link) => ({
        source: String(link.source),
        target: String(link.target)
      })) as PositionedLink[]
    };
  }, [nodes, links, focusNodeId]);

  const { connectedNodeIds, connectedLinkKeys } = useMemo(() => {
    if (!hoveredId) {
      return {
        connectedNodeIds: new Set<string>(),
        connectedLinkKeys: new Set<string>()
      };
    }

    const nodeSet = new Set<string>([hoveredId]);
    const linkSet = new Set<string>();
    for (const link of graphData.links) {
      const source = String(link.source);
      const target = String(link.target);
      if (source === hoveredId || target === hoveredId) {
        nodeSet.add(source);
        nodeSet.add(target);
        linkSet.add(`${source}->${target}`);
      }
    }

    return { connectedNodeIds: nodeSet, connectedLinkKeys: linkSet };
  }, [graphData.links, hoveredId]);

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
        linkWidth={(link) => {
          const source = String((link as PositionedLink).source);
          const target = String((link as PositionedLink).target);
          return connectedLinkKeys.has(`${source}->${target}`) ? 2.4 : 1;
        }}
        linkColor={(link) => {
          const source = String((link as PositionedLink).source);
          const target = String((link as PositionedLink).target);
          return connectedLinkKeys.has(`${source}->${target}`) ? "rgba(247,216,138,0.72)" : "rgba(255,255,255,0.18)";
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          const graphNode = node as PositionedNode;
          const x = graphNode.x;
          const y = graphNode.y;
          ctx.fillStyle = color;
          if (graphNode.type === "movie") {
            const { w, h } = movieSize(graphNode);
            ctx.fillRect(x - w / 2 - 8, y - h / 2 - 8, w + 16, h + 16);
          } else {
            const r = nodeRadius(graphNode) + 8;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fill();
          }
        }}
        onNodeHover={(node) => {
          const graphNode = node as PositionedNode | null;
          setHoveredId(graphNode?.id ?? null);
        }}
        onNodeClick={(node) => {
          const graphNode = node as PositionedNode;
          setFocusNodeId(graphNode.id);
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
            const { w, h } = movieSize(graphNode);
            const isHovered = hoveredId === graphNode.id;
            const isConnected = hoveredId ? connectedNodeIds.has(graphNode.id) : false;

            if (isHovered || isConnected) {
              ctx.fillStyle = isHovered ? "rgba(247,216,138,0.33)" : "rgba(247,216,138,0.2)";
              ctx.fillRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12);
            }

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(x - w / 2, y - h / 2, w, h, 10);
            ctx.closePath();
            ctx.clip();

            if (graphNode.posterPath) {
              const image = loadImage(`${IMAGE_BASE}${graphNode.posterPath}`);
              if (image.complete) {
                ctx.drawImage(image, x - w / 2, y - h / 2, w, h);
              } else {
                ctx.fillStyle = "#1f2937";
                ctx.fillRect(x - w / 2, y - h / 2, w, h);
              }
            } else {
              ctx.fillStyle = "#1f2937";
              ctx.fillRect(x - w / 2, y - h / 2, w, h);
            }

            ctx.restore();

            ctx.beginPath();
            ctx.roundRect(x - w / 2, y - h / 2, w, h, 10);
            ctx.strokeStyle = graphNode.isCenter || isConnected ? "#f7d88a" : "rgba(255,255,255,0.62)";
            ctx.lineWidth = graphNode.isCenter ? 3 : 1.6;
            ctx.stroke();

            const showTitle = graphNode.isCenter || isHovered || isConnected;
            if (showTitle) {
              const fontSize = Math.max(11, 13 / globalScale);
              const subtitleSize = Math.max(10, 11 / globalScale);

              ctx.fillStyle = "#f5f5f5";
              ctx.font = `700 ${fontSize}px IBM Plex Sans, sans-serif`;
              ctx.textAlign = "center";
              ctx.fillText(graphNode.title ?? "Untitled", x, y + h / 2 + fontSize + 6);

              const subtitle = `${graphNode.year ?? "N/A"} • ${graphNode.rating?.toFixed(1) ?? "N/A"}`;
              ctx.fillStyle = "#c9c9ce";
              ctx.font = `500 ${subtitleSize}px IBM Plex Sans, sans-serif`;
              ctx.fillText(subtitle, x, y + h / 2 + fontSize + subtitleSize + 9);
            }
            return;
          }

          const radius = nodeRadius(graphNode);
          const isHovered = hoveredId === graphNode.id;
          const accent = roleColor(graphNode.role);
          const isConnected = hoveredId ? connectedNodeIds.has(graphNode.id) : false;

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = isHovered || isConnected ? "#52525b" : "#3f3f46";
          ctx.fill();
          ctx.strokeStyle = isConnected ? "#f7d88a" : accent;
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

          ctx.fillStyle = isConnected ? "#f7d88a" : accent;
          ctx.textAlign = "center";
          ctx.fillText(labelText, x, chipY + chipHeight - 6);
        }}
      />
    </div>
  );
}
