import { AiClient } from "@/components/settings/ai-client";
import { VinculoUniko } from "@/components/panel/vinculo-uniko";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionOrNull } from "@/lib/auth/session";
import { storeIdDeTienda } from "@/server/platform/vinculo";
import { inventarioUnikoActivo } from "@/server/uniko/config";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const session = await getSessionOrNull();
  const conUniko = inventarioUnikoActivo() && session?.role === "owner";
  const storeId = conUniko ? await storeIdDeTienda(session.organizationId) : null;

  return (
    <div className="max-w-2xl space-y-6">
      <AiClient />
      {conUniko && (
        <Card>
          <CardHeader>
            <CardTitle>Tu tienda en UNIKO-RD</CardTitle>
            <CardDescription>
              Pega tu Store ID y tu bot de WhatsApp contestará sobre tus productos
              y el perfil de tu tienda en uniko-rd.com.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VinculoUniko
              organizationId={session.organizationId}
              storeId={storeId}
              endpoint="/api/settings/uniko"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
