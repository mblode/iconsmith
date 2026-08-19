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

const STATS = [
  { label: "icons measured to derive the house spec", value: "2,085" },
  { label: "of stroked shapes use stroke 2", value: "97.5%" },
  {
    label: "of 6,188 measured corners land exactly on the radius tiers",
    value: "78.4%",
  },
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
  <section className="scroll-mt-8 border-border border-t pt-12" id={id}>
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
        <p className="font-mono text-foreground/50 text-xs uppercase tracking-widest">
          Pre-release
        </p>

        <h1 className="mt-4 max-w-[20ch] text-balance font-heading font-medium text-4xl leading-[1.05] sm:text-5xl md:text-6xl">
          Icon generation that cannot drift.
        </h1>

        <p className="mt-6 max-w-[62ch] text-balance text-foreground/70 text-lg leading-relaxed">
          Because the model never emits a coordinate. Iconsmith gives it five primitives:{" "}
          <code className="font-mono text-sm">rect</code>,{" "}
          <code className="font-mono text-sm">circle</code>,{" "}
          <code className="font-mono text-sm">line</code>,{" "}
          <code className="font-mono text-sm">dot</code>,{" "}
          <code className="font-mono text-sm">part</code>. Every node quantises to a 0.25 grid,
          every corner radius comes from a measured tier, every part lands on a named quarter turn.
          Free path data is not something the model can express, so drift is not something it can
          write.
        </p>

        <div className="mt-10">
          <NewsletterForm />
        </div>
      </header>

      <Section title="A model calling rect() cannot drift. One emitting path data always will.">
        <p className="max-w-[62ch] text-foreground/70 leading-relaxed">
          That is the whole idea. A model writing raw path data introduces drift into a set at the
          rate it writes icons, and every icon it adds is a little further from the ones before it.
          The library decides how a shape is drawn; the model only decides what to draw and where.
        </p>
      </Section>

      <Section title="Five lines, and not one number the model chose">
        <div className="grid gap-8 sm:grid-cols-[1fr_auto] sm:items-center">
          <pre className="overflow-x-auto rounded-lg bg-foreground/5 p-5 font-mono text-sm leading-relaxed">
            <code>{PROGRAM}</code>
          </pre>
          <div className="flex items-center justify-center rounded-lg bg-foreground/5 p-8">
            <SquareCheckIcon className="h-24 w-24 text-foreground" />
          </div>
        </div>
        <p className="mt-4 max-w-[62ch] text-foreground/60 text-sm leading-relaxed">
          No coordinate the model invented, no radius it picked, no angle it guessed.{" "}
          <code className="font-mono">fit</code> and <code className="font-mono">center</code> exist
          so it never does spatial arithmetic: keyline scaling is a pure function of the content, so
          the library does it exactly.
        </p>
      </Section>

      <Section title="And when you ask for something off-spec, it says no in full">
        <pre className="overflow-x-auto rounded-lg border border-border bg-foreground/[0.03] p-5 font-mono text-xs leading-relaxed sm:text-sm">
          <code>{REFUSAL}</code>
        </pre>
        <p className="mt-4 max-w-[62ch] text-foreground/60 text-sm leading-relaxed">
          The escape exists. It has to be asked for by name, and it stays visible in review.
          Off-axis edges are not a bug to stamp out: they are 29.3% of the set, and they sit on
          rational slopes because the edge runs between two grid points. Refusing them all would
          refuse a third of the corpus.
        </p>
      </Section>

      <Section id="vocabulary" title="It learns your set's vocabulary, then draws in it">
        <p className="max-w-[62ch] text-foreground/70 leading-relaxed">
          <code className="font-mono text-sm">iconsmith parts</code> clusters every subpath in a set
          into reusable marks: 199 parts across 1,863 icons, the top 50 covering 86% of instances,
          61 of them named by hand. Nothing can reason about{" "}
          <code className="font-mono text-sm">p0031</code>. Everything can reason about{" "}
          <code className="font-mono text-sm">cloud</code>.
        </p>
        <div className="mt-8">
          <VocabularyGrid />
        </div>
      </Section>

      <Section title="The house spec is measured, not asserted">
        <dl className="grid gap-6 sm:grid-cols-3">
          {STATS.map((stat) => (
            <div key={stat.value}>
              <dt className="font-heading font-medium text-3xl">{stat.value}</dt>
              <dd className="mt-2 text-balance text-foreground/60 text-sm leading-relaxed">
                {stat.label}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 max-w-[62ch] text-foreground/70 leading-relaxed">
          Those radius tiers match 78.4% of measured corners exactly. The values written from the
          Cursor article the spec started as matched 23.9%.
        </p>
        <blockquote className="mt-6 border-foreground/20 border-l-2 pl-5 font-heading text-xl italic leading-snug">
          Cursor is the inspiration; the corpus is the specification.
        </blockquote>
      </Section>

      <Section title="Four numbers, never one">
        <dl className="max-w-lg divide-y divide-border">
          {[
            { k: "floor", v: "a random icon scored against the target" },
            {
              highlight: true,
              k: "baseline 0.737",
              v: "the measured median between two mature icon sets drawing the same concept",
            },
            { k: "treatment", v: "what the pipeline scored" },
            { k: "ceiling 1.0", v: "pixel identity" },
          ].map((row) => (
            <div
              className={`flex flex-col gap-1 py-3 sm:flex-row sm:gap-6 ${
                row.highlight ? "font-medium" : "text-foreground/60"
              }`}
              key={row.k}
            >
              <dt className="shrink-0 font-mono text-sm sm:w-40">{row.k}</dt>
              <dd className="text-sm leading-relaxed">{row.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-[62ch] text-foreground/70 leading-relaxed">
          Every eval prints all four. A score above 0.95 is flagged{" "}
          <span className="font-mono text-sm">SUSPECT</span>, because at that point the harness is
          comparing something to itself rather than succeeding.
        </p>
      </Section>

      <section className="border-border border-t pt-12">
        <h2 className="max-w-[24ch] text-balance font-heading font-medium text-3xl leading-[1.15] sm:text-4xl">
          Iconsmith is not on npm yet.
        </h2>
        <p className="mt-4 max-w-[58ch] text-foreground/70 leading-relaxed">
          It is one person&apos;s tool that outgrew its own icon set. Leave an address and I will
          send one email the day it is installable.
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
