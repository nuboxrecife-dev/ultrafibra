/* ==========================================================================
   ULTRA FIBRA - SPEED TEST SIMULATOR WIDGET
   ========================================================================== */

class SpeedTestWidget {
  constructor() {
    this.testing = false;
    this.gaugeVal = document.getElementById('speedValue');
    this.gaugePing = document.getElementById('speedPing');
    this.startBtn = document.getElementById('startSpeedTestBtn');

    if (this.startBtn) {
      this.startBtn.addEventListener('click', () => this.runTest());
    }
  }

  async runTest() {
    if (this.testing) return;
    this.testing = true;
    this.startBtn.disabled = true;
    this.startBtn.innerHTML = `<i class="ri-loader-4-line spin"></i> Testando Velocidade...`;

    // Simulate Ping
    this.gaugePing.innerText = 'Ping: -- ms';
    await this.sleep(600);
    const simulatedPing = Math.floor(Math.random() * 4) + 2; // 2-5ms (Ultra low fiber ping)
    this.gaugePing.innerText = `Ping: ${simulatedPing} ms (Ultra Baixa Latência)`;

    // Simulate Speed Gauge Upward Count
    const targetSpeed = 650; // Ultra Fibra speed simulation target
    let currentSpeed = 0;

    const interval = setInterval(() => {
      currentSpeed += Math.floor(Math.random() * 40) + 20;
      if (currentSpeed >= targetSpeed) {
        currentSpeed = targetSpeed;
        clearInterval(interval);
        this.finishTest(simulatedPing, targetSpeed);
      }
      this.gaugeVal.innerText = currentSpeed;
    }, 50);
  }

  finishTest(ping, speed) {
    this.testing = false;
    this.startBtn.disabled = false;
    this.startBtn.innerHTML = `<i class="ri-refresh-line"></i> Testar Novamente`;
    
    // Trigger notification
    const resultBox = document.getElementById('speedTestResult');
    if (resultBox) {
      resultBox.innerHTML = `
        <div style="margin-top: 16px; padding: 12px; background: rgba(0,242,254,0.1); border: 1px solid var(--cyan); border-radius: 12px; text-align: center;">
          🚀 <strong>Velocidade Excelente!</strong> Sua conexão atingiu <strong>${speed} Mbps</strong> com ping ultra-baixo de <strong>${ping}ms</strong>.
        </div>
      `;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SpeedTestWidget();
});
