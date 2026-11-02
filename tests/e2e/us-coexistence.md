# E2E — R12 Coexistence (la app de WhatsApp Business del teléfono)

Precondición: app corriendo con mocks (`WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock), organización creada y conexión WhatsApp
guardada. Sembrar el estado del mock con
`POST /api/dev/wa-mock/coexistence` (`{phoneNumberId, onBizApp, platformType,
wabaId, subscribedFields}`) y leerlo con el `GET` de la misma ruta.

Los campos del webhook (`history`, `smb_app_state_sync`, `account_update`…) NO
se pueden suscribir por API para WhatsApp: se ponen una vez en el panel de la
app. El CRM solo los lee y avisa; por eso el arnés siembra `subscribedFields`.

## El relleno se pide una sola vez

1. `onBizApp: false` (número de Cloud API a secas) → `PUT /api/settings/whatsapp`
   responde 200 con `sincronizacion: null` y el mock no recibe ningún
   `POST /{PHONE}/smb_app_data`.
2. `onBizApp: null` (Meta no reporta el campo) → tampoco se pide: sin
   confirmación no se gasta la única ventana de 24 h.
3. `onBizApp: true` + `subscribedFields: ["messages","smb_message_echoes"]` →
   `webhook.coexistencia.enAppDeNegocio === true`, `campos.faltan` lista
   `history`, `smb_app_state_sync`, `account_update`, y `sincronizacion` trae
   los dos `ok: true`. En el mock: dos `smb_app_data` (`history`,
   `smb_app_state_sync`).
4. Volver a guardar → los dos con `code: "ya_solicitada"`, el mock sigue con
   dos pedidos y el guardado sigue siendo 200.
5. Sembrar los cinco campos → `campos.faltan` vacío.

## `history`: relleno, no actividad

6. `POST /api/dev/wa-mock/history` con un hilo de dos mensajes de hace ~60 días
   (uno entrante, otro con `fromMe: true`).
7. La conversación del cliente aparece con los dos mensajes, `origin: "history"`
   y su fecha real; el entrante sale `direction: "in"` y el del negocio `"out"`.
8. `lastInboundAt` sigue `null`, `windowOpen: false`, `unreadCount: 0`,
   `aiEnabled: true` —el relleno no abre la ventana de 24 h, no acumula
   no-leídos y no pausa al bot. `lastMessageAt` sí avanza al mensaje más nuevo.
9. Re-entregar el MISMO payload (mismos `waMessageId`) → sin duplicados.
10. Control: un `POST /api/dev/wa-mock/inbound` de hoy sobre esa conversación →
    `windowOpen: true`, `unreadCount: 1` y un tercer mensaje.

## `smb_app_state_sync`: la agenda del dueño

11. `POST /api/dev/wa-mock/contacts-sync` con un contacto `update` y otro
    `delete`.
12. El `update` aparece en `GET /api/contacts?q=<teléfono>` con el nombre de la
    agenda.
13. El `delete` NO crea, archiva ni borra nada: quitar un número del celular del
    dueño no decide sobre la cartera del negocio.

## `account_update`: el dueño corta desde su teléfono

14. `POST /api/dev/wa-mock/account-update` con `{event:
    "ACCOUNT_OFFBOARDED", sinMetadata: true}` (llega a nivel WABA) →
    `GET /api/settings/whatsapp` pasa a `status: "reconnect_required"`, con el
    motivo (`disconnection_info`) en el log del servidor y sin el token.
15. `{event: "ACCOUNT_RECONNECTED"}` (esta vez con `phone_number_id`) → de
    vuelta `connected`.
16. `{event: "PARTNER_REMOVED"}` → otra vez `reconnect_required`.
17. Una `wabaId` que no está guardada en esta instancia → el webhook responde
    200 y no mueve el estado de ninguna conexión.

## Arnés

`node --env-file=.env scripts/e2e-selftest.mjs`, sección **R12**.
