import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 023 — WhatsApp por Zernio: el transporte saliente, la entrada del webhook y
 * los acuses.
 *
 * Lo que se cuida aquí son las tres cosas que no se ven en la UI y que, si se
 * rompen, rompen el canal entero: que el id guardado al enviar sea el `wamid`
 * (ningún acuse encuentra un id sintético), que la identidad llegue por
 * teléfono o BSUID sin inventarse prefijos, y que un evento de otra plataforma
 * o de otra clase no entre a la bandeja de WhatsApp.
 */

const ingest = vi.hoisted(() =>
  vi.fn(async (_input: Record<string, unknown>) => {})
);
const applyStatus = vi.hoisted(() =>
  vi.fn(async (_organizationId: string, _status: Record<string, unknown>) => {})
);
const credenciales = vi.hoisted(() => ({
  current: null as null | {
    organizationId: string;
    source: string;
    token: string;
    accountRef: string | null;
  },
}));

vi.mock("@/server/inbox/ingest", () => ({ ingestInboundMessage: ingest }));
vi.mock("@/server/inbox/status", () => ({ applyStatusUpdate: applyStatus }));
// El módulo se reemplaza completo: lo que pide `send.ts` también tiene que
// estar, o el import revienta antes del primer test.
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByAccountRef: async () => credenciales.current,
  getCredentialsByOrg: async () => credenciales.current,
  hablaPorZernio: (c: { source?: string } | null) => c?.source === "zernio",
  markReconnectRequired: vi.fn(async () => {}),
  saveCredentials: vi.fn(async () => {}),
  tokenLast4: (t: string) => t.slice(-4),
}));

import { callGraphSend } from "@/server/inbox/send";
import { MetaApiError } from "@/lib/meta/client";
import {
  normalizeZernioWhatsappAcuse,
  normalizeZernioWhatsappEvent,
  processZernioWhatsappEvent,
} from "@/server/whatsapp/ingest-zernio";
import {
  ZERNIO_BASE,
  listZernioAccounts,
  sendZernioAttachment,
  sendZernioMessage,
  sendZernioStructured,
  sendZernioTyping,
  type ZernioEvent,
} from "@/server/zernio";

const ACCOUNT = "665f1c2e8b3a4d0012345678";
const HILO = "664a0001-77b2";
const WAMID = "wamid.HBgMNzkwMTIzNBUCIAEYARhGNDI0M0E1QjM3";

const fetchMock = vi.fn();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function llamada(i = 0): [string, RequestInit & { headers: Record<string, string> }] {
  return fetchMock.mock.calls[i] as [
    string,
    RequestInit & { headers: Record<string, string> },
  ];
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  ingest.mockClear();
  applyStatus.mockClear();
  credenciales.current = {
    organizationId: "org_a",
    source: "zernio",
    token: "zrk_llave",
    accountRef: ACCOUNT,
  };
});

describe("el transporte saliente", () => {
  it("guarda el wamid que devuelve Zernio, no un id sintético", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, data: { messageId: WAMID } }));
    const res = await sendZernioMessage({
      token: "zrk_llave",
      accountId: ACCOUNT,
      conversationId: HILO,
      text: "Buenas tardes",
      idempotencyKey: "msg_1",
    });
    expect(res.platformMessageId).toBe(WAMID);

    const [url, init] = llamada();
    expect(url).toBe(`${ZERNIO_BASE}/inbox/conversations/${HILO}/messages`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer zrk_llave");
    expect(init.headers["Idempotency-Key"]).toBe("msg_1");
    expect(JSON.parse(String(init.body))).toEqual({
      accountId: ACCOUNT,
      message: "Buenas tardes",
    });
  });

  it("sin hilo no hay envío: la conversación todavía no existe en Zernio", async () => {
    await expect(
      sendZernioMessage({
        token: "zrk_llave",
        accountId: ACCOUNT,
        conversationId: null,
        text: "hola",
      })
    ).rejects.toThrow(/hilo/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si la respuesta no trae id, queda uno provisional y el mensaje sigue visible", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    const res = await sendZernioMessage({
      token: "zrk_llave",
      accountId: ACCOUNT,
      conversationId: HILO,
      text: "hola",
    });
    expect(res.platformMessageId).toMatch(/^zernio_/);
  });

  it("el adjunto sale en multipart con la parte `attachment` y sin content-type propio", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, data: { messageId: WAMID } }));
    await sendZernioAttachment({
      token: "zrk_llave",
      accountId: ACCOUNT,
      conversationId: HILO,
      kind: "image",
      data: Buffer.from("bytes-de-la-foto"),
      fileName: "foto.jpg",
      mimeType: "image/jpeg",
      caption: "la foto",
    });

    const [url, init] = llamada();
    expect(url).toBe(`${ZERNIO_BASE}/inbox/conversations/${HILO}/messages`);
    expect(init.headers["Content-Type"]).toBeUndefined();
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("accountId")).toBe(ACCOUNT);
    expect(form.get("message")).toBe("la foto");
    const parte = form.get("attachment") as Blob & { name?: string };
    expect(parte.type).toBe("image/jpeg");
    expect(await parte.text()).toBe("bytes-de-la-foto");
  });

  it("un audio no lleva pie: en WhatsApp el texto saldría como segundo mensaje", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, data: { messageId: WAMID } }));
    await sendZernioAttachment({
      token: "zrk_llave",
      accountId: ACCOUNT,
      conversationId: HILO,
      kind: "audio",
      data: Buffer.from("ogg"),
      fileName: "nota.ogg",
      mimeType: "audio/ogg",
      caption: "nota de voz",
    });
    const form = llamada()[1].body as FormData;
    expect(form.get("message")).toBeNull();
    expect((form.get("attachment") as Blob).type).toBe("audio/ogg");
  });

  it("ubicación y contactos viajan como objetos, igual que en la Cloud API", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, data: { messageId: WAMID } }));
    await sendZernioStructured({
      token: "zrk_llave",
      accountId: ACCOUNT,
      conversationId: HILO,
      location: { latitude: 19.4326, longitude: -99.1332, name: "Oficina" },
    });
    expect(JSON.parse(String(llamada()[1].body))).toEqual({
      accountId: ACCOUNT,
      location: { latitude: 19.4326, longitude: -99.1332, name: "Oficina" },
    });

    fetchMock.mockResolvedValueOnce(json({ success: true, data: { messageId: WAMID } }));
    await sendZernioStructured({
      token: "zrk_llave",
      accountId: ACCOUNT,
      conversationId: HILO,
      contacts: [{ name: { formatted_name: "Ana" }, phones: [{ phone: "15551234567" }] }],
    });
    expect(JSON.parse(String(llamada(1)[1].body)).contacts).toHaveLength(1);
  });

  it("«escribiendo…» responde lo que Zernio diga, sin reintentar", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await expect(
      sendZernioTyping({ token: "zrk_llave", accountId: ACCOUNT, conversationId: HILO })
    ).resolves.toBe(true);
    expect(llamada()[0]).toBe(`${ZERNIO_BASE}/inbox/conversations/${HILO}/typing`);

    fetchMock.mockResolvedValueOnce(json({ success: false }));
    await expect(
      sendZernioTyping({ token: "zrk_llave", accountId: ACCOUNT, conversationId: HILO })
    ).resolves.toBe(false);
  });

  it("una llave muerta se distingue de un hipo de Zernio", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { message: "invalid api key" } }, 401)
    );
    await expect(
      sendZernioMessage({
        token: "zrk_rota",
        accountId: ACCOUNT,
        conversationId: HILO,
        text: "hola",
      })
    ).rejects.toMatchObject({ isAuthError: true, message: "invalid api key" });

    fetchMock.mockResolvedValueOnce(json({ error: "boom" }, 503));
    const err = (await sendZernioMessage({
      token: "zrk_llave",
      accountId: ACCOUNT,
      conversationId: HILO,
      text: "hola",
    }).catch((e) => e)) as MetaApiError;
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.isAuthError).toBe(false);
    expect(err.status).toBe(503);

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const red = (await sendZernioMessage({
      token: "zrk_llave",
      accountId: ACCOUNT,
      conversationId: HILO,
      text: "hola",
    }).catch((e) => e)) as MetaApiError;
    expect(red.status).toBe(0);
  });
});

describe("las cuentas de Zernio para dar de alta", () => {
  it("filtra por plataforma y traduce `_id`, nombre y salud", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        accounts: [
          { _id: ACCOUNT, platform: "whatsapp", displayName: "Uniko RD", isActive: true },
          { _id: "otro", platform: "whatsapp", username: "+12029087457", isActive: false, needsReconnection: true },
          { _id: "", platform: "whatsapp" },
        ],
        hasAnalyticsAccess: false,
      })
    );
    const cuentas = await listZernioAccounts("zrk_llave", "whatsapp");
    expect(llamada()[0]).toBe(`${ZERNIO_BASE}/accounts?platform=whatsapp`);
    expect(llamada()[1].headers.Authorization).toBe("Bearer zrk_llave");
    expect(cuentas).toEqual([
      { id: ACCOUNT, name: "Uniko RD", isActive: true, needsReconnection: false },
      { id: "otro", name: "+12029087457", isActive: false, needsReconnection: true },
    ]);
  });

  it("sin `accounts` en la respuesta no hay cuentas, no un crash", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await expect(listZernioAccounts("zrk_llave", "whatsapp")).resolves.toEqual([]);
  });
});

type Mensaje = NonNullable<ZernioEvent["message"]>;
type Evento = {
  id: string;
  event: string;
  message: Mensaje;
  account: { id?: string; platform?: string };
  statusAt?: string;
  error?: { code?: number; title?: string; message?: string } | null;
};

const BASE: Evento = {
  id: "evt_1",
  event: "message.received",
  message: {
    id: "665f0001",
    platformMessageId: WAMID,
    conversationId: HILO,
    direction: "incoming",
    text: "Hola",
    sentAt: "2026-10-20T18:00:00.000Z",
    sender: { id: "18496279994", phoneNumber: "+18496279994", name: "Ana" },
  },
  account: { id: ACCOUNT, platform: "whatsapp" },
};

function evento(over: Partial<Evento> = {}): Evento {
  return { ...BASE, ...over };
}

describe("la normalización del entrante", () => {
  it("un texto de WhatsApp entra con identidad de teléfono e hilo", () => {
    const evt = normalizeZernioWhatsappEvent(evento());
    expect(evt).toMatchObject({
      accountRef: ACCOUNT,
      identity: { identity: "18496279994", phone: "18496279994" },
      // Prefijado: un id de Zernio nunca debe chocar con un wamid en el índice único.
      waMessageId: "zw_665f0001",
      type: "text",
      text: "Hola",
      threadRef: HILO,
    });
  });

  it("la hora del evento es la de `sentAt`, no la de llegada", () => {
    const evt = normalizeZernioWhatsappEvent(evento());
    expect(evt!.timestamp).toBe(
      String(Math.floor(Date.parse("2026-10-20T18:00:00.000Z") / 1000))
    );
  });

  it("sin teléfono, el BSUID es la identidad: nunca se inventa un número", () => {
    const evt = normalizeZernioWhatsappEvent(
      evento({
        message: {
          ...evento().message,
          sender: { id: "AQQBSuid", businessScopedUserId: "AQQBSuid" },
        },
      })
    );
    expect(evt!.identity).toMatchObject({
      identity: "bsuid:AQQBSuid",
      phone: null,
      waUserId: "AQQBSuid",
    });
  });

  it("el nombre del perfil llega aunque la plataforma no mande contactos", () => {
    const evt = normalizeZernioWhatsappEvent(evento());
    expect(evt!.identity.profileName).toBe("Ana");
  });

  it("descarta otra plataforma, otra clase de evento y los salientes", () => {
    expect(
      normalizeZernioWhatsappEvent(evento({ account: { id: ACCOUNT, platform: "instagram" } }))
    ).toBeNull();
    expect(normalizeZernioWhatsappEvent(evento({ event: "message.sent" }))).toBeNull();
    expect(
      normalizeZernioWhatsappEvent(
        evento({ message: { ...evento().message, direction: "outgoing" } })
      )
    ).toBeNull();
    // Un payload de Meta (objeto `page`) tampoco pasa: no trae `account`.
    expect(normalizeZernioWhatsappEvent({ object: "whatsapp_business_account" })).toBeNull();
  });

  it("un adjunto conserva tipo, mime y pie; sin url el mensaje entra igual", () => {
    const conAdjunto = normalizeZernioWhatsappEvent(
      evento({
        message: {
          ...evento().message,
          text: "mira esto",
          attachments: [
            {
              type: "image",
              url: "https://zernio.com/api/v1/whatsapp/media/ABC123?exp=1",
              mimeType: "image/jpeg",
            },
          ],
        },
      })
    );
    expect(conAdjunto).toMatchObject({
      type: "image",
      media: {
        kind: "image",
        mimeType: "image/jpeg",
        caption: "mira esto",
      },
    });

    const sinUrl = normalizeZernioWhatsappEvent(
      evento({
        message: { ...evento().message, text: null, attachments: [{ type: "audio" }] },
      })
    );
    expect(sinUrl).toMatchObject({ type: "audio", media: null });

    const raro = normalizeZernioWhatsappEvent(
      evento({
        message: {
          ...evento().message,
          text: null,
          attachments: [{ type: "share", url: "https://x.test/1" }],
        },
      })
    );
    expect(raro).toMatchObject({ type: "unsupported" });
  });

  it("ni texto ni adjunto no es un mensaje que mostrar", () => {
    expect(
      normalizeZernioWhatsappEvent(
        evento({ message: { ...evento().message, text: "" } })
      )
    ).toBeNull();
  });
});

describe("los acuses de entrega", () => {
  it("delivered/read/failed pasan con el wamid y su hora", () => {
    for (const [evento_, esperado] of [
      ["message.delivered", "delivered"],
      ["message.read", "read"],
      ["message.failed", "failed"],
    ] as const) {
      const a = normalizeZernioWhatsappAcuse(
        evento({
          event: evento_,
          statusAt: "2026-10-20T18:01:00.000Z",
          message: { ...evento().message, direction: "outgoing" },
        })
      );
      expect(a).toMatchObject({
        accountRef: ACCOUNT,
        status: {
          id: WAMID,
          status: esperado,
          timestamp: String(Math.floor(Date.parse("2026-10-20T18:01:00.000Z") / 1000)),
        },
      });
    }
  });

  it("un fallo trae el error de la plataforma, para que el operador lo lea", () => {
    const a = normalizeZernioWhatsappAcuse(
      evento({
        event: "message.failed",
        error: { code: 131049, title: "Re-engagement message", message: "fuera de ventana" },
        message: { ...evento().message, direction: "outgoing" },
      })
    );
    expect(a!.status.errors).toEqual([
      { code: 131049, title: "Re-engagement message", message: "fuera de ventana" },
    ]);
  });

  it("sin platformMessageId no hay nada que marcar: no se adivina el mensaje", () => {
    expect(
      normalizeZernioWhatsappAcuse(
        evento({
          event: "message.read",
          message: { id: "665f0001", direction: "outgoing" },
        })
      )
    ).toBeNull();
    expect(
      normalizeZernioWhatsappAcuse(
        evento({ event: "message.read", account: { id: ACCOUNT, platform: "facebook" } })
      )
    ).toBeNull();
  });
});

describe("el reparto del evento", () => {
  it("un entrante se ingesta con la organización de esa cuenta y el id de media de Zernio", async () => {
    await processZernioWhatsappEvent(
      evento({
        message: {
          ...evento().message,
          text: null,
          attachments: [
            {
              type: "image",
              url: "https://zernio.com/api/v1/whatsapp/media/ABC123?exp=1",
              mimeType: "image/jpeg",
            },
          ],
        },
      })
    );
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]![0]).toMatchObject({
      organizationId: "org_a",
      waMessageId: "zw_665f0001",
      threadRef: HILO,
      // El id, no la URL: viaja al bot como segmento de ruta.
      media: { waMediaId: "ABC123", fetchStatus: "pending" },
    });
    expect(applyStatus).not.toHaveBeenCalled();
  });

  it("una URL sin forma de id se guarda tal cual, para no perder el adjunto", async () => {
    await processZernioWhatsappEvent(
      evento({
        message: {
          ...evento().message,
          text: null,
          attachments: [{ type: "image", url: "https://x.test/m/ABC123", mimeType: "image/png" }],
        },
      })
    );
    expect(ingest.mock.calls[0]![0]).toMatchObject({
      media: { waMediaId: "ABC123" },
    });

    ingest.mockClear();
    await processZernioWhatsappEvent(
      evento({
        message: {
          ...evento().message,
          text: null,
          attachments: [{ type: "image", url: "no-es-una-url", mimeType: "image/png" }],
        },
      })
    );
    expect(ingest.mock.calls[0]![0]).toMatchObject({
      media: { waMediaId: "no-es-una-url" },
    });
  });

  it("un acuse avanza el estado del mensaje, no crea uno nuevo", async () => {
    await processZernioWhatsappEvent(
      evento({
        event: "message.read",
        statusAt: "2026-10-20T18:01:00.000Z",
        message: { ...evento().message, direction: "outgoing" },
      })
    );
    expect(applyStatus).toHaveBeenCalledTimes(1);
    expect(applyStatus.mock.calls[0]).toEqual([
      "org_a",
      expect.objectContaining({ id: WAMID, status: "read" }),
    ]);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("una cuenta desconocida o conectada por Meta no ingesta nada", async () => {
    credenciales.current = null;
    await processZernioWhatsappEvent(evento());
    expect(ingest).not.toHaveBeenCalled();

    credenciales.current = {
      organizationId: "org_a",
      source: "meta",
      token: "EAAG",
      accountRef: ACCOUNT,
    };
    await processZernioWhatsappEvent(evento());
    await processZernioWhatsappEvent(evento({ event: "message.read" }));
    expect(ingest).not.toHaveBeenCalled();
    expect(applyStatus).not.toHaveBeenCalled();
  });
});

describe("la frontera de la Cloud API", () => {
  it("sin Phone Number ID no hay Graph que llamar: un envío por Meta se corta", async () => {
    // Es el guard que atrapa un camino nuevo que olvidó consultar
    // `hablaPorZernio`: una fila de Zernio no tiene número de Meta.
    const conexionZernio = {
      organizationId: "org_a",
      source: "zernio",
      wabaId: null,
      phoneNumberId: null,
      accountRef: ACCOUNT,
      webhookSecret: null,
      displayPhoneNumber: null,
      verifiedName: null,
      status: "connected",
      token: "zrk_llave",
    } as unknown as import("@/server/whatsapp/credentials").Credentials;
    await expect(
      callGraphSend(conexionZernio, { messaging_product: "whatsapp" })
    ).rejects.toMatchObject({ code: "not_connected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

