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
  /**
   * The height in pixels an empty block keeps: its last rendered height, or the estimate until it
   * has rendered.
   */
  readonly height: number | null;
}

/** Options for {@link useWindowed}. */
export interface WindowedOptions {
  /**
   * Whether the block renders before the first intersection check. The blocks at the top of a list
   * do, so the list shows at once; blocks further down wait until they are near.
   */
  readonly initiallyNear?: boolean;
  /** The block's height before it has rendered, such as its row count times a row's height. */
  readonly estimate?: number | null;
}

/**
 * Windowing for a long list rendered in blocks (pages of songs, or a long playlist cut into
 * blocks): a block far from the visible part of the list renders an empty box of its height
 * instead of its rows, so the page holds a few hundred rows however long the list is, and the
 * scrollbar stays put.
 */
export const useWindowed = ({
  initiallyNear = true,
  estimate = null,
}: WindowedOptions = {}): Windowed => {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(initiallyNear);
  const [measured, setMeasured] = useState<number | null>(null);

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

      if (size !== undefined && size > 0) setMeasured(size);
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [node, near]);

  const height = measured ?? estimate;

  // A block with no height to keep renders its rows, so it can't collapse to nothing.
  return { ref: setNode, near: near || height === null, height };
};
