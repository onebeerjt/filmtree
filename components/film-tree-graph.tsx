"use client";

import dynamic from "next/dynamic";
import NextImage from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import { PLATFORM_META } from "@/lib/streaming";
import { GraphLink, GraphNode, StreamingAvailability, StreamingPlatformKey } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false
});

const IMAGE_BASE = "https://image.tmdb.org/t/p/w185";
type CachedImage = {
  img: HTMLImageElement;
  status: "loading" | "loaded" | "error";
  lastAttemptAt: number;
};

const IMAGE_RETRY_MS = 15000;
const imageCache = new Map<string, CachedImage>();

type Props = {
  nodes: GraphNode[];
  links: GraphLink[];
  onMovieClick: (movieId: number) => void;
  onPersonClick?: (personId: number, personName: string) => void;
  onExploreStep?: (node: GraphNode) => void;
  pendingMovieId: number | null;
  failedMovieId: number | null;
  streamingByMovieId: Record<number, StreamingAvailability>;
  selectedPlatforms: StreamingPlatformKey[];
};

type PositionedNode = GraphNode & {
  x: number;
  y: number;
  fx: number;
  fy: number;
};

type PositionedLink = {
  source: string | { id?: string };
  target: string | { id?: string };
};

type TooltipState = {
  nodeId: string;
  x: number;
  y: number;
};

type CenterTransition = {
  prevId: string | null;
  nextId: string;
  startMs: number;
};

const ROLE_WEIGHT: Record<string, number> = {
  Director: 0,
  Producer: 1,
  Writer: 2,
  Actor: 3
};

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number) {
  return t * t * t;
}

function loadImage(src: string) {
  const now = Date.now();
  const cached = imageCache.get(src);
  if (cached) {
    const shouldRetry = cached.status === "error" && now - cached.lastAttemptAt >= IMAGE_RETRY_MS;
    if (!shouldRetry) return cached;
    imageCache.delete(src);
  }

  const img = new Image(1, 1);
  const entry: CachedImage = {
    img,
    status: "loading",
    lastAttemptAt: now
  };

  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.onload = () => {
    entry.status = img.naturalWidth > 0 && img.naturalHeight > 0 ? "loaded" : "error";
  };
  img.onerror = () => {
    entry.status = "error";
  };
  img.src = src;

  imageCache.set(src, entry);
  return entry;
}

function roleColor(role?: string) {
  switch (role) {
    case "Director":
      return "#C9A84C";
    case "Actor":
      return "#4A90D9";
    case "Writer":
      return "#9B59B6";
    case "Producer":
      return "#1ABC9C";
    default:
      return "#9ca3af";
  }
}

function linkEndId(end: string | { id?: string }) {
  if (typeof end === "string") return end;
  return end?.id ?? "";
}

function linkKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function shortName(name?: string, max = 18) {
  if (!name) return "Unknown";
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

function filmSizeFromRating(node: GraphNode) {
  const rating = node.rating;
  let width = 45;
  if (typeof rating === "number") {
    if (rating >= 8) width = 70;
    else if (rating >= 7) width = 55;
    else if (rating >= 6) width = 45;
    else width = 35;
  }

  if (node.isCenter) {
    width = Math.round(45 * 2.5);
  }

  return {
    w: width,
    h: Math.round(width * 1.45)
  };
}

function nodeRadius(node: GraphNode) {
  if (node.type === "person") return 20;
  const size = filmSizeFromRating(node);
  return Math.hypot(size.w / 2, size.h / 2);
}

function pickNodeAtPoint(x: number, y: number, nodes: PositionedNode[], preferMovie = false) {
  let best: PositionedNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    const dx = x - node.x;
    const dy = y - node.y;
    const distance = Math.hypot(dx, dy);
    if (node.type === "person") {
      if (distance > 34) continue;
    } else {
      const { w, h } = filmSizeFromRating(node);
      const halfW = Math.max(28, w / 2 + 14);
      const halfH = Math.max(38, h / 2 + 14);
      if (Math.abs(dx) > halfW || Math.abs(dy) > halfH) continue;
    }
    const effectiveDistance = preferMovie && node.type === "movie" ? distance * 0.7 : distance;
    if (effectiveDistance < bestDistance) {
      best = node;
      bestDistance = effectiveDistance;
    }
  }

  return best;
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

function resolveCollisions(nodes: PositionedNode[], iterations = 140) {
  const mutable = nodes.map((node) => ({ ...node }));

  for (let i = 0; i < iterations; i += 1) {
    let moved = false;
    for (let a = 0; a < mutable.length; a += 1) {
      for (let b = a + 1; b < mutable.length; b += 1) {
        const n1 = mutable[a];
        const n2 = mutable[b];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const distance = Math.hypot(dx, dy) || 1;
        const minDistance = nodeRadius(n1) + nodeRadius(n2) + 20;
        if (distance >= minDistance) continue;

        const overlap = minDistance - distance;
        const nx = dx / distance;
        const ny = dy / distance;

        if (!n1.isCenter) {
          n1.x -= nx * overlap * 0.52;
          n1.y -= ny * overlap * 0.52;
        }
        if (!n2.isCenter) {
          n2.x += nx * overlap * 0.52;
          n2.y += ny * overlap * 0.52;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  return mutable.map((node) => ({ ...node, fx: node.x, fy: node.y }));
}

function layoutNodes(nodes: GraphNode[], links: GraphLink[], focusNodeId: string | null) {
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

  const firstRadius = hub.type === "movie" ? 210 : 250;
  const firstCount = firstHop.length || 1;
  const firstAngles = new Map<string, number>();
  firstHop.forEach((node, idx) => {
    const angle = (Math.PI * 2 * idx) / firstCount - Math.PI / 2;
    firstAngles.set(node.id, angle);
    const x = Math.cos(angle) * firstRadius;
    const y = Math.sin(angle) * firstRadius;
    placed.set(node.id, { ...node, x, y, fx: x, fy: y });
  });

  const seen = new Set<string>([hub.id, ...firstHop.map((n) => n.id)]);
  for (const n of firstHop) {
    const baseAngle = firstAngles.get(n.id) ?? 0;
    const secondHop = getNeighbors(n.id, links)
      .filter((id) => !seen.has(id))
      .map((id) => nodeById.get(id))
      .filter((node): node is GraphNode => Boolean(node));

    const spread = 0.34;
    const start = baseAngle - ((secondHop.length - 1) * spread) / 2;
    secondHop.forEach((node, idx) => {
      seen.add(node.id);
      const angle = start + idx * spread;
      const radius = 360 + idx * 6;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      placed.set(node.id, { ...node, x, y, fx: x, fy: y });
    });
  }

  const leftovers = nodes.filter((n) => !placed.has(n.id));
  leftovers.forEach((node, idx) => {
    const angle = (Math.PI * 2 * idx) / Math.max(leftovers.length, 1);
    const radius = 420 + Math.floor(idx / 8) * 50;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    placed.set(node.id, { ...node, x, y, fx: x, fy: y });
  });

  return resolveCollisions([...placed.values()]);
}

export function FilmTreeGraph({
  nodes,
  links,
  onMovieClick,
  onPersonClick,
  onExploreStep,
  pendingMovieId,
  failedMovieId,
  streamingByMovieId,
  selectedPlatforms
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods>();
  const lastNodeClickAtRef = useRef(0);
  const pointerDownRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const centerIdRef = useRef<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [tappedNodeId, setTappedNodeId] = useState<string | null>(null);
  const [centerTransition, setCenterTransition] = useState<CenterTransition | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setIsTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  useEffect(() => {
    const center = nodes.find((node) => node.type === "movie" && node.isCenter) ?? nodes.find((node) => node.type === "movie");
    const nextCenterId = center?.id ?? null;
    if (nextCenterId && centerIdRef.current && centerIdRef.current !== nextCenterId) {
      setCenterTransition({
        prevId: centerIdRef.current,
        nextId: nextCenterId,
        startMs: Date.now()
      });
    }
    centerIdRef.current = nextCenterId;
    setFocusNodeId(nextCenterId);
  }, [nodes]);

  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 33);
    return () => clearInterval(timer);
  }, []);

  const graphData = useMemo(() => {
    const laidOut = layoutNodes(nodes, links, focusNodeId);
    const sorted = [...laidOut].sort((a, b) => {
      if (!a.isCenter && b.isCenter) return -1;
      if (a.isCenter && !b.isCenter) return 1;
      if (a.type === "movie" && b.type === "person") return -1;
      if (a.type === "person" && b.type === "movie") return 1;
      return 0;
    });

    return {
      nodes: sorted,
      links: links.map((link) => ({
        source: String(link.source),
        target: String(link.target)
      })) as PositionedLink[]
    };
  }, [nodes, links, focusNodeId]);

  const nodeById = useMemo(() => {
    return new Map(graphData.nodes.map((node) => [node.id, node]));
  }, [graphData.nodes]);

  const hoveredNode = hoveredId ? nodeById.get(hoveredId) : null;

  const { connectedNodeIds, connectedLinkKeys } = useMemo(() => {
    if (!hoveredId) {
      return { connectedNodeIds: new Set<string>(), connectedLinkKeys: new Set<string>() };
    }

    const nodeSet = new Set<string>([hoveredId]);
    const linkSet = new Set<string>();
    for (const link of graphData.links) {
      const s = linkEndId(link.source);
      const t = linkEndId(link.target);
      if (s === hoveredId || t === hoveredId) {
        nodeSet.add(s);
        nodeSet.add(t);
        linkSet.add(linkKey(s, t));
      }
    }

    return { connectedNodeIds: nodeSet, connectedLinkKeys: linkSet };
  }, [graphData.links, hoveredId]);

  useEffect(() => {
    function updateViewport() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    const centerNode = graphData.nodes.find((n) => n.isCenter);
    if (centerNode) {
      fg.centerAt(centerNode.x, centerNode.y, 600);
      fg.zoom(1.15, 600);
    } else {
      fg.zoomToFit?.(700, 120);
    }
  }, [graphData]);

  useEffect(() => {
    if (!tooltip?.nodeId) return;
    const fg = graphRef.current as ForceGraphMethods & {
      graph2ScreenCoords?: (x: number, y: number) => { x: number; y: number };
    };
    if (!fg?.graph2ScreenCoords) return;

    const node = nodeById.get(tooltip.nodeId);
    if (!node) return;
    const pt = fg.graph2ScreenCoords(node.x, node.y);
    setTooltip({ nodeId: node.id, x: pt.x, y: pt.y });
  }, [tick, nodeById, tooltip?.nodeId]);

  function getLinkRole(link: PositionedLink) {
    const source = nodeById.get(linkEndId(link.source));
    const target = nodeById.get(linkEndId(link.target));
    if (source?.type === "person") return source.role;
    if (target?.type === "person") return target.role;
    return undefined;
  }

  function getMovieDirectorName(movieNodeId: string) {
    const directors = graphData.links
      .filter((link) => linkEndId(link.source) === movieNodeId || linkEndId(link.target) === movieNodeId)
      .map((link) => {
        const source = nodeById.get(linkEndId(link.source));
        const target = nodeById.get(linkEndId(link.target));
        if (source?.type === "person" && source.role === "Director") return source.name;
        if (target?.type === "person" && target.role === "Director") return target.name;
        return null;
      })
      .filter((name): name is string => Boolean(name));

    return directors[0] ?? "Unknown";
  }

  function movieMatchesPlatformFilter(graphNode: PositionedNode) {
    if (graphNode.type !== "movie" || selectedPlatforms.length === 0) return true;
    const availability = streamingByMovieId[graphNode.tmdbId];
    if (!availability) return false;
    return selectedPlatforms.some((platform) => availability.all.includes(platform));
  }

  function activateNode(graphNode: PositionedNode) {
    setFocusNodeId(graphNode.id);
    onExploreStep?.(graphNode);
    graphRef.current?.centerAt(graphNode.x, graphNode.y, 600);

    const fg = graphRef.current as ForceGraphMethods & {
      graph2ScreenCoords?: (x: number, y: number) => { x: number; y: number };
    };
    if (fg?.graph2ScreenCoords) {
      const pt = fg.graph2ScreenCoords(graphNode.x, graphNode.y);
      setTooltip({ nodeId: graphNode.id, x: pt.x, y: pt.y });
    }

    if (graphNode.type !== "movie") {
      setTappedNodeId(graphNode.id);
      if (onPersonClick && graphNode.name) {
        onPersonClick(graphNode.tmdbId, graphNode.name);
      }
      return;
    }

    if (isTouch && tappedNodeId !== graphNode.id) {
      setTappedNodeId(graphNode.id);
      return;
    }

    setTappedNodeId(graphNode.id);
    onMovieClick(graphNode.tmdbId);
  }

  function resolveClientPoint(clientX: number, clientY: number, preferMovie = false) {
    const fg = graphRef.current as ForceGraphMethods & {
      screen2GraphCoords?: (x: number, y: number) => { x: number; y: number };
      graph2ScreenCoords?: (x: number, y: number) => { x: number; y: number };
    };
    if (!fg?.screen2GraphCoords) return null;

    const container = containerRef.current;
    const canvas = container?.querySelector("canvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const graphPt = fg.screen2GraphCoords(sx, sy);
    return pickNodeAtPoint(graphPt.x, graphPt.y, graphData.nodes, preferMovie);
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      onMouseMove={(event) => {
        if (isTouch) return;
        const picked = resolveClientPoint(event.clientX, event.clientY, false);
        setHoveredId(picked?.id ?? null);
        if (!picked) {
          setTooltip(null);
          return;
        }
        const fg = graphRef.current as ForceGraphMethods & {
          graph2ScreenCoords?: (x: number, y: number) => { x: number; y: number };
        };
        if (!fg?.graph2ScreenCoords) return;
        const pt = fg.graph2ScreenCoords(picked.x, picked.y);
        setTooltip({ nodeId: picked.id, x: pt.x, y: pt.y });
      }}
      onMouseLeave={() => {
        if (isTouch) return;
        setHoveredId(null);
        setTooltip(null);
      }}
      onPointerDownCapture={(event) => {
        pointerDownRef.current = { x: event.clientX, y: event.clientY, at: Date.now() };
      }}
      onPointerUpCapture={(event) => {
        const down = pointerDownRef.current;
        pointerDownRef.current = null;
        if (!down) return;

        const dragDistance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        if (dragDistance > 8) return;
        if (Date.now() - lastNodeClickAtRef.current < 140) return;

        const picked = resolveClientPoint(event.clientX, event.clientY, true);
        if (picked) activateNode(picked);
      }}
    >
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={viewport.width}
        height={viewport.height}
        autoPauseRedraw={false}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={1}
        cooldownTicks={0}
        minZoom={0.08}
        maxZoom={8}
        enableNodeDrag={false}
        enablePointerInteraction
        linkWidth={(link) => {
          const line = link as PositionedLink;
          const sourceId = linkEndId(line.source);
          const targetId = linkEndId(line.target);
          const key = linkKey(sourceId, targetId);
          const source = nodeById.get(sourceId);
          const target = nodeById.get(targetId);

          const isCenterToPerson =
            (source?.isCenter && target?.type === "person") || (target?.isCenter && source?.type === "person");

          if (hoveredNode) {
            return connectedLinkKeys.has(key) ? 3.4 : 0.55;
          }

          if (selectedPlatforms.length > 0) {
            const sourceVisible = source?.type === "movie" ? movieMatchesPlatformFilter(source) : true;
            const targetVisible = target?.type === "movie" ? movieMatchesPlatformFilter(target) : true;
            return sourceVisible && targetVisible ? (isCenterToPerson ? 2.1 : 1.1) : 0.45;
          }

          return isCenterToPerson ? 2.1 : 1.1;
        }}
        linkColor={(link) => {
          const line = link as PositionedLink;
          const sourceId = linkEndId(line.source);
          const targetId = linkEndId(line.target);
          const key = linkKey(sourceId, targetId);
          const source = nodeById.get(sourceId);
          const target = nodeById.get(targetId);
          const role = getLinkRole(line);
          const baseColor = roleColor(role);

          const isCenterToPerson =
            (source?.isCenter && target?.type === "person") || (target?.isCenter && source?.type === "person");

          if (hoveredNode) {
            return connectedLinkKeys.has(key) ? "rgba(255,215,107,0.98)" : "rgba(255,255,255,0.08)";
          }

          if (selectedPlatforms.length > 0) {
            const sourceVisible = source?.type === "movie" ? movieMatchesPlatformFilter(source) : true;
            const targetVisible = target?.type === "movie" ? movieMatchesPlatformFilter(target) : true;
            return sourceVisible && targetVisible ? `${baseColor}66` : "rgba(255,255,255,0.06)";
          }

          if (isCenterToPerson) return `${baseColor}CC`;
          return `${baseColor}4D`;
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          const graphNode = node as PositionedNode;
          const x = graphNode.x;
          const y = graphNode.y;
          ctx.fillStyle = color;
          if (graphNode.type === "movie") {
            const { w, h } = filmSizeFromRating(graphNode);
            ctx.beginPath();
            ctx.roundRect(x - w / 2 - 12, y - h / 2 - 12, w + 24, h + 24, 10);
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.arc(x, y, 28, 0, 2 * Math.PI);
            ctx.fill();
          }
        }}
        onNodeClick={(node) => {
          lastNodeClickAtRef.current = Date.now();
          activateNode(node as PositionedNode);
        }}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const graphNode = node as PositionedNode;
          const baseX = graphNode.x;
          const baseY = graphNode.y;

          const shakeOffset =
            failedMovieId && graphNode.type === "movie" && graphNode.tmdbId === failedMovieId
              ? Math.sin(Date.now() * 0.06) * 5
              : 0;

          const x = baseX + shakeOffset;
          const y = baseY;

          const transitionProgress = centerTransition
            ? Math.min((Date.now() - centerTransition.startMs) / 600, 1)
            : 1;

          if (graphNode.type === "movie") {
            let { w, h } = filmSizeFromRating(graphNode);

            if (centerTransition) {
              if (graphNode.id === centerTransition.nextId) {
                const t = easeInCubic(transitionProgress);
                const normal = filmSizeFromRating({ ...graphNode, isCenter: false });
                w = normal.w + (w - normal.w) * t;
                h = normal.h + (h - normal.h) * t;
              }
              if (graphNode.id === centerTransition.prevId) {
                const t = easeOutCubic(transitionProgress);
                const normal = filmSizeFromRating({ ...graphNode, isCenter: false });
                const hero = filmSizeFromRating({ ...graphNode, isCenter: true });
                w = hero.w + (normal.w - hero.w) * t;
                h = hero.h + (normal.h - hero.h) * t;
              }
            }

            const isHovered = hoveredId === graphNode.id || tappedNodeId === graphNode.id;
            const isConnected = hoveredId ? connectedNodeIds.has(graphNode.id) : false;
            const isFilterMiss = selectedPlatforms.length > 0 && !movieMatchesPlatformFilter(graphNode);
            const availability = streamingByMovieId[graphNode.tmdbId];
            const badgePlatforms = availability?.all?.slice(0, 3) ?? [];

            if (graphNode.isCenter) {
              const pulse = 1 + 0.15 * (0.5 + 0.5 * Math.sin(Date.now() / 320));
              const pw = w * pulse;
              const ph = h * pulse;
              ctx.beginPath();
              ctx.roundRect(x - pw / 2, y - ph / 2, pw, ph, 14);
              ctx.strokeStyle = "rgba(201,168,76,0.45)";
              ctx.lineWidth = 3;
              ctx.stroke();
            }

            if (pendingMovieId && pendingMovieId === graphNode.tmdbId) {
              ctx.beginPath();
              ctx.roundRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12, 12);
              ctx.strokeStyle = "rgba(255,255,255,0.95)";
              ctx.lineWidth = 2;
              ctx.stroke();
            }

            if (isHovered || isConnected) {
              ctx.fillStyle = isHovered ? "rgba(255,255,255,0.15)" : "rgba(201,168,76,0.18)";
              ctx.fillRect(x - w / 2 - 5, y - h / 2 - 5, w + 10, h + 10);
            }

            ctx.save();
            if (isFilterMiss) {
              ctx.filter = "grayscale(100%) opacity(35%)";
            }
            ctx.beginPath();
            ctx.roundRect(x - w / 2, y - h / 2, w, h, 10);
            ctx.closePath();
            ctx.clip();

            if (graphNode.posterPath) {
              const image = loadImage(`${IMAGE_BASE}${graphNode.posterPath}`);
              if (image.status === "loaded") {
                ctx.drawImage(image.img, x - w / 2, y - h / 2, w, h);
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
            if (selectedPlatforms.length > 0 && !isFilterMiss) {
              ctx.strokeStyle = "rgba(255,215,107,0.95)";
              ctx.lineWidth = graphNode.isCenter ? 3.4 : 2.2;
            } else {
              ctx.strokeStyle = graphNode.isCenter ? "#C9A84C" : "rgba(255,255,255,0.55)";
              ctx.lineWidth = graphNode.isCenter ? 3 : 1.4;
            }
            ctx.stroke();

            if (badgePlatforms.length > 0) {
              const badgeSize = 12;
              badgePlatforms.forEach((platform, index) => {
                const meta = PLATFORM_META[platform];
                const icon = loadImage(meta.logoUrl);
                const bx = x + w / 2 - (badgeSize + 2) * (badgePlatforms.length - index);
                const by = y - h / 2 - badgeSize / 2;
                ctx.beginPath();
                ctx.arc(bx + badgeSize / 2, by + badgeSize / 2, badgeSize / 2 + 1.2, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(10,10,14,0.95)";
                ctx.fill();
                if (icon.status === "loaded") {
                  ctx.drawImage(icon.img, bx, by, badgeSize, badgeSize);
                }
              });
            }

            if (graphNode.isCenter) {
              ctx.fillStyle = "#ffffff";
              ctx.font = `700 ${Math.max(16, 16 / globalScale)}px IBM Plex Sans, sans-serif`;
              ctx.textAlign = "center";
              ctx.fillText(graphNode.title ?? "Untitled", x, y + h / 2 + 24);

              ctx.fillStyle = "#C9A84C";
              ctx.font = `600 ${Math.max(13, 13 / globalScale)}px IBM Plex Sans, sans-serif`;
              ctx.fillText(`${graphNode.year ?? "N/A"} • ${graphNode.rating?.toFixed(1) ?? "N/A"}`, x, y + h / 2 + 44);
            } else if (isHovered) {
              const rating = graphNode.rating?.toFixed(1) ?? "N/A";
              const badgeText = `IMDb ${rating}`;
              const fontSize = Math.max(10, 10 / globalScale);
              ctx.font = `700 ${fontSize}px IBM Plex Sans, sans-serif`;
              const textWidth = ctx.measureText(badgeText).width;
              const padX = 8;
              const padY = 4;
              const bw = textWidth + padX * 2;
              const bh = fontSize + padY * 2;
              const bx = x - bw / 2;
              const by = y + h / 2 + 7;

              ctx.beginPath();
              ctx.roundRect(bx, by, bw, bh, 7);
              ctx.fillStyle = "rgba(10,10,14,0.92)";
              ctx.fill();
              ctx.strokeStyle = "rgba(255,215,107,0.95)";
              ctx.lineWidth = 1.1;
              ctx.stroke();

              ctx.fillStyle = "#ffd76b";
              ctx.textAlign = "center";
              ctx.fillText(badgeText, x, by + bh - padY - 1);
            }
            return;
          }

          const radius = 20;
          const isHovered = hoveredId === graphNode.id || tappedNodeId === graphNode.id;
          const isConnected = hoveredId ? connectedNodeIds.has(graphNode.id) : false;
          const fill = roleColor(graphNode.role);
          if (graphNode.profilePath) {
            const image = loadImage(`${IMAGE_BASE}${graphNode.profilePath}`);
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.closePath();
            ctx.clip();
            if (image.status === "loaded") {
              ctx.drawImage(image.img, x - radius, y - radius, radius * 2, radius * 2);
            } else {
              ctx.fillStyle = fill;
              ctx.fill();
            }
            ctx.restore();
          } else {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = fill;
            ctx.globalAlpha = isConnected || isHovered ? 1 : 0.9;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, 2 * Math.PI);
          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.lineWidth = isHovered ? 2.6 : 1.4;
          ctx.stroke();

          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.font = `700 ${Math.max(13, 13 / globalScale)}px IBM Plex Sans, sans-serif`;
          if (!graphNode.profilePath) {
            const initialsText = initials(graphNode.name);
            ctx.strokeStyle = "rgba(0,0,0,0.55)";
            ctx.lineWidth = 3;
            ctx.strokeText(initialsText, x, y + 4);
            ctx.fillText(initialsText, x, y + 4);
          }

          const label = shortName(graphNode.name, 20);
          const labelFont = Math.max(9, 9 / globalScale);
          ctx.font = `600 ${labelFont}px IBM Plex Sans, sans-serif`;
          const labelW = ctx.measureText(label).width + 10;
          const labelH = labelFont + 6;
          const labelX = x - labelW / 2;
          const labelY = y + radius + 6;
          ctx.beginPath();
          ctx.roundRect(labelX, labelY, labelW, labelH, 6);
          ctx.fillStyle = "rgba(10,10,14,0.82)";
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          ctx.fillText(label, x, labelY + labelH - 4);

          if (isHovered && graphNode.name) {
            const label = `${graphNode.name} • ${graphNode.role ?? "Person"}`;
            const fontSize = Math.max(11, 11 / globalScale);
            ctx.font = `600 ${fontSize}px IBM Plex Sans, sans-serif`;
            const textWidth = ctx.measureText(label).width;
            const padX = 9;
            const padY = 5;
            const boxW = textWidth + padX * 2;
            const boxH = fontSize + padY * 2;
            const boxX = x - boxW / 2;
            const boxY = y + radius + 8;

            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, boxH, 7);
            ctx.fillStyle = "rgba(10,10,14,0.94)";
            ctx.fill();
            ctx.strokeStyle = `${fill}cc`;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.textAlign = "center";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(label, x, boxY + boxH - padY - 1);
          }
        }}
      />

      {tooltip?.nodeId && (() => {
        const node = nodeById.get(tooltip.nodeId);
        if (!node) return null;
        if (node.type === "person") return null;

        const director = getMovieDirectorName(node.id);
        const availability = streamingByMovieId[node.tmdbId];
        const renderPlatforms = (platforms?: StreamingPlatformKey[]) => {
          if (!platforms || platforms.length === 0) return "None";
          return platforms.map((platform) => PLATFORM_META[platform].shortLabel).join(", ");
        };
        return (
          <div
            className="pointer-events-none absolute z-40 transition-opacity duration-200"
            style={{ left: tooltip.x, top: tooltip.y - 24, transform: "translate(-50%, -100%)" }}
          >
            <div className="flex w-72 gap-3 rounded-xl border border-zinc-700 bg-zinc-950/90 p-3 text-xs text-white shadow-2xl backdrop-blur">
              <div className="h-[90px] w-[60px] overflow-hidden rounded-md bg-zinc-800">
                {node.posterPath ? (
                  <NextImage
                    src={`${IMAGE_BASE}${node.posterPath}`}
                    alt={node.title ?? "Poster"}
                    width={60}
                    height={90}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{node.title}</p>
                <p className="text-zinc-300">{node.year ?? "N/A"} • {node.rating?.toFixed(1) ?? "N/A"}</p>
                <p className="mt-1 truncate text-zinc-300">Director: {director}</p>
                <p className="mt-2 font-semibold text-zinc-200">Where to Watch</p>
                <p className="truncate text-zinc-300">Stream: {renderPlatforms(availability?.subscription)}</p>
                <p className="truncate text-zinc-300">Rent: {renderPlatforms(availability?.rent)}</p>
                <p className="truncate text-zinc-300">Buy: {renderPlatforms(availability?.buy)}</p>
                <p className="mt-2 text-[#c9a84c]">Click to explore</p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
