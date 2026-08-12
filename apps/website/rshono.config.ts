import { defineConfig } from "@rshono/core";

/** Workspace packages that must be bundled rather than left as runtime imports. */
const WORKSPACE_SCOPE = "@cpd/";

export default defineConfig({
  deploy: "cloudflare",

  /**
   * Bundle the workspace packages into the server build instead of leaving them
   * as external imports.
   *
   * A Node server build externalises bare specifiers by default — sensible for
   * real dependencies, wrong for these. Left external, `@cpd/react` is loaded by
   * Node at runtime from `packages/react/dist`, where it resolves its own copy
   * of `react` rather than the one the RSC server bundle set up. Two React
   * instances means two internal dispatchers, and a hook called from the library
   * half finds the half that is not currently rendering:
   *
   *     TypeError: Cannot read properties of null (reading 'useRef')
   *
   * Bundling them puts the library and the renderer on the same React. Note this
   * is a *monorepo* concern: an app consuming these from npm gets one copy in
   * its own `node_modules` and needs none of this.
   *
   * Aliasing `react` itself would also collapse the instances, but it defeats
   * the `exports` conditions and the server build then fails with "the
   * react-server condition must be enabled".
   */
  rspack(config, { isServer }) {
    if (!isServer) return config;

    type ExternalItem = Extract<
      NonNullable<typeof config.externals>,
      readonly unknown[]
    >[number];
    type ExternalsCallback = (error?: Error | null, result?: string) => void;

    const originals = (
      Array.isArray(config.externals) ? config.externals : [config.externals]
    ).filter((external): external is ExternalItem => external !== undefined);
    const delegate = originals.find(
      (external) => typeof external === "function",
    );

    const bundleWorkspacePackages = (
      data: { request?: string },
      callback: ExternalsCallback,
    ): void => {
      // Calling back with no result means "nothing claimed this as external",
      // so it gets bundled. Deliberately does not consult the original.
      if (data.request?.startsWith(WORKSPACE_SCOPE)) return callback();

      if (typeof delegate === "function") {
        return (delegate as (d: unknown, c: ExternalsCallback) => void)(
          data,
          callback,
        );
      }
      return callback();
    };

    config.externals = [
      // Rspack accepts this callback form at runtime — rshono's own externals
      // entry uses it — but its published `ExternalItem` type only describes the
      // synchronous form. The cast is on the type, not on the behaviour.
      bundleWorkspacePackages as unknown as ExternalItem,
      ...originals.filter((external) => typeof external !== "function"),
    ];

    return config;
  },
});
