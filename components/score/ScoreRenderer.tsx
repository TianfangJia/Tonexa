"use client";
// ── Verovio-based MusicXML score renderer ─────────────────────────────────
// Renders MusicXML → SVG via Verovio (loaded once, WASM inline).
// Responsive model:
//   - Engraving "scale" is fixed per Tailwind breakpoint (md=768, xl=1280),
//     so notehead pixel size is constant within a tier.
//   - Verovio's pageWidth tracks the container pixel width, so when the
//     viewport narrows, Verovio's auto line-breaking redistributes measures
//     into more systems (e.g. 8 bars → 1 line → 4+4 → 3+3+2).
// Exposes imperative methods via ref for cursor movement and note coloring.

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
} from "react";

export interface ScoreRendererHandle {
  /** Highlight a specific measure (1-indexed). Pass null to clear. */
  highlightMeasure: (measureNumber: number | null) => void;
  /** Move the cursor to the given note index (0-based, matches melody.notes order). */
  setCursorIndex: (index: number) => void;
  /** Show or hide the cursor line. */
  showCursor: (visible: boolean) => void;
  /** Color the notehead at a melody.notes index. */
  colorNote: (noteIndex: number, color: string) => void;
  /** Reset all notehead colors to default. */
  clearNoteColors: () => void;
}

interface Props {
  musicXml: string;
  className?: string;
  /** Called after each render with the natural content height in CSS pixels. */
  onContentHeightChange?: (px: number) => void;
  /** Enables click/drag-to-seek. Fires with the melody.notes index nearest
   *  the pointer. Drag is tracked while the mouse button is held down. */
  onSeek?: (noteIndex: number) => void;
  /** Verovio `spacingSystem` override — vertical gap between systems, in
   *  Verovio units. Default 6 (moderate). Lower values compress multi-line
   *  scores (useful for pitch mode where each measure holds one whole note). */
  spacingSystem?: number;
  /** Verovio `justificationSystem` override. Default 1.0 (stretch each
   *  system to full width). Pass 0 to leave the system at its natural width
   *  — useful for short scores that would otherwise look oversized. */
  justificationSystem?: number;
}

// Singleton: load Verovio once and reuse across component instances.
let verovioModulePromise: Promise<unknown> | null = null;
function loadVerovioModule(): Promise<unknown> {
  if (!verovioModulePromise) {
    verovioModulePromise = (async () => {
      const [wasm, esm] = await Promise.all([
        import("verovio/wasm" as string),
        import("verovio/esm" as string),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const VerovioModule = await (wasm as any).default();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { VerovioModule, VerovioToolkit: (esm as any).VerovioToolkit };
    })();
  }
  return verovioModulePromise;
}

// Tailwind breakpoints: md=768, xl=1280.
// "scale" is in Verovio percent units. At scale=100, Verovio's internal page
// units render 1:1 as SVG pixels, so notehead pixel size ≈ staff-space × scale/100.
function scaleForWidth(px: number): number {
  if (px >= 1280) return 70; // xl  — comfortable desktop
  if (px >= 768)  return 55; // md  — tablet / small laptop
  return 42;                 // sm  — phone / narrow panel
}

// Even distribution of measures across N systems: bigger groups come first,
// using ceiling division so the "overflow" is absorbed in earlier systems.
// Examples: (8, 2) → [4,4]; (8, 3) → [3,3,2]; (10, 3) → [4,3,3].
function evenBreakpoints(total: number, numSystems: number): number[] {
  const out: number[] = [];
  let remaining = total;
  for (let i = 0; i < numSystems; i++) {
    const count = Math.ceil(remaining / (numSystems - i));
    out.push(count);
    remaining -= count;
  }
  return out;
}

// Insert <print new-system="yes"/> elements into a MusicXML string so that
// measures are grouped per the given breakpoints. We operate on the first
// <part> only (practice melodies are single-part).
function insertSystemBreaks(musicXml: string, breakpoints: number[]): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(musicXml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return musicXml;

  const firstPart = doc.getElementsByTagName("part")[0];
  if (!firstPart) return musicXml;
  const measures = Array.from(firstPart.getElementsByTagName("measure"));
  if (measures.length < 2) return musicXml;

  // Strip any pre-existing system/page breaks so our layout wins.
  Array.from(doc.getElementsByTagName("print")).forEach((el) => {
    const hasSys  = el.getAttribute("new-system") === "yes";
    const hasPage = el.getAttribute("new-page")   === "yes";
    if (!hasSys && !hasPage) return;
    el.removeAttribute("new-system");
    el.removeAttribute("new-page");
    // If the <print> carried only break attrs, drop it entirely.
    if (el.attributes.length === 0 && el.childNodes.length === 0) {
      el.parentNode?.removeChild(el);
    }
  });

  // Insert a system break at the first measure of each system after the first.
  let idx = 0;
  for (let sys = 0; sys < breakpoints.length - 1; sys++) {
    idx += breakpoints[sys];
    if (idx >= measures.length) break;
    const target = measures[idx];
    const printEl = doc.createElement("print");
    printEl.setAttribute("new-system", "yes");
    target.insertBefore(printEl, target.firstChild);
  }

  return new XMLSerializer().serializeToString(doc);
}

const ScoreRenderer = forwardRef<ScoreRendererHandle, Props>(
  ({ musicXml, className, onContentHeightChange, onSeek, spacingSystem, justificationSystem }, ref) => {
    const wrapperRef    = useRef<HTMLDivElement>(null);
    const svgRef        = useRef<HTMLDivElement>(null);
    const overlayRef    = useRef<HTMLDivElement | null>(null);

    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState<string | null>(null);
    const [containerWidth, setContainerWidth] = useState<number | null>(null);

    // noteIndex → SVG group element  (g.note or g.rest, DOM order = score order)
    const noteMapRef    = useRef<Map<number, SVGElement>>(new Map());
    // measureNumber (1-based) → SVG group element
    const measureMapRef = useRef<Map<number, Element>>(new Map());

    const cursorVisibleRef = useRef(false);
    const cursorIndexRef   = useRef(0);

    // ── Click / drag to seek ──────────────────────────────────────────────
    // Attached to svgRef. On mousedown and while dragging, find the note
    // whose horizontal center is closest to the pointer (within the same
    // system row) and emit onSeek with its melody.notes index.
    useEffect(() => {
      if (!onSeek) return;
      const container = svgRef.current;
      if (!container) return;

      const findNearestNote = (cx: number, cy: number): number | null => {
        let bestIdx = -1;
        let bestDx  = Infinity;
        const Y_TOLERANCE = 40; // px outside staff still counts as same row
        noteMapRef.current.forEach((el, idx) => {
          const r = (el as Element).getBoundingClientRect();
          if (cy < r.top - Y_TOLERANCE || cy > r.bottom + Y_TOLERANCE) return;
          const dx = Math.abs(cx - (r.left + r.width / 2));
          if (dx < bestDx) { bestIdx = idx; bestDx = dx; }
        });
        return bestIdx === -1 ? null : bestIdx;
      };

      let dragging = false;
      const onDown = (e: MouseEvent) => {
        const idx = findNearestNote(e.clientX, e.clientY);
        if (idx === null) return;
        dragging = true;
        onSeek(idx);
        e.preventDefault();
      };
      const onMove = (e: MouseEvent) => {
        if (!dragging) return;
        const idx = findNearestNote(e.clientX, e.clientY);
        if (idx !== null) onSeek(idx);
      };
      const onUp = () => { dragging = false; };

      container.addEventListener("mousedown", onDown);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup",   onUp);
      container.style.cursor = "grab";
      return () => {
        container.removeEventListener("mousedown", onDown);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup",   onUp);
        container.style.cursor = "";
      };
    }, [onSeek]);

    // ── Observe container width (bucketed to 40px to avoid thrashing) ─────
    // useLayoutEffect so we measure *after* flex layout has resolved and
    // before the render effect runs for the first time.
    useLayoutEffect(() => {
      const el = wrapperRef.current;
      if (!el) return;

      let lastBucket = 0;
      const update = (w: number) => {
        const bucket = Math.max(320, Math.round(w / 40) * 40);
        if (bucket !== lastBucket) {
          lastBucket = bucket;
          setContainerWidth(bucket);
        }
      };

      const initial = el.getBoundingClientRect().width || el.clientWidth;
      update(initial);

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) update(entry.contentRect.width);
      });
      observer.observe(el);

      return () => observer.disconnect();
    }, []);

    // ── Render ─────────────────────────────────────────────────────────────
    useEffect(() => {
      const svgContainer = svgRef.current;
      if (!svgContainer || !musicXml || !containerWidth) return;
      let cancelled = false;

      (async () => {
        setLoading(true);
        setError(null);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { VerovioModule, VerovioToolkit } = (await loadVerovioModule()) as any;
          if (cancelled) return;

          const toolkit = new VerovioToolkit(VerovioModule);

          const scale = scaleForWidth(containerWidth);
          // Verovio: at scale=100, SVG pixel width == pageWidth. At other scales,
          // SVG pixel width == pageWidth * scale/100. So to make the natural SVG
          // render at ~containerWidth px, we pick pageWidth accordingly.
          // This is what drives Verovio's auto line-breaking when the viewport shrinks.
          const pageWidthVrv = Math.min(
            100000,
            Math.max(300, Math.round((containerWidth * 100) / scale)),
          );

          const commonOpts = {
            scale,
            pageWidth: pageWidthVrv,
            pageHeight: 60000,
            adjustPageHeight: true,
            svgViewBox: true,
            svgHtml5: true,
            // Justify every system to the full pageWidth — including the last
            // (shorter) system in a 3+3+2 split. Default min is 0.8 which would
            // leave a short last line unjustified.
            justificationSystem: justificationSystem ?? 1.0,
            minLastJustification: 0,
            spacingSystem: spacingSystem ?? 6,
            spacingLinear: 0.25,
            spacingNonLinear: 0.5,
            pageMarginLeft: 20,
            pageMarginRight: 20,
            pageMarginTop: 20,
            pageMarginBottom: 20,
          };

          // ── Pass 1: let Verovio decide natural line-breaking ──────────────
          toolkit.setOptions({ ...commonOpts, breaks: "auto" });
          toolkit.loadData(musicXml);

          const pageCount: number = toolkit.getPageCount();
          let html = "";
          for (let p = 1; p <= pageCount; p++) {
            html += toolkit.renderToSVG(p);
          }

          // Count how many systems Verovio used and how many measures exist.
          const probe = document.createElement("div");
          probe.innerHTML = html;
          const systemsUsed  = probe.querySelectorAll("g.system").length;
          const measuresUsed = probe.querySelectorAll("g.measure").length;

          // ── Pass 2: if music wrapped to >1 system, redistribute evenly ────
          if (systemsUsed > 1 && measuresUsed >= systemsUsed) {
            const breakpoints = evenBreakpoints(measuresUsed, systemsUsed);
            const evenXml     = insertSystemBreaks(musicXml, breakpoints);

            toolkit.setOptions({ ...commonOpts, breaks: "encoded" });
            toolkit.loadData(evenXml);

            const p2Count = toolkit.getPageCount();
            html = "";
            for (let p = 1; p <= p2Count; p++) html += toolkit.renderToSVG(p);
          }

          if (cancelled) return;

          svgContainer.innerHTML = html;

          // Render at natural size so notehead pixel size stays fixed per tier.
          // Center horizontally inside the container if the music is narrower.
          svgContainer.querySelectorAll<SVGSVGElement>("svg").forEach((svg) => {
            svg.style.display = "block";
            svg.style.margin  = "0 auto";
          });

          // Report the rendered content height so the parent can auto-size
          // the score pane to fit exactly (1 system → short pane, N systems → tall).
          onContentHeightChange?.(svgContainer.scrollHeight);

          // ── Note map: DOM order matches score order ──────────────────────
          const noteMap = new Map<number, SVGElement>();
          svgContainer
            .querySelectorAll<SVGElement>("g.note, g.rest")
            .forEach((el, i) => noteMap.set(i, el));
          noteMapRef.current = noteMap;

          // ── Measure map: 1-indexed by DOM order ─────────────────────────
          const measureMap = new Map<number, Element>();
          svgContainer
            .querySelectorAll("g.measure")
            .forEach((el, i) => measureMap.set(i + 1, el));
          measureMapRef.current = measureMap;

          setLoading(false);

          // Re-place cursor since DOM was replaced.
          if (cursorVisibleRef.current) placeCursor(cursorIndexRef.current);
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "Score rendering failed");
            setLoading(false);
          }
        }
      })();

      return () => { cancelled = true; };
    }, [musicXml, containerWidth, spacingSystem, justificationSystem]);

    // ── Cursor helpers ──────────────────────────────────────────────────────
    // The cursor is drawn as an SVG <line> inside the rendered score SVG itself.
    // That way it lives in the SVG's viewBox coordinate system and scales /
    // positions correctly regardless of CSS margins, centering, or scroll.
    function clearCursor() {
      svgRef.current?.querySelectorAll(".score-cursor").forEach((el) => el.remove());
    }
    function placeCursor(index: number) {
      clearCursor();
      if (!cursorVisibleRef.current) return;

      const noteEl = noteMapRef.current.get(index) as SVGGraphicsElement | undefined;
      if (!noteEl) return;
      const svg = noteEl.ownerSVGElement;
      if (!svg) return;

      let noteBBox: DOMRect;
      try { noteBBox = noteEl.getBBox(); } catch { return; }

      // Prefer the containing staff for vertical extent — staff is always
      // emitted by Verovio. Fall back to the system or the note itself.
      const staff  = noteEl.closest("g.staff")  as SVGGraphicsElement | null;
      const system = noteEl.closest("g.system") as SVGGraphicsElement | null;
      const anchor = staff ?? system;
      const anchorBBox = anchor?.getBBox();

      const cx = noteBBox.x + noteBBox.width / 2;
      const y1 = (anchorBBox?.y ?? noteBBox.y) - 40;
      const y2 = (anchorBBox?.y ?? noteBBox.y)
               + (anchorBBox?.height ?? noteBBox.height) + 40;

      const NS = "http://www.w3.org/2000/svg";
      const line = document.createElementNS(NS, "line");
      line.setAttribute("class", "score-cursor");
      line.setAttribute("x1", String(cx));
      line.setAttribute("x2", String(cx));
      line.setAttribute("y1", String(y1));
      line.setAttribute("y2", String(y2));
      line.setAttribute("stroke", "rgba(37,99,235,0.85)");
      line.setAttribute("stroke-width", "18");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("pointer-events", "none");
      svg.appendChild(line);
    }

    // ── Imperative handle ───────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      highlightMeasure(measureNumber: number | null) {
        overlayRef.current?.remove();
        overlayRef.current = null;
        if (measureNumber === null) return;

        const wrapper   = wrapperRef.current;
        const measureEl = measureMapRef.current.get(measureNumber);
        if (!wrapper || !measureEl) return;

        const mr = measureEl.getBoundingClientRect();
        const wr = wrapper.getBoundingClientRect();

        const div = document.createElement("div");
        div.style.cssText = `
          position:absolute;
          top:${mr.top - wr.top}px; left:${mr.left - wr.left}px;
          width:${mr.width}px; height:${mr.height}px;
          background:rgba(0,97,244,0.12); border-radius:4px;
          pointer-events:none; z-index:5;
        `;
        wrapper.appendChild(div);
        overlayRef.current = div;
      },

      setCursorIndex(index: number) {
        cursorIndexRef.current = index;
        placeCursor(index);
      },

      showCursor(visible: boolean) {
        cursorVisibleRef.current = visible;
        if (!visible) clearCursor();
        else          placeCursor(cursorIndexRef.current);
      },

      colorNote(noteIndex: number, color: string) {
        const el = noteMapRef.current.get(noteIndex);
        if (el) applyColor(el, color);
      },

      clearNoteColors() {
        noteMapRef.current.forEach((el) => applyColor(el, ""));
      },
    }));

    return (
      <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20">
            <span className="text-sm text-zinc-400">Loading score…</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-20">
            <span className="text-sm text-red-500">{error}</span>
          </div>
        )}
        <div ref={svgRef} className="w-full" />
      </div>
    );
  }
);

/** Color only the notehead(s) inside a note/rest group — leave stems,
 *  beams, flags, dots, ledger lines untouched. */
function applyColor(el: SVGElement, color: string): void {
  // Verovio wraps each notehead in <g class="notehead">. For rests the whole
  // group is the visual, so fall back to coloring the group itself.
  const heads = el.querySelectorAll<SVGElement>("g.notehead");
  const targets: SVGElement[] = heads.length > 0 ? Array.from(heads) : [el];

  for (const t of targets) {
    t.querySelectorAll<SVGElement>("path, use, rect, polygon, ellipse, circle").forEach((child) => {
      child.style.fill   = color;
      child.style.color  = color; // drives currentColor inside <use> symbols
      child.style.stroke = color === "" ? "" : "none";
    });
    t.style.fill  = color;
    t.style.color = color;
  }
}

ScoreRenderer.displayName = "ScoreRenderer";
export default ScoreRenderer;
