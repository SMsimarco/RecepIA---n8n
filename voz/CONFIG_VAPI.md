# Config Vapi — Julieta (canal de voz)

Setup manual del assistant "Julieta" en Vapi.ai. El teléfono del paciente **nunca** se pide por voz ni se declara como parámetro de function — el router lo toma del caller ID (`message.call.customer.number`) y lo inyecta en cada tool call. Por eso ninguna function de abajo tiene `telefono` como parámetro.

## Server URL (Tool Calls)

En el assistant, configurar el **Server URL** de las tools apuntando al router único:

```
https://vmi3210449.contaboserver.net/webhook/vapi-tools-router
```

Header requerido en cada request (lo agrega Vapi automáticamente si se configura como Server Secret):

```
x-vapi-secret: <mismo valor que VAPI_TOOLS_SECRET en el .env de n8n>
```

## Functions (5)

### 1. buscar_contexto

```json
{
  "name": "buscar_contexto",
  "description": "Busca el historial del paciente que está llamando: nombre, si tiene turno activo, y próximos días con disponibilidad. Llamar SIEMPRE al inicio de la conversación, antes de cualquier otra cosa.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

### 2. ver_disponibilidad

```json
{
  "name": "ver_disponibilidad",
  "description": "Devuelve los horarios libres para una fecha puntual. Usar siempre antes de ofrecer un horario al paciente, nunca inventar horarios.",
  "parameters": {
    "type": "object",
    "properties": {
      "fecha": {
        "type": "string",
        "description": "Fecha a consultar en formato YYYY-MM-DD."
      }
    },
    "required": ["fecha"]
  }
}
```

### 3. crear_turno

```json
{
  "name": "crear_turno",
  "description": "Crea un turno nuevo. Confirmar en voz alta fecha, hora y nombre con el paciente antes de llamar esta function.",
  "parameters": {
    "type": "object",
    "properties": {
      "nombre": { "type": "string", "description": "Nombre completo del paciente." },
      "fecha": { "type": "string", "description": "Fecha del turno en formato YYYY-MM-DD." },
      "hora": { "type": "string", "description": "Hora del turno en formato HH:MM (24hs)." },
      "servicio": { "type": "string", "description": "Motivo de la consulta. Si no lo menciona, usar 'Consulta general'." }
    },
    "required": ["nombre", "fecha", "hora"]
  }
}
```

### 4. cambiar_turno

```json
{
  "name": "cambiar_turno",
  "description": "Reprograma un turno existente a nueva fecha/hora. Confirmar en voz alta la fecha vieja y la nueva antes de llamar esta function.",
  "parameters": {
    "type": "object",
    "properties": {
      "fecha_actual": { "type": "string", "description": "Fecha del turno que se quiere cambiar, formato YYYY-MM-DD." },
      "fecha_nueva": { "type": "string", "description": "Nueva fecha del turno, formato YYYY-MM-DD." },
      "hora_nueva": { "type": "string", "description": "Nueva hora del turno, formato HH:MM (24hs)." }
    },
    "required": ["fecha_actual", "fecha_nueva", "hora_nueva"]
  }
}
```

### 5. cancelar_turno

```json
{
  "name": "cancelar_turno",
  "description": "Cancela un turno existente. Confirmar en voz alta la fecha del turno a cancelar antes de llamar esta function.",
  "parameters": {
    "type": "object",
    "properties": {
      "fecha": { "type": "string", "description": "Fecha del turno a cancelar, formato YYYY-MM-DD." }
    },
    "required": ["fecha"]
  }
}
```

## Checklist de setup

- [ ] Crear assistant "Julieta" en Vapi con voz ElevenLabs (Valentina) y modelo Claude Haiku
- [ ] Pegar `julieta_system_prompt.md` como System Prompt del assistant
- [ ] Generar `VAPI_TOOLS_SECRET` (string random largo) y agregarlo al `.env` de n8n (VPS)
- [ ] Configurar ese mismo valor como Server Secret / header en Vapi para las 5 functions
- [ ] Importar `voz/vapi_router_tools.json` a n8n
- [ ] En cada nodo `Exec Tool ...` del router, seleccionar manualmente el sub-workflow correspondiente (n8n no exporta la referencia por ID entre instancias)
- [ ] Activar el workflow del router y copiar la URL del webhook (`/webhook/vapi-tools-router`)
- [ ] Crear las 5 functions en Vapi con los schemas de arriba, todas apuntando al mismo Server URL
- [ ] Asignar el número de teléfono de voz en Vapi al assistant Julieta
- [ ] Llamada de prueba: pedir turno, cambiar turno, cancelar turno, preguntar disponibilidad
