# Voz — RecepIA (Vapi + Julieta)

Canal de voz para RecepIA. Comparte las mismas 5 tools que ya usa WhatsApp — no hay lógica de negocio duplicada, solo un router nuevo que traduce el formato de Vapi al formato que las tools ya entienden.

## Arquitectura

```
WhatsApp (paciente)          Voz (paciente llama)
      |                              |
      v                              v
Flow 2 - Hub Central          Vapi (assistant "Julieta")
(n8n-flows/flow2_             |
 agente_configurable.json)    | tool calls por webhook
      |                       v
      |                 voz/vapi_router_tools.json
      |                 (valida x-vapi-secret,
      |                  rutea por toolName,
      |                  responde formato Vapi)
      |                       |
      +----------+------------+
                 |
                 v
     5 tools compartidas (n8n-flows/*.json)
     tool_buscar_contexto
     tool_ver_disponibilidad
     tool_crear_turno
     tool_cambiar_turno
     tool_cancelar_turno
                 |
                 v
        Google Sheets (Pacientes, Turnos)
```

Ninguna tool sabe si la llamó WhatsApp o Vapi. El router solo adapta el sobre (formato del mensaje entrante/saliente), el contenido de negocio vive en un solo lugar.

## Archivos de esta carpeta

- `vapi_router_tools.json` — workflow n8n. Recibe webhook de Vapi, valida secret, separa tool calls, rutea por `toolName` a las 5 tools vía Execute Workflow, arma la respuesta `{ results: [...] }` que Vapi espera.
- `CONFIG_VAPI.md` — schemas de las 5 functions para pegar en Vapi + checklist de setup.
- `julieta_system_prompt.md` — system prompt del assistant de voz.

## Pasos manuales pendientes (Marco)

1. **Importar** `vapi_router_tools.json` a n8n.
2. En cada nodo `Exec Tool ...` del router, **seleccionar el sub-workflow** correspondiente desde el dropdown (n8n no preserva la referencia por ID al exportar/importar entre instancias). Son 5 nodos, uno por tool.
3. **Generar** un secret random largo (`VAPI_TOOLS_SECRET`) y agregarlo como variable de entorno en el `.env` del n8n del VPS (Contabo/Easypanel). Reiniciar el contenedor de n8n para que tome la env var.
4. **Activar** el workflow del router y copiar la URL del webhook: `https://vmi3210449.contaboserver.net/webhook/vapi-tools-router`.
5. En Vapi: crear el assistant **Julieta** (Claude Haiku + voz ElevenLabs Valentina), pegar el contenido de `julieta_system_prompt.md` como System Prompt.
6. En Vapi: crear las **5 functions** usando los schemas de `CONFIG_VAPI.md`, todas apuntando al Server URL del paso 4, con el header `x-vapi-secret` configurado con el mismo valor del paso 3.
7. Asignar el número de teléfono de voz al assistant Julieta.
8. Probar: llamada real → sacar turno, cambiar turno, cancelar turno, consultar disponibilidad. Verificar en el Sheet que los turnos quedan bien formados.

Checklist completo con detalle en `CONFIG_VAPI.md`.

## Fix aplicado (bug turno_id)

De paso se corrigió un bug de datos que afectaba WhatsApp (no específico de voz, pero compartido por las mismas tools): `tool_cambiar_turno.json` armaba el `turno_id` nuevo sin la hora (`telefono_fecha` en vez de `telefono_fecha_hora`), y `n8n-flows/vapi/flow1_recordatorio_diario.json` reconstruía el turno_id de la misma forma trunca para marcarlo como `RECORDATORIO_ENVIADO`. Como el turno_id real tiene 3 partes, el match fallaba, el flag nunca se actualizaba, y el recordatorio se reenviaba todos los días. Ambos archivos ahora arman `telefono_fecha_hora` de forma consistente con `tool_crear_turno.json`.
