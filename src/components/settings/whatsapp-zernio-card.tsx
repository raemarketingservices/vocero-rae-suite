"use client";

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  RefreshCw,
  Smartphone,
} from "lucide-react";
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
 * 023/025 — WhatsApp por Zernio, en dos formas de conectar el mismo número.
 *
 * - **Escaneando un QR** (modo RAE): el CRM prepara el escaneo con su llave
 *   maestra y al dueño de la tienda solo le queda abrir la cámara. No ve Zernio,
 *   no crea una cuenta y no copia una API key: es lo que se vende.
 * - **Pegando su llave** (BYO): cada tienda paga su cuenta de Zernio y trae su
 *   key. Sigue existiendo porque hay clientes que ya la tienen, y porque es la
 *   única forma de conectar sin que RAE sea dueño de la cuenta.
 *
 * Las dos terminan en la misma fila de credenciales y pasan por las mismas
 * guardas, así que el webhook y el reparto de mensajes no saben de qué modo
 * nació la conexión.
 */

export type ZernioConnection = {
  source: "zernio";
  accountRef: string | null;
  displayPhoneNumber: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

type Modo = "qr" | "llave";

/** Los estados de Zernio, sin traducir: son los mismos que contesta la ruta. */
type EstadoEscaneo =
  | "inactivo"
  | "qr"
  | "waiting"
  | "opened"
  | "connected"
  | "failed"
  | "expired";

type Cuenta = {
  id: string;
  name: string | null;
  phoneNumber: string | null;
  sandbox: boolean;
  needsReconnection: boolean;
};

export function WhatsappZernioCard({
  existing,
  webhookUrl,
  onSaved,
}: {
  existing: ZernioConnection | null;
  webhookUrl: string | null;
  onSaved: () => void;
}) {
  const [modoRae, setModoRae] = useState(false);
  const [modo, setModo] = useState<Modo>("llave");

  // La tarjeta no puede adivinar si la instancia ofrece el escaneo: lo pregunta
  // una vez, porque la respuesta viene del entorno y no de esta tienda.
  useEffect(() => {
    let vivo = true;
    void fetch("/api/settings/whatsapp/zernio")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { modoRae?: boolean } | null) => {
        if (!vivo || !d?.modoRae) return;
        setModoRae(true);
        setModo("qr");
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {existing
            ? "Actualizar la conexión de Zernio"
            : "Conectar WhatsApp por Zernio"}
        </CardTitle>
        <CardDescription>
          Zernio mantiene la sesión con Meta. Puedes conectar escaneando un QR
          desde tu teléfono o pegando la API key de tu propia cuenta de Zernio.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {modoRae && (
          <div className="flex flex-wrap gap-2">
            {(["qr", "llave"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                aria-pressed={modo === m}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                  modo === m
                    ? "border-brand bg-brand-tint text-brand-text"
                    : "border-border-strong hover:bg-accent"
                )}
              >
                {m === "qr"
                  ? "Conectar con RAE (escaneo un QR)"
                  : "Ya tengo mi cuenta (pego mi API key)"}
              </button>
            ))}
          </div>
        )}

        {modoRae && modo === "qr" ? (
          <EscaneoQr
            reconectar={existing?.status === "reconnect_required"}
            onConectado={onSaved}
          />
        ) : (
          <ConectarConLlave existing={existing} onSaved={onSaved} />
        )}

        {webhookUrl && <UrlDelWebhook webhookUrl={webhookUrl} />}
      </CardContent>
    </Card>
  );
}

/**
 * El escaneo, de principio a fin.
 *
 * Se sondea cada tres segundos (lo que recomienda Zernio) y el sondeo se corta
 * en cuanto el estado es terminal: seguir preguntando por un handoff ya
 * consumido es escribir en la fila de nuevo. La cuenta atrás también corta, pero
 * con la duración que midió el servidor: el reloj de quien conecta puede estar
 * adelantado horas, y fiarse de él es declararle caduco a un enlace vivo.
 */
function EscaneoQr({
  reconectar,
  onConectado,
}: {
  reconectar: boolean;
  onConectado: () => void;
}) {
  const [escaneo, setEscaneo] = useState<{
    handoffId: string;
    url: string;
    /** Segundos que le quedaban al recibir la respuesta, según el servidor. */
    duracion: number | null;
    /** Cuándo se recibió, en el reloj de este navegador. */
    recibido: number;
  } | null>(null);
  const [estado, setEstado] = useState<EstadoEscaneo>("inactivo");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arrancando, setArrancando] = useState(false);
  const [quedan, setQuedan] = useState<number | null>(null);
  const [copiado, setCopiado] = useState(false);

  const arrancar = useCallback(async () => {
    setArrancando(true);
    setError(null);
    setMensaje(null);
    setEscaneo(null);
    setEstado("inactivo");
    const res = await fetch("/api/settings/whatsapp/zernio/handoff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reconectar ? { reconectar: true } : {}),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as {
      estado?: string;
      handoffId?: string;
      url?: string;
      quedanSegundos?: number | null;
      error?: { message?: string };
    } | null;
    setArrancando(false);

    if (!res?.ok) {
      setError(data?.error?.message ?? "Zernio no pudo preparar el escaneo");
      return;
    }
    // Sin número que escanear: Zernio reactivó la cuenta que ya estaba en este
    // perfil y el CRM la guardó en el mismo POST.
    if (data?.estado === "connected") {
      setEstado("connected");
      onConectado();
      return;
    }
    if (!data?.handoffId || !data.url) {
      setError("Zernio respondió sin enlace de escaneo");
      return;
    }
    setEscaneo({
      handoffId: data.handoffId,
      url: data.url,
      duracion: data.quedanSegundos ?? null,
      recibido: Date.now(),
    });
    setEstado("qr");
  }, [reconectar, onConectado]);

  useEffect(() => {
    if (!escaneo || estado === "connected" || estado === "failed" || estado === "expired") {
      return;
    }
    let vivo = true;
    const id = setInterval(async () => {
      const res = await fetch(
        `/api/settings/whatsapp/zernio/handoff?handoffId=${encodeURIComponent(escaneo.handoffId)}`
      ).catch(() => null);
      if (!vivo) return;
      const data = (await res?.json().catch(() => null)) as {
        estado?: EstadoEscaneo;
        mensaje?: string;
        error?: { message?: string };
      } | null;
      if (!res?.ok) {
        setError(data?.error?.message ?? "No se pudo consultar el escaneo");
        return;
      }
      if (data?.estado === "waiting" || data?.estado === "opened") {
        setEstado(data.estado);
        return;
      }
      if (data?.estado === "connected") {
        setEstado("connected");
        setError(null);
        onConectado();
        return;
      }
      if (data?.estado === "expired") {
        setEstado("expired");
        setMensaje(data.mensaje ?? "El enlace caducó: pide uno nuevo.");
        return;
      }
      if (data?.estado === "failed") {
        setEstado("failed");
        setMensaje(data.mensaje ?? "El escaneo no terminó.");
      }
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [escaneo, estado, onConectado]);

  /**
   * La cuenta atrás, restada del reloj de este navegador dos veces.
   *
   * `duracion` llega ya medida por el servidor, así que el desfase entre los dos
   * relojes se cancela en la resta: una máquina adelantada horas veía caducar en
   * segundos un enlace que aún servía 29 minutos, y cortaba un escaneo que iba
   * bien. Sin `duracion` no se adivina nada: manda el sondeo.
   */
  useEffect(() => {
    if (!escaneo?.duracion) {
      setQuedan(null);
      return;
    }
    const { duracion, recibido } = escaneo;
    const marca = () =>
      setQuedan(
        Math.max(0, duracion - Math.round((Date.now() - recibido) / 1000))
      );
    marca();
    const id = setInterval(marca, 1000);
    return () => clearInterval(id);
  }, [escaneo]);

  // El enlace caduca a los 30 minutos y el servidor dijo cuántos le quedaban al
  // nacer: si aquí llega a 0, ya no hay nada que sondear.
  useEffect(() => {
    if (quedan === 0 && (estado === "qr" || estado === "waiting" || estado === "opened")) {
      setEstado("expired");
      setMensaje("El enlace caducó: dura 30 minutos. Pide uno nuevo y escanéalo.");
    }
  }, [quedan, estado]);

  if (estado === "connected") {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-success-text">
          <CheckCircle2 className="h-4 w-4" />
          Número conectado. La tarjeta se va a actualizar sola.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-xs text-text-2">
        <li>
          Escanea este código con la{" "}
          <span className="text-foreground">cámara del teléfono</span>, no desde
          dentro de WhatsApp: es un enlace web y el lector de{" "}
          <span className="text-foreground">Dispositivos vinculados</span> solo
          entiende códigos de vinculación, por eso rechaza este.
        </li>
        <li>
          En el teléfono se abre la pantalla de RAE: acepta e inicia sesión en{" "}
          <span className="text-foreground">Facebook</span> con la cuenta dueña
          del número, y elige conectar la app de WhatsApp Business que ya tienes.
          Con el WhatsApp normal no va. Nada se transfiere ni se porta: el número
          sigue siendo tuyo y la app sigue funcionando igual.
        </li>
        <li>
          Cuando el teléfono diga que terminó, vuelve aquí: la conexión sola
          aparece en esta pantalla.
        </li>
      </ol>

      {escaneo && (
        <div className="flex flex-wrap items-center gap-4 rounded-md border bg-background p-4">
          <div className="rounded-md bg-white p-2">
            <QRCodeSVG value={escaneo.url} size={196} />
          </div>
          <div className="min-w-[12rem] flex-1 space-y-1 text-sm">
            <p className="font-medium">
              {estado === "opened"
                ? "Abierto en el teléfono: termina ahí los pasos de Meta."
                : "Escanea con la cámara del teléfono."}
            </p>
            {quedan !== null && (
              <p className="text-xs text-text-3">
                {quedan > 0
                  ? `Este enlace caduca en ${Math.floor(quedan / 60)}:${String(
                      quedan % 60
                    ).padStart(2, "0")}.`
                  : "El enlace caducó."}
              </p>
            )}
            {estado === "waiting" && (
              <p className="flex items-center gap-1.5 text-xs text-text-3">
                <Loader2 className="h-3 w-3 animate-spin" /> Esperando el
                escaneo…
              </p>
            )}
            {estado === "opened" && (
              <p className="flex items-center gap-1.5 text-xs text-text-3">
                <Loader2 className="h-3 w-3 animate-spin" /> Comprobando…
              </p>
            )}
          </div>
        </div>
      )}

      {escaneo && (
        <details className="text-xs text-text-3">
          <summary className="cursor-pointer">
            ¿Estás en el teléfono y no puedes escanear tu propia pantalla?
          </summary>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1">
              {escaneo.url}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar el enlace de escaneo"
              onClick={() => {
                void navigator.clipboard.writeText(escaneo.url).then(() => {
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 1500);
                });
              }}
            >
              {copiado ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </details>
      )}

      {(estado === "failed" || estado === "expired") && mensaje && (
        <div className="flex items-start gap-2 rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">{mensaje}</p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        variant={escaneo ? "outline" : "default"}
        disabled={arrancando}
        onClick={() => void arrancar()}
      >
        {arrancando ? (
          "Preparando el enlace…"
        ) : escaneo ? (
          <>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            {estado === "failed" || estado === "expired"
              ? "Pedir otro enlace"
              : "Reiniciar el escaneo"}
          </>
        ) : (
          "Pedir un enlace de escaneo"
        )}
      </Button>

      <p className="flex items-start gap-2 text-xs text-text-3">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        No hace falta que tengas cuenta en Zernio: la conexión corre a cargo de
        RAE y el número queda en tu propia app de WhatsApp Business.
      </p>
    </div>
  );
}

/** El modo de siempre: la tienda trae su API key y su accountId. */
function ConectarConLlave({
  existing,
  onSaved,
}: {
  existing: ZernioConnection | null;
  onSaved: () => void;
}) {
  const [accountRef, setAccountRef] = useState(existing?.accountRef ?? "");
  const [token, setToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function guardar(accountElegida?: string) {
    setSaving(true);
    setError(null);
    setSaved(null);
    const res = await fetch("/api/settings/whatsapp/zernio", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: token.trim(),
        accountRef: (accountElegida ?? accountRef).trim() || null,
        webhookSecret: webhookSecret.trim() || null,
        sandbox,
      }),
    }).catch(() => null);
    setSaving(false);

    const data = (await res?.json().catch(() => null)) as {
      cuentas?: Cuenta[];
      error?: { message?: string };
    } | null;

    if (!res?.ok) {
      // Varios números en la misma llave: se lista y se elige, no se adivina.
      if (data?.cuentas?.length) setCuentas(data.cuentas);
      setError(data?.error?.message ?? "No se pudo conectar con Zernio");
      return;
    }
    setCuentas(null);
    setToken("");
    setWebhookSecret("");
    setSaved("Número conectado por Zernio");
    onSaved();
  }

  return (
    <div className="space-y-4">
      <ul className="list-disc space-y-1 pl-5 text-xs text-text-2">
        <li>
          El número se vincula en el panel de Zernio (WhatsApp → Connect), no
          desde el CRM. Copia de ahí el <code>accountId</code>.
        </li>
        <li>
          La API key se crea en Zernio → Settings → API Keys y se muestra una
          sola vez. Si cada tienda paga la suya, usa la key de esa cuenta: así
          el consumo se factura donde corresponde.
        </li>
        <li>
          Deja <span className="text-foreground">accountId</span> vacío y la
          llave tiene un solo número de WhatsApp: se conecta ese.
        </li>
        <li>
          El secreto del webhook es opcional, pero con él cada entrega se
          verifica por firma HMAC; sin él solo protege el segmento secreto de la
          URL.
        </li>
      </ul>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="za-account">accountId de Zernio</Label>
          <Input
            id="za-account"
            value={accountRef}
            onChange={(e) => setAccountRef(e.target.value)}
            placeholder={
              existing ? existing.accountRef ?? "" : "opcional si tienes un solo número"
            }
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="za-secret">Secreto del webhook (opcional)</Label>
          <Input
            id="za-secret"
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="el mismo que pusiste en Zernio"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="za-token">API key de Zernio</Label>
        <Input
          id="za-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={
            existing
              ? `Guardada (····${existing.tokenLast4}) — pega la llave otra vez para cambiarla`
              : "zrk_…"
          }
          autoComplete="off"
        />
      </div>

      <label className="flex items-start gap-2 text-xs text-text-2">
        <input
          type="checkbox"
          checked={sandbox}
          onChange={(e) => setSandbox(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
        />
        <span>
          Incluir el número de pruebas compartido de Zernio (sandbox) en la
          lista. Solo para montar la conexión antes de tener número propio: nadie
          más escribe ahí.
        </span>
      </label>

      {cuentas && cuentas.length > 0 && (
        <div className="space-y-2 rounded-md border bg-background p-3">
          <p className="text-sm font-medium">
            Esta API key tiene varios números: elige el de esta tienda.
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
                  {c.phoneNumber ?? c.name ?? "sin nombre"}
                </span>
                {c.sandbox && <span className="text-xs text-warning-text">pruebas</span>}
                {c.needsReconnection && (
                  <span className="text-xs text-warning-text">necesita reconectar</span>
                )}
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
      {saved && (
        <p className="flex items-center gap-2 text-sm text-success-text">
          <CheckCircle2 className="h-4 w-4" /> {saved}
        </p>
      )}

      <Button
        disabled={saving || token.trim().length === 0}
        onClick={() => void guardar()}
      >
        {saving ? "Probando…" : existing ? "Actualizar" : "Probar y guardar"}
      </Button>
    </div>
  );
}

function UrlDelWebhook({ webhookUrl }: { webhookUrl: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="space-y-1.5 border-t pt-4">
      <Label>URL que va en Zernio</Label>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 text-xs">
          {webhookUrl}
        </code>
        <Button
          variant="outline"
          size="icon"
          aria-label="Copiar la URL del webhook"
          onClick={() => {
            void navigator.clipboard.writeText(webhookUrl).then(() => {
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1500);
            });
          }}
        >
          {copiado ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <p className="flex items-start gap-2 text-xs text-text-3">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Con la llave de RAE el CRM da de alta esta URL él solo al conectar el
        número. Con tu cuenta propia, dala de alta en Zernio con los eventos{" "}
        <code>message.received</code>, <code>message.delivered</code>,{" "}
        <code>message.read</code> y <code>message.failed</code>. La URL contiene
        el token secreto de la ruta: trátala como una contraseña.
      </p>
    </div>
  );
}
