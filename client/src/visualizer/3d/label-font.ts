// Bundled font for all 3D text (drei/troika <Text>).
//
// Without an explicit font, troika preloads font metadata over the network
// (unicode-font-resolver on a CDN). drei's <Text> suspends during that
// preload, and if the machine is offline the promise never settles — React
// then hides the whole surrounding <Suspense> subtree, blanking the scene.
// This bit the standalone single-file build, which must work offline.
//
// Bundling a local woff (troika supports woff v1, not woff2) makes font
// loading instant and network-free; the standalone build inlines it as a
// data URI. Latin subset is enough for table names.
import interWoff from "@fontsource/inter/files/inter-latin-400-normal.woff?url";

export const LABEL_FONT = interWoff;
