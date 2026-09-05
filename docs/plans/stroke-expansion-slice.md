# Stroke expansion: evidence and next slice

Status: investigation, not integrated or craft-qualified. 5 September 2026.

A057 achieved tangent outer ticket mouths but leaves approximately30-degree internal cap-to-arc joins. See ../log/positive-transition-audit-2026-09-05.json. Isolated PathKit derivations of the actual AI ticket and rounded bookmark show why a reusable expansion operation merits evaluation. A058 tests whether existing primitives can produce the bookmark counterpart before changing the engine.

Extend the existing host geometry boundary in packages/iconsmith/src/tools/boolean.ts or a sibling stroke module. Keep models on constrained recipes; do not expose raw path strings. Before changing the DSL, define whether an operation expands a centerline only or also unions a closed contour interior. Those are different operations: an expanded closed line is a ring, not automatically a solid silhouette. Preserve current line semantics rather than silently filling its interior.

Integration prerequisites:

- Resolve synchronous Canvas/compileStyle versus asynchronous WASM initialization without making static iconsmith/spec import the kernel. Verify built CLI asset resolution as well as source execution.
- Preserve nested construction recipes and exact replay; bump compiler revision and retain historical artifacts. Treat a ready initialization promise or availability check as insufficient evidence of geometry correctness.
- Validate rounded open strokes, closed rings, closed interior union, concave transitions, subtraction of overlapping counters and invalid/empty input. Keep computed handles and offsets off the placement grid.
- Check the entire affected boundary, including closure and curve-to-curve joins. Selected tangent endpoints are insufficient. Inspect native24 and16 rasters, pair extents and source neighbors; retain optical differences.
- Own and dispose every WASM path; check Boolean return status. The isolated probe is exploratory and is not the production error-handling contract.

A058 finished with structural delivery but a visible stray slit and uneven fold (../log/bookmark-filled-result-2026-09-05.json). Together with D044, this supports proceeding to a constrained stroke-expansion slice. Do not add a second permanent Boolean engine merely because the probe works; choose the smallest boundary that satisfies measured stroke expansion while retaining current behavior. No training or API spend is needed for the kernel evaluation.
