import { ChevronLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Back on the left, title in the middle, and room for something on the right. */
export function TopBar({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 grid grid-cols-[3rem_1fr_3rem] items-center bg-background/60 px-3 pt-[max(10px,env(safe-area-inset-top))] pb-2 backdrop-blur">
      <Button variant="ghost" size="icon" className="rounded-xl" onClick={onBack} aria-label="Back">
        <ChevronLeftIcon className="size-6" />
      </Button>
      <span className="truncate text-center text-lg font-bold text-heading">{title}</span>
      <span className="flex justify-end">{right}</span>
    </header>
  );
}
