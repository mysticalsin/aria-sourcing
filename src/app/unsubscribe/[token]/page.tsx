import type { Metadata } from "next";
import { isEmailUnsubscribeToken } from "@/lib/email-unsubscribe";

export const metadata: Metadata = {
  title: "Email preferences",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = isEmailUnsubscribeToken(token);

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6 py-12 text-ink">
      <section className="w-full max-w-md rounded-3xl border border-line bg-surface p-7 shadow-soft">
        <p className="eyebrow text-tangerine">Email preferences</p>
        <h1 className="mt-3 font-serif text-3xl font-medium tracking-tight">Stop recruiting emails</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {valid
            ? "Confirm once to stop future recruiting emails from this organization."
            : "This preference link is no longer available."}
        </p>
        {valid && (
          <form action={`/api/unsubscribe/${encodeURIComponent(token)}`} method="post" className="mt-6">
            <input type="hidden" name="List-Unsubscribe" value="One-Click" />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 text-sm font-semibold text-white transition hover:bg-ink/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
            >
              Unsubscribe
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
