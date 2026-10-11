import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

const LibrariesSearch = Schema.Struct({ add: Schema.optionalKey(Schema.String) });

export const Route = createFileRoute("/_app/settings/libraries")({
  validateSearch: Schema.toStandardSchemaV1(LibrariesSearch),
  component: () => <div className="p-12">Coming soon</div>,
});
