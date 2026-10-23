/**
 * What the pages read from this phone's downloads while the server is out of reach: Home's rail
 * of downloaded albums (D14), and an album or playlist page the server can't load.
 */
import type { AlbumCard } from "@music/commands/models";
import type { OfflineAlbum } from "@music/sdk/downloads";

/** An album as a card draws it. */
export type CardAlbum = Pick<AlbumCard, "id" | "title" | "artist" | "artUrl" | "year">;

/** A downloaded album as a card: its cover from this phone, and no year, which it doesn't keep. */
export const cardOf = (album: OfflineAlbum): CardAlbum => ({
  id: album.albumId,
  title: album.title,
  artist: album.artist,
  artUrl: album.artUri,
  year: null,
});
