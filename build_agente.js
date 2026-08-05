// build_agente.js — RecepIA versión AI Agent (n8n nativo)
// Genera: n8n-flows/flow_agente_demo.json
// DEMO / POC — para usar en el futuro cuando quieras migrar
//
// REQUISITO: en n8n ir a Credentials → New → Anthropic → pegar API key
// El nombre de la credencial debe ser "Anthropic Account"

const fs = require('fs');

const SHEET_ID = "1vK8h8c8prheB8_KE7nwl6e4SblGoeALs_jE-vkgv5ho";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
if (!TWILIO_ACCOUNT_SID) throw new Error("Falta TWILIO_ACCOUNT_SID en el entorno");
if (!TWILIO_AUTH_TOKEN) throw new Error("Falta TWILIO_AUTH_TOKEN en el entorno");
const TWILIO_URL = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
const BASIC_AUTH = "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
const sheetDoc = { "__rl": true, mode: "id", value: SHEET_ID };

// Parseo igual que el flow actual
const jsCode_parse = `
const raw = $('Webhook Twilio').first().json;
const body = raw.body || raw.params?.body || {};
const ds = ['sent','delivered','read','failed','undelivered','queued','sending'];
if (ds.includes(body?.SmsStatus) || ds.includes(body?.MessageStatus)) return [];
const mensajeTexto = (body?.Body || '').trim();
if (!mensajeTexto) return [];
const from = body?.From || '';
const telefono = from.startsWith('whatsapp:') ? from.replace('whatsapp:+', '') : (body?.WaId || '');
if (!telefono) return [];
return [{ json: { telefono, mensajeTexto } }];
`.trim();

// Prepara el input para el agente combinando datos del paciente y mensaje
const jsCode_preparar = `
const { telefono, mensajeTexto } = $('Parsear Mensaje Entrante').first().json;
const pacientes = $('Buscar Paciente').all();
const turnos = $('Leer Turnos').all();
const paciente = pacientes.find(i => String(i.json.telefono) === String(telefono))?.json || {};
const turnoActivo = turnos.find(t =>
  String(t.json.telefono) === String(telefono) &&
  ['CONFIRMADO','PENDIENTE'].includes((t.json.estado_turno||'').toUpperCase())
)?.json || null;
const hoy = new Date().toISOString().split('T')[0];
const contexto = \`Teléfono del paciente: \${telefono}
Nombre: \${paciente.nombre || 'desconocido'}
Estado: \${paciente.estado || 'NUEVO'}
Turno activo: \${turnoActivo ? turnoActivo.fecha + ' ' + turnoActivo.hora + ' (' + turnoActivo.servicio + ')' : 'ninguno'}
Fecha de hoy: \${hoy}\`;
return [{ json: { chatInput: mensajeTexto, sessionId: telefono, contexto, telefono } }];
`.trim();

// Extrae la respuesta del agente y prepara para Twilio
const jsCode_extraer = `
const telefono = $('Preparar Input Agente').first().json.telefono;
const respuesta = $input.first().json.output || 'Gracias por escribirnos.';
return [{ json: { telefono, respuesta } }];
`.trim();

// ─── Herramientas del agente (toolCode) ─────────────────────────────────────
// NOTA: estas tools usan datos mock para el demo.
// En producción reemplazar por toolWorkflow que acceda a Google Sheets real.

const tool_disponibilidad = `
// Recibe: fecha (YYYY-MM-DD)
// Devuelve: horarios libres
const fecha = $input.first().json.fecha;
const DURACION = 45;
// DEMO: turnos ocupados hardcodeados — en prod leer de Sheets
const ocupados = [{ hora: '09:00' }, { hora: '10:30' }]
  .filter(t => true) // en prod filtrar por fecha
  .map(t => { const [h,m] = t.hora.split(':').map(Number); return h*60+m; });
const dt = new Date(fecha + 'T00:00:00');
const dow = dt.getDay();
if (dow === 0) return [{ json: { disponibles: [], mensaje: 'Domingo cerrado' } }];
const fin = dow === 6 ? 13*60 : 21*60;
const libres = [];
for (let min = 8*60; min <= fin-DURACION; min += DURACION) {
  if (!ocupados.some(o => Math.abs(o-min) < DURACION)) {
    libres.push(String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0'));
  }
}
return [{ json: { fecha, disponibles: libres.slice(0,6), aviso: 'DEMO: reemplazar con Sheets real' } }];
`.trim();

const tool_crear_turno = `
// Recibe: telefono, nombre, fecha, hora, servicio
// En producción: hacer appendOrUpdate en Google Sheets
const d = $input.first().json;
// DEMO: solo confirma, no escribe a Sheets
return [{ json: {
  exito: true,
  turno_id: d.telefono + '_' + d.fecha,
  mensaje: \`Turno creado: \${d.fecha} a las \${d.hora} (\${d.servicio})\`,
  aviso: 'DEMO: en prod escribir a Google Sheets'
}}];
`.trim();

const tool_cancelar_turno = `
// Recibe: telefono
// En producción: actualizar estado_turno a CANCELADO en Sheets
const { telefono } = $input.first().json;
// DEMO: solo confirma
return [{ json: { exito: true, mensaje: 'Turno cancelado.', aviso: 'DEMO: en prod actualizar Sheets' } }];
`.trim();

const systemPrompt = `Sos la recepcionista virtual de Centro Médico San Martín, clínica odontológica en Tandil, Argentina.

Antes de responder cualquier cosa, usá el contexto del paciente que viene en el input del usuario.
Usá las herramientas disponibles para verificar disponibilidad o gestionar turnos cuando sea necesario.

HORARIO: lunes a viernes 8-21hs, sábados 8-13hs.
SERVICIOS: consulta, limpieza, extracción, blanqueamiento, ortodoncia, implantes, carillas.
OBRAS SOCIALES: todas. Detalles en consultorio.
DIRECCIÓN: Av. San Martín 450, Tandil.

TONO: joven, natural, descontracturada pero profesional. Usá vos/te. Nunca digas que sos IA.
Nada de "Por supuesto", "Entendido", "Con gusto".
Al confirmar turno, poné día y hora en negrita: *día* y *hora*.
Nunca asumas fechas u horas que el paciente no dijo explícitamente.`;

// ─── Flow ────────────────────────────────────────────────────────────────────

const flow = {
  name: "Flow AGENTE DEMO — RecepIA (futuro)",
  nodes: [
    {
      id: "ag-webhook", name: "Webhook Twilio", type: "n8n-nodes-base.webhook",
      typeVersion: 2, position: [0, 300],
      parameters: { httpMethod: "POST", path: "whatsapp-agente", responseMode: "responseNode", options: {} },
      webhookId: "whatsapp-agente"
    },
    {
      id: "ag-respond", name: "Responder 200 a Twilio", type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1, position: [220, 300],
      parameters: { respondWith: "text", responseBody: "OK", options: { responseCode: 200 } }
    },
    {
      id: "ag-parse", name: "Parsear Mensaje Entrante", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [440, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: jsCode_parse }
    },
    {
      id: "ag-buscar", name: "Buscar Paciente", type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.4, position: [660, 300], alwaysOutputData: true,
      parameters: { operation: "read", documentId: sheetDoc, sheetName: { "__rl": true, mode: "name", value: "Pacientes" }, options: {} },
      credentials: { googleSheetsOAuth2Api: { name: "Google Sheets Account" } }
    },
    {
      id: "ag-turnos", name: "Leer Turnos", type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.4, position: [880, 300], alwaysOutputData: true,
      parameters: { operation: "read", documentId: sheetDoc, sheetName: { "__rl": true, mode: "name", value: "Turnos" }, options: {} },
      credentials: { googleSheetsOAuth2Api: { name: "Google Sheets Account" } }
    },
    {
      id: "ag-preparar", name: "Preparar Input Agente", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [1100, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: jsCode_preparar }
    },
    // ── AI Agent (nodo central) ──────────────────────────────────────────────
    {
      id: "ag-agent", name: "AI Agent Recepcionista", type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.7, position: [1320, 300],
      parameters: {
        agent: "conversationalAgent",
        promptType: "define",
        text: "={{ $json.chatInput }}\n\nContexto del paciente:\n={{ $json.contexto }}",
        options: { systemMessage: systemPrompt }
      }
    },
    // ── Modelo Claude (se conecta al agente via ai_languageModel) ────────────
    {
      id: "ag-claude", name: "Claude Haiku", type: "@n8n/n8n-nodes-langchain.lmChatAnthropic",
      typeVersion: 1.2, position: [1100, 520],
      parameters: { model: "claude-haiku-4-5-20251001", options: { maxTokens: 1024 } },
      credentials: { anthropicApi: { name: "Anthropic Account" } }
    },
    // ── Memoria de conversación ──────────────────────────────────────────────
    {
      id: "ag-memory", name: "Memoria Conversacion", type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
      typeVersion: 1.3, position: [1320, 520],
      parameters: { sessionKey: "={{ $json.sessionId }}", contextWindowLength: 10 }
    },
    // ── Herramientas ─────────────────────────────────────────────────────────
    {
      id: "ag-tool-disp", name: "Ver Disponibilidad", type: "@n8n/n8n-nodes-langchain.toolCode",
      typeVersion: 1.1, position: [1540, 520],
      parameters: {
        name: "ver_disponibilidad",
        description: "Ver horarios libres para una fecha. Input: { fecha: 'YYYY-MM-DD' }",
        language: "javaScript",
        jsCode: tool_disponibilidad
      }
    },
    {
      id: "ag-tool-crear", name: "Crear Turno", type: "@n8n/n8n-nodes-langchain.toolCode",
      typeVersion: 1.1, position: [1760, 520],
      parameters: {
        name: "crear_turno",
        description: "Crea un turno confirmado. Input: { telefono, nombre, fecha, hora, servicio }",
        language: "javaScript",
        jsCode: tool_crear_turno
      }
    },
    {
      id: "ag-tool-cancelar", name: "Cancelar Turno", type: "@n8n/n8n-nodes-langchain.toolCode",
      typeVersion: 1.1, position: [1980, 520],
      parameters: {
        name: "cancelar_turno",
        description: "Cancela el turno activo de un paciente. Input: { telefono }",
        language: "javaScript",
        jsCode: tool_cancelar_turno
      }
    },
    // ── Post-agente ──────────────────────────────────────────────────────────
    {
      id: "ag-extraer", name: "Extraer Respuesta", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [1540, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: jsCode_extraer }
    },
    {
      id: "ag-twilio", name: "Responder WhatsApp", type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [1760, 300],
      parameters: {
        method: "POST", url: TWILIO_URL, sendHeaders: true,
        headerParameters: { parameters: [{ name: "Authorization", value: BASIC_AUTH }] },
        sendBody: true, contentType: "form-urlencoded",
        bodyParameters: { parameters: [
          { name: "From", value: "whatsapp:+14155238886" },
          { name: "To", value: "=whatsapp:+{{ $json.telefono }}" },
          { name: "Body", value: "={{ $json.respuesta }}" }
        ]}
      }
    }
  ],
  connections: {
    // Flujo principal
    "Webhook Twilio":           { main: [[{ node: "Responder 200 a Twilio",  type: "main", index: 0 }]] },
    "Responder 200 a Twilio":   { main: [[{ node: "Parsear Mensaje Entrante", type: "main", index: 0 }]] },
    "Parsear Mensaje Entrante": { main: [[{ node: "Buscar Paciente",          type: "main", index: 0 }]] },
    "Buscar Paciente":          { main: [[{ node: "Leer Turnos",              type: "main", index: 0 }]] },
    "Leer Turnos":              { main: [[{ node: "Preparar Input Agente",    type: "main", index: 0 }]] },
    "Preparar Input Agente":    { main: [[{ node: "AI Agent Recepcionista",   type: "main", index: 0 }]] },
    "AI Agent Recepcionista":   { main: [[{ node: "Extraer Respuesta",        type: "main", index: 0 }]] },
    "Extraer Respuesta":        { main: [[{ node: "Responder WhatsApp",       type: "main", index: 0 }]] },
    // Conexiones al agente (LLM + memoria + tools)
    "Claude Haiku":             { ai_languageModel: [[{ node: "AI Agent Recepcionista", type: "ai_languageModel", index: 0 }]] },
    "Memoria Conversacion":     { ai_memory:        [[{ node: "AI Agent Recepcionista", type: "ai_memory",        index: 0 }]] },
    "Ver Disponibilidad":       { ai_tool:          [[{ node: "AI Agent Recepcionista", type: "ai_tool",          index: 0 }]] },
    "Crear Turno":              { ai_tool:          [[{ node: "AI Agent Recepcionista", type: "ai_tool",          index: 0 }]] },
    "Cancelar Turno":           { ai_tool:          [[{ node: "AI Agent Recepcionista", type: "ai_tool",          index: 0 }]] }
  },
  settings: { executionOrder: "v1", saveManualExecutions: true }
};

fs.writeFileSync(
  'C:/Users/marco/OneDrive/Desktop/RecepIA/n8n-flows/flow_agente_demo.json',
  JSON.stringify(flow, null, 2), 'utf8'
);
console.log('OK - flow_agente_demo.json generado');
console.log('Para importar: n8n → Import from file → flow_agente_demo.json');
console.log('Requisito: crear credencial "Anthropic Account" en n8n con tu API key');
