/** The bundled blode-icons library: the house set, vendored from its git-tracked
 *  package files so no sibling checkout is needed. `SOURCE.json` records the
 *  upstream commit. */
import path from "node:path";

export const BLODE_ICONS_PACKAGE = path.resolve(
  import.meta.dirname,
  "../library/blode-icons"
);
export const BLODE_ICONS_SVG_URL = new URL(
  "../library/blode-icons/icons-svg/",
  import.meta.url
);
