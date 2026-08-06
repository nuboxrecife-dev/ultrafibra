const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Global state variables
let qrCodeImage = '';
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, INITIALIZING, AWAITING_QR, CONNECTED

// Session state map to track dialog steps for each user JID
const sessions = new Map();

// Config file path for local persistence
const fs = require('fs');
const configFilePath = path.join(__dirname, 'config.json');

// Local DB configuration synced with admin panel
let dbConfig = {
    whatsappNumber: '55991183681',
    botActive: true,
    providerActive: true,
    providerUrl: 'https://api.asaas.com/v3',
    providerToken: Buffer.from('JGFhY3RfcHJvZF8wMDBNemt3T0RBMk1XWTJPR00zTVdSbE1EVTJOV00zTXpKbE56Wm1OR1poWkdZNk9tTTFNR0ZpTkRnNExUZ3daRGd0TkdNMlpDMWlaVGhtTFRGaVl6ZzVNelptTkRObE5UbzZKR0ZoWTJoZk0yWTRNekUxWkRjdE5UTXdOaTAwWlRZMExXRmxPREl0T0RReU56azBNMlkwT0RWawo=', 'base64').toString('utf8').trim(),
    welcomeMessage: 'Olá! 👋 Sou o Ultra Bot da Ultra Fibra. Como posso te ajudar hoje?\n\n1️⃣ - Assinar um Plano\n2️⃣ - Segunda Via de Fatura\n3️⃣ - Suporte Técnico\n\nPor favor, responda digitando apenas o número da opção desejada.',
    planMessage: 'Planos de Internet Ultra Fibra disponíveis:\n\n⚡ 350 Megas - R$ 70,00/mês\n⚡ 450 Megas - R$ 85,00/mês (Canais, Filmes e Séries)\n⚡ 650 Megas - R$ 99,90/mês (★ Plano Destaque + Canais, Filmes e Séries)\n\n🤖 Estou transferindo seu atendimento para um atendente humano finalizar sua assinatura. Aguarde um instante...',
    supportMessage: 'Descreva qual o seu problemas:\n\n"Opção 1 - Troca de Senha"\n"Opção 2 - Lentidão na Conexão"\n"Opção 3 - Mudança de Endereço"\nOpção 4 " Outros "',
    adminUsers: [
        { username: 'admin', password: 'admin123', name: 'Administrador', role: 'admin', createdAt: '2026-08-05' }
    ],
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

// Load saved config on startup if it exists
if (fs.existsSync(configFilePath)) {
    try {
        const fileContent = fs.readFileSync(configFilePath, 'utf8');
        dbConfig = { ...dbConfig, ...JSON.parse(fileContent) };
        console.log('Configurações salvas carregadas com sucesso de config.json');
    } catch (err) {
        console.error('Falha ao ler arquivo config.json:', err);
    }
}

let sock = null;

async function connectToWhatsApp() {
    connectionStatus = 'INITIALIZING';
    
    // Auth info folder setup
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '.baileys_auth'));
    
    // Create WhatsApp socket client
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Ultra Fibra Bot', 'Safari', '1.0.0']
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            connectionStatus = 'AWAITING_QR';
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    qrCodeImage = url;
                }
            });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (new Boom(lastDisconnect?.error))?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Tentando reconectar...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                connectionStatus = 'DISCONNECTED';
                qrCodeImage = '';
            }
        } else if (connection === 'open') {
            connectionStatus = 'CONNECTED';
            qrCodeImage = '';
            console.log('WhatsApp Web (Baileys) Conectado!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- MESSAGES UPSERT HANDLER ---
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const from = msg.key.remoteJid;
            const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
            
            if (!text) return;

            // Ignore if bot is deactivated in config
            if (dbConfig.botActive === false) {
                return;
            }

            // Initialize user session
            if (!sessions.has(from)) {
                sessions.set(from, { step: 'INITIAL', cpf: '' });
            }
            const session = sessions.get(from);

            // Normalize incoming text
            const cleanText = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            const greetings = ['oi', 'ola', 'hello', 'bom dia', 'boa tarde', 'boa noite', 'comecar', 'inicio', 'iniciar', 'menu', 'voltar', '0'];
            const explicitReset = ['menu', 'voltar', '0', 'comecar', 'inicio'];

            // Ignore if handover active, unless explicit reset word is received
            if (session.step === 'HUMAN_HANDOVER') {
                if (explicitReset.includes(cleanText)) {
                    session.step = 'INITIAL';
                    await sock.sendMessage(from, { text: dbConfig.welcomeMessage });
                    return;
                }
                return;
            }

            // Reset conversation and show menu if client greets the bot
            if (greetings.includes(cleanText)) {
                session.step = 'INITIAL';
                await sock.sendMessage(from, { text: dbConfig.welcomeMessage });
                return;
            }

            try {
                if (session.step === 'INITIAL') {
                    if (text === '1') {
                        await sock.sendMessage(from, { text: dbConfig.planMessage || 'Transferindo para o setor de planos...' });
                        session.step = 'HUMAN_HANDOVER';
                    } else if (text === '2') {
                        await sock.sendMessage(from, { text: `Por favor, digite o CPF cadastrado do titular da conta (apenas números):` });
                        session.step = 'AWAITING_CPF';
                    } else if (text === '3') {
                        await sock.sendMessage(from, { text: dbConfig.supportMessage || 'Por favor, selecione a opção de suporte:' });
                        session.step = 'AWAITING_SUPPORT_OPTION';
                    } else {
                        await sock.sendMessage(from, { text: dbConfig.welcomeMessage });
                    }
                } 
                
                else if (session.step === 'AWAITING_CPF') {
                    const cleanCpf = text.replace(/\D/g, '');
                    if (cleanCpf.length < 11) {
                        await sock.sendMessage(from, { text: `⚠️ CPF inválido. Por favor, digite os 11 dígitos do CPF:` });
                        return;
                    }

                    let invoice = null;

                    // Query real ERP provider API if configured
                    if (dbConfig.providerActive && dbConfig.providerUrl) {
                        try {
                            const isAsaas = dbConfig.providerUrl.includes('asaas.com');
                            if (isAsaas) {
                                console.log(`Efetuando consulta Asaas API para o CPF: ${cleanCpf}`);
                                // 1. Find customer ID by CPF/CNPJ
                                const customerUrl = `${dbConfig.providerUrl.replace(/\/$/, '')}/customers?cpfCnpj=${cleanCpf}`;
                                const customerRes = await fetch(customerUrl, {
                                    method: 'GET',
                                    headers: { 'access_token': dbConfig.providerToken }
                                });

                                if (customerRes.ok) {
                                    const customerData = await customerRes.json();
                                    if (customerData.data && customerData.data.length > 0) {
                                        const customerId = customerData.data[0].id;
                                        const customerName = customerData.data[0].name;
                                        console.log(`Cliente Asaas encontrado: ${customerName} (${customerId})`);

                                        // 2. Fetch pending payments for this customer (fetch up to 20 to find the oldest/current one)
                                        const paymentsUrl = `${dbConfig.providerUrl.replace(/\/$/, '')}/payments?customer=${customerId}&status=PENDING&limit=20`;
                                        const paymentsRes = await fetch(paymentsUrl, {
                                            method: 'GET',
                                            headers: { 'access_token': dbConfig.providerToken }
                                        });

                                        if (paymentsRes.ok) {
                                            const paymentsData = await paymentsRes.json();
                                            if (paymentsData.data && paymentsData.data.length > 0) {
                                                 const pendingPayments = paymentsData.data;
                                                 const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
                                                 
                                                 // Filter for overdue invoices (dueDate < today)
                                                 const overduePayments = pendingPayments.filter(p => p.dueDate < todayStr);
                                                 
                                                 let payment = null;
                                                 if (overduePayments.length > 0) {
                                                     // Sort overdue ascending to select the oldest one first
                                                     overduePayments.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
                                                     payment = overduePayments[0];
                                                     console.log(`Fatura em atraso selecionada: vencimento ${payment.dueDate}`);
                                                 } else {
                                                     // Filter for invoices due in the current month (YYYY-MM)
                                                     const currentYearMonth = todayStr.substring(0, 7);
                                                     const currentMonthPayments = pendingPayments.filter(p => p.dueDate.startsWith(currentYearMonth));
                                                     
                                                     if (currentMonthPayments.length > 0) {
                                                         // Sort current month ascending
                                                         currentMonthPayments.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
                                                         payment = currentMonthPayments[0];
                                                         console.log(`Fatura do mês selecionada: vencimento ${payment.dueDate}`);
                                                     } else {
                                                         // Fallback: select the next upcoming future invoice
                                                         pendingPayments.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
                                                         payment = pendingPayments[0];
                                                         console.log(`Sem faturas vencidas ou do mês. Selecionada próxima futura: vencimento ${payment.dueDate}`);
                                                     }
                                                 }
 
                                                 const paymentId = payment.id;
                                                 const value = payment.value;
                                                 const dueDate = payment.dueDate; // YYYY-MM-DD
                                                 const formattedDate = dueDate.split('-').reverse().join('/');
                                                 const description = payment.description || 'Fatura Internet Ultra Fibra';

                                                // 3. Fetch Pix Copy-and-Paste Payload
                                                const pixUrl = `${dbConfig.providerUrl.replace(/\/$/, '')}/payments/${paymentId}/pixQrCode`;
                                                const pixRes = await fetch(pixUrl, {
                                                    method: 'GET',
                                                    headers: { 'access_token': dbConfig.providerToken }
                                                });

                                                let pixKey = '';
                                                if (pixRes.ok) {
                                                    const pixData = await pixRes.json();
                                                    pixKey = pixData.payload || '';
                                                }

                                                 invoice = {
                                                     titular: customerName,
                                                     plano: description,
                                                     vencimento: formattedDate,
                                                     valor: `R$ ${value.toFixed(2).replace('.', ',')}`,
                                                     pix: pixKey,
                                                     boleto: payment.bankSlipUrl || payment.invoiceUrl || ''
                                                 };
                                            }
                                        }
                                    }
                                }
                            } else {
                                // Generic ERP API Call
                                console.log(`Efetuando chamada ao ERP genérico para CPF: ${cleanCpf}`);
                                const url = `${dbConfig.providerUrl.replace(/\/$/, '')}/fatura?cpf=${cleanCpf}`;
                                const headers = { 'Content-Type': 'application/json' };
                                if (dbConfig.providerToken) {
                                    headers['Authorization'] = `Bearer ${dbConfig.providerToken}`;
                                }

                                const response = await fetch(url, {
                                    method: 'GET',
                                    headers: headers
                                });

                                if (response.ok) {
                                    const data = await response.json();
                                    if (data && (data.valor || data.valor_fatura)) {
                                         invoice = {
                                             titular: data.titular || data.nome_cliente || 'Cliente Provedor',
                                             plano: data.plano || data.nome_plano || 'Internet Fibra Óptica',
                                             vencimento: data.vencimento || data.data_vencimento || 'A vencer',
                                             valor: data.valor || data.valor_fatura,
                                             pix: data.pix || data.copia_cola || '',
                                             boleto: data.boleto || data.link_boleto || data.bankSlipUrl || ''
                                         };
                                    }
                                }
                            }
                        } catch (err) {
                            console.error('Erro na integração do ERP:', err.message);
                        }
                    }

                    // Fallback to local simulated invoices database
                    if (!invoice) {
                        invoice = dbConfig.invoices[cleanCpf];
                    }

                    if (invoice) {
                        const pixKey = invoice.pix || '00020126580014BR.GOV.BCB.PIX013612345678-90ab-cdef-1234-567890abcdef520400005303986540599.905802BR5920ULTRA FIBRA TELECOM6009SAO PAULO62070503***6304E8A9';
                        
                        // 1. Send the details message
                        const reply = `✅ Localizamos sua fatura em aberto!\n\n` +
                                      `👤 Titular: ${invoice.titular}\n` +
                                      `⚡ Plano: ${invoice.plano}\n` +
                                      `📅 Vencimento: ${invoice.vencimento}\n` +
                                      `💵 Valor: ${invoice.valor}\n\n` +
                                      `👇 Copie o código PIX na mensagem abaixo para realizar o pagamento:`;
                        await sock.sendMessage(from, { text: reply });
                        
                        // 2. Send the raw PIX Copia e Cola code in a separate bubble
                        await sock.sendMessage(from, { text: pixKey });

                        // 3. Send the Boleto PDF link if available
                        if (invoice.boleto) {
                             const boletoMsg = `📄 *Link para baixar o Boleto em PDF:*\n${invoice.boleto}`;
                             await sock.sendMessage(from, { text: boletoMsg });
                        }
                        
                        // 4. Send the final instruction bubble
                        await sock.sendMessage(from, { text: `Você pode visualizar a fatura digital no nosso site.\n\nDigite 0 para voltar ao menu inicial.` });
                        
                        session.step = 'INITIAL';
                    } else {
                        await sock.sendMessage(from, { text: `❌ Nenhuma fatura em aberto cadastrada para o CPF ${cleanCpf}.\n\nDigite 0 para voltar ao menu inicial.` });
                        session.step = 'INITIAL';
                    }
                } 
                
                else if (session.step === 'AWAITING_SUPPORT_OPTION') {
                    if (text === '2') {
                        // Option 2: Lentidão na Conexão → Send Speedtest link
                        const speedMsg = `📡 *Teste de Velocidade da sua Conexão*\n\nPara verificar a velocidade da sua internet, acesse o link abaixo:\n\n[Speedtest by Ookla - Teste de Velocidade de Conexão da Internet] (https://www.speedtest.net/pt)\n\nApós o teste, caso o resultado esteja abaixo do contratado, entre em contato novamente que iremos te ajudar! 😊\n\nDigite 0 para voltar ao menu inicial.`;
                        await sock.sendMessage(from, { text: speedMsg });
                        session.step = 'INITIAL';
                    } else if (text === '1' || text === '3' || text === '4') {
                        // Options 1, 3, 4 → Human handover
                        const labels = { '1': 'Troca de Senha', '3': 'Mudança de Endereço', '4': 'Outros' };
                        const topic = labels[text] || 'Suporte';
                        const reply = `🤖 Entendido! Registramos sua solicitação: *${topic}*.\n\nUm atendente especializado irá prosseguir com o seu atendimento a partir de agora. Por favor, aguarde um instante... ⏳`;
                        await sock.sendMessage(from, { text: reply });
                        session.step = 'HUMAN_HANDOVER';
                    } else {
                        await sock.sendMessage(from, { text: `⚠️ Opção inválida. Por favor, responda com 1, 2, 3 ou 4.\n\n${dbConfig.supportMessage}` });
                    }
                }
                
                else if (session.step === 'AWAITING_PROBLEM') {
                    const reply = `🤖 Entendido. Registrei sua ocorrência: "${text}".\n\nUm técnico de suporte especializado irá prosseguir com o seu atendimento manualmente a partir de agora. Por favor, aguarde...`;
                    await sock.sendMessage(from, { text: reply });
                    session.step = 'HUMAN_HANDOVER';
                }
            } catch (err) {
                console.error('Erro ao enviar mensagem:', err);
            }
        }
    });
}

// --- API ENDPOINTS ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = dbConfig.adminUsers || [];
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ success: true, token: 'session_token_secure_ultrafibra_2026', name: user.name, role: user.role });
    } else {
        res.status(401).json({ success: false, message: 'Usuário ou senha incorretos' });
    }
});

// --- USER MANAGEMENT ENDPOINTS ---
app.get('/api/users', (req, res) => {
    const users = (dbConfig.adminUsers || []).map(u => ({ username: u.username, name: u.name, role: u.role, createdAt: u.createdAt }));
    res.json({ success: true, users });
});

app.post('/api/users', (req, res) => {
    const { username, password, name, role } = req.body;
    if (!username || !password || !name) return res.status(400).json({ success: false, message: 'Campos obrigatórios: username, password, name' });
    if (!dbConfig.adminUsers) dbConfig.adminUsers = [];
    if (dbConfig.adminUsers.find(u => u.username === username)) return res.status(409).json({ success: false, message: 'Usuário já existe' });
    const newUser = { username, password, name, role: role || 'admin', createdAt: new Date().toISOString().split('T')[0] };
    dbConfig.adminUsers.push(newUser);
    try { fs.writeFileSync(configFilePath, JSON.stringify(dbConfig, null, 2), 'utf8'); } catch(e) {}
    res.json({ success: true, user: { username: newUser.username, name: newUser.name, role: newUser.role, createdAt: newUser.createdAt } });
});

app.put('/api/users/:username', (req, res) => {
    const { username } = req.params;
    const { password, name, role } = req.body;
    if (!dbConfig.adminUsers) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    const idx = dbConfig.adminUsers.findIndex(u => u.username === username);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    if (name) dbConfig.adminUsers[idx].name = name;
    if (role) dbConfig.adminUsers[idx].role = role;
    if (password) dbConfig.adminUsers[idx].password = password;
    try { fs.writeFileSync(configFilePath, JSON.stringify(dbConfig, null, 2), 'utf8'); } catch(e) {}
    res.json({ success: true });
});

app.delete('/api/users/:username', (req, res) => {
    const { username } = req.params;
    if (!dbConfig.adminUsers) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    if (dbConfig.adminUsers.length === 1) return res.status(400).json({ success: false, message: 'Não é possível excluir o último usuário' });
    dbConfig.adminUsers = dbConfig.adminUsers.filter(u => u.username !== username);
    try { fs.writeFileSync(configFilePath, JSON.stringify(dbConfig, null, 2), 'utf8'); } catch(e) {}
    res.json({ success: true });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: qrCodeImage
    });
});

app.post('/api/config', (req, res) => {
    if (req.body) {
        // Bloqueia a mensagem antiga se vier do cache de algum navegador
        if (req.body.supportMessage && req.body.supportMessage.includes('descreva qual o problema ou lentidão')) {
            delete req.body.supportMessage;
        }
        dbConfig = { ...dbConfig, ...req.body };
        // Save to file persistently
        try {
            fs.writeFileSync(configFilePath, JSON.stringify(dbConfig, null, 2), 'utf8');
            console.log('Configurações salvas de forma persistente em config.json');
        } catch (err) {
            console.error('Erro ao gravar arquivo config.json:', err);
        }
    }
    res.json({ success: true, config: dbConfig });
});

app.get('/api/config', (req, res) => {
    res.json(dbConfig);
});

app.post('/api/disconnect', async (req, res) => {
    const fs = require('fs');
    try {
        console.log('Solicitação de desconexão recebida.');
        if (sock) {
            await sock.logout().catch(() => {});
            sock.end();
            sock = null;
        }
    } catch (err) {
        console.log('Nota ao encerrar socket:', err.message);
    }
    
    // Clear credentials folder to allow new QR generation
    const authDir = path.join(__dirname, '.baileys_auth');
    try {
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log('Pasta de credenciais .baileys_auth removida.');
        }
    } catch (err) {
        console.error('Erro ao limpar pasta de credenciais:', err);
    }

    connectionStatus = 'DISCONNECTED';
    qrCodeImage = '';
    
    // Start a fresh connection wait
    connectToWhatsApp().catch(err => console.error("Erro ao reiniciar wweb socket:", err));
    
    res.json({ success: true });
});

// Run client connection
connectToWhatsApp().catch(err => console.error("Erro ao rodar o wweb socket:", err));

// --- SELF PINGER TO PREVENT RENDER SLEEP ---
function startSelfPinger() {
    // Ping every 5 minutes (300,000 ms)
    setInterval(() => {
        const https = require('https');
        console.log('Realizando self-ping para manter o bot ativo...');
        https.get('https://ultrafibra.onrender.com/api/status', (res) => {
            console.log(`Self-ping response status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error('Self-ping error:', err.message);
        });
    }, 5 * 60 * 1000);
}
startSelfPinger();

app.listen(PORT, () => {
    console.log(`Backend Baileys da Ultra Fibra rodando na porta ${PORT}`);
});
