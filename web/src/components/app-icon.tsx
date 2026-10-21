import { BookOpenIcon, BrainIcon, ChartColumnIcon, CircleHelpIcon, MessageCircleIcon, MessageCircleQuestionIcon, NotebookPenIcon, PaletteIcon, SparklesIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";

// App icons are Lucide names in app.yaml (e.g. icon: book-open). Only icons listed here are bundled.
const ICONS: Record<string, LucideIcon> = {
  "book-open": BookOpenIcon,
  brain: BrainIcon,
  "chart-column": ChartColumnIcon,
  "circle-help": CircleHelpIcon,
  "notebook-pen": NotebookPenIcon,
  palette: PaletteIcon,
  "message-circle-question": MessageCircleQuestionIcon,
  "message-circle": MessageCircleIcon,
  "trending-up": TrendingUpIcon,
};

export function AppIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? SparklesIcon;
  return <Icon className={className} aria-hidden />;
}
