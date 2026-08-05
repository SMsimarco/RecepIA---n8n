// agente_demo.js — RecepIA versión Agente
// Correr: node agente_demo.js
// El agente decide solo qué herramientas usar y cuándo

const https = require('https');
const readline = require('readline');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) throw new Error("Falta ANTHROPIC_API_KEY en el entorno");
const TELEFONO_DEMO = "5492494000000";

// ─── Datos mock (simulan Google Sheets) ───────────────────────────────────────

const pacientes = [
  { telefono: TELEFONO_DEMO, nombre: "Marco", estado: "ACTIVO", proximoTurno: "" }
];

const turnos = [
  { turno_id: "t1", telefono: TELEFONO_DEMO, nombre: "Marco", servicio: "Limpieza dental", fecha: "2026-04-23", hora: "09:00", estado_turno: "CONFIRMADO" },
  { turno_id: "t2", telefono: "5492494111111", nombre: "Ana García", servicio: "Consulta", fecha: "2026-04-23", hora: "10:30", estado_turno: "CONFIRMADO" },
  { turno_id: "t3", telefono: "5492494222222", nombre: "Luis Pérez", servicio: "Ortodoncia", fecha: "2026-04-24", hora: "09:00", estado_turno: "CONFIRMADO" },
];

// ─── Herramientas disponibles para el agente ──────────────────────────────────

const tools = [
  {
    name: "buscar_paciente",
    description: "Busca un paciente por teléfono. Devuelve nombre, estado y turno activo si tiene.",
    input_schema: {
      type: "object",
      properties: {
        telefono: { type: "string", description: "Teléfono sin espacios ni signos" }
      },
      required: ["telefono"]
    }
  },
  {
    name: "ver_disponibilidad",
    description: "Ver horarios disponibles para una fecha específica. Devuelve lista de slots libres.",
    input_schema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD" }
      },
      required: ["fecha"]
    }
  },
  {
    name: "crear_turno",
    description: "Crea un turno confirmado en el sistema.",
    input_schema: {
      type: "object",
      properties: {
        telefono: { type: "string" },
        nombre: { type: "string" },
        fecha: { type: "string", description: "YYYY-MM-DD" },
        hora: { type: "string", description: "HH:MM" },
        servicio: { type: "string" }
      },
      required: ["telefono", "nombre", "fecha", "hora", "servicio"]
    }
  },
  {
    name: "cancelar_turno",
    description: "Cancela el turno activo de un paciente.",
    input_schema: {
      type: "object",
      properties: {
        telefono: { type: "string" }
      },
      required: ["telefono"]
    }
  }
];

// ─── Ejecutor de herramientas ─────────────────────────────────────────────────

function ejecutarTool(name, input) {
  if (name === "buscar_paciente") {
    const p = pacientes.find(x => x.telefono === input.telefono);
    if (!p) return { encontrado: false, mensaje: "Paciente no registrado, es la primera vez." };
    const turno = turnos.find(t => t.telefono === input.telefono && t.estado_turno === "CONFIRMADO");
    return {
      encontrado: true,
      nombre: p.nombre,
      estado: p.estado,
      turno_activo: turno ? `${turno.servicio} el ${turno.fecha} a las ${turno.hora}` : null
    };
  }

  if (name === "ver_disponibilidad") {
    const DURACION = 45;
    const ocupados = turnos
      .filter(t => t.fecha === input.fecha && t.estado_turno === "CONFIRMADO")
      .map(t => { const [h, m] = t.hora.split(':').map(Number); return h * 60 + m; });

    const dt = new Date(input.fecha + 'T00:00:00');
    const dow = dt.getDay();
    if (dow === 0) return { disponibles: [], mensaje: "Domingo, clínica cerrada." };
    const fin = dow === 6 ? 13 * 60 : 21 * 60;
    const libres = [];
    for (let min = 8 * 60; min <= fin - DURACION; min += DURACION) {
      if (!ocupados.some(o => Math.abs(o - min) < DURACION)) {
        const h = String(Math.floor(min / 60)).padStart(2, '0');
        const m = String(min % 60).padStart(2, '0');
        libres.push(`${h}:${m}`);
      }
    }
    return { fecha: input.fecha, disponibles: libres.slice(0, 8), total_libres: libres.length };
  }

  if (name === "crear_turno") {
    const existe = turnos.find(t => t.telefono === input.telefono && t.estado_turno === "CONFIRMADO");
    if (existe) return { exito: false, mensaje: "Ya tiene un turno activo. Cancelalo primero." };
    const nuevo = { turno_id: `t${Date.now()}`, ...input, estado_turno: "CONFIRMADO" };
    turnos.push(nuevo);
    return { exito: true, turno: nuevo, mensaje: `Turno creado: ${input.fecha} a las ${input.hora}` };
  }

  if (name === "cancelar_turno") {
    const idx = turnos.findIndex(t => t.telefono === input.telefono && t.estado_turno === "CONFIRMADO");
    if (idx === -1) return { exito: false, mensaje: "No tiene turno activo." };
    turnos[idx].estado_turno = "CANCELADO";
    return { exito: true, mensaje: `Turno del ${turnos[idx].fecha} cancelado.` };
  }

  return { error: "Herramienta desconocida" };
}

// ─── Llamada a Claude API ─────────────────────────────────────────────────────

function llamarClaude(messages) {
  return new Promise((resolve, reject) => {
    const hoy = new Date().toISOString().split('T')[0];
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `Sos la recepcionista virtual de Centro Médico San Martín, clínica odontológica en Tandil. Fecha de hoy: ${hoy}. Teléfono del paciente: ${TELEFONO_DEMO}.
Usá las herramientas para buscar datos reales antes de responder. Siempre buscá al paciente al inicio de la conversación.
Tono: joven, natural, descontracturada. Sin frases robóticas. Nunca digas que sos IA.`,
      tools,
      messages
    });

    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Loop del agente ──────────────────────────────────────────────────────────

async function agenteLoop(messages) {
  while (true) {
    const respuesta = await llamarClaude(messages);

    if (respuesta.error) {
      console.log("\n[ERROR API]", respuesta.error, respuesta.message);
      return "Error al conectar con Claude.";
    }

    messages.push({ role: "assistant", content: respuesta.content });

    if (respuesta.stop_reason === "end_turn") {
      const texto = respuesta.content.find(b => b.type === "text")?.text || "";
      return texto;
    }

    if (respuesta.stop_reason === "tool_use") {
      const toolResults = [];
      for (const bloque of respuesta.content) {
        if (bloque.type !== "tool_use") continue;
        console.log(`\n  [AGENTE usa herramienta: ${bloque.name}]`, JSON.stringify(bloque.input));
        const resultado = ejecutarTool(bloque.name, bloque.input);
        console.log(`  [Resultado: ${JSON.stringify(resultado)}]`);
        toolResults.push({ type: "tool_result", tool_use_id: bloque.id, content: JSON.stringify(resultado) });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    return "No entendí la respuesta del agente.";
  }
}

// ─── CLI interactivo ──────────────────────────────────────────────────────────

async function main() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║   RecepIA — Demo Agente IA             ║");
  console.log("║   El agente decide solo qué hacer      ║");
  console.log("║   Escribí 'salir' para terminar        ║");
  console.log("╚════════════════════════════════════════╝\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const messages = [];

  const preguntar = () => {
    rl.question("Vos: ", async (input) => {
      if (input.toLowerCase() === 'salir') { rl.close(); return; }
      if (!input.trim()) { preguntar(); return; }

      messages.push({ role: "user", content: input });

      try {
        const respuesta = await agenteLoop(messages);
        console.log(`\nAgente: ${respuesta}\n`);
      } catch (e) {
        console.log("\n[ERROR]", e.message, "\n");
      }

      preguntar();
    });
  };

  preguntar();
}

main();
