/**
 * `parseIconSvg` is the only reader in the project that sees a whole icon.
 *
 * Every other reader that has scraped `d="…"` instead has been wrong, and the
 * failure is silent: the icon still parses, still measures, still lints, and
 * the answer is quietly computed from a fraction of the drawing. It has cost
 * four separate wrong measurements so far, so the shapes that are not `<path>`
 * get their own tests.
 */
import { describe, expect, it } from "vitest";

import { parseIconSvg } from "./load.js";

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${body}</svg>`;

describe("parseIconSvg", () => {
  it("reads a circle, which user draws its head with", () => {
    const shapes = parseIconSvg(
      svg('<circle cx="12" cy="8" r="4" stroke="currentColor"/>')
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0].d).not.toBe("");
  });

  it("reads an icon that carries no path element at all", () => {
    // threed, toggle, speed-dots and 8 others are drawn entirely without
    // <path>. A path-only reader calls all 11 empty.
    const shapes = parseIconSvg(
      svg(
        '<rect x="4" y="4" width="16" height="16" rx="3" fill="black"/><circle cx="8" cy="8" r="2" fill="black"/>'
      )
    );
    expect(shapes).toHaveLength(2);
  });

  it("reads path, circle, ellipse and rect from one icon", () => {
    const shapes = parseIconSvg(
      svg(
        '<path stroke="black" d="M4 4L20 4"/><circle cx="6" cy="6" r="2" fill="black"/>' +
          '<ellipse cx="12" cy="12" rx="4" ry="2" fill="black"/><rect x="2" y="2" width="6" height="6" fill="black"/>'
      )
    );
    expect(shapes).toHaveLength(4);
    expect(shapes.every((s) => s.d.length > 0)).toBe(true);
  });
});

it("does not admit definition, clipping, mask, symbol or comment shapes as foreground ink", () => {
  const source = svg(
    '<defs><clipPath id="clip"><path d="M0 0H24V24H0Z"/></clipPath><g><path d="M1 1H23V23H1Z"/></g></defs><mask id="mask"><rect width="24" height="24"/></mask><symbol id="symbol"><circle r="10"/></symbol><!-- <path d="M0 0H24"/> --><g clip-path="url(#clip)"><path fill="currentColor" d="M4 4H20V20H4Z"/></g>'
  );
  expect(parseIconSvg(source).map((shape) => shape.d)).toEqual([
    "M4 4H20V20H4Z",
  ]);
});

it("resolves nested inherited paint and excludes unpainted canvas paths", () => {
  const shapes = parseIconSvg(
    '<svg fill="currentColor"><path fill="none" d="M0 0H24V24H0Z"/><g fill="none" stroke="black" stroke-width="2" stroke-linecap="round"><path d="M4 4H20"/><g stroke-width="1"><path d="M4 8H20"/></g></g><path d="M8 8H16V16H8Z"/></svg>'
  );
  expect(shapes).toHaveLength(3);
  expect(shapes.map((s) => [s.filled, s.strokeWidth, s.cap])).toEqual([
    [false, 2, "round"],
    [false, 1, "round"],
    [true, 0, "butt"],
  ]);
  expect(parseIconSvg('<svg><path d="M4 4H20V20H4Z"/></svg>')[0].filled).toBe(
    true
  );
});
