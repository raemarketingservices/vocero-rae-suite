import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/**
 * Devolver el agente a su estado de fábrica.
 *
 * Existe porque el admin de la plataforma ya tiene bots montados (el de Uniko,
 * por ejemplo) y quiere volver a pasarlos por la configuración desde cero sin
 * tener que borrar campo por campo: se apaga al agente y quedan en blanco el
 * nombre, el tono, las instrucciones, las reglas de escalado y el saludo, que
 * son exactamente los campos que edita la pantalla Agente.
 *
 * NO toca la knowledge base ni las credenciales del canal: perder el
 * conocimiento del negocio no es «reconfigurar el agente», y eso no se
 * consigue con un clic.
 */
export const POST = withAuth(async (session) => {
  const actualizado = await getDb()
    .update(schema.agentProfile)
    .set({
      enabled: false,
      name: "Asistente",
      tone: null,
      instructions: null,
      escalationRules: null,
      greeting: null,
      updatedAt: new Date(),
    })
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .returning({ id: schema.agentProfile.id });

  if (!actualizado[0]) {
    return apiError(404, "not_found", "Perfil del agente no encontrado");
  }
  return Response.json({ ok: true });
});
