import { createCn } from "cn/config";

const borderWidths = [{ border: ["hairline", "field"] }];

/**
 * Joins class names and resolves Tailwind conflicts. It knows the token names in
 * `styles/globals.css`, so `text-md` merges as a font size (not a colour), `border-hairline` as a
 * border width, and `rounded-sheet` as a radius.
 */
export const cn = createCn({
  extend: {
    theme: {
      text: [
        "md",
        "display",
        "phone-subhead",
        "phone-body",
        "phone-title",
        "phone-card",
        "phone-large-title",
      ],
      leading: ["xs", "sm", "base", "md", "lg", "xl", "2xl", "display"],
      tracking: ["display", "mono", "snug"],
      "font-weight": ["regular", "heavy"],
      radius: ["phone-art", "phone-card", "sheet"],
      shadow: [
        "dialog",
        "popover",
        "menu",
        "toast",
        "segment",
        "cover",
        "cover-phone",
        "glass",
        "command",
        "art-preview",
        "now-playing-art",
        "now-playing-art-sm",
        "now-playing-art-phone",
        "now-playing-thumb",
      ],
      spacing: [
        "row",
        "row-touch",
        "safe-top",
        "safe-top-sm",
        "safe-bottom",
        "safe-bottom-lg",
        "dvh-inset",
        "dvh-inset-sm",
        "dvh-sheet",
        "dvh-message",
      ],
      container: ["sidebar", "dialog", "content", "vw-inset"],
      blur: ["scrim"],
    },
    classGroups: {
      "border-w": borderWidths,
      "border-w-x": [{ "border-x": ["hairline", "field"] }],
      "border-w-y": [{ "border-y": ["hairline", "field"] }],
      "border-w-t": [{ "border-t": ["hairline", "field"] }],
      "border-w-r": [{ "border-r": ["hairline", "field"] }],
      "border-w-b": [{ "border-b": ["hairline", "field"] }],
      "border-w-l": [{ "border-l": ["hairline", "field"] }],
    },
  },
});
