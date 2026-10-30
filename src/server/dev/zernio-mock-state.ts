/**
 * 017 — Estado en memoria del mock de Zernio (solo dev/test). Vive en
 * globalThis porque Next recarga módulos en dev; una instancia = un proceso,
 * así que el outbox en memoria alcanza para las aserciones del self-test.
 */

export type ZernioSentMessage = {
  n: number;
  conversationId: string;
  accountId: string | null;
  message: string;
  /** Presente solo fuera de la ventana de 24 h. */
  messagingType?: string;
  messageTag?: string;
  /** Llave de idempotencia con la que llegó, si la hubo. */
  idempotencyKey: string | null;
  at: string;
};

export type ZernioMockProfile = {
  _id: string;
  name: string;
  externalId: string | null;
};

export type ZernioMockHandoff = {
  id: string;
  profileId: string;
  status: "waiting" | "opened" | "connected" | "failed" | "expired";
  /** Como en la API real: vacía salvo en `connected`. */
  accounts: { id: string; profileId: string; username: string }[];
  error: { code: string; message: string | null; details: Record<string, string> } | null;
  expiresAt: string;
};

export type ZernioMockWebhook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
};

type ZernioMockState = {
  seq: number;
  sent: ZernioSentMessage[];
  profiles: ZernioMockProfile[];
  handoffs: ZernioMockHandoff[];
  webhooks: ZernioMockWebhook[];
  /**
   * El connect responde `account` en vez de `handoff` cuando reactiva una cuenta
   * desconectada. El arnés no puede desconectar de verdad, así que lo fuerza.
   */
  connectDevuelveCuenta: { id: string; username: string } | null;
};

const g = globalThis as unknown as { __voceroZernioMock?: ZernioMockState };

export function zernioMockState(): ZernioMockState {
  if (!g.__voceroZernioMock) {
    g.__voceroZernioMock = {
      seq: 0,
      sent: [],
      profiles: [],
      handoffs: [],
      webhooks: [],
      connectDevuelveCuenta: null,
    };
  }
  return g.__voceroZernioMock;
}

/** Vacía lo enviado y los escaneos: cada corrida empieza sin estado. */
export function resetZernioMock(): void {
  const state = zernioMockState();
  state.sent = [];
  state.profiles = [];
  state.handoffs = [];
  state.webhooks = [];
  state.connectDevuelveCuenta = null;
}

/**
 * Id del mensaje que el mock le devuelve al CRM.
 *
 * Lleva la marca de tiempo del proceso, no solo un contador: el CRM guarda ese
 * id con un índice ÚNICO, así que dos corridas del arnés contra la misma base
 * chocarían con `zmock_1` y el envío fallaría por una colisión del harness,
 * que se ve igual que un bug del producto.
 */
export function nextZernioMessageId(): string {
  const state = zernioMockState();
  return `zmock_${Date.now().toString(36)}_${++state.seq}`;
}

/** Un id nuevo, con la misma regla: único entre corridas del arnés. */
export function nextZernioMockId(prefijo: string): string {
  const state = zernioMockState();
  return `${prefijo}_${Date.now().toString(36)}_${++state.seq}`;
}

/**
 * Cierra un escaneo desde el arnés: es el sustituto del dedo que escanea.
 *
 * Sin esto el flujo de handoff no se puede probar de ninguna manera, porque el
 * resultado lo produce un teléfono.
 */
export function resolverZernioHandoff(
  handoffId: string,
  outcome:
    | { status: "connected"; accountId: string; username: string }
    | { status: "failed"; code: string; message?: string | null; details?: Record<string, string> }
    | { status: "expired" | "opened" | "waiting" }
): ZernioMockHandoff | null {
  const h = zernioMockState().handoffs.find((x) => x.id === handoffId);
  if (!h) return null;
  h.status = outcome.status;
  h.accounts =
    outcome.status === "connected"
      ? [{ id: outcome.accountId, profileId: h.profileId, username: outcome.username }]
      : [];
  h.error =
    outcome.status === "failed"
      ? {
          code: outcome.code,
          message: outcome.message ?? null,
          details: outcome.details ?? {},
        }
      : null;
  return h;
}

/**
 * Una llave que termina en `-invalid` se rechaza, igual que hace el mock de
 * Graph: es como el arnés comprueba que unas credenciales malas NO se guardan.
 */
export function zernioTokenIsBad(authorization: string | null): boolean {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
  return token.length === 0 || token.endsWith("-invalid");
}
