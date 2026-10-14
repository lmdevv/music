/**
 * Who may do what. Every command names the capability it needs (`access` in the registry), and
 * the backend, the web app, the command menu, and the CLI all ask this module, so a rule changed
 * here changes everywhere at once.
 */
import type { AssignableRole, Role } from "./models";

/**
 * What a command needs from the caller's role:
 *
 * - `user`: anyone signed in, guests included: listen, and keep your own likes, history, and
 *   playlists.
 * - `keys`: create and revoke API keys for the CLI and agents. Not guests.
 * - `admin`: run the server: people, invites, password reset links, libraries, and jobs.
 * - `owner`: hand the server to someone else.
 */
export type Capability = "user" | "keys" | "admin" | "owner";

const CAPABILITIES: Readonly<Record<Role, ReadonlySet<Capability>>> = {
  owner: new Set(["user", "keys", "admin", "owner"]),
  admin: new Set(["user", "keys", "admin"]),
  member: new Set(["user", "keys"]),
  guest: new Set(["user"]),
};

/** Whether `role` has `capability`. */
export const can = (role: Role, capability: Capability): boolean =>
  CAPABILITIES[role].has(capability);

/** Roles from least to most trusted. */
const RANK: Readonly<Record<Role, number>> = { guest: 0, member: 1, admin: 2, owner: 3 };

/** Every role an invite or a role change can give, most trusted first. */
const ASSIGNABLE: ReadonlyArray<AssignableRole> = ["admin", "member", "guest"];

/**
 * The roles `actor` may give through an invite or a role change: never `owner` (that takes a
 * transfer), and never a role above the actor's own. Empty for people who cannot manage others.
 */
export const assignableRoles = (actor: Role): ReadonlyArray<AssignableRole> =>
  can(actor, "admin") ? ASSIGNABLE.filter((role) => RANK[role] <= RANK[actor]) : [];

/** The parts of a person the rules below look at. */
export interface PersonRef {
  readonly id: string;
  readonly role: Role;
}

/**
 * Whether `actor` may change `target`'s role, suspend, reset, or remove them. Nobody changes their
 * own account this way, the owner is out of reach until they transfer ownership, and only the
 * owner manages admins.
 */
export const canManagePerson = (actor: PersonRef, target: PersonRef): boolean =>
  can(actor.role, "admin") &&
  actor.id !== target.id &&
  target.role !== "owner" &&
  // An admin who could reset or demote another admin could take over their private libraries.
  (target.role !== "admin" || can(actor.role, "owner"));

/**
 * Whether `actor` may change who listens to a library: its visibility and its access list. Only
 * the library's own owner may, so no admin can let themselves or anyone else into a library that
 * is not theirs. Admins still rename, rescan, and remove every library. A library whose owner is
 * removed moves to the server's owner, who then decides.
 */
export const canChangeLibraryAccess = (
  actor: PersonRef,
  library: { readonly ownerId: string },
): boolean => can(actor.role, "admin") && library.ownerId === actor.id;

/** Whether `actor` may make `target` the owner: only the owner, and only to an admin. */
export const canTransferOwnership = (
  actor: PersonRef,
  target: PersonRef & { readonly suspended: boolean },
): boolean =>
  can(actor.role, "owner") &&
  actor.id !== target.id &&
  target.role === "admin" &&
  !target.suspended;

const CAPABILITY_LABELS: Readonly<Record<Capability, string>> = {
  user: "any user",
  keys: "members and admins; not guests",
  admin: "admins only",
  owner: "the owner only",
};

/** Who has a capability, for help text. */
export const capabilityLabel = (capability: Capability): string => CAPABILITY_LABELS[capability];

const FORBIDDEN_MESSAGES: Readonly<Record<Capability, string>> = {
  user: "Sign in first",
  keys: "Guests can't use API keys",
  admin: "Only an admin can do that",
  owner: "Only the owner can do that",
};

/** The message for a caller who lacks `capability`. */
export const forbiddenMessage = (capability: Capability): string => FORBIDDEN_MESSAGES[capability];

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

/** A role as people read it. */
export const roleLabel = (role: Role): string => ROLE_LABELS[role];
