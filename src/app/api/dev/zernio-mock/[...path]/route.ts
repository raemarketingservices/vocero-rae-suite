import { mockGuard } from "@/lib/dev-guard";
import {
  nextZernioMessageId,
  nextZernioMockId,
  resetZernioMock,
  resolverZernioHandoff,
  zernioMockState,
  zernioTokenIsBad,
  type ZernioMockHandoff,
} from "@/server/dev/zernio-mock-state";

export const dynamic = "force-dynamic";

/**
 * 017 — Zernio de mentira para el self-test. Tras `mockGuard()`: 404
 * incondicional en producción, indistinguible de una ruta inexistente.
 *
 * Imita lo que Vocero usa de esa API: listar conversaciones (que es como se
 * valida la llave), responder en una, y desde 025 el alta de un número —
 * perfiles, `connect` con handoff, el sondeo del escaneo y la suscripción del
 * webhook. Expone `_sent`, `_reset` y `_handoffs/{id}` para que el arnés pueda
 * afirmar sobre lo que recibió y, sobre todo, hacer de dedo: el resultado de un
 * escaneo lo produce un teléfono y aquí no lo hay.
 */

type Ctx = { params: Promise<{ path: string[] }> };

function unauthorized(): Response {
  return Response.json(
    { error: { message: "Invalid API key" } },
    { status: 401 }
  );
}

/** Como Zernio: un id de perfil con `_id`, y `externalId` para mapear tenants. */
function pintaPerfil(p: { _id: string; name: string; externalId: string | null }) {
  return { _id: p._id, name: p.name, externalId: p.externalId };
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = path.join("/");
  const q = new URL(req.url).searchParams;

  if (route === "_sent") {
    return Response.json({ sent: zernioMockState().sent });
  }
  if (zernioTokenIsBad(req.headers.get("authorization"))) return unauthorized();

  // GET /inbox/conversations → lo que usa la validación de la llave.
  if (route === "inbox/conversations") {
    return Response.json({ data: [], hasMore: false });
  }

  // GET /profiles?externalId= → el filtro exacto que usa el CRM para su tienda.
  if (route === "profiles") {
    const externalId = q.get("externalId");
    const profiles = zernioMockState().profiles.filter(
      (p) => !externalId || p.externalId === externalId
    );
    return Response.json({ profiles: profiles.map(pintaPerfil) });
  }

  // GET /connect/{platform} → el link de escaneo (o la cuenta reactivada).
  if (path[0] === "connect" && path.length === 2) {
    const state = zernioMockState();
    const profileId = q.get("profileId");
    if (!profileId) {
      return Response.json(
        { error: { message: "profileId is required" } },
        { status: 400 }
      );
    }
    const reactivada = state.connectDevuelveCuenta;
    if (reactivada) {
      state.connectDevuelveCuenta = null;
      return Response.json({
        authUrl: `https://zernio.test/connect/${path[1]}`,
        account: {
          _id: reactivada.id,
          username: reactivada.username,
          metadata: { displayPhoneNumber: reactivada.username },
        },
      });
    }
    if (q.get("handoff") !== "true") {
      return Response.json({
        authUrl: `https://zernio.test/connect/${path[1]}`,
        state: `state-${profileId}`,
      });
    }
    const id = nextZernioMockId("handoff");
    const handoff: ZernioMockHandoff = {
      id,
      profileId,
      status: "waiting",
      accounts: [],
      error: null,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    state.handoffs.push(handoff);
    return Response.json({
      authUrl: `https://zernio.test/connect/${path[1]}`,
      state: `state-${profileId}`,
      handoff: { id, url: `https://zernio.test/h/${id}`, expiresAt: handoff.expiresAt },
    });
  }

  // GET /connect/handoffs/{id} → el sondeo del escaneo.
  if (path[0] === "connect" && path[1] === "handoffs" && path.length === 3) {
    const h = zernioMockState().handoffs.find((x) => x.id === decodeURIComponent(path[2]!));
    if (!h) {
      return Response.json({ error: { message: "handoff not found" } }, { status: 404 });
    }
    return Response.json({
      id: h.id,
      status: h.status,
      accounts: h.accounts,
      error: h.error,
    });
  }

  // GET /webhooks/settings → lo que lee el CRM antes de crear su suscripción.
  if (route === "webhooks/settings") {
    return Response.json({ webhooks: zernioMockState().webhooks });
  }

  return Response.json({});
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = mockGuard();
  if (denied) return denied;
  const { path } = await ctx.params;
  const route = path.join("/");

  if (route === "_reset") {
    resetZernioMock();
    return Response.json({ ok: true });
  }

  // Control del arnés: cierra el escaneo como lo haría el teléfono.
  // POST /_handoffs/{id}  {status:"connected", accountId, username}
  // POST /_handoffs/{id}  {status:"failed", code, message, details}
  // POST /_handoffs/{id}  {status:"opened"|"expired"|"waiting"}
  if (path[0] === "_handoffs" && path.length === 2) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = String(body.status ?? "connected");
    let outcome: Parameters<typeof resolverZernioHandoff>[1];
    if (status === "connected") {
      outcome = {
        status: "connected",
        accountId: String(body.accountId ?? nextZernioMockId("acct")),
        username: String(body.username ?? "+1 849 000 0000"),
      };
    } else if (status === "failed") {
      outcome = {
        status: "failed",
        code: String(body.code ?? "connect_incomplete"),
        message: typeof body.message === "string" ? body.message : null,
        details: (body.details ?? {}) as Record<string, string>,
      };
    } else if (status === "opened" || status === "expired" || status === "waiting") {
      outcome = { status };
    } else {
      outcome = {
        status: "failed",
        code: "connect_incomplete",
        message: "estado inventado por el arnés",
      };
    }
    const h = resolverZernioHandoff(decodeURIComponent(path[1]!), outcome);
    if (!h) return Response.json({ error: { message: "handoff not found" } }, { status: 404 });
    return Response.json({ ok: true, handoff: h });
  }

  // Control del arnés: la rama en la que Zernio reactiva una cuenta y responde
  // `account` en vez de `handoff`.
  if (route === "_connect-account") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    zernioMockState().connectDevuelveCuenta =
      body.id || body.username
        ? { id: String(body.id ?? nextZernioMockId("acct")), username: String(body.username ?? "+1 849 000 0000") }
        : null;
    return Response.json({ ok: true });
  }

  if (zernioTokenIsBad(req.headers.get("authorization"))) return unauthorized();

  // POST /profiles → 201 con el perfil; `externalId` repetido es 409, que es lo
  // que obliga al CRM a recuperarlo por lista en vez de crear un segundo.
  if (route === "profiles") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const externalId =
      typeof body.externalId === "string" && body.externalId ? body.externalId : null;
    const state = zernioMockState();
    if (externalId && state.profiles.some((p) => p.externalId === externalId)) {
      return Response.json(
        { error: { message: "profile already exists" } },
        { status: 409 }
      );
    }
    const perfil = {
      _id: nextZernioMockId("profile"),
      name: String(body.name ?? "sin nombre"),
      externalId,
    };
    state.profiles.push(perfil);
    return Response.json({ message: "ok", profile: pintaPerfil(perfil) }, { status: 201 });
  }

  // POST /webhooks/settings → la suscripción que el CRM da de alta solo.
  if (route === "webhooks/settings") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const state = zernioMockState();
    const webhook = {
      id: nextZernioMockId("webhook"),
      name: String(body.name ?? ""),
      url: String(body.url ?? ""),
      events: Array.isArray(body.events) ? body.events.map(String) : [],
      secret: String(body.secret ?? ""),
      isActive: body.isActive !== false,
    };
    state.webhooks.push(webhook);
    return Response.json({ webhook }, { status: 201 });
  }

  // POST /inbox/conversations/{id}/messages
  if (
    path.length === 4 &&
    path[0] === "inbox" &&
    path[1] === "conversations" &&
    path[3] === "messages"
  ) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const state = zernioMockState();
    const id = nextZernioMessageId();
    state.sent.push({
      n: state.seq,
      conversationId: decodeURIComponent(path[2]!),
      accountId: body.accountId ? String(body.accountId) : null,
      message: String(body.message ?? ""),
      ...(body.messagingType ? { messagingType: String(body.messagingType) } : {}),
      ...(body.messageTag ? { messageTag: String(body.messageTag) } : {}),
      idempotencyKey: req.headers.get("idempotency-key"),
      at: new Date().toISOString(),
    });
    return Response.json({ message: { id } });
  }

  return Response.json({});
}
