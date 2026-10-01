import { onUnauthorized } from "./authGate";

/** A mechanism advertised by the backend (`password` today, OIDC later). */
export interface AuthMethodInfo {
  id: string;
  title: string;
}

/** Backend auth status (`GET /api/auth/status`). */
export interface AuthStatusInfo {
  required: boolean;
  authenticated: boolean;
  method?: string;
  methods: AuthMethodInfo[];
}

/**
 * Site-wide authentication state. The backend owns the session cookie; this
 * only tracks whether the UI should show the login gate and where to send
 * credentials.
 */
class AuthState {
  status = $state<AuthStatusInfo | null>(null);
  loading = $state(true);
  error = $state<string | null>(null);

  /** True when the backend demands a login and no valid session exists. */
  get locked(): boolean {
    return this.status?.required === true && !this.status.authenticated;
  }

  /** True when a mechanism is configured (shows the logout affordance). */
  get enabled(): boolean {
    return this.status?.required === true;
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const response = await fetch("/api/auth/status");
      this.status = (await response.json()) as AuthStatusInfo;
      this.error = null;
    } catch {
      // Backend unreachable: render the app, its health pill shows offline.
      this.status = { required: false, authenticated: true, methods: [] };
    } finally {
      this.loading = false;
    }
  }

  async login(method: string, password: string): Promise<boolean> {
    this.error = null;
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, password }),
      });
      if (!response.ok) {
        this.error =
          response.status === 429
            ? "Too many attempts. Wait a moment and try again."
            : "Wrong password.";
        return false;
      }
      const status = this.status;
      this.status = status
        ? { ...status, authenticated: true, method }
        : { required: true, authenticated: true, method, methods: [] };
      return true;
    } catch {
      this.error = "Could not reach the server.";
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Even a failed call should return to the login screen.
    }
    await this.load();
  }

  /**
   * A request hit a 401. Commands only answer 401 when the site is protected,
   * so always fall back to the login gate — even if the status call failed.
   */
  markLocked(): void {
    this.status = {
      required: true,
      authenticated: false,
      methods: this.status?.methods ?? [],
    };
  }
}

export const authState = new AuthState();

onUnauthorized(() => authState.markLocked());
