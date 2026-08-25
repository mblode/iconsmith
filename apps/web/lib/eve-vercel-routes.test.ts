import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eveServiceRouteSrc, prefixEveVercelOutputConfig } from "./eve-vercel-routes.ts";

describe("eveServiceRouteSrc", () => {
  it("matches withEve's default-agent route when the prefix is empty", () => {
    assert.equal(eveServiceRouteSrc(""), "^/eve/v1/(.*)$");
  });

  it("prefixes the default-agent route the way named agents do", () => {
    assert.equal(eveServiceRouteSrc("/iconsmith"), "^/iconsmith/eve/v1/(.*)$");
  });
});

describe("prefixEveVercelOutputConfig", () => {
  const unprefixed = {
    routes: [
      { handle: "filesystem" },
      {
        destination: { service: "eve", type: "service" },
        src: "^/eve/v1/(.*)$",
      },
    ],
    services: {
      eve: {
        buildCommand: "node ./node_modules/eve/bin/eve.js build",
        framework: "eve",
        routes: [
          {
            src: "^/eve/v1/(.*)$",
            transforms: [{ args: "/eve/v1/$1", op: "set", type: "request.path" }],
          },
        ],
      },
    },
    version: 3,
  };

  it("sends /iconsmith/eve/v1 to the eve service and strips the zone prefix", () => {
    const prefixed = prefixEveVercelOutputConfig(unprefixed, "/iconsmith");
    assert.deepEqual(prefixed.routes, [
      { handle: "filesystem" },
      {
        destination: { service: "eve", type: "service" },
        src: "^/iconsmith/eve/v1/(.*)$",
      },
    ]);
    assert.equal(
      prefixed.services && "eve" in prefixed.services
        ? prefixed.services.eve.routes?.[0]?.src
        : undefined,
      "^/iconsmith/eve/v1/(.*)$",
    );
    assert.deepEqual(
      prefixed.services && "eve" in prefixed.services
        ? prefixed.services.eve.routes?.[0]?.transforms
        : undefined,
      [{ args: "/eve/v1/$1", op: "set", type: "request.path" }],
    );
  });

  it("exports EVE_PUBLIC_ROUTE_PREFIX so callbacks keep the zone prefix", () => {
    const prefixed = prefixEveVercelOutputConfig(unprefixed, "/iconsmith");
    const command =
      prefixed.services && "eve" in prefixed.services
        ? prefixed.services.eve.buildCommand
        : undefined;
    assert.ok(command?.includes("export EVE_PUBLIC_ROUTE_PREFIX='/iconsmith'"));
    assert.ok(command?.endsWith("node ./node_modules/eve/bin/eve.js build"));
  });

  it("does not rewrite an already-prefixed config", () => {
    const once = prefixEveVercelOutputConfig(unprefixed, "/iconsmith");
    const twice = prefixEveVercelOutputConfig(once, "/iconsmith");
    assert.equal(twice, once);
  });

  it("leaves a Next filesystem route that is not Eve alone", () => {
    const prefixed = prefixEveVercelOutputConfig(unprefixed, "/iconsmith");
    assert.deepEqual(prefixed.routes?.[0], { handle: "filesystem" });
  });
});
