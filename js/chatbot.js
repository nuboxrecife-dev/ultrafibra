/* ==========================================================================
   ULTRA FIBRA - DIALOG ENGINE FOR ULTRA BOT
   ========================================================================== */

class UltraBot {
  constructor() {
    this.isOpen = false;
    this.step = 'INITIAL'; // INITIAL, AWAITING_CPF, AWAITING_PROBLEM, HUMAN_HANDOVER
    this.userCpf = '';
    
    this.loadConfig();
    this.initDOM();
    this.bindEvents();
  }

  loadConfig() {
    const DEFAULT_CONFIG = {
      whatsappNumber: '55991183681',
      welcomeMessage: 'Olá! 👋 Sou o <strong>Ultra Bot</strong>. Por favor, escolha uma das opções abaixo para iniciarmos seu atendimento:',
      invoices: {
        '12345678900': {
          titular: 'João da Silva',
          cpf: '123.456.789-00',
          plano: 'Ultra Fibra 650 Megas Destaque + TV',
          vencimento: '10/08/2026',
          valor: 'R$ 99,90'
        },
        '98765432100': {
          titular: 'Maria de Souza',
          cpf: '987.654.321-00',
          plano: 'Ultra Fibra 450 Megas',
          vencimento: '15/08/2026',
          valor: 'R$ 85,00'
        }
      }
    };

    const stored = localStorage.getItem('ultra_bot_config');
    if (stored) {
      this.config = JSON.parse(stored);
    } else {
      this.config = DEFAULT_CONFIG;
      localStorage.setItem('ultra_bot_config', JSON.stringify(DEFAULT_CONFIG));
    }

    this.whatsappNumber = this.config.whatsappNumber;
  }

  initDOM() {
    this.triggerBtn = document.getElementById('chatbotTrigger');
    this.chatWindow = document.getElementById('chatWindow');
    this.closeBtn = document.getElementById('chatClose');
    this.messagesContainer = document.getElementById('chatMessages');
    this.chatInput = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSend');
    this.invoiceModal = document.getElementById('invoiceModal');
    this.invoiceModalClose = document.getElementById('invoiceModalClose');
  }

  bindEvents() {
    if (this.triggerBtn) {
      this.triggerBtn.addEventListener('click', () => this.toggleChat());
    }
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.toggleChat(false));
    }
    if (this.sendBtn) {
      this.sendBtn.addEventListener('click', () => this.handleUserSubmit());
    }
    if (this.chatInput) {
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleUserSubmit();
      });
    }
    if (this.invoiceModalClose) {
      this.invoiceModalClose.addEventListener('click', () => {
        this.invoiceModal.classList.remove('active');
      });
    }
  }

  toggleChat(forceState) {
    this.isOpen = forceState !== undefined ? forceState : !this.isOpen;
    if (this.isOpen) {
      this.chatWindow.classList.add('active');
      if (this.messagesContainer.children.length === 0) {
        this.startWelcomeFlow();
      }
    } else {
      this.chatWindow.classList.remove('active');
    }
  }

  async startWelcomeFlow() {
    this.loadConfig();
    this.step = 'INITIAL';
    this.messagesContainer.innerHTML = '';
    
    await this.showTyping(600);
    this.addBotMessage(`${this.config.welcomeMessage}`, [
      { text: '1 - Assinar um Plano', action: () => this.selectOption1() },
      { text: '2 - Segunda Via de Fatura', action: () => this.selectOption2() },
      { text: '3 - Suporte Técnico', action: () => this.selectOption3() }
    ]);
  }

  // --- FLOW 1: ASSINAR PLANO ---
  async selectOption1() {
    this.addUserMessage("1 - Assinar um Plano");
    await this.showTyping(1000);
    
    this.addBotMessage(`Nossos planos de Internet Fibra disponíveis são:<br><br>
    ⚡ <strong>350 Megas</strong> - R$ 70,00/mês<br>
    ⚡ <strong>450 Megas</strong> - R$ 85,00/mês (Canais, Filmes e Séries)<br>
    ⚡ <strong>650 Megas</strong> - R$ 99,90/mês (★ Plano Destaque + Canais, Filmes e Séries)<br><br>
    🤖 <em>Estou transferindo seu atendimento para um atendente humano finalizar sua assinatura. Por favor, aguarde um instante...</em>`);

    this.step = 'HUMAN_HANDOVER';
    this.chatInput.placeholder = "Atendimento humano em andamento...";
    this.chatInput.disabled = true;
  }

  // --- FLOW 2: SEGUNDA VIA DE FATURA ---
  async selectOption2() {
    this.addUserMessage("2 - Segunda Via de Fatura");
    await this.showTyping(800);
    
    this.step = 'AWAITING_CPF';
    this.addBotMessage(`Por favor, <strong>digite o seu CPF ou CNPJ</strong> cadastrado para localizarmos sua fatura:`);
    this.chatInput.placeholder = "Digite o CPF (ex: 12345678900)";
  }

  // --- FLOW 3: SUPORTE TÉCNICO ---
  async selectOption3() {
    this.addUserMessage("3 - Suporte Técnico");
    await this.showTyping(800);
    
    this.step = 'AWAITING_PROBLEM';
    this.addBotMessage(`Por favor, descreva brevemente qual o problema ou lentidão que você está enfrentando na sua conexão:`);
    this.chatInput.placeholder = "Descreva o seu problema aqui...";
  }

  // --- MAIN INPUT SUBMISSION HANDLER ---
  async handleUserSubmit() {
    const text = this.chatInput.value.trim();
    if (!text) return;

    // Direct numeric shortcuts from welcome screen
    if (this.step === 'INITIAL') {
      this.chatInput.value = '';
      if (text === '1') {
        this.selectOption1();
      } else if (text === '2') {
        this.selectOption2();
      } else if (text === '3') {
        this.selectOption3();
      } else {
        this.addUserMessage(text);
        await this.showTyping(500);
        this.addBotMessage("Opção inválida. Digite 1, 2 ou 3 para prosseguir.");
      }
      return;
    }

    this.addUserMessage(text);
    this.chatInput.value = '';

    if (this.step === 'AWAITING_CPF') {
      await this.processCpfInvoice(text);
    } else if (this.step === 'AWAITING_PROBLEM') {
      await this.processSupportProblem(text);
    }
  }

  // --- PROCESS CPF INPUT FOR INVOICE ---
  async processCpfInvoice(cpfInput) {
    const cleanCpf = cpfInput.replace(/\D/g, '');
    if (cleanCpf.length < 11) {
      await this.showTyping(500);
      this.addBotMessage(`⚠️ CPF/CNPJ inválido. Digite os 11 dígitos do CPF (ou 14 do CNPJ):`);
      return;
    }

    this.userCpf = cleanCpf;
    await this.showTyping(1000);
    
    this.loadConfig();
    const invoice = this.config.invoices[cleanCpf];

    if (invoice) {
      this.addBotMessage(`✅ Fatura encontrada com sucesso!`);
      this.renderInvoiceCard({
        titular: invoice.titular,
        cpf: invoice.cpf,
        plano: invoice.plano,
        vencimento: invoice.vencimento,
        valor: invoice.valor,
        pixCode: '00020126580014BR.GOV.BCB.PIX013612345678-90ab-cdef-1234-567890abcdef520400005303986540599.905802BR5920ULTRA FIBRA TELECOM6009SAO PAULO62070503***6304E8A9'
      });
      
      await this.showTyping(1000);
      this.addBotMessage(`Deseja realizar mais alguma operação?`, [
        { text: '🏠 Voltar para o Menu Principal', action: () => this.startWelcomeFlow() },
        { text: '👤 Falar com Atendente no WhatsApp', action: () => this.redirectToWhatsApp('Preciso de atendimento para minha fatura.') }
      ]);
    } else {
      this.addBotMessage(`❌ Nenhuma fatura em aberto cadastrada para o documento <strong>${cpfInput}</strong>.`, [
        { text: '🔄 Tentar outro CPF', action: () => this.promptCpfForInvoice() },
        { text: '👤 Falar com Atendente', action: () => this.redirectToWhatsApp(`Preciso de auxílio para localizar a fatura vinculada ao CPF ${cpfInput}.`) }
      ]);
    }
  }

  // --- PROCESS SUPPORT PROBLEM ENTRY ---
  async processSupportProblem(problemText) {
    await this.showTyping(1000);
    this.addBotMessage(`🤖 <em>Registrei sua ocorrência: "${problemText}". Estou transferindo você agora mesmo para o suporte especializado humano analisar sua conexão. Por favor, aguarde...</em>`);
    
    this.step = 'HUMAN_HANDOVER';
    this.chatInput.placeholder = "Atendimento humano em andamento...";
    this.chatInput.disabled = true;
  }

  // --- RENDERING WIDGET CARDS & MODALS ---
  renderInvoiceCard(data) {
    const cardEl = document.createElement('div');
    cardEl.className = 'invoice-chat-card';
    cardEl.innerHTML = `
      <div class="invoice-header-info">
        <div>
          <div style="font-weight: 700; font-size: 0.95rem; color: #FFF;">${data.plano}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">CPF: ${data.cpf}</div>
        </div>
        <span class="invoice-status-badge">EM ABERTO</span>
      </div>
      <div class="invoice-details-row">
        <span>Vencimento: <strong>${data.vencimento}</strong></span>
        <span class="invoice-amount">${data.valor}</span>
      </div>
      <button class="btn-copy-pix" id="copyPixBtn">
        <i class="ri-file-copy-line"></i> Copiar Código PIX
      </button>
      <button class="btn-view-pdf" id="viewPdfBtn">
        <i class="ri-printer-line"></i> Visualizar Fatura / Imprimir
      </button>
    `;

    this.messagesContainer.appendChild(cardEl);
    this.scrollToBottom();

    const copyBtn = cardEl.querySelector('#copyPixBtn');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(data.pixCode);
      copyBtn.innerHTML = `<i class="ri-check-line"></i> PIX Copiado!`;
      setTimeout(() => {
        copyBtn.innerHTML = `<i class="ri-file-copy-line"></i> Copiar Código PIX`;
      }, 3000);
    });

    const pdfBtn = cardEl.querySelector('#viewPdfBtn');
    pdfBtn.addEventListener('click', () => {
      this.openInvoiceModal(data);
    });
  }

  openInvoiceModal(data) {
    const paper = document.getElementById('invoicePaperContent');
    paper.innerHTML = `
      <div class="invoice-paper-header">
        <div>
          <div class="invoice-logo-title">ULTRA FIBRA</div>
          <div style="font-size: 0.85rem; color: #64748B;">Navegue com Ultra Velocidade. Seja Livre.</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 1.1rem; font-weight: 900; color: #FF6600;">2ª VIA DE FATURA</div>
          <div style="font-size: 0.85rem; color: #64748B;">Nº Documento: #84920</div>
        </div>
      </div>

      <div class="invoice-paper-grid">
        <div class="invoice-paper-box">
          <strong>DADOS DO CLIENTE</strong><br>
          Nome: ${data.titular}<br>
          CPF/CNPJ: ${data.cpf}<br>
          Contato WhatsApp: (99) 9118-3681
        </div>
        <div class="invoice-paper-box">
          <strong>RESUMO DA COBRANÇA</strong><br>
          Plano: ${data.plano}<br>
          Vencimento: <strong>${data.vencimento}</strong><br>
          Valor a Pagar: <strong style="font-size: 1.2rem; color: #FF6600;">${data.valor}</strong>
        </div>
      </div>

      <div class="invoice-paper-box" style="margin-bottom: 20px;">
        <strong>PAGUE COM PIX (APROVAÇÃO INSTANTÂNEA)</strong>
        <div class="pix-copy-box" style="margin-top: 8px;">
          ${data.pixCode}
        </div>
      </div>

      <div class="invoice-paper-box">
        <strong>CÓDIGO DE BARRAS PARA BOLETO BANCÁRIO</strong>
        <div style="font-family: monospace; font-size: 0.9rem; margin-top: 6px;">
          34191.09008 61234.567890 12345.678901 8 98760000009990
        </div>
        <div class="barcode-simulated">
          ${'<div class="barcode-line"></div>'.repeat(35)}
        </div>
      </div>

      <div style="margin-top: 24px; text-align: center;">
        <button class="btn btn-primary" onclick="window.print()">
          <i class="ri-printer-line"></i> Imprimir Fatura
        </button>
      </div>
    `;

    this.invoiceModal.classList.add('active');
  }

  redirectToWhatsApp(message) {
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${this.whatsappNumber}?text=${encoded}`, '_blank');
  }

  sendInvoiceToWhatsApp() {
    const text = encodeURIComponent(`Olá, gostaria de receber a 2ª via da fatura do CPF ${this.userCpf} diretamente aqui no WhatsApp.`);
    window.open(`https://wa.me/${this.whatsappNumber}?text=${text}`, '_blank');
  }

  scrollToSection(id) {
    const section = document.getElementById(id);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth' });
      this.toggleChat(false);
    }
  }

  async showTyping(ms) {
    const typingEl = document.createElement('div');
    typingEl.className = 'typing-indicator';
    typingEl.id = 'botTyping';
    typingEl.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;
    this.messagesContainer.appendChild(typingEl);
    this.scrollToBottom();

    await new Promise(r => setTimeout(r, ms));
    const currentTyping = document.getElementById('botTyping');
    if (currentTyping) currentTyping.remove();
  }

  addBotMessage(htmlText, options = []) {
    const msgEl = document.createElement('div');
    msgEl.className = 'message bot';
    
    let optionsHtml = '';
    if (options.length > 0) {
      optionsHtml = `<div class="chat-options-group">`;
      options.forEach((opt, idx) => {
        optionsHtml += `<button class="chat-opt-btn" data-opt-idx="${idx}">${opt.text} <i class="ri-arrow-right-s-line"></i></button>`;
      });
      optionsHtml += `</div>`;
    }

    msgEl.innerHTML = `
      <div class="message-bubble">${htmlText}${optionsHtml}</div>
      <span class="message-time">${this.getCurrentTime()}</span>
    `;

    this.messagesContainer.appendChild(msgEl);

    if (options.length > 0) {
      const btns = msgEl.querySelectorAll('.chat-opt-btn');
      btns.forEach((btn, idx) => {
        btn.addEventListener('click', () => {
          options[idx].action();
        });
      });
    }

    this.scrollToBottom();
  }

  addUserMessage(text) {
    const msgEl = document.createElement('div');
    msgEl.className = 'message user';
    msgEl.innerHTML = `
      <div class="message-bubble">${text}</div>
      <span class="message-time">${this.getCurrentTime()}</span>
    `;
    this.messagesContainer.appendChild(msgEl);
    this.scrollToBottom();
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.ultraBot = new UltraBot();
});
