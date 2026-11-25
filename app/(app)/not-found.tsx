import Link from "next/link";

/** Next's own page follows the phone's dark mode, and this app is light only. */
export default function NotFound() {
  return (
    <>
      <h1 className="mb-4 text-[22px] font-semibold leading-tight tracking-tight md:text-[24px]">Not found</h1>
      <div className="card px-6 py-12 text-center">
        <p className="text-[17px] font-semibold">This page is not here</p>
        <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-snug text-muted">
          The product or note may have been removed, or the link is wrong.
        </p>
        <Link
          href="/"
          className="tap mt-6 inline-flex items-center justify-center rounded-2xl bg-brand px-6
                     font-semibold text-white transition hover:opacity-90"
        >
          Back to stock
        </Link>
      </div>
    </>
  );
}
