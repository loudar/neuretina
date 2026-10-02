/**
 * Shared one-second clock: running activity rows derive their elapsed time
 * from it, so every row ticks without spawning its own timer.
 */
class Clock {
  now = $state(Date.now());

  constructor() {
    if (typeof window !== "undefined") {
      setInterval(() => {
        this.now = Date.now();
      }, 1000);
    }
  }
}

export const clock = new Clock();
