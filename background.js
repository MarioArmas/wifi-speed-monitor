/**
 * Wifi Speed & Latency Monitor - Background Service Worker
 * Desarrollado para monitorear periódicamente la calidad de la conexión a Internet.
 */

// Configuración de constantes y valores por defecto
const DEFAULT_SETTINGS = {
  minSpeed: 15,      // Mbps mínimos para alertar
  maxLatency: 80,    // Latencia máxima (ms) para alertar
  interval: 15,      // Intervalo de monitoreo por defecto (minutos)
};

const LATENCY_ENDPOINT = 'https://cloudflare.com/cdn-cgi/trace';
const SPEED_ENDPOINT = 'https://speed.cloudflare.com/__down?bytes=500000'; // 500 KB

// Al instalarse la extensión, inicializa los valores y configura la alarma
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extensión instalada. Inicializando almacenamiento...');
  
  const storage = await chrome.storage.local.get(['settings', 'history', 'outageInfo', 'alertCount']);
  
  if (!storage.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  
  if (!storage.history) {
    await chrome.storage.local.set({ history: [] });
  }
  
  if (!storage.outageInfo) {
    await chrome.storage.local.set({
      outageInfo: {
        lastOutageTimestamp: 0,
        lastOutageDuration: 0,
        currentOutageStart: null
      }
    });
  }
  
  if (storage.alertCount === undefined) {
    await chrome.storage.local.set({ alertCount: 0 });
  }

  // Establecer la alarma inicial
  const interval = storage.settings ? storage.settings.interval : DEFAULT_SETTINGS.interval;
  setupAlarm(interval);
});

// Escuchar cambios en el almacenamiento para actualizar la alarma si cambia el intervalo
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    const newSettings = changes.settings.newValue;
    const oldSettings = changes.settings.oldValue;
    if (!oldSettings || newSettings.interval !== oldSettings.interval) {
      console.log(`Intervalo cambiado a ${newSettings.interval} minutos. Reconfigurando alarma...`);
      setupAlarm(newSettings.interval);
    }
  }
});

// Escucha las activaciones de la alarma
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'speed-check-alarm') {
    console.log('Alarma speed-check-alarm activada. Iniciando medición automática...');
    runConnectionTest();
  }
});

// Escucha mensajes desde el Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'run_manual_test') {
    console.log('Mensaje recibido: Iniciando medición manual...');
    runConnectionTest()
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Mantiene el canal abierto para respuesta asíncrona
  }
});

/**
 * Configura la alarma de Chrome para la medición periódica
 * @param {number} intervalMinutes - Intervalo en minutos
 */
function setupAlarm(intervalMinutes) {
  chrome.alarms.clear('speed-check-alarm', () => {
    // Chrome restringe las alarmas a un mínimo de 1 minuto en producción
    const period = Math.max(1, intervalMinutes);
    chrome.alarms.create('speed-check-alarm', {
      delayInMinutes: period,
      periodInMinutes: period
    });
    console.log(`Alarma configurada para ejecutarse cada ${period} minutos.`);
  });
}

/**
 * Determina la calidad del estado de la conexión según métricas
 * @param {number} speed - Velocidad en Mbps
 * @param {number} latency - Latencia en ms
 * @returns {string} Estado (Excelente, Buena, Regular, Mala)
 */
function getConnectionStatus(speed, latency) {
  if (speed >= 25 && latency <= 30) return 'Excelente';
  if (speed >= 15 && latency <= 60) return 'Buena';
  if (speed >= 5 && latency <= 100) return 'Regular';
  return 'Mala';
}

/**
 * Ejecuta el test de latencia midiendo el tiempo de respuesta RTT (Round Trip Time)
 * Realiza 3 intentos para obtener una estimación estable (mínimo RTT)
 */
async function measureLatency() {
  let minLatency = Infinity;
  
  for (let i = 0; i < 3; i++) {
    const startTime = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      
      const response = await fetch(`${LATENCY_ENDPOINT}?cb=${Date.now()}_${i}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const endTime = performance.now();
        const duration = endTime - startTime;
        if (duration < minLatency) {
          minLatency = duration;
        }
      }
    } catch (e) {
      console.warn(`Intento de latencia ${i + 1} fallido:`, e);
    }
  }
  
  if (minLatency === Infinity) {
    throw new Error('No se pudo establecer conexión con el servidor de latencia.');
  }
  
  return Math.round(minLatency);
}

/**
 * Mide la velocidad de descarga descargando un fragmento de 500 KB
 */
async function measureDownloadSpeed() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 segundos de timeout
  
  const startTime = performance.now();
  try {
    const response = await fetch(`${SPEED_ENDPOINT}&cb=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    
    if (!response.ok) {
      throw new Error('Respuesta del servidor de velocidad incorrecta');
    }
    
    const buffer = await response.arrayBuffer();
    const endTime = performance.now();
    clearTimeout(timeoutId);
    
    const durationSec = (endTime - startTime) / 1000;
    if (durationSec <= 0) return 0;
    
    const sizeInBits = buffer.byteLength * 8;
    const speedMbps = sizeInBits / (durationSec * 1024 * 1024); // Mbps
    
    return parseFloat(speedMbps.toFixed(2));
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Ejecuta el test completo de conexión (Latencia y Velocidad)
 * Registra los resultados y maneja las alarmas / transiciones online-offline
 */
async function runConnectionTest() {
  console.log('Iniciando medición de red...');
  const timestamp = Date.now();
  
  let speed = 0;
  let latency = 0;
  let isOnline = true;
  let errorMsg = null;

  try {
    // 1. Medir latencia
    latency = await measureLatency();
    
    // 2. Medir velocidad de descarga si hay latencia exitosa
    speed = await measureDownloadSpeed();
  } catch (error) {
    isOnline = false;
    errorMsg = error.message;
    console.error('Error durante la medición de conexión:', error);
  }

  // Leer estado actual
  const storage = await chrome.storage.local.get(['settings', 'history', 'outageInfo', 'alertCount']);
  const settings = storage.settings || DEFAULT_SETTINGS;
  const history = storage.history || [];
  const outageInfo = storage.outageInfo || { lastOutageTimestamp: 0, lastOutageDuration: 0, currentOutageStart: null };
  let alertCount = storage.alertCount || 0;

  let status = 'Mala';
  let alertTriggered = false;

  if (isOnline) {
    // Conexión activa: determinar calidad y procesar transiciones de caídas
    status = getConnectionStatus(speed, latency);
    
    // Si veníamos de estar desconectados, cerrar el outage actual
    if (outageInfo.currentOutageStart !== null) {
      const outageDuration = timestamp - outageInfo.currentOutageStart;
      outageInfo.lastOutageTimestamp = outageInfo.currentOutageStart;
      outageInfo.lastOutageDuration = outageDuration;
      outageInfo.currentOutageStart = null;
      
      // Notificar al usuario que la conexión ha retornado
      showNotification(
        'connection-restored',
        'Conexión Restablecida',
        `El servicio de Internet ha retornado. Estuvo caído durante ${formatOutageDuration(outageDuration)}.`
      );
    }

    // Verificar si se infringen los umbrales configurados
    const speedViolated = speed < settings.minSpeed;
    const latencyViolated = latency > settings.maxLatency;

    if (speedViolated || latencyViolated) {
      alertTriggered = true;
      alertCount++;
      
      // Armar el mensaje de alerta detallado
      let alertReason = [];
      if (speedViolated) alertReason.push(`Velocidad de ${speed} Mbps (Umbral: ${settings.minSpeed} Mbps)`);
      if (latencyViolated) alertReason.push(`Latencia de ${latency} ms (Límite: ${settings.maxLatency} ms)`);
      
      showNotification(
        'speed-alert-' + timestamp,
        '¡Alerta de Rendimiento de Internet!',
        `La calidad de la red es deficiente: ${alertReason.join(' y ')}.`
      );
    }
  } else {
    // Sin conexión: Registrar el inicio de la caída si no estaba ya registrado
    status = 'Mala';
    if (outageInfo.currentOutageStart === null) {
      outageInfo.currentOutageStart = timestamp;
      
      showNotification(
        'connection-lost',
        'Conexión a Internet Perdida',
        'Se ha detectado una desconexión total. Comenzando el registro de la caída.'
      );
    }
  }

  // Construir registro de medición
  const measurement = {
    timestamp,
    speed: isOnline ? speed : 0,
    latency: isOnline ? latency : 0,
    status,
    alertTriggered,
    isOnline,
    error: errorMsg
  };

  // Agregar al historial local de las últimas 100 mediciones
  history.unshift(measurement);
  if (history.length > 100) {
    history.pop();
  }

  // Guardar datos actualizados en el almacenamiento local
  await chrome.storage.local.set({
    history,
    outageInfo,
    alertCount
  });

  console.log('Medición guardada con éxito:', measurement);
  return measurement;
}

/**
 * Muestra una notificación push del navegador
 * @param {string} id - Identificador de la notificación
 * @param {string} title - Título de la notificación
 * @param {string} message - Mensaje detallado
 */
function showNotification(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: title,
    message: message,
    priority: 2 // Alta prioridad
  });
}

/**
 * Convierte milisegundos a una cadena legible de tiempo
 * @param {number} ms - Duración en milisegundos
 * @returns {string} Tiempo formateado (ej. "3m 45s", "12s")
 */
function formatOutageDuration(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)));

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}
