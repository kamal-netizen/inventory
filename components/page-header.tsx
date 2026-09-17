import Link from "next/link";

export default function PageHeader({
  title,
  back = "/",
  subtitle,
}: {
  title: string;
  back?: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-1">
      <Link
        href={back}
        aria-label="Back"
        className="-ml-2.5 shrink-0 rounded-xl p-2.5 text-muted active:bg-surface"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 19l-7-7 7-7" />
        </svg>
      </Link>
      <div className="min-w-0">
        <h1 className="truncate text-[19px] font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="truncate text-[14px] text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}
