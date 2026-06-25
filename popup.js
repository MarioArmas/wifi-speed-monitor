/**
 * Wifi Speed & Latency Monitor - Popup Script
 * Controla la interacción del dashboard, renderizado de gráficas y exportación.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elementos de la UI
  const statusRing = document.getElementById('status-ring');
  const statusValue = document.getElementById('status-value');
  const testLoader = document.getElementById('test-loader');
  const innerGauge = document.querySelector('.inner-gauge');
  
  const speedVal = document.getElementById('speed-val');
  const latencyVal = document.getElementById('latency-val');
  
  const avgSpeed = document.getElementById('avg-speed');
  const avgLatency = document.getElementById('avg-latency');
  const alertCountVal = document.getElementById('alert-count-val');
  
  const outageSection = document.getElementById('outage-section');
  const outageText = document.getElementById('outage-text');
  const lastOutageBanner = document.getElementById('last-outage-banner');
  const lastOutageText = document.getElementById('last-outage-text');
  
  const lastUpdate = document.getElementById('last-update');
  const btnTest = document.getElementById('btn-test');
  const btnExport = document.getElementById('btn-export');
  const btnOptions = document.getElementById('btn-options');
  const canvas = document.getElementById('history-chart');
  
  let outageIntervalId = null;

  // Cargar datos iniciales y renderizar
  updateUI();

  // Escuchar cambios en el almacenamiento para actualizar la UI en tiempo real
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      updateUI();
    }
  });

  // Botón: Iniciar medición manual
  btnTest.addEventListener('click', () => {
    // Activar estado visual de carga
    btnTest.disabled = true;
    btnExport.disabled = true;
    innerGauge.classList.add('testing');
    testLoader.classList.remove('hidden');
    statusValue.textContent = 'Midiendo...';
    statusValue.className = 'status-text text-muted';
    
    // Cambiar clase de animación del anillo a neutra
    statusRing.className = 'status-ring';
    statusRing.style.background = 'linear-gradient(135deg, #475569 0%, #64748b 100%)';
    statusRing.style.boxShadow = '0 0 15px rgba(100, 116, 139, 0.3)';

    // Enviar mensaje al Service Worker
    chrome.runtime.sendMessage({ action: 'run_manual_test' }, (response) => {
      // Desactivar estado visual de carga
      btnTest.disabled = false;
      btnExport.disabled = false;
      innerGauge.classList.remove('testing');
      testLoader.classList.add('hidden');
      
      // Limpiar estilo dinámico en línea para que rijan las clases de CSS
      statusRing.removeAttribute('style');

      if (response && response.success) {
        console.log('Medición manual completada:', response.result);
        updateUI();
      } else {
        console.error('Error en medición manual:', response ? response.error : 'Sin respuesta');
        alert('Error al realizar la medición: ' + (response ? response.error : 'El servicio en segundo plano no respondió.'));
        updateUI();
      }
    });
  });

  // Botón: Exportar historial a CSV
  btnExport.addEventListener('click', exportToCSV);

  // Botón: Abrir configuración
  btnOptions.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  /**
   * Obtiene la información de almacenamiento de Chrome y actualiza el Dashboard
   */
  async function updateUI() {
    const storage = await chrome.storage.local.get(['history', 'outageInfo', 'alertCount', 'settings']);
    const history = storage.history || [];
    const outageInfo = storage.outageInfo || { lastOutageTimestamp: 0, lastOutageDuration: 0, currentOutageStart: null };
    const alertCount = storage.alertCount || 0;
    
    // Limpiar intervalos previos de timer de caída
    if (outageIntervalId) {
      clearInterval(outageIntervalId);
      outageIntervalId = null;
    }

    // 1. Mostrar última medición si existe
    if (history.length > 0) {
      const latest = history[0];
      
      if (latest.isOnline) {
        speedVal.textContent = latest.speed.toFixed(1);
        latencyVal.textContent = latest.latency;
        
        statusValue.textContent = latest.status;
        setGaugeStatusStyle(latest.status);
      } else {
        speedVal.textContent = '0.0';
        latencyVal.textContent = '--';
        statusValue.textContent = 'Sin Red';
        setGaugeStatusStyle('Offline');
      }
      
      // Mostrar fecha/hora de última actualización
      const testTime = new Date(latest.timestamp);
      lastUpdate.textContent = `Actualizado: ${testTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } else {
      speedVal.textContent = '--.-';
      latencyVal.textContent = '--';
      statusValue.textContent = 'Sin Datos';
      setGaugeStatusStyle('Default');
      lastUpdate.textContent = 'Actualizado: Nunca';
    }

    // 2. Calcular promedios (excluyendo periodos Offline)
    const onlineHistory = history.filter(item => item.isOnline);
    if (onlineHistory.length > 0) {
      const totalSpeed = onlineHistory.reduce((sum, item) => sum + item.speed, 0);
      const totalLatency = onlineHistory.reduce((sum, item) => sum + item.latency, 0);
      
      avgSpeed.textContent = `${(totalSpeed / onlineHistory.length).toFixed(1)} Mbps`;
      avgLatency.textContent = `${Math.round(totalLatency / onlineHistory.length)} ms`;
    } else {
      avgSpeed.textContent = '-- Mbps';
      avgLatency.textContent = '-- ms';
    }

    // 3. Alertas acumuladas
    alertCountVal.textContent = alertCount;

    // 4. Mostrar Banners de Caídas (Outages)
    if (outageInfo.currentOutageStart !== null) {
      // Conexión actualmente caída
      outageSection.classList.remove('hidden');
      lastOutageBanner.classList.add('hidden');
      
      const updateOutageTimer = () => {
        const elapsedMs = Date.now() - outageInfo.currentOutageStart;
        outageText.textContent = `Sin conexión. Tiempo caído: ${formatDuration(elapsedMs)}`;
      };
      
      updateOutageTimer();
      outageIntervalId = setInterval(updateOutageTimer, 1000);
    } else {
      // Conexión activa: ocultar banner de caída activa
      outageSection.classList.add('hidden');
      
      // Mostrar banner de última caída si hay registros
      if (outageInfo.lastOutageTimestamp > 0) {
        lastOutageBanner.classList.remove('hidden');
        
        const elapsedSinceOutage = Date.now() - outageInfo.lastOutageTimestamp;
        const durationFormatted = formatDuration(outageInfo.lastOutageDuration);
        const timeAgoFormatted = formatTimeAgo(elapsedSinceOutage);
        
        lastOutageText.textContent = `Última caída: Hace ${timeAgoFormatted} (duró ${durationFormatted})`;
      } else {
        lastOutageBanner.classList.add('hidden');
      }
    }

    // 5. Dibujar la gráfica del historial
    drawChart(history);
  }

  /**
   * Cambia las clases del anillo de estado en base a la calidad
   */
  function setGaugeStatusStyle(status) {
    statusRing.className = 'status-ring';
    statusValue.className = 'status-text';
    
    switch (status) {
      case 'Excelente':
        statusRing.classList.add('pulse-excellent');
        statusValue.classList.add('text-excellent');
        break;
      case 'Buena':
        statusRing.classList.add('pulse-good');
        statusValue.classList.add('text-good');
        break;
      case 'Regular':
        statusRing.classList.add('pulse-regular');
        statusValue.classList.add('text-regular');
        break;
      case 'Mala':
      case 'Offline':
        statusRing.classList.add('pulse-bad');
        statusValue.classList.add('text-bad');
        break;
      default:
        statusRing.style.background = 'var(--border-color)';
        statusValue.classList.add('text-muted');
        break;
    }
  }

  /**
   * Renderiza el gráfico del historial en el canvas
   */
  function drawChart(history) {
    const ctx = canvas.getContext('2d');
    
    // Obtener dimensiones reales del contenedor
    const rect = canvas.parentNode.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    const width = rect.width;
    const height = rect.height;
    
    // Limpiar canvas
    ctx.clearRect(0, 0, width, height);

    // Obtener las últimas 15 mediciones y ordenarlas cronológicamente (de vieja a nueva)
    const chartData = history.slice(0, 15).reverse();
    
    if (chartData.length < 2) {
      ctx.font = '11px Outfit, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.fillText('Historial insuficiente para graficar', width / 2, height / 2 + 4);
      return;
    }

    // Encontrar velocidad máxima para escalar la gráfica (con un mínimo de 20 Mbps)
    const maxSpeed = Math.max(...chartData.map(d => d.speed), 20) * 1.15;

    // Márgenes del gráfico
    const paddingLeft = 24;
    const paddingRight = 10;
    const paddingTop = 12;
    const paddingBottom = 16;
    
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    // Dibujar líneas de guía horizontales (Grid)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    
    const gridLines = 3;
    ctx.font = '8px Outfit, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    
    for (let i = 0; i <= gridLines; i++) {
      const yVal = (maxSpeed / gridLines) * i;
      const yPos = height - paddingBottom - (chartHeight / gridLines) * i;
      
      ctx.beginPath();
      ctx.moveTo(paddingLeft, yPos);
      ctx.lineTo(width - paddingRight, yPos);
      ctx.stroke();
      
      // Etiqueta del eje Y
      ctx.fillText(`${Math.round(yVal)}`, paddingLeft - 5, yPos + 3);
    }
    
    ctx.setLineDash([]); // Quitar línea punteada

    // Calcular posiciones de los puntos
    const points = chartData.map((d, index) => {
      const x = paddingLeft + (index / (chartData.length - 1)) * chartWidth;
      const y = height - paddingBottom - (d.speed / maxSpeed) * chartHeight;
      return { x, y, speed: d.speed, isOnline: d.isOnline, alert: d.alertTriggered };
    });

    // 1. Dibujar área rellena bajo la línea con degradado
    const areaGrad = ctx.createLinearGradient(0, paddingTop, 0, height - paddingBottom);
    areaGrad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
    areaGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, height - paddingBottom);
    
    // Trazar curvas suaves (Bezier)
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        ctx.lineTo(points[i].x, points[i].y);
      } else {
        const prev = points[i - 1];
        const curr = points[i];
        const cpX1 = prev.x + (curr.x - prev.x) / 2;
        const cpY1 = prev.y;
        const cpX2 = prev.x + (curr.x - prev.x) / 2;
        const cpY2 = curr.y;
        ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, curr.x, curr.y);
      }
    }
    ctx.lineTo(points[points.length - 1].x, height - paddingBottom);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // 2. Dibujar la línea de velocidad
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        ctx.moveTo(points[i].x, points[i].y);
      } else {
        const prev = points[i - 1];
        const curr = points[i];
        const cpX1 = prev.x + (curr.x - prev.x) / 2;
        const cpY1 = prev.y;
        const cpX2 = prev.x + (curr.x - prev.x) / 2;
        const cpY2 = curr.y;
        ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, curr.x, curr.y);
      }
    }
    ctx.stroke();

    // 3. Dibujar puntos de medición individuales
    points.forEach((pt) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5, 0, 2 * Math.PI);
      
      if (!pt.isOnline) {
        ctx.fillStyle = '#ef4444'; // Rojo si está desconectado
        ctx.strokeStyle = '#0b0f19';
        ctx.lineWidth = 1;
      } else if (pt.alert) {
        ctx.fillStyle = '#fb7185'; // Rosa/Rojo si disparó alerta
        ctx.strokeStyle = '#0b0f19';
        ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = '#ffffff'; // Blanco por defecto
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1.5;
      }
      
      ctx.fill();
      ctx.stroke();
    });

    // Dibujar etiquetas X en los extremos (hora del primer y último dato graficado)
    ctx.font = '8px Outfit, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    
    const firstTime = new Date(chartData[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(firstTime, paddingLeft, height - 4);
    
    ctx.textAlign = 'right';
    const lastTime = new Date(chartData[chartData.length - 1].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(lastTime, width - paddingRight, height - 4);
  }

  /**
   * Genera y descarga un archivo CSV con el historial completo
   */
  async function exportToCSV() {
    const storage = await chrome.storage.local.get('history');
    const history = storage.history || [];
    
    if (history.length === 0) {
      alert('No hay mediciones en el historial para exportar.');
      return;
    }

    // Cabecera del CSV
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Fecha y Hora,Velocidad (Mbps),Latencia (ms),Estado,Alerta Disparada,Online,Error\n';

    // Rellenar filas
    history.forEach((row) => {
      const dateStr = new Date(row.timestamp).toLocaleString();
      const speed = row.speed.toFixed(2);
      const latency = row.latency;
      const status = row.status;
      const alert = row.alertTriggered ? 'SI' : 'NO';
      const online = row.isOnline ? 'SI' : 'NO';
      const error = row.error ? `"${row.error.replace(/"/g, '""')}"` : '';

      csvContent += `${dateStr},${speed},${latency},${status},${alert},${online},${error}\n`;
    });

    // Crear link de descarga invisible y activarlo
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    
    // Dar un nombre formateado al archivo
    const now = new Date();
    const timestampStr = now.toISOString().slice(0, 10) + '_' + now.toTimeString().slice(0, 8).replace(/:/g, '-');
    
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `wifi_speed_history_${timestampStr}.csv`);
    document.body.appendChild(link);
    
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Formatea milisegundos a una cadena corta legible ("4m 20s" o "15s")
   */
  function formatDuration(ms) {
    const sec = Math.floor((ms / 1000) % 60);
    const min = Math.floor((ms / (1000 * 60)) % 60);
    const hr = Math.floor((ms / (1000 * 60 * 60)));
    
    const parts = [];
    if (hr > 0) parts.push(`${hr}h`);
    if (min > 0) parts.push(`${min}m`);
    if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
    
    return parts.join(' ');
  }

  /**
   * Formatea el tiempo transcurrido de forma aproximada ("3m", "2h", "1d")
   */
  function formatTimeAgo(ms) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    
    const days = Math.floor(hr / 24);
    return `${days}d`;
  }
});
