/**
 * Estado en memoria del harness wa-mock (solo dev/test). Vive en globalThis
 * porque Next recarga módulos en dev; una instancia = un proceso, así que el
 * outbox en memoria es suficiente para las aserciones del self-test.
 */

export type OutboxEntry = {
  n: number;
  phoneNumberId: string;
  to: string;
  /**
   * El BSUID, cuando el destinatario iba por `recipient` en vez de `to`.
   *
   * Se expone para que un self-test pueda comprobar EN QUE CAMPO viajo: es la
   * unica diferencia entre el envio que Meta acepta y el que devuelve 131026.
   */
  recipient?: string;
  type: string;
  body: unknown;
  at: string;
  /**
   * Id que se le devolvió al CRM. Lo expone el outbox para que un self-test
   * pueda mandarle un webhook de estado a ESE mensaje sin adivinar el formato.
   */
  waMessageId?: string;
};

export type MockTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  body: string;
  /** Componentes tal cual los mandó el CRM: Meta valida aquí los `example`. */
  components?: unknown[];
};

/**
 * 016 — Un evento de Conversions API que el CRM le mandó al mock. El self-test
 * lo inspecciona para verificar la FORMA del payload: el modo de fallar de ese
 * endpoint es un 200 con `events_received: 0`, donde un campo mal puesto se ve
 * idéntico a uno bien puesto.
 */
export type CapiMockEvent = {
  n: number;
  datasetId: string;
  eventName: string;
  ctwaClid: string | null;
  customData: Record<string, unknown> | null;
  body: unknown;
  at: string;
};

/**
 * La suscripción de la app a una WABA (`{WABA}/subscribed_apps`), con su
 * override de callback si alguien lo configuró. Existe para que el self-test
 * pueda comprobar que guardar la conexión NO borra el override de un cerebro
 * externo: en Meta, un POST sin cuerpo lo elimina, y el mock hace lo mismo.
 *
 * `subscribedFields` es el otro lado de la misma consulta: los campos que la
 * app tiene suscritos. En Meta se ponen en el panel y la API NO los escribe,
 * así que el mock los deja SEMBRAR (`POST /api/dev/wa-mock/coexistence`) para
 * poder probar tanto el diagnóstico en verde como el aviso de campo que falta.
 */
export type MockWabaSubscription = {
  overrideCallbackUri: string | null;
  subscribedFields?: string[] | null;
};

/**
 * Un `POST {PHONE_NUMBER_ID}/smb_app_data` (relleno de coexistence). Se guarda
 * para que el self-test compruebe que el CRM lo pidió, con qué `sync_type` y
 * cuántas veces: en Meta es de un solo uso por conexión, y el mock devuelve el
 * error de duplicado (subcode 2593107) en el segundo intento igual que Meta.
 */
export type MockSmbAppDataRequest = {
  n: number;
  phoneNumberId: string;
  syncType: string;
  at: string;
};

/**
 * El número montado en la app de WhatsApp Business del teléfono
 * (`is_on_biz_app`, `platform_type`). Sin sembrar, el mock responde como un
 * número normal de Cloud API: `is_on_biz_app: false`.
 *
 * `onBizApp: null` imita al número cuyo campo NO se reporta (token sin el
 * permiso, versión de Graph que no lo trae): es el caso en el que el CRM no
 * puede afirmar nada y el pedido de relleno no se dispara.
 */
export type MockPhoneCoexistence = {
  onBizApp: boolean | null;
  platformType: string | null;
};

type WaMockState = {
  outbox: OutboxEntry[];
  templates: MockTemplate[];
  capiEvents: CapiMockEvent[];
  /** Por WABA ID. Sin entrada = la app no está suscrita a esa WABA. */
  wabaSubscriptions: Record<string, MockWabaSubscription>;
  /**
   * Override de webhook por NÚMERO: phone_number_id → callback URL. Es lo que
   * el CRM registra al guardar la conexión; el self-test lo lee para comprobar
   * que quedó puesto (y que desconectar lo quita) sin mirar dentro del CRM.
   */
  phoneWebhooks: Record<string, string>;
  /** Por phone_number_id: si el número está en la app del teléfono. */
  phoneCoexistence: Record<string, MockPhoneCoexistence>;
  /** Los `smb_app_data` que pidió el CRM, en orden. */
  smbAppDataRequests: MockSmbAppDataRequest[];
  counter: number;
};

const globalForMock = globalThis as unknown as { __waMockState?: WaMockState };

function freshState(): WaMockState {
  return {
    outbox: [],
    templates: [],
    capiEvents: [],
    wabaSubscriptions: {},
    phoneWebhooks: {},
    phoneCoexistence: {},
    smbAppDataRequests: [],
    counter: 0,
  };
}

export function getWaMockState(): WaMockState {
  if (!globalForMock.__waMockState) {
    globalForMock.__waMockState = freshState();
  }
  // Un proceso de `next dev` que ya tenía el estado viejo en memoria.
  globalForMock.__waMockState.phoneWebhooks ??= {};
  globalForMock.__waMockState.phoneCoexistence ??= {};
  globalForMock.__waMockState.smbAppDataRequests ??= [];
  return globalForMock.__waMockState;
}

export function resetWaMockState(): void {
  globalForMock.__waMockState = freshState();
}

export function nextN(): number {
  return ++getWaMockState().counter;
}

/**
 * Sello único por arranque del proceso. Sin él, el contador del mock reinicia
 * al reiniciar `pnpm dev` y vuelve a emitir `wamid.mock.out.1`, que choca con
 * el UNIQUE de `wa_message_id` en la BD de una corrida anterior (500 al
 * enviar). No es un fallo del producto: la idempotencia hace su trabajo.
 */
const boot = Math.random().toString(36).slice(2, 8);

export function nextOutboundWamid(): string {
  return `wamid.mock.out.${boot}.${nextN()}`;
}
