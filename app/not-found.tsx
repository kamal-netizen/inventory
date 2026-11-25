import NotFound from "./(app)/not-found";

/** An address that matches no page at all, which renders outside the signed-in layout. */
export default function RootNotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <NotFound />
    </main>
  );
}
