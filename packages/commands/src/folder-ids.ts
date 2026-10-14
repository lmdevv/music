/**
 * Folder identities that survive every way of naming a folder. A path, even resolved through
 * links, can still differ for the same folder: a bind mount shows one folder at two paths, and
 * resolving paths does not see through it. A folder's device and inode (`<dev>:<ino>`) are the
 * same under any name, so the media service reports them for a library's folder and every folder
 * above it, up to `/`, and Convex compares those chains.
 */

/**
 * A folder's identity and its parents' up to `/`, the folder itself first. Built by the media
 * service from `stat`; each entry is `<device>:<inode>`.
 */
export type FolderChain = ReadonlyArray<string>;

/**
 * Whether two folders are the same, or one sits inside the other, whatever paths they were
 * reached by: one folder's own identity appears in the other's chain.
 */
export const chainsOverlap = (left: FolderChain, right: FolderChain): boolean => {
  const [leftRoot] = left;
  const [rightRoot] = right;

  return (
    (leftRoot !== undefined && right.includes(leftRoot)) ||
    (rightRoot !== undefined && left.includes(rightRoot))
  );
};
