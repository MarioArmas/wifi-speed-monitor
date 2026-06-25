/**
 * Wifi Speed & Latency Monitor - Options Script
 * Maneja la lectura y guardado de configuraciones, y el vaciado del historial.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elementos del formulario
  const form = document.getElementById('settings-form');
  const minSpeedInput = document.getElementById('min-speed');
  const speedDisplay = document.getElementById('speed-display');
  const maxLatencyInput = document.getElementById('max-latency');
  const latencyDisplay = document.getElementById('latency-display');
  const intervalSelect = document.getElementById('interval');
  
  // Botones y Toast
  const btnResetHistory = document.getElementById('btn-reset-history');
  const toast = document.getElementById('toast');
  const toastText = toast.querySelector('span');

  // Valores predeterminados
  const DEFAULT_SETTINGS = {
    minSpeed: 15,
    maxLatency: 80,
    interval: 15
  };

  // 1. Cargar configuraciones guardadas
  chrome.storage.local.get('settings', (storage) => {
    const settings = storage.settings || DEFAULT_SETTINGS;
    
    // Rellenar controles
    minSpeedInput.value = settings.minSpeed;
    speedDisplay.textContent = settings.minSpeed;
    
    maxLatencyInput.value = settings.maxLatency;
    latencyDisplay.textContent = settings.maxLatency;
    
    intervalSelect.value = settings.interval;
  });

  // 2. Escuchar deslizamientos (inputs) para actualizar los textos informativos
  minSpeedInput.addEventListener('input', (e) => {
    speedDisplay.textContent = e.target.value;
  });

  maxLatencyInput.addEventListener('input', (e) => {
    latencyDisplay.textContent = e.target.value;
  });

  // 3. Guardar configuraciones al enviar el formulario
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const settings = {
      minSpeed: parseInt(minSpeedInput.value, 10),
      maxLatency: parseInt(maxLatencyInput.value, 10),
      interval: parseInt(intervalSelect.value, 10)
    };

    chrome.storage.local.set({ settings }, () => {
      console.log('Configuraciones guardadas:', settings);
      showToast('¡Configuración guardada correctamente!', '#10b981');
    });
  });

  // 4. Limpiar historial y contadores de alertas (Zona Peligrosa)
  btnResetHistory.addEventListener('click', () => {
    const confirmed = confirm('¿Estás seguro de que deseas vaciar el historial de mediciones y reiniciar el contador de alertas? Esta acción borrará todas las estadísticas actuales.');
    
    if (confirmed) {
      chrome.storage.local.set({
        history: [],
        alertCount: 0,
        outageInfo: {
          lastOutageTimestamp: 0,
          lastOutageDuration: 0,
          currentOutageStart: null
        }
      }, () => {
        console.log('Historial y alertas borrados.');
        showToast('¡Historial y contador restablecidos!', '#ef4444');
      });
    }
  });

  /**
   * Muestra un toast emergente con un mensaje
   * @param {string} message - Texto a mostrar
   * @param {string} bgColor - Color de fondo del toast en formato hexadecimal
   */
  function showToast(message, bgColor) {
    toastText.textContent = message;
    toast.style.backgroundColor = bgColor;
    toast.classList.remove('hidden');
    
    // Ocultar automáticamente tras 3 segundos
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }
});
