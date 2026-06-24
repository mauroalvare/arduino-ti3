const offBtn = document.getElementById("offBtn");
const manualBtn = document.getElementById("manualBtn");
const autoBtn = document.getElementById("autoBtn");
const currentMode = document.getElementById("currentMode");
const connectionStatus = document.getElementById("connectionStatus");
const connectBtn = document.getElementById("connectBtn");
const savedCost = document.getElementById("savedCost");
const savingPercentBar = document.getElementById("savingPercentBar");
const manualConsumption = document.getElementById("manualConsumption");
const autoConsumption = document.getElementById("autoConsumption");
const hoursInput = document.getElementById("hours");
const autoPercentInput = document.getElementById("autoPercent");
const autoPercentValue = document.getElementById("autoPercentValue");
const timeoutInput = document.getElementById("timeout");
const priceInput = document.getElementById("price");
const monthlySavings = document.getElementById("monthlySavings");
const addEquipmentBtn = document.getElementById("addEquipmentBtn");
const equipmentList = document.getElementById("equipmentList");

const scenario = { airePower: 1500, ledPower: 10, projectorPower: 300 };

let mode = "AUTOMÁTICO";
let port = null;
let writer = null;
let reader = null;
let readBuffer = "";
let isDisconnecting = false;
let writeQueue = Promise.resolve();

// ==== ESTADO EQUIPOS ====
let aireIsOn = false;
let luzIsOn = false;
let realTimeInterval = null;

// ==== CONTADORES ====
// sessionSeconds: corre siempre que el modo no sea APAGADO (es la base "si todo estuviera siempre prendido")
// aireSeconds: solo cuando el aire está ON
// luzSeconds: solo cuando la luz está ON
let sessionSeconds = Number(localStorage.getItem("sessionSeconds")) || 0;
let aireSeconds = Number(localStorage.getItem("aireSeconds")) || 0;
let luzSeconds = Number(localStorage.getItem("luzSeconds")) || 0;

// ==== POTENCIAS ====
function getLuzPowerKw() {
  const count = Number(document.getElementById("ledCount").value) || 0;
  const power =
    Number(document.getElementById("ledPower").value) || scenario.ledPower;
  return (count * power) / 1000;
}

function getAireRestoPowerKw() {
  const aireCount = Number(document.getElementById("aireCount").value) || 0;
  const projCount =
    Number(document.getElementById("projectorCount").value) || 0;
  const airePower =
    Number(document.getElementById("airePower").value) || scenario.airePower;
  const projPower =
    Number(document.getElementById("projectorPower").value) ||
    scenario.projectorPower;

  const extraPower = Array.from(
    equipmentList.querySelectorAll(".equipment-item"),
  ).reduce((sum, row) => {
    const c = Number(row.querySelector(".equipment-count").value) || 0;
    const p = Number(row.querySelector(".equipment-power").value) || 0;
    return sum + c * p;
  }, 0);

  return (aireCount * airePower + projCount * projPower + extraPower) / 1000;
}

function getTotalPowerKw() {
  return getLuzPowerKw() + getAireRestoPowerKw();
}

// ==== EQUIPOS DINÁMICOS ====
function createEquipmentRow(name = "", count = 1, power = 0) {
  const row = document.createElement("div");
  row.className = "equipment-item";
  row.innerHTML = `
    <input type="text"   class="equipment-name"  placeholder="Ej: Ventilador" value="${name}" />
    <input type="number" min="0" class="equipment-count" value="${count}" placeholder="Cant." />
    <input type="number" min="0" class="equipment-power" value="${power}" placeholder="Watts" />
    <button type="button" class="equipment-remove">×</button>
  `;
  row
    .querySelectorAll("input")
    .forEach((i) => i.addEventListener("input", updateAllValues));
  row.querySelector(".equipment-remove").addEventListener("click", () => {
    row.remove();
    updateAllValues();
  });
  equipmentList.appendChild(row);
  return row;
}

// ==== FORMATO ====
function formatNumber(value, digits = 2) {
  return Number(value.toFixed(digits)).toLocaleString("es-ES");
}

function formatDuration(totalSeconds) {
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ==== ACTUALIZACIONES ====
function updateAllValues() {
  updateEstimates();
  updateRealTimeStatsUI();
}

function updateEstimates() {
  const hours = Number(hoursInput.value);
  const autoPct = Number(autoPercentInput.value) / 100;
  const price = Number(priceInput.value);
  const totalKw = getTotalPowerKw();

  const manualKwh = totalKw * hours;
  const autoKwh = totalKw * hours * autoPct;
  const savedKwh = Math.max(manualKwh - autoKwh, 0);
  const savedMoney = savedKwh * price;
  const savedPct = manualKwh > 0 ? (savedKwh / manualKwh) * 100 : 0;

  currentMode.textContent = mode;
  savedCost.textContent = `$${formatNumber(savedMoney, 2)}`;
  manualConsumption.textContent = `${formatNumber(manualKwh, 2)} kWh`;
  autoConsumption.textContent = `${formatNumber(autoKwh, 2)} kWh`;
  savingPercentBar.style.width = `${Math.min(Math.round(savedPct), 100)}%`;
  autoPercentValue.textContent = `${Math.round(autoPct * 100)}%`;
  monthlySavings.textContent = `$${formatNumber(savedMoney * 30, 2)}`;
}

// ==== TRACKING EN TIEMPO REAL ====
function startRealTimeTracking() {
  if (realTimeInterval) return;

  realTimeInterval = setInterval(() => {
    // NUEVO: Si no hay puerto conectado, salimos y no contamos nada
    if (!port) return;

    // Si está conectado pero apagado, tampoco contamos
    if (mode === "APAGADO") return;

    // La sesión siempre avanza (base comparación manual)
    sessionSeconds++;

    if (aireIsOn) aireSeconds++;
    if (luzIsOn) luzSeconds++;

    localStorage.setItem("sessionSeconds", sessionSeconds);
    localStorage.setItem("aireSeconds", aireSeconds);
    localStorage.setItem("luzSeconds", luzSeconds);

    updateRealTimeStatsUI();
  }, 1000);
}

function updateRealTimeStatsUI() {
  const price = Number(priceInput.value);
  const luzKw = getLuzPowerKw();
  const aireKw = getAireRestoPowerKw();
  const totalKw = luzKw + aireKw;

  // Lo que realmente consumieron los equipos
  const realKwhAire = aireKw * (aireSeconds / 3600);
  const realKwhLuz = luzKw * (luzSeconds / 3600);
  const realKwhTotal = realKwhAire + realKwhLuz;
  const realCost = realKwhTotal * price;

  // Lo que hubiera consumido si todo estuviera siempre prendido
  const manualKwh = totalKw * (sessionSeconds / 3600);

  // Ahorro = diferencia entre consumo manual y consumo real
  const savedKwh = Math.max(manualKwh - realKwhTotal, 0);
  const savedCostVal = savedKwh * price;

  document.getElementById("realConnectedTime").textContent =
    formatDuration(sessionSeconds);
  document.getElementById("realAireTime").textContent =
    formatDuration(aireSeconds);
  document.getElementById("realLuzTime").textContent =
    formatDuration(luzSeconds);

  document.getElementById("realConsumptionKwh").textContent =
    `${formatNumber(realKwhTotal, 4)} kWh`;
  document.getElementById("realConsumptionCost").textContent =
    `$${formatNumber(realCost, 2)}`;

  document.getElementById("realSavedKwh").textContent =
    `${formatNumber(savedKwh, 4)} kWh`;
  document.getElementById("realSavedCost").textContent =
    `$${formatNumber(savedCostVal, 2)}`;
}

function resetRealTimeStats() {
  sessionSeconds = 0;
  aireSeconds = 0;
  luzSeconds = 0;
  localStorage.setItem("sessionSeconds", 0);
  localStorage.setItem("aireSeconds", 0);
  localStorage.setItem("luzSeconds", 0);
  updateRealTimeStatsUI();
}

// ==== SERIAL ====
function setConnectionStatus(text, color) {
  connectionStatus.textContent = text;
  connectionStatus.style.color = color;
}

function writeSerial(message) {
  if (!writer) {
    console.warn("writeSerial: sin conexión");
    return;
  }
  const encoder = new TextEncoder();
  writeQueue = writeQueue
    .then(() => writer.write(encoder.encode(message + "\n")))
    .catch((err) => console.warn("writeSerial error (ignorado):", err));
}

async function connectArduino() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });

    isDisconnecting = false;
    writeQueue = Promise.resolve();

    // Resetear estado hasta recibir confirmación del Arduino
    aireIsOn = false;
    luzIsOn = false;
    updateRealTimeStatsUI();

    writer = port.writable.getWriter();

    setConnectionStatus("CONECTADO", "var(--accent-green)");
    connectBtn.textContent = "Desconectar Arduino";

    listenSerial();
    setTimeout(() => sendModeAndTimeout(), 1500);
  } catch (error) {
    console.error("connectArduino error:", error);
    setConnectionStatus("ERROR AL CONECTAR", "#f43f5e");
  }
}

async function disconnectArduino() {
  isDisconnecting = true;

  try {
    writeSerial("MODE:APAGADO");
    await writeQueue;
  } catch (e) {}

  if (reader) {
    try {
      await reader.cancel();
    } catch (e) {}
    try {
      reader.releaseLock();
    } catch (e) {}
    reader = null;
  }
  if (writer) {
    try {
      await writer.close();
    } catch (e) {}
    try {
      writer.releaseLock();
    } catch (e) {}
    writer = null;
  }
  if (port) {
    try {
      await port.close();
    } catch (e) {}
    port = null;
  }

  aireIsOn = false;
  luzIsOn = false;

  setConnectionStatus("DESCONECTADO", "#f43f5e");
  connectBtn.textContent = "Conectar Arduino";
  updateRealTimeStatsUI();
}

let lastArduinoSignal = Date.now();

async function listenSerial() {
  const decoder = new TextDecoder();

  while (port && port.readable && !isDisconnecting) {
    try {
      reader = port.readable.getReader();
      try {
        while (!isDisconnecting) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          readBuffer += chunk;

          const lines = readBuffer.split("\n");
          readBuffer = lines.pop();
          lines.forEach((line) => {
            if (line.trim()) handleSerialMessage(line.trim());
          });
        }
      } finally {
        try {
          reader.releaseLock();
        } catch (e) {}
        reader = null;
      }
    } catch (err) {
      if (isDisconnecting) break;
      console.error("Error lectura serial, reintentando...", err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

function handleSerialMessage(message) {
  lastArduinoSignal = Date.now();
  console.log("Arduino:", message);

  if (message.startsWith("MODE:")) {
    const m = message.split(":")[1].trim();
    setModeFromArduino(
      m === "MANUAL" ? "MANUAL" : m === "APAGADO" ? "APAGADO" : "AUTOMÁTICO",
      false,
    );
  }

  if (message.startsWith("AIRE:")) {
    aireIsOn = message.split(":")[1].trim() === "ON";
  }

  if (message.startsWith("LUZ:")) {
    luzIsOn = message.split(":")[1].trim() === "ON";
  }

  // STATE solo se usa en MANUAL/APAGADO, en AUTO se confía en AIRE/LUZ
  if (message.startsWith("STATE:") && mode !== "AUTOMÁTICO") {
    const state = message.split(":")[1].trim() === "ON";
    aireIsOn = state;
    luzIsOn = state;
  }

  updateRealTimeStatsUI();
}

function setModeFromArduino(newMode, updateArduino = true) {
  mode = newMode;
  offBtn.classList.toggle("active", mode === "APAGADO");
  autoBtn.classList.toggle("active", mode === "AUTOMÁTICO");
  manualBtn.classList.toggle("active", mode === "MANUAL");

  if (mode === "MANUAL") {
    aireIsOn = true;
    luzIsOn = true;
  } else if (mode === "APAGADO") {
    aireIsOn = false;
    luzIsOn = false;
  }

  if (updateArduino) sendModeAndTimeout();
  updateAllValues();
}

function sendModeAndTimeout() {
  if (!writer) return;
  const modoArduino =
    mode === "MANUAL" ? "MANUAL" : mode === "APAGADO" ? "APAGADO" : "AUTO";
  writeSerial(`MODE:${modoArduino}`);
  writeSerial(`TIMEOUT:${timeoutInput.value}`);
  console.log("Enviando al Arduino:", `MODE:${modoArduino}`);
}

// ==== INIT ====
document.addEventListener("DOMContentLoaded", () => {
  offBtn.addEventListener("click", () => setModeFromArduino("APAGADO"));
  manualBtn.addEventListener("click", () => setModeFromArduino("MANUAL"));
  autoBtn.addEventListener("click", () => setModeFromArduino("AUTOMÁTICO"));

  connectBtn.addEventListener("click", async () => {
    connectBtn.disabled = true;
    try {
      if (port) await disconnectArduino();
      else await connectArduino();
    } finally {
      connectBtn.disabled = false;
    }
  });

  document
    .getElementById("resetOnTimeBtn")
    .addEventListener("click", resetRealTimeStats);
  addEquipmentBtn.addEventListener("click", () => createEquipmentRow());

  [
    "hours",
    "autoPercent",
    "timeout",
    "price",
    "aireCount",
    "ledCount",
    "projectorCount",
    "airePower",
    "ledPower",
    "projectorPower",
  ].forEach((id) =>
    document.getElementById(id).addEventListener("input", () => {
      if (id === "timeout") sendModeAndTimeout();
      updateAllValues();
    }),
  );

  createEquipmentRow("PC Escritorio", 1, 250);

  updateAllValues();
  updateRealTimeStatsUI();
  startRealTimeTracking();

  setInterval(() => {
    if (!port) return;
    if (Date.now() - lastArduinoSignal > 60000) {
      aireIsOn = false;
      luzIsOn = false;
    }
  }, 5000);
});
