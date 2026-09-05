import { NewsletterForm } from "@/components/newsletter-form";
import { SiteFooter } from "@/components/site-footer";
import { SquareCheckIcon } from "@/components/square-check-icon";
import { VocabularyGrid } from "@/components/vocabulary-grid";
import { ZoneBreadcrumb } from "@/components/zone-breadcrumb";
import { SITE_NAME } from "@/lib/site-url";

const PROGRAM = `icon square-check
keyline square
rect 4,4 16x16 r3
line 8,12 11,15 16,10
fit`;

// Verbatim stderr from the CLI. It contains em dashes, which house copy rules
// forbid; this is program output rather than prose, and editing evidence to
// satisfy a copy rule would be the worse error. Reproduce with:
//   printf 'icon cloud-check\nkeyline wide\nline 9,13.75 11,15.5 14.5,10.5\nfit\n' \
//     | node packages/iconsmith/dist/cli.js draw - 2>&1
const REFUSAL = `line segment 2 (11,15.75 → 14.5,10.5) runs at 123.69°, 11.31° off
the nearest axis (135°). Off-axis edges are legitimate — 29.3% of
stroked icons in the set have one, on rational slopes between two
grid points — but they are asked for, not arrived at: pass
\`offAxis: true\` (\`off-axis\` in the DSL) if that is the shape, or
move an endpoint onto the axis.`;

const SCALE = [
  { note: "a random icon scored against the target", term: "floor" },
  {
    lead: true,
    note: "the measured median between two mature icon sets drawing the same concept",
    term: "baseline 0.737",
  },
  { note: "what the pipeline scored", term: "treatment" },
  { note: "pixel identity", term: "ceiling 1.0" },
];

const Section = ({
  children,
  id,
  title,
}: {
  children: React.ReactNode;
  id?: string;
  title: string;
}) => (
  <section className="scroll-mt-8" id={id}>
    <h2 className="max-w-[28ch] text-balance font-heading font-medium text-2xl leading-[1.2] sm:text-3xl">
      {title}
    </h2>
    <div className="mt-6">{children}</div>
  </section>
);

const Home = () => (
  <main className="min-h-screen" id="main-content">
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-16 px-6 py-12">
      <ZoneBreadcrumb product={SITE_NAME} />

      <header>
        <h1 className="max-w-[20ch] text-balance font-heading font-medium text-4xl leading-[1.05] sm:text-5xl md:text-6xl">
          Icon generation that cannot drift.
        </h1>

        <p className="mt-6 max-w-[58ch] text-balance text-lg text-muted-foreground leading-relaxed">
          The model never emits a coordinate. It gets five primitives:{" "}
          <code className="font-mono text-sm">rect</code>,{" "}
          <code className="font-mono text-sm">circle</code>,{" "}
          <code className="font-mono text-sm">line</code>,{" "}
          <code className="font-mono text-sm">dot</code> and{" "}
          <code className="font-mono text-sm">part</code>. It picks what to draw and where. The
          library picks how, so every node lands on the grid and every radius comes from a measured
          tier. It can&apos;t express free path data, so it can&apos;t write drift.
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-start">
          <NewsletterForm />
        </div>
      </header>

      <Section title="Five lines, and not one number the model chose">
        <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-stretch">
          <pre className="overflow-x-auto rounded-2xl bg-code p-5 font-mono text-code-foreground text-sm leading-relaxed">
            <code>{PROGRAM}</code>
          </pre>
          <div className="flex items-center justify-center rounded-2xl bg-surface p-8">
            <SquareCheckIcon className="size-24 text-foreground" />
          </div>
        </div>
        <p className="mt-4 max-w-[58ch] text-muted-foreground text-sm leading-relaxed">
          <code className="font-mono">fit</code> and <code className="font-mono">center</code> are
          there so the model never does spatial arithmetic. Scaling to the keyline is a pure
          function of the content, so the library does it exactly.
        </p>
      </Section>

      <Section title="Ask for something off-spec and it says no, at length">
        <pre className="overflow-x-auto rounded-2xl bg-code p-5 font-mono text-code-foreground text-xs leading-relaxed sm:text-sm">
          <code>{REFUSAL}</code>
        </pre>
        <p className="mt-4 max-w-[58ch] text-muted-foreground text-sm leading-relaxed">
          The escape is real. You just have to ask for it by name, and it stays visible in review.
          Off-axis edges aren&apos;t a bug to stamp out. They&apos;re 29.3% of the set, and they sit
          on rational slopes because the edge runs between two grid points. Refusing all of them
          would refuse a third of the corpus.
        </p>
      </Section>

      <Section id="vocabulary" title="It learns your set's vocabulary, then draws in it">
        <p className="max-w-[58ch] text-muted-foreground leading-relaxed">
          <code className="font-mono text-sm">iconsmith parts</code> clusters every subpath in a set
          into reusable marks. Over blode-icons that&apos;s 199 parts across 1,863 icons, the top 50
          covering 86% of instances, 61 of them named by hand. Nothing can reason about{" "}
          <code className="font-mono text-sm">p0031</code>. Everything can reason about{" "}
          <code className="font-mono text-sm">cloud</code>.
        </p>
        <div className="mt-8">
          <VocabularyGrid />
        </div>
      </Section>

      <Section title="The house spec is measured, not asserted">
        <p className="max-w-[58ch] text-muted-foreground leading-relaxed">
          I derived every constant from 2,085 icons. 97.5% of stroked shapes use stroke 2. The
          radius tiers match 78.4% of the 6,188 corners I measured. The values I&apos;d written from
          the Cursor article matched 23.9%.
        </p>
        <blockquote className="mt-6 border-border border-l-2 pl-5 font-heading text-xl italic leading-snug">
          Cursor is the inspiration. The corpus is the specification.
        </blockquote>
      </Section>

      <Section title="Four numbers, never one">
        <dl className="max-w-lg divide-y divide-border">
          {SCALE.map((row) => (
            <div
              className={`flex flex-col gap-1 py-3 sm:flex-row sm:gap-6 ${
                row.lead ? "font-medium" : "text-muted-foreground"
              }`}
              key={row.term}
            >
              <dt className="shrink-0 font-mono text-sm sm:w-40">{row.term}</dt>
              <dd className="text-sm leading-relaxed">{row.note}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-[58ch] text-muted-foreground leading-relaxed">
          Every eval prints all four. Anything above 0.95 gets flagged{" "}
          <span className="font-mono text-sm">SUSPECT</span>, because at that point the harness is
          comparing something to itself.
        </p>
      </Section>

      <section>
        <h2 className="max-w-[24ch] text-balance font-heading font-medium text-3xl leading-[1.15] sm:text-4xl">
          It&apos;s not on npm yet.
        </h2>
        <p className="mt-4 max-w-[54ch] text-muted-foreground leading-relaxed">
          This started as one tool that outgrew its own icon set. Leave an address and I&apos;ll
          send one email the day you can install it.
        </p>
        <div className="mt-8">
          <NewsletterForm />
        </div>
      </section>
    </div>

    <SiteFooter />
  </main>
);

export default Home;
