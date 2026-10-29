"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * 014 — Conexión del canal de Instagram.
 *
 * Dos fuentes, como WhatsApp y Messenger: la API unificada de Zernio o una app
 * propia de Meta. La diferencia con las otras dos es que aquí el `IG_ID` no se
 * teclea: en modo Zernio sale de la cuenta conectada en el servicio, porque un
 * id escrito a mano guarda una conexión que recibe webhooks de un perfil y
 * contesta por otro. Misma regla que los demás canales: la pantalla solo existe
 * si el canal está encendido con `CHANNELS` (ADR-001).
 */

type Source = "zernio" | "meta";

type Connection = {
  source: Source;
  igUserId: string;
  accountRef: string | null;
  username: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

type Cuenta = {
  id: string;
  name: string | null;
  platformUserId: string | null;
};

type WebhookInfo = {
  instagramUrl: string | null;
  verifyToken: string;
  isHttps: boolean;
  signatureLayer: boolean;
};

const HELP: Record<Source, { title: string; items: string[] }> = {
  zernio: {
    title: "Conecta el perfil en Zernio y pega aquí su cuenta y tu API key",
    items: [
      "El perfil se vincula en el panel de Zernio (Instagram → Connect), no desde el CRM. Copia de ahí el accountId de la cuenta de Instagram.",
      "La API key se crea en Zernio → Settings → API Keys y se muestra una sola vez.",
      "Deja el accountId vacío y la llave tiene un solo Instagram: se conecta ese. El IG_ID sale de la cuenta listada, no hay que escribirlo.",
      "El mismo webhook de Zernio entrega WhatsApp, Messenger y X si esas cuentas están conectadas; el CRM filtra por plataforma.",
    ],
  },
  meta: {
    title: "Crea una app en developers.facebook.com con el producto Instagram",
    items: [
      "El IG_ID del perfil profesional está en la API de Instagram (graph.instagram.com/me) o en el explorador de Graph API de tu app.",
      "El token se genera con los permisos instagram_manage_messages e instagram_business_basic_information; uno de larga duración evita reconectar cada dos meses.",
      "Sin App Review, el perfil solo admite mensajes de cuentas con un rol en la app (administradores, desarrolladores, testers).",
    ],
  },
};

export function InstagramClient() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<Source>("zernio");
  const [igUserId, setIgUserId] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [token, setToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "token" | null>(null);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/instagram").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (c) {
      setConnection(c.connection);
      if (c.connection) {
        setSource(c.connection.source);
        setIgUserId(c.connection.igUserId);
        if (c.connection.accountRef) setAccountRef(c.connection.accountRef);
      }
    }
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(null);
    const res = await fetch("/api/settings/instagram", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source,
        // En modo Zernio el IG_ID lo devuelve la plataforma; mandarlo vacío
        // obliga a la ruta a ir a buscarlo en vez de fiarse de un tecleo.
        igUserId: igUserId.trim() || null,
        accountRef: accountRef.trim() || null,
        token: token.trim(),
        webhookSecret: webhookSecret.trim() || null,
      }),
    }).catch(() => null);
    setSaving(false);

    const data = (await res?.json().catch(() => null)) as {
      cuentas?: Cuenta[];
      username?: string | null;
      error?: { message?: string };
    } | null;

    if (!res?.ok) {
      // Varios perfiles en la misma llave: se lista y se elige, no se adivina.
      if (data?.cuentas?.length) setCuentas(data.cuentas);
      setError(data?.error?.message ?? "No se pudo conectar el perfil");
      return;
    }
    setCuentas(null);
    setToken("");
    setWebhookSecret("");
    setSaved(
      data?.username ? `Perfil conectado: ${data.username}` : "Conexión guardada"
    );
    void refetch();
  }

  async function copy(text: string, what: "url" | "token") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // sin portapapeles (contexto no seguro): el texto sigue visible
    }
  }

  if (!loaded) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const help = HELP[source];
  const canSave =
    token.trim().length > 0 && (source === "meta" ? igUserId.trim().length > 0 : true);

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              El token expiró o fue revocado.
            </p>
            <p className="text-danger-text opacity-80">
              Los envíos por Instagram están pausados. Pega uno nuevo abajo para
              reconectar.
            </p>
          </div>
        </div>
      )}

      {connection?.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-success-soft bg-success-tint p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-text">
              Conectado por {connection.source === "zernio" ? "Zernio" : "Meta"}
              {connection.username ? `: @${connection.username}` : ""}
            </p>
            <p className="text-success-text opacity-80">
              {connection.source === "zernio"
                ? `Cuenta ${connection.accountRef}`
                : `IG_ID ${connection.igUserId}`}{" "}
              · token que termina en ····{connection.tokenLast4}
            </p>
          </div>
          <Badge variant="success">Instagram activo</Badge>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {connection ? "Reconectar Instagram" : "Conectar Instagram"}
          </CardTitle>
          <CardDescription>
            Los mensajes directos que le escriben al perfil entran a la misma
            bandeja que WhatsApp, con su distintivo de canal. {help.title}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>¿De dónde llegan los mensajes?</Label>
            <div className="flex flex-wrap gap-2">
              {(["zernio", "meta"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  aria-pressed={source === s}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                    source === s
                      ? "border-brand bg-brand-tint text-brand-text"
                      : "border-border-strong hover:bg-accent"
                  )}
                >
                  {s === "zernio" ? "Zernio (API unificada)" : "App propia de Meta"}
                </button>
              ))}
            </div>
          </div>

          <ul className="list-disc space-y-1 pl-5 text-xs text-text-2">
            {help.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>

          <div className="grid gap-4 sm:grid-cols-2">
            {source === "zernio" ? (
              <div className="space-y-1.5">
                <Label htmlFor="ig-account">accountId de Zernio</Label>
                <Input
                  id="ig-account"
                  value={accountRef}
                  onChange={(e) => setAccountRef(e.target.value)}
                  placeholder={
                    connection
                      ? connection.accountRef ?? ""
                      : "opcional si tienes un solo perfil"
                  }
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="ig-user-id">IG_ID del perfil</Label>
                <Input
                  id="ig-user-id"
                  value={igUserId}
                  onChange={(e) => setIgUserId(e.target.value)}
                  placeholder="17841400000000000"
                  autoComplete="off"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ig-token">
                {source === "zernio" ? "API key de Zernio" : "Token del perfil"}
              </Label>
              <Input
                id="ig-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={
                  connection
                    ? `Guardada (····${connection.tokenLast4}) — pégala otra vez para cambiarla`
                    : source === "zernio"
                      ? "zrk_…"
                      : "EAAG…"
                }
                autoComplete="off"
              />
            </div>
            {source === "zernio" && (
              <div className="space-y-1.5">
                <Label htmlFor="ig-secret">Secreto del webhook (opcional)</Label>
                <Input
                  id="ig-secret"
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="el mismo que pusiste en Zernio"
                  autoComplete="off"
                />
              </div>
            )}
          </div>

          {cuentas && cuentas.length > 0 && (
            <div className="space-y-2 rounded-md border bg-background p-3">
              <p className="text-sm font-medium">
                Esta API key tiene varios perfiles de Instagram: elige el de esta
                tienda.
              </p>
              <div className="space-y-1.5">
                {cuentas.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setAccountRef(c.id);
                      setCuentas(null);
                      setError(null);
                    }}
                    aria-pressed={accountRef === c.id}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      accountRef === c.id
                        ? "border-brand bg-brand-tint text-brand-text"
                        : "border-border-strong hover:bg-accent"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {c.name ? `@${c.name}` : "sin nombre"}
                    </span>
                    <code className="truncate text-xs text-text-3">{c.id}</code>
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-3">
                Después de elegir, vuelve a pulsar «Probar y guardar».
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-success-text">{saved} ✓</p>}

          <Button disabled={saving || !canSave} onClick={() => void save()}>
            {saving ? "Probando…" : "Probar y guardar"}
          </Button>
        </CardContent>
      </Card>

      {webhook?.instagramUrl && (
        <Card>
          <CardHeader>
            <CardTitle>Webhook de Instagram</CardTitle>
            <CardDescription>
              {source === "zernio" ? (
                <>
                  En Zernio, da de alta este endpoint con el evento{" "}
                  <code>message.received</code> y, si usas secreto, el mismo que
                  pegaste arriba.
                </>
              ) : (
                <>
                  En tu app de Meta: Instagram → Webhooks. Objeto{" "}
                  <code>instagram</code>, campos <code>messages</code> y{" "}
                  <code>story_insights</code> si quieres. Pega esta URL y este
                  token de verificación.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>URL de callback</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={webhook.instagramUrl}
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copiar la URL"
                  onClick={() => void copy(webhook.instagramUrl!, "url")}
                >
                  {copied === "url" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-text-3">
                La URL contiene el token secreto de la ruta: trátala como una
                contraseña.
              </p>
            </div>
            {source === "meta" && (
              <div className="space-y-1.5">
                <Label>Token de verificación</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhook.verifyToken}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copiar el token de verificación"
                    onClick={() => void copy(webhook.verifyToken, "token")}
                  >
                    {copied === "token" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}
            <p className="flex items-start gap-2 text-xs text-text-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {source === "zernio"
                ? "Con secreto configurado, cada entrega se verifica con su firma HMAC; sin él, la protección es el segmento secreto de la URL."
                : webhook.signatureLayer
                  ? "Cada entrega se verifica con la firma del App Secret de tu app."
                  : "Define META_APP_SECRET en la instancia para que además se verifique la firma de cada entrega."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
