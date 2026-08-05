# RecepIA — Recepcionista con IA para negocios con turnos

Sistema de automatización WhatsApp con inteligencia artificial para cualquier negocio que trabaje con turnos: clínicas, barberías, canchas, consultorios, veterinarias.

---

## Qué hace

- **Recordatorio automático** — el día anterior al turno le manda WhatsApp al cliente pidiendo confirmación
- **Respuestas inteligentes** — Claude AI interpreta CONFIRMO / CANCELO / CAMBIAR y responde solo
- **Reviews post-turno** — a las 20hs le pide opinión a quien confirmó y asistió. Si es positiva, manda el link de Google
- **Reactivación** — todos los lunes le escribe a los pacientes que no vienen hace 90+ días
- **Resumen semanal** — cada viernes a las 19hs el dueño recibe por WhatsApp las métricas de la semana

---

## Modelo de negocio

| Plan | Precio/mes | Incluye |
|---|---|---|
| **Básico** | $49 USD | Flows 1+2 · hasta 200 mensajes/mes |
| **Pro** | $99 USD | Los 5 flows · mensajes ilimitados · resumen semanal · dashboard |

**Setup fee:** $150 USD único (instalación y configuración inicial)

**Objetivo:** 40 clientes Pro = $4.000 USD/mes recurrentes

---

## Stack técnico

| Componente | Herramienta | Costo |
|---|---|---|
| Automatización | n8n en Contabo VPS | ~$7/mes |
| WhatsApp API | 360Dialog | $10/mes + conversaciones |
| Base de datos | Google Sheets | Gratis |
| IA clasificación | Claude Haiku (Anthropic) | ~$0.001 por mensaje |
| IA generación | Claude Sonnet (Anthropic) | ~$0.01 por reactivación |
| Dashboard | Google Looker Studio | Gratis |
| Cobro | Stripe o MercadoPago | % por transacción |

**Costo total por cliente:** ~$15-20 USD/mes → margen de $80+ por cliente Pro

---

## Estructura del proyecto

```
RecepIA/
├── README.md                    ← este archivo
├── n8n-flows/                   ← los 5 workflows para importar en n8n
│   ├── flow1_recordatorio_diario.json
│   ├── flow2_hub_central.json
│   ├── flow3_reviews_post_turno.json
│   ├── flow4_reactivacion.json
│   └── flow5_resumen_semanal.json
├── landing-page/                ← sitio web del producto (Next.js)
├── onboarding/                  ← formulario y checklist de alta de clientes
└── dashboard/                   ← template de Looker Studio
```

---

## Google Sheets — estructura requerida

Cada cliente tiene su propio Google Sheet con dos hojas:

### Hoja "Turnos"
| turno_id | fecha | hora | nombre | telefono | servicio | estado_turno |
|---|---|---|---|---|---|---|
| 5491123_2026-04-10 | 2026-04-10 | 10:00 | Juan Pérez | 5491123456789 | Consulta | PENDIENTE |

`estado_turno` posibles: `PENDIENTE` · `RECORDATORIO_ENVIADO` · `CONFIRMADO` · `CANCELADO`

### Hoja "Pacientes"
| telefono | nombre | ultimoTurno | proximoTurno | estado | fechaUltimoContacto | cantidadTurnos |
|---|---|---|---|---|---|---|
| 5491123456789 | Juan Pérez | 2026-01-15 | 2026-04-10 | CONFIRMADO | 2026-04-09T08:00:00Z | 4 |

`estado` posibles: `RECORDATORIO_ENVIADO` · `CONFIRMADO` · `CANCELADO` · `ESPERANDO_REPROGRAMACION` · `CONSULTA_PENDIENTE` · `ESPERANDO_REVIEW` · `REVIEW_POSITIVO` · `REVIEW_NEGATIVO` · `REVIEW_NEUTRO` · `REACTIVACION_ENVIADA` · `INACTIVO`

---

## Variables de entorno (Contabo VPS)

Configurar en el archivo `.env` de n8n en el servidor, o desde la UI de n8n en Settings → Variables:

```env
# Clínica / negocio
NOMBRE_CLINICA=Clínica Ejemplo
DIRECCION_CLINICA=Av. Corrientes 1234, CABA
TELEFONO_CLINICA=+54 9 11 1234-5678
GOOGLE_MAPS_LINK=https://maps.google.com/?q=...
GOOGLE_REVIEWS_LINK=https://g.page/r/.../review

# WhatsApp — 360Dialog
D360_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
D360_WABA_URL=https://waba.360dialog.io/v1

# Templates de WhatsApp (nombres exactos aprobados en 360Dialog)
TEMPLATE_RECORDATORIO=recordatorio_turno
TEMPLATE_REVIEW=solicitud_resena
TEMPLATE_REACTIVACION=reactivacion_paciente

# IA
ANTHROPIC_API_KEY=sk-ant-...

# Google Sheets
SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms

# Notificaciones al dueño
OWNER_PHONE=5491123456789
```

---

## Templates de WhatsApp — 360Dialog

Crear estos 3 templates en el dashboard de 360Dialog antes de activar el sistema.

### recordatorio_turno
```
Hola {{1}}, te recordamos tu turno de {{2}} el {{3}} a las {{4}} en {{5}}.
Respondé *CONFIRMO* para confirmar o *CANCELO* para cancelar. 📅
```
Parámetros: nombre · servicio · fecha · hora · nombre_clinica

### solicitud_resena
```
Hola {{1}}, ¿cómo estuvo tu visita a {{2}} hoy?
Tu opinión nos ayuda a mejorar. Contanos cómo te fue 😊
```
Parámetros: nombre · nombre_clinica

### reactivacion_paciente
```
Hola {{1}}, hace tiempo que no te vemos en {{2}} 👋
Tu salud nos importa. ¿Agendamos un turno? Respondé este mensaje.
```
Parámetros: nombre · nombre_clinica

---

## Checklist de alta de cliente nuevo

**Tiempo estimado: 45 minutos**

### Datos a recolectar (Google Form)
- [ ] Nombre del negocio
- [ ] Dirección
- [ ] Teléfono
- [ ] WhatsApp del dueño (para resumen semanal y alertas)
- [ ] Link Google Maps
- [ ] Link Google Reviews
- [ ] Número de WhatsApp Business que van a usar
- [ ] Email para acceso a Google Sheets

### Setup técnico
- [ ] Crear Google Sheet con las dos hojas (Turnos y Pacientes)
- [ ] Compartir el Sheet con la cuenta de servicio de Google
- [ ] Copiar el SHEET_ID de la URL
- [ ] Crear cuenta 360Dialog para el cliente
- [ ] Obtener D360_API_KEY y D360_WABA_URL
- [ ] Configurar webhook en 360Dialog → URL del n8n del cliente
- [ ] Crear los 3 templates en 360Dialog y esperar aprobación (~2hs)
- [ ] Setear todas las variables de entorno en Railway
- [ ] Importar los 5 flows en n8n
- [ ] Vincular credenciales de Google Sheets y Google Calendar en cada flow
- [ ] Activar los 5 workflows
- [ ] Test manual: cargar un turno de prueba en Sheets y verificar que llegue el recordatorio
- [ ] Compartir link de Looker Studio al dueño
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
- [x] 5 flows de n8n funcionales
- [ ] Nombre y dominio
- [ ] Landing page
- [ ] Primer cliente caso de éxito
- [ ] Template de Looker Studio
- [ ] Stripe/MercadoPago configurado

### Fase 2 (5-10 clientes)
- [ ] Video demo
- [ ] Testimonios en landing page
- [ ] Automatizar parte del onboarding
- [ ] Documentación para el cliente

### Fase 3 (10+ clientes)
- [ ] Script de provisioning automático via n8n API
- [ ] Portal de cliente self-service
- [ ] Upwork / LinkedIn Ads

---

*RecepIA — Automatización WhatsApp con IA para negocios con turnos*
