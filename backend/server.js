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

// Local DB configuration synced with admin panel
let dbConfig = {
    whatsappNumber: '55991183681',
    botActive: true,
    welcomeMessage: 'Olá! 👋 Sou o Ultra Bot da Ultra Fibra. Como posso te ajudar hoje?\n\n1️⃣ - Assinar um Plano\n2️⃣ - Segunda Via de Fatura\n3️⃣ - Suporte Técnico\n\nPor favor, responda digitando apenas o número da opção desejada.',
    planMessage: 'Planos de Internet Ultra Fibra disponíveis:\n\n⚡ 350 Megas - R$ 70,00/mês\n⚡ 450 Megas - R$ 85,00/mês (Canais, Filmes e Séries)\n⚡ 650 Megas - R$ 99,90/mês (★ Plano Destaque + Canais, Filmes e Séries)\n\n🤖 Estou transferindo seu atendimento para um atendente humano finalizar sua assinatura. Aguarde um instante...',
    supportMessage: 'Por favor, descreva qual o problema ou lentidão que você está enfrentando na sua conexão:',
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
                        await sock.sendMessage(from, { text: dbConfig.supportMessage || 'Como posso te ajudar no suporte?' });
                        session.step = 'AWAITING_PROBLEM';
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
                            console.log(`Efetuando chamada ao ERP para CPF: ${cleanCpf}`);
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
                                        pix: data.pix || data.copia_cola || ''
                                    };
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
                        const reply = `✅ Localizamos sua fatura em aberto!\n\n` +
                                      `👤 Titular: ${invoice.titular}\n` +
                                      `⚡ Plano: ${invoice.plano}\n` +
                                      `📅 Vencimento: ${invoice.vencimento}\n` +
                                      `💵 Valor: ${invoice.valor}\n\n` +
                                      `🔑 Código PIX Copia e Cola:\n` +
                                      `${pixKey}\n\n` +
                                      `Você pode visualizar a fatura digital no nosso site. Digite 0 para voltar ao menu inicial.`;
                        await sock.sendMessage(from, { text: reply });
                        session.step = 'INITIAL';
                    } else {
                        await sock.sendMessage(from, { text: `❌ Nenhuma fatura em aberto cadastrada para o CPF ${cleanCpf}.\n\nDigite 0 para voltar ao menu inicial.` });
                        session.step = 'INITIAL';
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
app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: qrCodeImage
    });
});

app.post('/api/config', (req, res) => {
    if (req.body) {
        dbConfig = { ...dbConfig, ...req.body };
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

app.listen(PORT, () => {
    console.log(`Backend Baileys da Ultra Fibra rodando na porta ${PORT}`);
});
