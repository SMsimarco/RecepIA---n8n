#!/usr/bin/env bash
# set-sheet.sh <SHEET_ID>
#
# Cambia el Google Sheet ID en todos los nodos Google Sheets de los
# workflows de RecepIA en n8n, y VERIFICA que todos queden apuntando
# al mismo ID antes de darse por exitoso.
#
# Solo toca nodos cuyo documentId actual ya coincide con un ID conocido
# de RecepIA (ver KNOWN_IDS abajo) — nunca pisa sheets de otros proyectos.
#
# Requiere: N8N_API_KEY (env var), node
# Opcional: N8N_BASE_URL (default: https://vmi3538071.contaboserver.net)
#
# Uso: ./set-sheet.sh 1AbCdEfGhIjKlMnOpQrStUvWxYz

set -euo pipefail

NEW_ID="${1:-}"
if [ -z "$NEW_ID" ]; then
  echo "Uso: $0 <SHEET_ID>"
  exit 1
fi
if [ -z "${N8N_API_KEY:-}" ]; then
  echo "ERROR: falta N8N_API_KEY en el entorno."
  exit 1
fi

BASE_URL="${N8N_BASE_URL:-https://vmi3538071.contaboserver.net}"

# IDs conocidos de sheets de RecepIA (agregar nuevos acá a medida que se creen).
KNOWN_IDS='["1vK8h8c8prheB8_KE7nwl6e4SblGoeALs_jE-vkgv5ho"]'

# Para el label final. Ajustar cuando exista una sheet de produccion real
# separada de la de demo.
DEMO_SHEET_ID="1vK8h8c8prheB8_KE7nwl6e4SblGoeALs_jE-vkgv5ho"
PROD_SHEET_ID=""

TMP_DIR="./.set-sheet-tmp.$$"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> Listando workflows..."
curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$BASE_URL/api/v1/workflows?limit=250" -o "$TMP_DIR/workflows.json"

node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('$TMP_DIR/workflows.json', 'utf8'));
fs.writeFileSync('$TMP_DIR/ids.json', JSON.stringify(d.data.map(w => w.id)));
"

MODIFIED=0

echo "==> Buscando y actualizando nodos Google Sheets con ID conocido..."
for id in $(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/ids.json','utf8')).join('\n'))"); do
  curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$BASE_URL/api/v1/workflows/$id" -o "$TMP_DIR/wf_$id.json"

  CHANGED=$(node -e "
    const fs = require('fs');
    const knownIds = $KNOWN_IDS;
    const newId = '$NEW_ID';
    const d = JSON.parse(fs.readFileSync('$TMP_DIR/wf_$id.json', 'utf8'));
    let changed = false;
    for (const n of d.nodes) {
      if (n.type === 'n8n-nodes-base.googleSheets' && n.parameters && n.parameters.documentId) {
        const doc = n.parameters.documentId;
        if (doc.mode === 'id' && knownIds.includes(doc.value) && doc.value !== newId) {
          doc.value = newId;
          changed = true;
        }
      }
    }
    if (changed) {
      const payload = { name: d.name, nodes: d.nodes, connections: d.connections, settings: d.settings };
      fs.writeFileSync('$TMP_DIR/put_$id.json', JSON.stringify(payload));
    }
    console.log(changed ? 'yes' : 'no');
  ")

  if [ "$CHANGED" = "yes" ]; then
    NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/wf_$id.json','utf8')).name)")
    echo "   -> $id ($NAME): actualizando..."
    curl -s -o /dev/null -w "      HTTP %{http_code}\n" -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" -X PUT "$BASE_URL/api/v1/workflows/$id" -d @"$TMP_DIR/put_$id.json"
    MODIFIED=$((MODIFIED + 1))
  fi
done

echo "==> $MODIFIED workflow(s) actualizados. Releyendo todo para verificar consistencia..."

: > "$TMP_DIR/found.txt"
for id in $(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/ids.json','utf8')).join('\n'))"); do
  curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$BASE_URL/api/v1/workflows/$id" -o "$TMP_DIR/verify_$id.json"

  node -e "
    const fs = require('fs');
    const knownIds = $KNOWN_IDS;
    const newId = '$NEW_ID';
    const d = JSON.parse(fs.readFileSync('$TMP_DIR/verify_$id.json', 'utf8'));
    for (const n of d.nodes) {
      if (n.type === 'n8n-nodes-base.googleSheets' && n.parameters && n.parameters.documentId) {
        const doc = n.parameters.documentId;
        if (doc.mode === 'id' && (doc.value === newId || knownIds.includes(doc.value))) {
          console.log(doc.value + ' | ' + d.name + ' / ' + n.name);
        }
      }
    }
  " >> "$TMP_DIR/found.txt"
done

echo "==> Nodos Google Sheets relevantes encontrados:"
cat "$TMP_DIR/found.txt"

MISMATCH="$(grep -v "^$NEW_ID |" "$TMP_DIR/found.txt" || true)"
if [ -n "$MISMATCH" ]; then
  echo ""
  echo "ERROR: hay nodos que NO quedaron en $NEW_ID:"
  echo "$MISMATCH"
  exit 1
fi

echo ""
if [ "$NEW_ID" = "$DEMO_SHEET_ID" ]; then
  LABEL="DEMO"
elif [ -n "$PROD_SHEET_ID" ] && [ "$NEW_ID" = "$PROD_SHEET_ID" ]; then
  LABEL="PRODUCCION"
else
  LABEL="DESCONOCIDO (no coincide con DEMO ni PRODUCCION configurados arriba en el script)"
fi

echo "OK: todos los nodos verificados apuntan a $NEW_ID ($LABEL)."
