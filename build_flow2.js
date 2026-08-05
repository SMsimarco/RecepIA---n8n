const fs = require('fs');

const SHEET_ID = "1vK8h8c8prheB8_KE7nwl6e4SblGoeALs_jE-vkgv5ho";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
if (!ANTHROPIC_KEY) throw new Error("Falta ANTHROPIC_API_KEY en el entorno");
if (!TWILIO_ACCOUNT_SID) throw new Error("Falta TWILIO_ACCOUNT_SID en el entorno");
if (!TWILIO_AUTH_TOKEN) throw new Error("Falta TWILIO_AUTH_TOKEN en el entorno");
const TWILIO_URL = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
const BASIC_AUTH = "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
const sheetDoc = { "__rl": true, mode: "id", value: SHEET_ID };

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

// Acumula el mensaje nuevo en mensajesPendientes y genera timestamp
const jsCode_acumular = `
const telefono = $('Parsear Mensaje Entrante').first().json.telefono;
const mensajeTexto = $('Parsear Mensaje Entrante').first().json.mensajeTexto;
const todos = $('Buscar Paciente').all();
const paciente = todos.find(i => String(i.json.telefono) === String(telefono))?.json || {};
const ultimoTS = paciente.ultimoMensaje || '';
const esViejo = !ultimoTS || (Date.now() - new Date(ultimoTS).getTime()) > 30000;
const pendientesActuales = esViejo ? '' : (paciente.mensajesPendientes || '');
const nuevosPendientes = pendientesActuales ? pendientesActuales + '\\n' + mensajeTexto : mensajeTexto;
const timestamp = new Date().toISOString();
return [{ json: { telefono, nuevosPendientes, timestamp } }];
`.trim();

// Tras el wait, verifica si este es el último mensaje (nadie llegó después)
const jsCode_verificar = `
const acum = $('Preparar Acumulacion').first().json;
const todos = $('Re-leer Paciente').all();
const paciente = todos.find(i => String(i.json.telefono) === String(acum.telefono))?.json || {};
if ((paciente.ultimoMensaje || '') !== acum.timestamp) return [];
const mensajesCombinados = paciente.mensajesPendientes || '';
return [{ json: { telefono: acum.telefono, mensajesCombinados } }];
`.trim();

const jsCode_contexto = `
const debounce = $('Verificar Debounce').first().json;
const telefono = debounce.telefono;
const mensajeTexto = debounce.mensajesCombinados;
const todos = $('Re-leer Paciente').all();
const paciente = todos.find(i => String(i.json.telefono) === String(telefono))?.json || {};
let convDatos = {};
try { convDatos = JSON.parse(paciente.conversacionDatos || '{}'); } catch(e) {}

const nombre = paciente.nombre || 'Paciente';
const estadoPaciente = paciente.estado || 'NUEVO';
const convEstado = paciente.conversacionEstado || '';
// Si no hay conversación activa, ignorar datos parciales viejos
const convDatosStr = convEstado ? (paciente.conversacionDatos || '{}') : '{}';

// Calcular turnos ocupados por fecha para disponibilidad
const allTurnos = $('Leer Turnos').all();
const ocupadosPorFecha = {};
allTurnos.forEach(t => {
  const f = t.json.fecha;
  const h = t.json.hora;
  const e = (t.json.estado_turno || '').toUpperCase();
  if (f && h && ['CONFIRMADO','PENDIENTE'].includes(e)) {
    if (!ocupadosPorFecha[f]) ocupadosPorFecha[f] = [];
    ocupadosPorFecha[f].push(h);
  }
});
const hoy = new Date().toISOString().split('T')[0];
const diasDisponibles = [];
for (let d = 1; d <= 14; d++) {
  const dt = new Date(); dt.setDate(dt.getDate() + d);
  const dow = dt.getDay();
  if (dow === 0) continue;
  const fechaStr = dt.toISOString().split('T')[0];
  const maxSlots = dow === 6 ? 10 : 26;
  const ocupados = (ocupadosPorFecha[fechaStr] || []).length;
  if (ocupados < maxSlots) {
    const nombreDia = ['dom','lun','mar','mié','jue','vie','sáb'][dow];
    diasDisponibles.push(nombreDia + ' ' + fechaStr.slice(8) + '/' + fechaStr.slice(5,7));
  }
}
const disponibilidadResumen = diasDisponibles.length > 0
  ? 'Días con turnos disponibles (próximos 14 días): ' + diasDisponibles.slice(0,5).join(', ')
  : 'Sin disponibilidad en los próximos 14 días';

const systemPrompt = \`Sos la recepcionista virtual de Centro Médico San Martín, una clínica odontológica en Tandil, Argentina.

SERVICIOS Y PRECIOS APROXIMADOS:
- Consulta/revisación: $15.000 a $20.000
- Limpieza dental: $25.000 a $35.000
- Extracción simple: $20.000 a $30.000
- Blanqueamiento: $80.000 a $120.000
- Ortodoncia: desde $150.000 (varía según el caso)
- Implantes y endodoncia: se evalúan en consulta
- Carillas: desde $60.000 por unidad

OBRAS SOCIALES: trabajamos con todas. Si preguntan por una específica, confirmá que sí y decí que los detalles de cobertura se ven en el consultorio. NO des el teléfono para esto.
FORMAS DE PAGO: efectivo, transferencia y tarjeta. Se coordinan en el consultorio.
HORARIO: lunes a viernes de 8 a 21hs, sábados de 8 a 13hs. Respondés 24/7.
DIRECCIÓN: Av. San Martín 450, Tandil.
TELÉFONO: +54 249 442-0000 (solo para urgencias sin turno disponible).

MANEJO DE PRECIOS: NO des precios salvo que el paciente los pida explícitamente.
Si pregunta por un servicio, mostrá interés y ofrecé agendar. Ej: Sí, hacemos blanqueamiento. ¿Querés que te agendemos una consulta para ver qué opción te conviene?
Si pregunta el precio de una consulta, decí que ronda los $15.000 a $20.000 y que en esa consulta la doctora evalúa el tratamiento que necesite.

CUANDO CONFIRMÁS UN TURNO Y EL PACIENTE TAMBIÉN HIZO UNA PREGUNTA: primero respondé la pregunta, después la confirmación del turno, y al final el recordatorio. Nunca al revés.
Al confirmar el turno, poné el día y el horario en negrita usando formato WhatsApp: *día* y *hora*. Ejemplo: el *lunes 21 de abril* a las *10:00hs*.
Cuando listés días u horarios disponibles, también ponelos en negrita. Ejemplo: *lunes 20*, *martes 21*, *10:00hs*, *14:00hs*.

REGLAS ESTRICTAS DE FECHAS Y HORARIOS — NUNCA VIOLARLAS:
- Nunca asumas un día que el paciente no dijo. Si dijo "a la tarde" sin día, preguntá el día primero.
- Nunca asumas un horario. Si dijo "a la mañana" o "a la tarde", preguntá la hora exacta.
- Nunca combines asunciones: "tarde" + "jueves" no te da "jueves 17:00hs". Primero confirmá el día, luego pedí la hora.
- "El otro [día]" significa la SIGUIENTE semana de ese día. Ej: si hoy es sábado 19/4 y dice "el otro jueves", es jueves 30/4, no jueves 24/4.
- Cuando el paciente da un día de la semana sin fecha, calculá la fecha exacta usando la fecha de hoy y ponela en datos.
- Nunca sugieras una fecha específica que el paciente no mencionó. Solo listá opciones disponibles.

CUANDO CONFIRMÁS UN TURNO: al final del mensaje de confirmación agregá siempre un recordatorio útil según el caso:
- Si tiene obra social: recordale que traiga el carnet.
- Para limpieza: que evite comer 1 hora antes.
- Para extracción o cirugía: que venga acompañado si puede.
- Para ortodoncia o implantes: que traiga estudios previos si tiene.
- Si no aplica ninguno: recordale la dirección nomás.

SITUACIONES ESPECIALES:
- Llegada tarde: hasta 15 minutos el turno se sostiene. Más de eso puede perderse.
- Urgencias: intentá dar el turno más cercano. Solo si no hay lugar pasá el teléfono.
- Síntomas o dolor: recomendá revisación y ofrecé agendar.
- Casos complejos: la doctora evalúa en la primera consulta.
- Preguntas que no podés responder: decí que se lo informan en el consultorio.

TONO: hablá como una recepcionista joven, simpática y natural. Descontracturada pero profesional. Usá siempre vos/te. Nunca digas que sos una IA.
Nada de frases robóticas como Por supuesto, Entendido, Claro que sí, Con gusto. Hablá como hablaría una persona real.
Usá el nombre del paciente SOLO al saludar al principio o al despedirte. En ningún otro momento.
Nunca expliques cómo escribir fechas ni formatos.

RESPONDÉ SIEMPRE con este JSON exacto sin markdown ni texto extra:
{"accion":"PEDIR_FECHA|PEDIR_HORA|CONFIRMAR_DATOS|CREAR_TURNO|CANCELAR_CONV|CONFIRMAR|CANCELAR|REPROGRAMAR|CONSULTA|REVIEW|OTRO","nuevo_conv_estado":"ESPERANDO_FECHA|ESPERANDO_HORA|ESPERANDO_CONFIRMACION|","datos":{"fecha":"","hora":"","servicio":"Consulta general"},"respuesta":"mensaje para el paciente","nuevo_estado_paciente":""}\`;

const turnoExistente = allTurnos
  .filter(t => String(t.json.telefono) === String(telefono) && ['CONFIRMADO','PENDIENTE'].includes((t.json.estado_turno||'').toUpperCase()))
  .sort((a,b) => a.json.fecha > b.json.fecha ? 1 : -1)[0]?.json || null;
const turnoInfo = turnoExistente
  ? \`Tiene turno: \${turnoExistente.fecha} a las \${turnoExistente.hora} (\${turnoExistente.servicio})\`
  : 'Sin turno activo';

const userPrompt = \`Datos del paciente:
- Nombre: \${nombre}
- Estado conversación activa: \${convEstado || 'NINGUNO'}
- Datos parciales del turno: \${convDatosStr}
- Estado en sistema: \${estadoPaciente}
- Fecha de hoy: \${hoy}
- \${turnoInfo}
- \${disponibilidadResumen}

Mensaje del paciente: \${mensajeTexto}

REGLAS de agendamiento:
1. Sin conv activa + quiere turno/agendar -> accion PEDIR_FECHA
2. Sin conv activa + otro mensaje -> respondé con la accion apropiada (CONFIRMAR/CANCELAR/REPROGRAMAR/CONSULTA/REVIEW/OTRO)
3. convEstado=ESPERANDO_FECHA -> interpretá la fecha aunque sea informal (mañana, el lunes, 22/4) -> convertila a YYYY-MM-DD -> accion PEDIR_HORA
4. convEstado=ESPERANDO_HORA -> interpretá la hora aunque sea informal (10am, a las 3, por la tarde, o solo un número como "11" o "9") -> un número solo siempre es una hora -> convertila a HH:MM -> accion CONFIRMAR_DATOS
5. convEstado=ESPERANDO_CONFIRMACION + confirma -> accion CREAR_TURNO
6. convEstado=ESPERANDO_CONFIRMACION + cancela -> accion CANCELAR_CONV\`;

const body = JSON.stringify({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 500,
  system: systemPrompt,
  messages: [{ role: 'user', content: userPrompt }]
});

return [{ json: {
  telefono, mensajeTexto, nombre, estadoPaciente,
  convEstado, convDatos: convDatosStr,
  body
}}];
`.trim();

const jsCode_hub = `
const contexto = $('Preparar Contexto').first().json;
const claudeRaw = $('Claude Clasifica y Analiza').first().json.content?.[0]?.text || '{}';
let claudeData;
try {
  const cleanRaw = claudeRaw.replace(/\`\`\`json\\n?/g, '').replace(/\`\`\`\\n?/g, '').trim();
  claudeData = JSON.parse(cleanRaw);
} catch(e) {
  claudeData = { accion: 'OTRO', respuesta: 'Gracias por escribirnos.', nuevo_conv_estado: '', datos: {}, nuevo_estado_paciente: '' };
}
const accion = claudeData.accion || 'OTRO';
let respuesta = claudeData.respuesta || 'Gracias por escribirnos.';
const terminarConv = accion === 'CREAR_TURNO' || accion === 'CANCELAR_CONV';
let nuevoConvEstado = terminarConv ? '' : (claudeData.nuevo_conv_estado || '');
let convDatosActuales = {};
try { convDatosActuales = JSON.parse(contexto.convDatos); } catch(e) {}
const claudeDatos = claudeData.datos || {};
const filteredDatos = Object.fromEntries(Object.entries(claudeDatos).filter(([k,v]) => v !== '' && v !== null && v !== undefined));
const convDatosMerged = { ...convDatosActuales, ...filteredDatos };
const convDatosStr = terminarConv ? '{}' : JSON.stringify(convDatosMerged);
let nuevoEstadoPaciente = claudeData.nuevo_estado_paciente || contexto.estadoPaciente;
if (accion === 'CREAR_TURNO') nuevoEstadoPaciente = 'CONFIRMADO';
if (accion === 'CONFIRMAR_DATOS' && convDatosMerged.fecha && convDatosMerged.hora) {
  const DURACION = 45;
  const allTurnos = $('Leer Turnos').all();
  const [hh, mm] = convDatosMerged.hora.split(':').map(Number);
  const minReq = hh * 60 + mm;
  const ocupado = allTurnos.some(t => {
    if (t.json.fecha !== convDatosMerged.fecha) return false;
    if (!['CONFIRMADO','PENDIENTE'].includes((t.json.estado_turno||'').toUpperCase())) return false;
    const [th, tm] = (t.json.hora||'00:00').split(':').map(Number);
    return Math.abs(minReq - (th*60+tm)) < DURACION;
  });
  if (ocupado) {
    let minNext = minReq + DURACION;
    let horaAlt = null;
    while (minNext <= 21*60) {
      const libre = !allTurnos.some(t => {
        if (t.json.fecha !== convDatosMerged.fecha) return false;
        if (!['CONFIRMADO','PENDIENTE'].includes((t.json.estado_turno||'').toUpperCase())) return false;
        const [th, tm] = (t.json.hora||'00:00').split(':').map(Number);
        return Math.abs(minNext - (th*60+tm)) < DURACION;
      });
      if (libre) { const h = Math.floor(minNext/60); const m = minNext%60; horaAlt = String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); break; }
      minNext += DURACION;
    }
    if (horaAlt) {
      convDatosMerged.hora = horaAlt;
      respuesta = 'Ese horario ya está ocupado. El próximo disponible es a las ' + horaAlt + 'hs. ¿Te viene bien?';
    } else {
      convDatosMerged.fecha = ''; convDatosMerged.hora = '';
      nuevoConvEstado = 'ESPERANDO_FECHA';
      respuesta = 'Lo siento, no hay más horarios disponibles ese día. ¿Querés intentar con otro día?';
    }
  }
}
let turnoData = null;
if (accion === 'CREAR_TURNO') {
  turnoData = {
    turno_id: contexto.telefono + '_' + convDatosMerged.fecha,
    telefono: contexto.telefono,
    nombre: contexto.nombre,
    servicio: convDatosMerged.servicio || 'Consulta general',
    fecha: convDatosMerged.fecha,
    hora: convDatosMerged.hora,
    estado_turno: 'CONFIRMADO'
  };
}
return [{ json: { telefono: contexto.telefono, nombre: contexto.nombre, respuesta, nuevoEstadoPaciente, nuevoConvEstado, convDatos: convDatosStr, accion, turnoData } }];
`.trim();

const jsCode_turno = `
const data = $('Hub Central Logica').first().json;
if (data.accion !== 'CREAR_TURNO' || !data.turnoData) return [];
return [{ json: data.turnoData }];
`.trim();

const schemaBase = (fields) => fields.map(id => ({
  id, displayName: id, required: false,
  defaultMatch: id === 'telefono', canBeUsedToMatch: id === 'telefono'
}));

const flow = {
  name: "Flow 2 - Hub Central Respuestas WhatsApp",
  nodes: [
    {
      id: "f2-webhook", name: "Webhook Twilio", type: "n8n-nodes-base.webhook",
      typeVersion: 2, position: [0, 300],
      parameters: { httpMethod: "POST", path: "whatsapp-incoming", responseMode: "responseNode", options: {} },
      webhookId: "whatsapp-incoming"
    },
    {
      id: "f2-respond-200", name: "Responder 200 a Twilio", type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1, position: [220, 300],
      parameters: { respondWith: "text", responseBody: "OK", options: { responseCode: 200 } }
    },
    {
      id: "f2-code-parse", name: "Parsear Mensaje Entrante", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [440, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: jsCode_parse }
    },
    {
      id: "f2-sheets-buscar", name: "Buscar Paciente", type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.4, position: [660, 300], alwaysOutputData: true,
      parameters: { operation: "read", documentId: sheetDoc, sheetName: { "__rl": true, mode: "name", value: "Pacientes" }, options: {} },
      credentials: { googleSheetsOAuth2Api: { name: "Google Sheets Account" } }
    },
    {
      id: "f2-code-acumular", name: "Preparar Acumulacion", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [880, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: jsCode_acumular }
    },
    {
      id: "f2-sheets-guardar", name: "Guardar Mensaje Pendiente", type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.4, position: [1100, 300],
      parameters: {
        operation: "appendOrUpdate", documentId: sheetDoc,
        sheetName: { "__rl": true, mode: "name", value: "Pacientes" },
        columns: {
          mappingMode: "defineBelow",
          value: {
            telefono: "={{ $json.telefono }}",
            mensajesPendientes: "={{ $json.nuevosPendientes }}",
            ultimoMensaje: "={{ $json.timestamp }}"
          },
          matchingColumns: ["telefono"],
          schema: schemaBase(["telefono", "mensajesPendientes", "ultimoMensaje"])
        }
      },
      credentials: { googleSheetsOAuth2Api: { name: "Google Sheets Account" } }
    },
    {
      id: "f2-wait", name: "Esperar 8 segundos", type: "n8n-nodes-base.wait",
      typeVersion: 1, position: [1320, 300],
      parameters: { resume: "timeInterval", amount: 10, unit: "seconds" }
    },
    {
      id: "f2-sheets-releer", name: "Re-leer Paciente", type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.4, position: [1540, 300], alwaysOutputData: true,
      parameters: { operation: "read", documentId: sheetDoc, sheetName: { "__rl": true, mode: "name", value: "Pacientes" }, options: {} },
      credentials: { googleSheetsOAuth2Api: { name: "Google Sheets Account" } }
    },
    {
      id: "f2-code-verificar", name: "Verificar Debounce", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [1760, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: jsCode_verificar }
    },
    {
      id: "f2-sheets-leer-turnos", name: "Leer Turnos", type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.4, position: [1980, 300], alwaysOutputData: true,
      parameters: { operation: "read", documentId: sheetDoc, sheetName: { "__rl": true, mode: "name", value: "Turnos" }, options: {} },
      credentials: { googleSheetsOAuth2Api: { name: "Google Sheets Account" } }
    },
    {
      id: "f2-code-contexto", name: "Preparar Contexto", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [2200, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: jsCode_contexto }
    },
    {
      id: "f2-claude", name: "Claude Clasifica y Analiza", type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [2420, 300],
      parameters: {
        method: "POST", url: "https://api.anthropic.com/v1/messages",
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: "x-api-key", value: ANTHROPIC_KEY },
          { name: "anthropic-version", value: "2023-06-01" },
          { name: "content-type", value: "application/json" }
        ]},
        sendBody: true, contentType: "raw", rawContentType: "application/json",
        body: "={{ $json.body }}"
      }
    },
    {
      id: "f2-code-hub", name: "Hub Central Logica", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [2640, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: jsCode_hub }
    },
    {
      id: "f2-twilio-send", name: "Responder WhatsApp", type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [2860, 300],
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
    },
    {
      id: "f2-sheets-update", name: "Actualizar Estado Paciente", type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.4, position: [3080, 300],
      parameters: {
        operation: "appendOrUpdate", documentId: sheetDoc,
        sheetName: { "__rl": true, mode: "name", value: "Pacientes" },
        columns: {
          mappingMode: "defineBelow",
          value: {
            telefono: "={{ $('Hub Central Logica').first().json.telefono }}",
            estado: "={{ $('Hub Central Logica').first().json.nuevoEstadoPaciente }}",
            conversacionEstado: "={{ $('Hub Central Logica').first().json.nuevoConvEstado }}",
            conversacionDatos: "={{ $('Hub Central Logica').first().json.convDatos }}",
            fechaUltimoContacto: "={{ new Date().toISOString() }}",
            mensajesPendientes: "",
            ultimoMensaje: ""
          },
          matchingColumns: ["telefono"],
          schema: schemaBase(["telefono","estado","conversacionEstado","conversacionDatos","fechaUltimoContacto","mensajesPendientes","ultimoMensaje"])
        }
      },
      credentials: { googleSheetsOAuth2Api: { name: "Google Sheets Account" } }
    },
    {
      id: "f2-code-turno", name: "Preparar Turno", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [3300, 300],
      parameters: { mode: "runOnceForAllItems", jsCode: jsCode_turno }
    },
    {
      id: "f2-sheets-turno", name: "Crear Turno en Sheets", type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.4, position: [3520, 300],
      parameters: {
        operation: "appendOrUpdate", documentId: sheetDoc,
        sheetName: { "__rl": true, mode: "name", value: "Turnos" },
        columns: {
          mappingMode: "defineBelow",
          value: {
            turno_id: "={{ $json.turno_id }}", telefono: "={{ $json.telefono }}",
            nombre: "={{ $json.nombre }}", servicio: "={{ $json.servicio }}",
            fecha: "={{ $json.fecha }}", hora: "={{ $json.hora }}",
            estado_turno: "={{ $json.estado_turno }}"
          },
          matchingColumns: ["turno_id"],
          schema: schemaBase(["turno_id","telefono","nombre","servicio","fecha","hora","estado_turno"])
            .map(s => s.id === "turno_id" ? {...s, defaultMatch: true, canBeUsedToMatch: true} : s)
        }
      },
      credentials: { googleSheetsOAuth2Api: { name: "Google Sheets Account" } }
    }
  ],
  connections: {
    "Webhook Twilio":            { main: [[{ node: "Responder 200 a Twilio",      type: "main", index: 0 }]] },
    "Responder 200 a Twilio":    { main: [[{ node: "Parsear Mensaje Entrante",     type: "main", index: 0 }]] },
    "Parsear Mensaje Entrante":  { main: [[{ node: "Buscar Paciente",              type: "main", index: 0 }]] },
    "Buscar Paciente":           { main: [[{ node: "Preparar Acumulacion",         type: "main", index: 0 }]] },
    "Preparar Acumulacion":      { main: [[{ node: "Guardar Mensaje Pendiente",    type: "main", index: 0 }]] },
    "Guardar Mensaje Pendiente": { main: [[{ node: "Esperar 8 segundos",           type: "main", index: 0 }]] },
    "Esperar 8 segundos":        { main: [[{ node: "Re-leer Paciente",             type: "main", index: 0 }]] },
    "Re-leer Paciente":          { main: [[{ node: "Verificar Debounce",           type: "main", index: 0 }]] },
    "Verificar Debounce":        { main: [[{ node: "Leer Turnos",                  type: "main", index: 0 }]] },
    "Leer Turnos":               { main: [[{ node: "Preparar Contexto",            type: "main", index: 0 }]] },
    "Preparar Contexto":         { main: [[{ node: "Claude Clasifica y Analiza",   type: "main", index: 0 }]] },
    "Claude Clasifica y Analiza":{ main: [[{ node: "Hub Central Logica",           type: "main", index: 0 }]] },
    "Hub Central Logica":        { main: [[{ node: "Responder WhatsApp",           type: "main", index: 0 }]] },
    "Responder WhatsApp":        { main: [[{ node: "Actualizar Estado Paciente",   type: "main", index: 0 }]] },
    "Actualizar Estado Paciente":{ main: [[{ node: "Preparar Turno",               type: "main", index: 0 }]] },
    "Preparar Turno":            { main: [[{ node: "Crear Turno en Sheets",        type: "main", index: 0 }]] }
  },
  settings: { executionOrder: "v1", saveManualExecutions: true }
};

fs.writeFileSync('C:/Users/marco/OneDrive/Desktop/RecepIA/n8n-flows/flow2_hub_central.json', JSON.stringify(flow, null, 2), 'utf8');
console.log('OK - flow2 reescrito con debounce');
