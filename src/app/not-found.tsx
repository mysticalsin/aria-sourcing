import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-ink text-paper">
        <Compass className="h-8 w-8 text-tangerine" />
      </div>
      <p className="eyebrow mb-2">Error 404</p>
      <h1 className="display text-4xl text-ink">This route went off the map.</h1>
      <p className="mt-3 max-w-md text-muted">
        The page you’re looking for doesn’t exist in the Hermes console. Let’s get you back to
        the command center.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-full bg-ink px-6 text-sm font-semibold text-paper shadow-soft hover:bg-ink/90"
      >
        Back to Command Center
      </Link>
    </div>
  );
}
