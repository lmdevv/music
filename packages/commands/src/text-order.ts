/**
 * Orders text by code point, as Convex orders index keys, rather than by UTF-16 unit as `<` and
 * `Array.prototype.sort` do: the two disagree when one string has a character beyond U+FFFF (an
 * emoji) where the other has one from U+E000 to U+FFFF. Anything that merges or splits Convex
 * index ranges must agree with the index.
 */
export const compareText = (left: string, right: string): number => {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);

  for (let position = 0; position < length; position += 1) {
    const difference = (leftPoints[position] ?? 0) - (rightPoints[position] ?? 0);

    if (difference !== 0) return difference;
  }

  return leftPoints.length - rightPoints.length;
};
