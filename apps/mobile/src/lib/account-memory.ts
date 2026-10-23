/**
 * The account this install last signed in to on its server, kept in the keychain. A launch with
 * no connection opens that account's downloads with it, before the server can say who is signed in.
 */
import { UserId } from "@music/commands/ids";
import { Option, Schema } from "effect";

import { readValue, writeValue } from "./secure-storage";
import { ServerOrigin } from "./server";

const RememberedAccount = Schema.fromJsonString(
  Schema.Struct({ origin: ServerOrigin, userId: UserId }),
);

const KEY = "music.account";

const decodeStored = Schema.decodeUnknownOption(RememberedAccount);

const encodeStored = Schema.encodeSync(RememberedAccount);

/** The account last signed in to on `origin`, or null when none is remembered for it. */
export const loadAccount = (origin: ServerOrigin): UserId | null =>
  Option.match(decodeStored(readValue(KEY)), {
    onNone: () => null,
    onSome: (stored) => (stored.origin === origin ? stored.userId : null),
  });

/** Remembers the account signed in to on `origin`, or forgets it with null. */
export const saveAccount = (origin: ServerOrigin, userId: UserId | null): void => {
  writeValue(KEY, userId === null ? null : encodeStored({ origin, userId }));
};
