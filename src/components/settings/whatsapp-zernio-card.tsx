"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Info } from "lucide-react";
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
 * 023 — WhatsApp por Zernio.
 *
 * La diferencia con la tarjeta de Meta no es cosmética: aquí el CRM no tiene
 * WABA ni Phone Number ID, y el webhook no se registra desde el CRM — se da de
 * alta en el panel de Zernio. Por eso esta tarjeta también muestra la URL de
 * callback: sin ella, quien conecta el número no tiene dónde copiar nada.
 */

export type ZernioConnection = {
  source: "zernio";
  accountRef: string | null;
  displayPhoneNumber: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

type Cuenta = { id: string; name: string | null; needsReconnection: boolean };

export function WhatsappZernioCard({
  existing,
  webhookUrl,
  onSaved,
}: {
  existing: ZernioConnection | null;
  webhookUrl: string | null;
  onSaved: () => void;
}) {
  const [accountRef, setAccountRef] = useState(existing?.accountRef ?? "");
  const [token, setToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    <Card>
      <CardHeader>
        <CardTitle>
          {existing ? "Actualizar la conexión de Zernio" : "Conectar WhatsApp por Zernio"}
        </CardTitle>
        <CardDescription>
          Zernio mantiene la sesión con Meta: tú pegas su API key y el accountId
          del número. Se valida contra Zernio antes de guardarse y la llave se
          cifra; hacia fuera solo se enseña su cola.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
            verifica por firma HMAC; sin él solo protege el segmento secreto de
            la URL.
          </li>
        </ul>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="za-account">accountId de Zernio</Label>
            <Input
              id="za-account"
              value={accountRef}
              onChange={(e) => setAccountRef(e.target.value)}
              placeholder={existing ? existing.accountRef ?? "" : "opcional si tienes un solo número"}
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
                    {c.name ?? "sin nombre"}
                  </span>
                  {c.needsReconnection && (
                    <span className="text-xs text-warning-text">
                      necesita reconectar
                    </span>
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

        {webhookUrl && (
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
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="flex items-start gap-2 text-xs text-text-3">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              En Zernio, da de alta esta URL con los eventos{" "}
              <code>message.received</code>, <code>message.delivered</code>,{" "}
              <code>message.read</code> y <code>message.failed</code>. La URL
              contiene el token secreto de la ruta: trátala como una contraseña.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
