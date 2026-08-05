/* ==========================================================================
   ULTRA FIBRA - MAIN APPLICATION CONTROLLER (FLYER INTEGRATED)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initNavbarScroll();
  initFaqAccordion();
  initCoverageChecker();
  initPlanButtons();
});

function initNavbarScroll() {
  const navbar = document.querySelector('.navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });
}

function initFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const questionBtn = item.querySelector('.faq-question');
    questionBtn.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      faqItems.forEach(other => other.classList.remove('active'));
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
}

function initCoverageChecker() {
  const form = document.getElementById('coverageForm');
  const input = document.getElementById('cepInput');
  const resultDiv = document.getElementById('coverageResult');

  if (form && input && resultDiv) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;

      resultDiv.innerHTML = `<span style="color: var(--brand-orange);"><i class="ri-loader-4-line spin"></i> Consultando viabilidade técnica em ${val}...</span>`;

      setTimeout(() => {
        resultDiv.innerHTML = `
          <div style="padding: 16px; background: rgba(37, 211, 102, 0.15); border: 2px solid var(--whatsapp-green); border-radius: 14px; color: #FFF; margin-top: 12px;">
            ✅ <strong>Excelente notícia!</strong> Temos cobertura Ultra Fibra de alta velocidade no seu endereço (CEP: ${val}).
            <button class="btn btn-whatsapp" style="margin-top: 12px; width: 100%;" onclick="openPlanWhatsApp('Consulta de CEP: ${val}')">
              <i class="ri-whatsapp-line"></i> Agendar Instalação no WhatsApp (9 9118-3681)
            </button>
          </div>
        `;
      }, 1000);
    });
  }
}

function initPlanButtons() {
  const buttons = document.querySelectorAll('.btn-plan-subscribe');
  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const planName = e.currentTarget.getAttribute('data-plan');
      const planPrice = e.currentTarget.getAttribute('data-price');
      openPlanWhatsApp(`Olá! Vi no site da Ultra Fibra e quero agendar a instalação do plano ${planName} por ${planPrice}/mês.`);
    });
  });
}

function openPlanWhatsApp(msg) {
  const text = encodeURIComponent(msg);
  window.open(`https://wa.me/55991183681?text=${text}`, '_blank');
}
