import Loader from "blode-icons-react/icons/loader";

import { cn } from "@/lib/utils";

/**
 * The registry ships this wired to `IconPlaceholder`, a build-time helper that
 * only exists inside the blode-ui authoring repo, so it resolves to nothing
 * here. This is the same component against the icon pack the project uses.
 */
const Spinner = ({ className, ...props }: React.ComponentProps<"svg">) => (
  /* Decorative: the control that owns the spinner owns the busy semantics. */
  <Loader
    aria-hidden="true"
    className={cn("size-4 animate-spin", className)}
    data-slot="spinner"
    {...props}
  />
);

export { Spinner };
