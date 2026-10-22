"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Tarjeta de registro insertado de Meta (Embedded Signup).
 *
 * El negocio pulsa, Meta abre su ventana, él elige o crea su número y autoriza
 * con SU cuenta. El navegador solo ve pasar identificadores públicos; el código
 * viaja a /api/settings/whatsapp/embedded-signup y ahí termina el token: nunca
 * entra en el CRM desde fuera ni sale de él. Los mensajes se cobran en el
 * método de pago del negocio.
 *
 * Sin `META_APP_ID` + `META_APP_SECRET` + `META_EMBEDDED_SIGNUP_CONFIG_ID` el
 * GET responde `enabled:false` y esta tarjeta no se pinta: la instancia sigue
 * en modo directo.
 */

type Config = {
  enabled: boolean;
  appId: string | null;
  configId: string | null;
  graphVersion: string;
};

type Numero = {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
};

type SdkMeta = {
  init(opts: {
    appId: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
    version: string;
  }): void;
  login(
    cb: (response: {
      authResponse?: { code?: string };
      data?: { phone_number_id?: string; waba_id?: string };
    }) => void,
    opts: Record<string, unknown>
  ): void;
};

declare global {
  interface Window {
    FB?: SdkMeta;
    fbAsyncInit?: () => void;
  }
}

type Ids = { wabaId?: string; phoneNumberId?: string };

export function EmbeddedSignupCard({ onConectado }: { onConectado: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [estado, setEstado] = useState<"inactivo" | "esperando" | "guardando">("inactivo");
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [numeros, setNumeros] = useState<Numero[] | null>(null);
  const idsDeLaVentana = useRef<Ids>({});

  useEffect(() => {
    let vivo = true;
    void fetch("/api/settings/whatsapp/embedded-signup")
      .then((r) => (r.ok ? (r.json() as Promise<Config>) : null))
      .then((c) => {
        if (vivo && c) setConfig(c);
      })
      .catch(() => {
        /* sin respuesta: la tarjeta simplemente no aparece */
      });
    return () => {
      vivo = false;
    };
  }, []);

  // La ventana de Meta avisa por postMessage cuándo ya creó/eligió el número.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;
      let data: { type?: string; event?: string; data?: Record<string, unknown> };
      try {
        data = JSON.parse(String(event.data)) as typeof data;
      } catch {
        return;
      }
      if (data.type !== "WA_EMBEDDED_SIGNUP") return;
      const wabaId = typeof data.data?.waba_id === "string" ? data.data.waba_id : undefined;
      const phoneNumberId =
        typeof data.data?.phone_number_id === "string" ? data.data.phone_number_id : undefined;
      if (wabaId || phoneNumberId) idsDeLaVentana.current = { wabaId, phoneNumberId };
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const appId = config?.appId ?? null;
  const configId = config?.configId ?? null;
  const graphVersion = config?.graphVersion ?? "v25.0";
  if (!config?.enabled || !appId || !configId) return null;

  const conectar = async () => {
    setError(null);
    setNumeros(null);
    setGuardado(false);
    idsDeLaVentana.current = {};
    setEstado("esperando");
    let FB: SdkMeta | undefined;
    try {
      FB = await cargarSdk(appId, graphVersion);
    } catch {
      setEstado("inactivo");
      setError(
        "No se pudo cargar el SDK de Meta (¿bloquea tu navegador connect.facebook.net?)."
      );
      return;
    }
    FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setEstado("inactivo");
          setError("Meta cerró la ventana sin completar el registro.");
          return;
        }
        const deLaVentana = idsDeLaVentana.current;
        void completar({
          code,
          wabaId: response.data?.waba_id ?? deLaVentana.wabaId,
          phoneNumberId: response.data?.phone_number_id ?? deLaVentana.phoneNumberId,
        });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      }
    );
  };

  const completar = async (input: { code: string } & Ids) => {
    setEstado("guardando");
    let res: Response | null;
    try {
      res = await fetch("/api/settings/whatsapp/embedded-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch {
      res = null;
    }
    setEstado("inactivo");
    if (!res) {
      setError("Sin conexión con el servidor.");
      return;
    }
    const data = (await res.json().catch(() => null)) as
      | {
          ok?: boolean;
          code?: string;
          numeros?: Numero[];
          error?: { message?: string };
        }
      | null;
    if (res.ok && data?.ok) {
      setGuardado(true);
      setError(null);
      onConectado();
      return;
    }
    if (data?.code === "varios_numeros") {
      setNumeros(data.numeros ?? []);
      setError(
        "La cuenta tiene varios números. Vuelve a pulsar y elige el número dentro de la ventana de Meta."
      );
      return;
    }
    setError(data?.error?.message ?? "Meta no completó el registro; intenta de nuevo.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conectar con Facebook (registro insertado)</CardTitle>
        <CardDescription>
          El negocio autoriza desde su propia cuenta de Meta: él trae el número,
          su Business Manager y su método de pago. Tú no pagas sus mensajes ni
          ves su token.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {guardado ? (
          <div className="flex items-center gap-2 rounded-md border border-success-soft bg-success-tint p-3 text-sm text-success-text">
            <CheckCircle2 className="h-4 w-4" />
            Conexión guardada.
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void conectar()} disabled={estado !== "inactivo"}>
            {estado === "esperando" ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Esperando a Meta…
              </>
            ) : estado === "guardando" ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Guardando la conexión…
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" />
                Conectar con Facebook
              </>
            )}
          </Button>
          <Badge variant="outline">SDK de Meta · {graphVersion}</Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Si el cliente prefiere pegar el token a mano, usa el formulario de
          abajo. Los dos caminos llegan al mismo sitio.
        </p>

        {numeros && numeros.length > 0 && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {numeros.map((n) => (
              <li key={n.id}>
                {n.displayPhoneNumber ?? n.id}
                {n.verifiedName ? ` · ${n.verifiedName}` : ""}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * El SDK es un script global: se carga una sola vez y `fbAsyncInit` lo
 * inicializa cuando llega. Si ya está en la página, se reutiliza.
 */
function cargarSdk(appId: string, version: string): Promise<SdkMeta> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      window.FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version,
      });
      resolve(window.FB);
      return;
    }
    window.fbAsyncInit = () => {
      const FB = window.FB;
      if (!FB) {
        reject(new Error("El SDK de Meta llegó sin FB global"));
        return;
      }
      FB.init({ appId, autoLogAppEvents: true, xfbml: true, version });
      resolve(FB);
    };
    if (document.getElementById("facebook-jssdk")) return;
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.onerror = () => reject(new Error("No se pudo cargar el SDK de Meta"));
    document.head.appendChild(script);
  });
}
