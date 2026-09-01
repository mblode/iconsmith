import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeStudioSvg, sanitizeStudioSvg } from "./svg.ts";

describe("sanitizeStudioSvg reports its status", () => {
  it("calls markup with nothing to strip ok", () => {
    const svg = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" stroke="currentColor"/></svg>';
    const result = sanitizeStudioSvg(svg);
    assert.equal(result.status, "ok");
    assert.equal(result.svg, svg);
  });

  it("calls a non-svg string empty and returns nothing", () => {
    const result = sanitizeStudioSvg("not markup at all");
    assert.equal(result.status, "empty");
    assert.equal(result.svg, "");
  });

  it("calls markup it had to strip unsafe but keeps the renderable remainder", () => {
    const result = sanitizeStudioSvg('<svg><script>alert(1)</script><path d="M0 0"/></svg>');
    assert.equal(result.status, "unsafe");
    assert.equal(result.svg, '<svg><path d="M0 0"/></svg>');
  });
});

describe("sanitizeStudioSvg strips a handler in every attribute-quoting form", () => {
  // The HTML parser accepts a value double-quoted, single-quoted, or bare, and
  // fires the handler in all three. A sanitiser that matched only the quoted
  // two once let `<svg onload=alert(1)>` through untouched into innerHTML.
  const handlers = [
    ["double-quoted", '<svg onload="alert(1)"></svg>'],
    ["single-quoted", "<svg onload='alert(1)'></svg>"],
    ["unquoted", "<svg onload=alert(1)></svg>"],
    ["unquoted before a self-close", "<svg onload=alert(1)/></svg>"],
    ["split across newlines", '<svg onload\n=\n"alert(1)"></svg>'],
  ] as const;

  for (const [name, svg] of handlers) {
    it(`strips an ${name} on* handler`, () => {
      const result = sanitizeStudioSvg(svg);
      assert.equal(result.status, "unsafe");
      assert.doesNotMatch(result.svg, /onload/iu);
    });
  }
});

describe("sanitizeStudioSvg strips link and embedding vectors", () => {
  it("strips an unquoted javascript: href", () => {
    const result = sanitizeStudioSvg("<svg><a xlink:href=javascript:alert(1)>x</a></svg>");
    assert.equal(result.status, "unsafe");
    assert.doesNotMatch(result.svg, /javascript:/iu);
  });

  it("strips an <image> element with an onerror handler whole", () => {
    const result = sanitizeStudioSvg("<svg><image href=x onerror=alert(1)></svg>");
    assert.equal(result.status, "unsafe");
    assert.doesNotMatch(result.svg, /image|onerror/iu);
  });

  it("strips a <foreignObject> and its contents", () => {
    const result = sanitizeStudioSvg(
      "<svg><foreignObject><iframe src=x></iframe></foreignObject></svg>",
    );
    assert.equal(result.status, "unsafe");
    assert.doesNotMatch(result.svg, /foreignObject|iframe/iu);
  });
});

describe("sanitizeStudioSvg does not disturb legitimate drawing markup", () => {
  it("keeps geometry attributes that are not handlers or links", () => {
    const svg =
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>';
    assert.equal(sanitizeStudioSvg(svg).status, "ok");
  });

  it("hides a rendered <title> so it does not show as visible text", () => {
    const result = sanitizeStudioSvg('<svg><title>home</title><path d="M0 0"/></svg>');
    assert.doesNotMatch(result.svg, /<title/iu);
  });
});

describe("safeStudioSvg returns the markup alone", () => {
  it("drops the status wrapper", () => {
    assert.equal(safeStudioSvg("<svg onload=alert(1)></svg>"), "<svg></svg>");
  });
});
