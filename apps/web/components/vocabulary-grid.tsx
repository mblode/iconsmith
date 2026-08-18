import vocabulary from "@/lib/vocabulary.json";

interface Part {
  d: string;
  dx: number;
  dy: number;
  name: string;
  scale: number;
  strokeWidth: number;
}

/**
 * The 61 named parts, drawn live rather than shipped as the PNG contact sheet
 * in packages/iconsmith/docs. That sheet is a review artifact: red debug
 * labels, portrait, ragged last row. Inline paths take `currentColor`, so this
 * grid works in both themes and stays crisp at any size.
 *
 * Regenerate the data with `node scripts/vocabulary-data.mjs`.
 */
export const VocabularyGrid = () => (
  <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
    {(vocabulary as Part[]).map((part) => (
      <li className="flex flex-col items-center gap-2" key={part.name}>
        <svg
          aria-hidden="true"
          className="h-12 w-12 text-foreground"
          fill="none"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <g transform={`translate(${part.dx} ${part.dy}) scale(${part.scale})`}>
            <path
              d={part.d}
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={part.strokeWidth}
            />
          </g>
        </svg>
        <span className="text-center font-mono text-foreground/60 text-xs">{part.name}</span>
      </li>
    ))}
  </ul>
);
