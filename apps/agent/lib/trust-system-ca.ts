import { getCACertificates, setDefaultCACertificates } from "node:tls";

const bundled = getCACertificates("default");
const system = getCACertificates("system");

if (system.length > 0) {
  setDefaultCACertificates([...new Set([...bundled, ...system])]);
}
