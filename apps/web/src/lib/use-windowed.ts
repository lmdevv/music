import { useEffect, useState } from "react";

import { scrollRootOf } from "./scroll-root";

/** How far past the visible part of the list a block stays rendered, as a share of its height. */
const WINDOW_MARGIN = "150% 0px";

/** Whether a block of a long list is rendered, and the height it keeps while it isn't. */
export interface Windowed {
  /** Attach to the block's wrapper. */
  readonly ref: (node: HTMLElement | null) => void;
  /** True while the block is within about a screen and a half of the visible part of the list. */
  readonly near: boolean;
  /** The block's last rendered height in pixels, kept by its empty wrapper while it is far. */
  readonly height: number | null;
}

/**
 * Windowing for a long list rendered in blocks (such as pages of songs): a block far from the
 * visible part of the list renders an empty box of its last height instead of its rows, so the
 * page holds a few hundred rows however far the list was scrolled, and the scrollbar stays put.
 * Blocks start out rendered, so a list shows at once and measures before it can leave.
 */
export const useWindowed = (): Windowed => {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(true);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (node === null) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);

        if (entry !== undefined) setNear(entry.isIntersecting);
      },
      { root: scrollRootOf(node), rootMargin: WINDOW_MARGIN },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [node]);

  // Measured only while the rows are there; an empty box keeps the last rendered height.
  useEffect(() => {
    if (node === null || !near) return undefined;

    const observer = new ResizeObserver((entries) => {
      const size = entries.at(-1)?.borderBoxSize[0]?.blockSize;

      if (size !== undefined && size > 0) setHeight(size);
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [node, near]);

  return { ref: setNode, near: near || height === null, height };
};
