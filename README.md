# RecepIA — Recepcionista con IA para negocios con turnos

Sistema de automatización WhatsApp (y voz) con inteligencia artificial para negocios que trabajan con turnos: clínicas, barberías, canchas, consultorios, veterinarias.

Un agente de IA (Claude) atiende por WhatsApp, entiende lenguaje natural, agenda/cancela/reprograma turnos, manda recordatorios y hace seguimiento — sin que el dueño del negocio tenga que responder mensajes.

![Demo conversación WhatsApp](screenRecepIA.png)

---

## Qué hace

- **Agente conversacional** — el paciente escribe como le sale ("necesito turno para el jueves a la tarde") y el agente pregunta lo que falta, agenda, cancela o reprograma solo
- **Recordatorio automático** — el día anterior al turno le manda WhatsApp al cliente pidiendo confirmación
- **Reviews post-turno** — después del turno le pide opinión a quien asistió. Si es positiva, manda el link de Google
- **Multi-tenant** — un mismo flow atiende a varios negocios: cada cliente es una fila en una hoja de configuración (nombre, dirección, precios, tono, credenciales de Twilio)
- **Canal de voz (opcional)** — los mismos tools (crear/cancelar turno, ver disponibilidad) están expuestos como webhooks para un agente de voz en Vapi.ai

---

## Modelo de negocio

| Plan | Precio/mes | Incluye |
|---|---|---|
| **Básico** | $49 USD | Recordatorios + respuestas del agente · hasta 200 mensajes/mes |
| **Pro** | $99 USD | Todo lo anterior · mensajes ilimitados · reviews · resumen semanal |

**Setup fee:** $150 USD único (instalación y configuración inicial)

---

## Stack técnico

| Componente | Herramienta | Costo |
|---|---|---|
| Automatización | n8n en Contabo VPS | ~$7/mes |
| WhatsApp API | Twilio | Pago por conversación |
| Base de datos (config/turnos/pacientes) | Google Sheets | Gratis |
| Base de datos (historial conversación) | Supabase (tabla `conversaciones`, compartida entre clínicas vía `clinica_id`) | Gratis (free tier) |
| IA | Claude (Anthropic) — Haiku para clasificar, Sonnet para generar | ~$0.001-0.01 por mensaje |
| Voz (opcional) | Vapi.ai + ElevenLabs | Pago por minuto |
| Cobro | Stripe o MercadoPago | % por transacción |

**Costo total por cliente:** ~$15-20 USD/mes → margen de $80+ por cliente Pro

---

## Arquitectura

```mermaid
sequenceDiagram
    participant P as Paciente (WhatsApp)
    participant T as Twilio
    participant N as n8n (Hub Central + AI Agent)
    participant C as Claude (Anthropic)
    participant S as Google Sheets (Configuracion / Turnos / Pacientes)

    P->>T: Mensaje de WhatsApp
    T->>N: Webhook entrante
    N->>S: Leer config del cliente + contexto del paciente
    N->>C: Agente decide accion (tool calling)
    C-->>N: Tool a ejecutar (crear/cancelar/ver disponibilidad)
    N->>S: Escribir turno / actualizar estado
    N->>T: Enviar respuesta
    T->>P: Confirmacion por WhatsApp
```

---

## Estructura del repo

```
RecepIA---n8n/
├── README.md
├── agente_demo.js                    ← demo de consola del agente (sin n8n, para probar la lógica)
├── build_agente.js                   ← genera flow2_agente_configurable.json
├── build_flow2.js                    ← genera la versión vieja (vapi/flow2_hub_central_v2.json)
├── dashboard.html                    ← prototipo standalone de dashboard
└── n8n-flows/
    ├── flow2_agente_configurable.json   ← versión ACTUAL: hub central con AI Agent nativo de n8n, multi-tenant
    ├── flow_error_handler.json          ← captura errores de cualquier flow y avisa
    ├── tool_crear_turno.json            ← sub-workflow, tool del agente
    ├── tool_cancelar_turno.json         ← sub-workflow, tool del agente
    ├── tool_cambiar_turno.json          ← sub-workflow, tool del agente
    ├── tool_ver_disponibilidad.json     ← sub-workflow, tool del agente
    ├── tool_buscar_contexto.json        ← sub-workflow, tool del agente
    └── vapi/
        ├── flow1_recordatorio_diario.json    ← versión ANTERIOR (pre-agente), single-tenant, de referencia
        ├── flow2_hub_central_v2.json         ← versión ANTERIOR, lógica de clasificación manual sin AI Agent
        ├── flow3_reviews_post_turno.json     ← versión ANTERIOR
        ├── flow_vapi_crear_turno.json        ← webhook para el agente de VOZ (Vapi.ai)
        ├── flow_vapi_cancelar_turno.json     ← webhook para el agente de VOZ
        ├── flow_vapi_disponibilidad.json     ← webhook para el agente de VOZ
        └── flow_vapi_obtener_fecha.json      ← webhook para el agente de VOZ
```

La versión que se usa hoy es `flow2_agente_configurable.json` + sus 5 tools + el error handler. La carpeta `vapi/` mezcla dos cosas distintas: los 3 flows viejos de WhatsApp (dejados de referencia) y los 4 webhooks que sí están en uso, pero para el canal de voz.

---

## Google Sheets — estructura requerida

Una hoja de cálculo con tres pestañas:

### "Configuracion" (multi-tenant: una fila por cliente)
Columnas reales (ver `config_clinica.csv`): `sheet_id`, `clinica_id`, `nombre_clinica`, `tipo_clinica`, `ciudad`, `pais`, `direccion`, `telefono_urgencias`, `telefono_admin`, `horario`, `servicios`, `obras_sociales`, `metodos_pago`, `twilio_from`, `twilio_account_sid`, `twilio_auth_token`, `supabase_url`, `supabase_key`.

El nodo `Construir Prompt` arma en runtime `twilioUrl` y `twilioAuth` (Basic Auth en base64) a partir de `twilio_account_sid` + `twilio_auth_token` — esos dos campos derivados NO están en la hoja, solo existen en memoria durante la ejecución.

`supabase_url` / `supabase_key` son los mismos para todas las filas (un solo proyecto Supabase compartido, particionado por `clinica_id`), no son credenciales por cliente.

### "Turnos"
| turno_id | fecha | hora | nombre | telefono | servicio | estado_turno |
|---|---|---|---|---|---|---|
| 5491123_2026-04-10 | 2026-04-10 | 10:00 | Juan Pérez | 5491123456789 | Consulta | PENDIENTE |

`estado_turno` posibles: `PENDIENTE` · `RECORDATORIO_ENVIADO` · `CONFIRMADO` · `CANCELADO`

### "Pacientes"
| telefono | nombre | ultimoTurno | proximoTurno | estado | fechaUltimoContacto | cantidadTurnos |
|---|---|---|---|---|---|---|
| 5491123456789 | Juan Pérez | 2026-01-15 | 2026-04-10 | CONFIRMADO | 2026-04-09T08:00:00Z | 4 |

---

## Variables de entorno

Ver [`.env.example`](.env.example). Configurar en n8n (Settings → Variables) o en el `.env` del VPS:

```env
ANTHROPIC_API_KEY=sk-ant-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
```

El ID de la Google Sheet y las credenciales de Twilio por cliente viven hardcodeadas en cada nodo (versión de referencia) o en la hoja "Configuracion" (versión multi-tenant) — no son variables de entorno hoy.

---

## Manejo de errores

Dos capas, ambas mandan WhatsApp al paciente ("tuvimos un problema técnico") + aviso al admin del negocio:

- **Errores del agente** (Claude no responde / responde vacío): `Verificar Error Agente` → `Avisar Error a Paciente` → `Preparar Alerta Admin` → `Avisar Error a Admin`. Usa las credenciales Twilio del cliente ya cargadas.
- **Errores tempranos** (`Leer Configuracion`, `Descargar Audio`, `Transcribir Groq`, `Buscar Paciente`, `Leer Historial Supabase`, `Guardar en Supabase` fallan con `onError: continueErrorOutput`): `Preparar Error Temprano` → `IF Hay Telefono Paciente` → (`Avisar Error a Paciente Temprano` si hay creds de cliente) → `Preparar Alerta Admin Temprano` → reusa `Avisar Error a Admin`.
  - Caso límite: si **`Leer Configuracion` es el que falla**, no hay credenciales Twilio del cliente todavía → no se le puede avisar al paciente, solo al admin, usando un fallback sandbox: `$vars.TWILIO_SANDBOX_SID` / `$vars.TWILIO_SANDBOX_AUTH_TOKEN` (configurar en n8n → Settings → Variables) + número fijo `5492494621486`.
  - **Sin confirmar todavía:** esta instancia de n8n bloquea `$env` dentro de nodos Code (confirmado); `$vars` no se probó aún. Verificar en el test de "fallo forzado".

## Config DEMO

Fila `demo-clinica-dental` en `config_clinica.csv` / tab "Configuracion": clínica ficticia "Clínica Dental Demo", número Twilio sandbox `+14155238886`, admin = tu número personal. Usar esta fila (no la de Centro Médico San Martín) para mostrar el agente en vivo sin tocar datos de cliente real.

## Checklist de alta de cliente nuevo

**Tiempo estimado: 45 minutos**

- [ ] Agregar fila del cliente en la hoja "Configuracion" (nombre, dirección, horario, servicios/precios, tono)
- [ ] Crear/asignar número de WhatsApp Business en Twilio para el cliente
- [ ] Configurar el webhook de Twilio → URL del flow en n8n
- [ ] Test manual: escribirle al número y verificar que el agente responda y agende
- [ ] Test de recordatorio: cargar un turno de prueba y verificar que llegue el WhatsApp
- [ ] Enviar guía de uso al cliente

---

## Rubros donde funciona sin cambios

- Clínicas médicas y dentales
- Psicólogos y psiquiatras
- Kinesiólogos y fisioterapeutas
- Nutricionistas
- Dermatólogos y estéticas
- Veterinarias
- Barberías y peluquerías
- Canchas de pádel, fútbol, tenis
- Estudios de tatuajes y piercings
- Cualquier negocio con turnos

---

## Roadmap

### Ahora (MVP)
- [x] Agente conversacional multi-tenant funcionando (WhatsApp)
- [x] Canal de voz vía Vapi.ai
- [ ] Video demo
- [ ] Primer cliente caso de éxito
- [ ] Stripe/MercadoPago configurado

### Fase 2 (5-10 clientes)
- [ ] Testimonios
- [ ] Automatizar onboarding
- [ ] Documentación para el cliente

### Fase 3 (10+ clientes)
- [ ] Script de provisioning automático vía n8n API
- [ ] Portal de cliente self-service

---

*RecepIA — Automatización WhatsApp y voz con IA para negocios con turnos*
