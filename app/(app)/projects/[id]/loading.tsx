import { Skeleton } from "@/components/ui/skeleton";

/**
 * The builder's loading state: the same three-column shape, with the *chrome*
 * present so the page does not jump when the project row arrives. The agent
 * nodes are shown as skeletons too, because the graph is the first thing a
 * developer looks for.
 */
export default function ProjectLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="ml-auto h-8 w-28" />
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[22rem_minmax(0,1fr)_26rem]">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:border-r lg:border-b-0">
          <Skeleton className="h-14 w-3/4 rounded-2xl" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-5/6" />
        </div>
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="flex-1 rounded-xl" />
        </div>
        <div className="flex flex-col gap-3 border-t border-border p-4 lg:border-l lg:border-t-0">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
