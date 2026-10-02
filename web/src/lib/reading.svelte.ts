/**
 * Reading preferences shared by every markdown view (report details, artifact
 * details), so the two stay in sync.
 */
export type ReadingSize = "small" | "medium" | "large";

export const READING_SIZES: ReadingSize[] = ["small", "medium", "large"];

const STORAGE_KEY = "reports.readingSize";

const READING_SIZE_CSS: Record<ReadingSize, string> = {
  small: "var(--font-medium)",
  medium: "calc(var(--font-medium) + 2px)",
  large: "calc(var(--font-medium) + 4px)",
};

function readStoredSize(): ReadingSize {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  return stored === "small" || stored === "medium" || stored === "large" ? stored : "medium";
}

class ReadingPrefs {
  size = $state<ReadingSize>(readStoredSize());

  setSize(size: ReadingSize): void {
    this.size = size;
    try {
      localStorage.setItem(STORAGE_KEY, size);
    } catch {}
  }

  /** CSS font size for the current preference. */
  get css(): string {
    return READING_SIZE_CSS[this.size];
  }
}

export const readingPrefs = new ReadingPrefs();
