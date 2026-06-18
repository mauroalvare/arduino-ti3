const offBtn = document.getElementById("offBtn");
const manualBtn = document.getElementById("manualBtn");
const autoBtn = document.getElementById("autoBtn");
const currentMode = document.getElementById("currentMode");
const connectionStatus = document.getElementById("connectionStatus");
const connectBtn = document.getElementById("connectBtn");
const savedEnergy = document.getElementById("savedEnergy");
const savedCost = document.getElementById("savedCost");
const savingPercentBar = document.getElementById("savingPercentBar");
const manualConsumption = document.getElementById("manualConsumption");
const autoConsumption = document.getElementById("autoConsumption");
const savingPercent = document.getElementById("savingPercent");
const hoursInput = document.getElementById("hours");
const autoPercentInput = document.getElementById("autoPercent");
const autoPercentValue = document.getElementById("autoPercentValue");
const timeoutInput = document.getElementById("timeout");
const priceInput = document.getElementById("price");
const totalWatts = document.getElementById("totalWatts");
const monthlySavings = document.getElementById("monthlySavings");
const yearlySavings = document.getElementById("yearlySavings");
const manualCostElement = document.getElementById("manualCost");
const dailySavingsElement = document.getElementById("dailySavings");
const storedOnHoursDisplay = document.getElementById("storedOnHours");
const salonMultiplierInput = document.getElementById("salonMultiplier");
const salonMultiplierLabel = document.getElementById("salonMultiplierLabel");
const totalSalonSavings = document.getElementById("totalSalonSavings");
const addEquipmentBtn = document.getElementById("addEquipmentBtn");
const equipmentList = document.getElementById("equipmentList");

const scenario = {
  airePower: 1500,
  ledPower: 10,
  projectorPower: 300,
};

let mode = "AUTOMÁTICO";
let port = null;
let writer = null;
let reader = null;
let readBuffer = "";
let onTimeTimer = null;
let currentSessionSeconds = 0;
let deviceIsOn = false;
const storedOnTimeKey = "storedTotalOnHoursSeconds";
let storedOnHoursSeconds = 0;

const resetOnTimeBtn = document.getElementById("resetOnTimeBtn");

console.log("Script Arduino cargado");

function getTotalPower() {
  const aireCount = Number(document.getElementById("aireCount").value) || 0;
  const ledCount = Number(document.getElementById("ledCount").value) || 0;
  const projectorCount =
    Number(document.getElementById("projectorCount").value) || 0;
  const airePower =
    Number(document.getElementById("airePower").value) || scenario.airePower;
  const ledPower =
    Number(document.getElementById("ledPower").value) || scenario.ledPower;
  const projectorPower =
    Number(document.getElementById("projectorPower").value) ||
    scenario.projectorPower;

  const aire = aireCount * airePower;
  const leds = ledCount * ledPower;
  const proyectores = projectorCount * projectorPower;
  const extra = getDynamicEquipmentPower();
  return aire + leds + proyectores + extra;
}

function getDynamicEquipmentPower() {
  return Array.from(equipmentList.querySelectorAll(".equipment-item")).reduce(
    (sum, row) => {
      const count = Number(row.querySelector(".equipment-count").value) || 0;
      const power = Number(row.querySelector(".equipment-power").value) || 0;
      return sum + count * power;
    },
    0,
  );
}

function createEquipmentRow(name = "", count = 1, power = 0) {
  const row = document.createElement("div");
  row.className = "equipment-item";
  row.innerHTML = `
    <input type="text" class="equipment-name" placeholder="Nombre del equipo" value="${name}" />
    <input type="number" min="0" class="equipment-count" value="${count}" />
    <input type="number" min="0" class="equipment-power" value="${power}" />
    <button type="button" class="equipment-remove">×</button>
  `;

  const inputs = row.querySelectorAll("input");
  inputs.forEach((input) => {
    input.addEventListener("input", updateValues);
  });

  row.querySelector(".equipment-remove").addEventListener("click", () => {
    row.remove();
    updateValues();
  });

  equipmentList.appendChild(row);
  return row;
}

function formatNumber(value, digits = 2) {
  return Number(value.toFixed(digits)).toLocaleString("es-ES");
}

function calculateCosts(totalPowerKw, hours, autoPercent, price) {
  const manualKwhDay = totalPowerKw * hours;
  const autoKwhDay = totalPowerKw * hours * autoPercent;
  const savedKwhDay = Math.max(manualKwhDay - autoKwhDay, 0);
  const manualCostDay = manualKwhDay * price;
  const autoCostDay = autoKwhDay * price;
  const savedMoneyDay = savedKwhDay * price;
  return {
    manualKwhDay,
    autoKwhDay,
    savedKwhDay,
    manualCostDay,
    autoCostDay,
    savedMoneyDay,
  };
}

function setConnectionStatus(text, color) {
  connectionStatus.textContent = text;
  connectionStatus.style.color = color;
}

function setConnectionError(text) {
  const connectionError = document.getElementById("connectionError");
  connectionError.textContent = text;
}

function writeSerial(message) {
  if (!writer) {
    console.warn("No hay conexión serial, no se envía:", message);
    return;
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(message + "\n");
  writer.write(data).catch((err) => {
    console.error("Error escribiendo serial:", err);
  });
}

async function connectArduino() {
  if (!window.isSecureContext) {
    setConnectionStatus("NO SEGURO", "#f97316");
    setConnectionError(
      "Abre la página desde localhost o HTTPS. No funciona con file://.",
    );
    return;
  }
  if (!("serial" in navigator)) {
    setConnectionStatus("NO SOPORTADO", "#f97316");
    setConnectionError(
      "Usa Chrome o Edge y asegúrate de tener Web Serial habilitado.",
    );
    return;
  }
  try {
    setConnectionError("");
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    setConnectionStatus("CONECTADO", "#22c55e");
    connectBtn.textContent = "Desconectar Arduino";

    writer = port.writable.getWriter();
    reader = port.readable.getReader();

    listenSerial();
    sendModeAndTimeout();
  } catch (error) {
    console.error("Error al conectar Arduino:", error);
    if (
      error.name === "NotFoundError" ||
      error.message.includes("No port selected")
    ) {
      setConnectionStatus("DESCONECTADO", "#f87171");
      setConnectionError(
        "No seleccionaste un puerto. Vuelve a intentar y elige el Arduino.",
      );
    } else {
      setConnectionStatus("ERROR", "#f97316");
      setConnectionError(
        error.message || "No se pudo conectar con el Arduino.",
      );
    }
  }
}

async function disconnectArduino() {
  // Ask Arduino to go to APAGADO mode before closing connection
  try {
    writeSerial("MODE:APAGADO");
  } catch (e) {
    // ignore
  }

  if (reader) {
    await reader.cancel();
    reader.releaseLock();
    reader = null;
  }
  if (writer) {
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
  deviceIsOn = false;
  stopOnTimeTimer(true);
  connectionStatus.textContent = "DESCONECTADO";
  connectionStatus.style.color = "#f87171";
  connectBtn.textContent = "Conectar Arduino";
}

async function listenSerial() {
  const decoder = new TextDecoder();
  while (port && reader) {
    try {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      readBuffer += decoder.decode(value, { stream: true });
      const lines = readBuffer.split("\n");
      readBuffer = lines.pop();
      lines.forEach((line) => {
        const message = line.trim();
        if (!message) return;
        handleSerialMessage(message);
      });
    } catch (error) {
      console.error("Error leyendo serial:", error);
      break;
    }
  }
}

let lastTimeoutValue = 10;

function handleSerialMessage(message) {
  console.log(`📥 Recibido: ${message}`);
  if (message.startsWith("MODE:")) {
    const receivedMode = message.split(":")[1].trim();
    const newMode =
      receivedMode === "MANUAL"
        ? "MANUAL"
        : receivedMode === "APAGADO"
          ? "APAGADO"
          : "AUTOMÁTICO";
    setModeFromArduino(newMode, false);
    return;
  }
  if (message.startsWith("TIMEOUT:")) {
    const timeout = Number(message.split(":")[1].trim());
    if (!Number.isNaN(timeout) && timeout > 0) {
      lastTimeoutValue = timeout;
      console.log(`✅ Timeout confirmado en Arduino: ${timeout}s`);
    }
    return;
  }
  if (message.startsWith("STATE:")) {
    const state = message.split(":")[1].trim();
    const isOn = state === "ON";
    if (isOn !== deviceIsOn) {
      deviceIsOn = isOn;
      if (deviceIsOn) {
        startOnTimeTimer();
      } else {
        stopOnTimeTimer(true);
      }
    }
    return;
  }
}

function setModeFromArduino(newMode, updateArduino = true) {
  mode = newMode;

  offBtn.classList.toggle("active", mode === "APAGADO");
  autoBtn.classList.toggle("active", mode === "AUTOMÁTICO");
  manualBtn.classList.toggle("active", mode === "MANUAL");

  if (updateArduino) {
    sendModeAndTimeout();
  }
  updateValues();
}

function sendModeAndTimeout() {
  if (!writer) {
    console.warn("Arduino no conectado, no se envían comandos");
    return;
  }
  const timeout = Number(timeoutInput.value);
  console.log(`📤 Enviando: MODE:${mode}, TIMEOUT:${timeout}`);
  writeSerial(`MODE:${mode}`);
  writeSerial(`TIMEOUT:${timeout}`);
}

function formatDuration(totalSeconds) {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours} h${minutes > 0 ? ` ${minutes} min` : ""}`;
  }
  if (minutes > 0) {
    return `${minutes} min${seconds > 0 ? ` ${seconds} s` : ""}`;
  }
  return `${seconds} s`;
}

function updateValues() {
  const hours = Number(hoursInput.value);
  const autoPercent = Number(autoPercentInput.value) / 100;
  const price = Number(priceInput.value);
  const totalPowerW = getTotalPower();
  const totalPowerKw = totalPowerW / 1000;

  const costs = calculateCosts(totalPowerKw, hours, autoPercent, price);
  const savedPercent =
    costs.manualKwhDay > 0 ? (costs.savedKwhDay / costs.manualKwhDay) * 100 : 0;

  // Cálculos mensuales y anuales
  const savedMoneyMonth = costs.savedMoneyDay * 30;
  const savedMoneyYear = costs.savedMoneyDay * 365;

  currentMode.textContent = mode;
  savedEnergy.textContent = `${formatNumber(costs.savedKwhDay, 2)} kWh`;
  savedCost.textContent = `$${formatNumber(costs.savedMoneyDay, 2)}`;
  manualConsumption.textContent = `${formatNumber(costs.manualKwhDay, 2)} kWh`;
  autoConsumption.textContent = `${formatNumber(costs.autoKwhDay, 2)} kWh`;
  savingPercent.textContent = `${formatNumber(savedPercent, 1)}%`;
  savingPercentBar.style.width = `${Math.min(Math.round(savedPercent), 100)}%`;
  autoPercentValue.textContent = `${Math.round(autoPercent * 100)}%`;

  manualCostElement.textContent = `$${formatNumber(costs.manualCostDay, 2)}`;
  dailySavingsElement.textContent = `$${formatNumber(costs.savedMoneyDay, 2)}`;

  const salonMultiplier = Math.max(1, Number(salonMultiplierInput.value) || 1);
  const totalMonthSavings = savedMoneyMonth * salonMultiplier;
  const totalYearSavings = savedMoneyYear * salonMultiplier;

  salonMultiplierLabel.textContent = salonMultiplier.toString();
  totalSalonSavings.textContent = `$${formatNumber(totalMonthSavings, 2)}`;

  // Mostrar watts totales y ahorros mensuales/anuales (totales por salones)
  totalWatts.textContent = `${formatNumber(totalPowerW, 0)} W`;
  monthlySavings.textContent = `$${formatNumber(totalMonthSavings, 2)}`;
  yearlySavings.textContent = `$${formatNumber(totalYearSavings, 2)}`;
}

function loadStoredOnHours() {
  storedOnHoursSeconds = Number(localStorage.getItem(storedOnTimeKey)) || 0;
  storedOnHoursDisplay.textContent = formatDuration(storedOnHoursSeconds);
}

function updateStoredOnHoursDisplay() {
  const totalSeconds = storedOnHoursSeconds + currentSessionSeconds;
  storedOnHoursDisplay.textContent = formatDuration(totalSeconds);
  localStorage.setItem(storedOnTimeKey, totalSeconds.toString());
}

function startOnTimeTimer() {
  if (onTimeTimer) return;
  onTimeTimer = setInterval(() => {
    currentSessionSeconds += 1;
    updateStoredOnHoursDisplay();
  }, 1000);
}

function stopOnTimeTimer(save = true) {
  if (onTimeTimer) {
    clearInterval(onTimeTimer);
    onTimeTimer = null;
  }
  if (save) {
    storedOnHoursSeconds += currentSessionSeconds;
    localStorage.setItem(storedOnTimeKey, storedOnHoursSeconds.toString());
  }
  currentSessionSeconds = 0;
  updateStoredOnHoursDisplay();
}

function resetOnTime() {
  storedOnHoursSeconds = 0;
  currentSessionSeconds = 0;
  localStorage.setItem(storedOnTimeKey, "0");
  updateStoredOnHoursDisplay();
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("Web Serial UI DOM cargado");

  const manualBtn = document.getElementById("manualBtn");
  const autoBtn = document.getElementById("autoBtn");
  const connectBtn = document.getElementById("connectBtn");
  const hoursInput = document.getElementById("hours");
  const autoPercentInput = document.getElementById("autoPercent");
  const timeoutInput = document.getElementById("timeout");
  const priceInput = document.getElementById("price");

  offBtn.addEventListener("click", () => {
    setModeFromArduino("APAGADO");
  });

  manualBtn.addEventListener("click", () => {
    setModeFromArduino("MANUAL");
  });

  autoBtn.addEventListener("click", () => {
    setModeFromArduino("AUTOMÁTICO");
  });

  connectBtn.addEventListener("click", async () => {
    if (port) {
      await disconnectArduino();
    } else {
      await connectArduino();
    }
  });

  hoursInput.addEventListener("input", updateValues);
  autoPercentInput.addEventListener("input", updateValues);
  timeoutInput.addEventListener("input", () => {
    let valor = Number(timeoutInput.value);
    if (valor < 0) {
      timeoutInput.value = 0;
      valor = 0;
    }
    lastTimeoutValue = valor;
    updateValues();
    sendModeAndTimeout();
  });
  priceInput.addEventListener("input", updateValues);
  salonMultiplierInput.addEventListener("input", updateValues);
  addEquipmentBtn.addEventListener("click", () => createEquipmentRow());

  if (resetOnTimeBtn) {
    resetOnTimeBtn.addEventListener("click", () => {
      resetOnTime();
    });
  }

  const aireCount = document.getElementById("aireCount");
  const ledCount = document.getElementById("ledCount");
  const projectorCount = document.getElementById("projectorCount");
  const airePowerInput = document.getElementById("airePower");
  const ledPowerInput = document.getElementById("ledPower");
  const projectorPowerInput = document.getElementById("projectorPower");

  aireCount.addEventListener("input", updateValues);
  ledCount.addEventListener("input", updateValues);
  projectorCount.addEventListener("input", updateValues);
  airePowerInput.addEventListener("input", updateValues);
  ledPowerInput.addEventListener("input", updateValues);
  projectorPowerInput.addEventListener("input", updateValues);

  loadStoredOnHours();
  createEquipmentRow("PC", 1, 250);
  createEquipmentRow("Ventilador", 1, 60);
  updateValues();

  window.addEventListener("beforeunload", () => {
    const total = storedOnHoursSeconds + currentSessionSeconds;
    localStorage.setItem(storedOnTimeKey, total.toString());

    // Intento de apagar Arduino antes de cerrar la página (mejor esfuerzo)
    try {
      writeSerial("MODE:APAGADO");
    } catch (e) {}

    try {
      if (writer) {
        try {
          writer.releaseLock();
        } catch (e) {}
      }
      if (port) {
        try {
          port.close();
        } catch (e) {}
      }
    } catch (e) {}
  });
});
