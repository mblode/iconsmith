import Link from "next/link";
import { Suspense } from "react";

import { SiteFooter } from "@/components/site-footer";

// Landing spot for the confirmation link in the opt-in email. Deliberately its
// own route rather than a `?status=` param on the home page: reading search
// params there would opt the landing page out of static rendering, and it is
// the one page that has to be fast.
//
// noindex, and deliberately absent from sitemap.ts. It declares no `openGraph`
// or `twitter` block either, so it inherits the layout's wholesale, which is
// what keeps `og:site_name` and the OG image correct here. See zone rules 9-11.
export const metadata = {
  robots: { follow: true, index: false },
  title: "Subscription confirmed",
};

// The outcome is the only part that depends on the URL, so it reads the promise
// behind a boundary and everything around it still prerenders.
const Outcome = async ({ searchParams }: { searchParams: Promise<{ status?: string }> }) => {
  const { status } = await searchParams;
  const confirmed = status !== "invalid";

  return (
    <>
      <h1 className="font-heading text-4xl italic leading-[1.1] md:text-5xl">
        {confirmed ? "You are on the list" : "That link did not work"}
      </h1>

      <p className="mt-4 text-lg leading-relaxed">
        {confirmed
          ? "I will send one email, on the day Iconsmith is installable. It has an unsubscribe link, and nothing else follows it."
          : "Confirmation links expire after 24 hours, and each one only works for the address it was sent to. Subscribing again will send a fresh link."}
      </p>
    </>
  );
};

const Subscribed = ({ searchParams }: { searchParams: Promise<{ status?: string }> }) => (
  <div className="min-h-screen py-24" id="main" tabIndex={-1}>
    <section className="mx-auto w-full max-w-[900px] px-6 pt-12">
      <Suspense fallback={<div className="h-28 animate-pulse rounded-md bg-foreground/5" />}>
        <Outcome searchParams={searchParams} />
      </Suspense>

      <Link className="mt-8 inline-block underline underline-offset-2" href="/">
        Back to Iconsmith
      </Link>
    </section>

    <SiteFooter />
  </div>
);

export default Subscribed;
