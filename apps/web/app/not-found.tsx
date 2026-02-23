export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <div className="max-w-xl rounded-2xl border border-border/60 bg-card/70 p-10 text-center">
        <p className="text-[0.65rem] uppercase tracking-[0.35em] text-muted-foreground">
          Not Found
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">
          We could not find that page.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Double-check the URL or head back to the admin overview to keep moving.
        </p>
      </div>
    </div>
  )
}
