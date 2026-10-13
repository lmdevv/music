import type { PageResult } from "@/components/library/paged";

/**
 * Reads a paginated list once, page after page, until it ends or holds `max` items. Each request
 * needs the previous page's cursor, so pages load one after another.
 */
export const readPages = async <Item>(
  read: (cursor: string | null) => Promise<PageResult<Item>>,
  max: number,
): Promise<ReadonlyArray<Item>> => {
  const collect = async (
    cursor: string | null,
    loaded: ReadonlyArray<Item>,
  ): Promise<ReadonlyArray<Item>> => {
    const page = await read(cursor);
    const items = [...loaded, ...page.items];

    return page.done || items.length >= max ? items.slice(0, max) : collect(page.cursor, items);
  };

  return collect(null, []);
};
