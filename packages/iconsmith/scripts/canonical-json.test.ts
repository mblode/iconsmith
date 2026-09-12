import { expect, it } from "vitest";

import { canonicalJson } from "./canonical-json.js";

it.each([
  [null, "null"],
  [JSON.parse('{"z":1,"a":2}'), '{"a":2,"z":1}'],
  [
    JSON.parse('{"z":[3,{"b":false,"a":"tick"}],"a":null}'),
    '{"a":null,"z":[3,{"a":"tick","b":false}]}',
  ],
  [[2, 1, 0], "[2,1,0]"],
  [{ text: 'quote"\n' }, '{"text":"quote\\\"\\n"}'],
])(
  "preserves historical canonical evidence bytes for %j",
  (input, expected) => {
    expect(canonicalJson(input)).toBe(expected);
  }
);
