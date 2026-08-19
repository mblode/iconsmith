/**
 * `dangerouslySetInnerHTML`, not children. React escapes some characters in the
 * text children of a `<script>`, which corrupts JSON containing a `</`
 * sequence. Writing it raw is the only form that is correct for every payload
 * rather than for the payload that happens to be there today.
 */
export const JsonLd = ({ data }: { data: Record<string, unknown> }) => (
  // oxlint-disable-next-line react/no-danger -- JSON-LD has to be written raw; see above
  <script dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} type="application/ld+json" />
);
