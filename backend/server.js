const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Global state variables
let qrCodeImage = '';
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, GENERATING_QR, AWAITING_QR, CONNECTED
let clientName = '';

// Session state map to track dialog steps for each user phone number
const sessions = new Map();

// Local DB fallback for invoices matching the admin configurations
let dbConfig = {
    whatsappNumber: '55991183681',
    welcomeMessage: 'Olá! 👋 Sou o Ultra Bot da Ultra Fibra. Como posso te ajudar hoje?\n\n1 - Assinar um Plano\n2 - Segunda Via de Fatura\n3 - Suporte Técnico\n\nResponda apenas com o número da opção desejada.',
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

// Initialize WhatsApp Client with Local Session Authentication
const puppeteerOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
};
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: puppeteerOptions
});

connectionStatus = 'INITIALIZING';

client.on('qr', (qr) => {
    connectionStatus = 'AWAITING_QR';
    QRCode.toDataURL(qr, (err, url) => {
        if (!err) {
            qrCodeImage = url;
        }
    });
    console.log('QR Code recebido. Pronto para escaneamento no Painel Admin!');
});

client.on('ready', () => {
    connectionStatus = 'CONNECTED';
    qrCodeImage = '';
    console.log('WhatsApp Web conectado com sucesso!');
});

client.on('disconnected', (reason) => {
    connectionStatus = 'DISCONNECTED';
    console.log('WhatsApp Web desconectado:', reason);
});

// --- CHATBOT MESSAGE ROUTING ENGINE ---
client.on('message', async (msg) => {
    const from = msg.from;
    const text = msg.body.trim();

    // Ignore group chats
    if (from.includes('@g.us')) return;

    // Get or initialize user session step
    if (!sessions.has(from)) {
        sessions.set(from, { step: 'INITIAL', cpf: '' });
    }
    const session = sessions.get(from);

    // If user is in handover state, ignore messages (stops responding)
    if (session.step === 'HUMAN_HANDOVER') {
        console.log(`Mensagem ignorada para ${from} (Handover Ativo).`);
        return;
    }

    try {
        if (session.step === 'INITIAL') {
            if (text === '1') {
                // Flow 1: Assinar um Plano
                const reply = `Planos de Internet Ultra Fibra:\n\n` +
                              `⚡ 350 Megas - R$ 70,00/mês\n` +
                              `⚡ 450 Megas - R$ 85,00/mês (Canais, Filmes e Séries)\n` +
                              `⚡ 650 Megas - R$ 99,90/mês (★ Plano Destaque + Canais, Filmes e Séries)\n\n` +
                              `🤖 Estou transferindo você para um atendente humano agora mesmo para concluir sua assinatura. Aguarde um instante...`;
                await client.sendMessage(from, reply);
                session.step = 'HUMAN_HANDOVER';
            } else if (text === '2') {
                // Flow 2: Segunda Via de Fatura
                await client.sendMessage(from, `Por favor, digite o CPF cadastrado do titular da conta (apenas números):`);
                session.step = 'AWAITING_CPF';
            } else if (text === '3') {
                // Flow 3: Suporte Técnico
                await client.sendMessage(from, `Por favor, descreva qual o problema ou lentidão que você está enfrentando na sua conexão:`);
                session.step = 'AWAITING_PROBLEM';
            } else {
                // Send Welcome Menu
                await client.sendMessage(from, dbConfig.welcomeMessage);
            }
        } 
        
        else if (session.step === 'AWAITING_CPF') {
            const cleanCpf = text.replace(/\D/g, '');
            if (cleanCpf.length < 11) {
                await client.sendMessage(from, `⚠️ CPF inválido. Por favor, digite os 11 dígitos do CPF:`);
                return;
            }

            const invoice = dbConfig.invoices[cleanCpf];
            if (invoice) {
                const reply = `✅ Localizamos sua fatura em aberto!\n\n` +
                              `👤 Titular: ${invoice.titular}\n` +
                              `⚡ Plano: ${invoice.plano}\n` +
                              `📅 Vencimento: ${invoice.vencimento}\n` +
                              `💵 Valor: ${invoice.valor}\n\n` +
                              `🔑 Código PIX Copia e Cola:\n` +
                              `00020126580014BR.GOV.BCB.PIX013612345678-90ab-cdef-1234-567890abcdef520400005303986540599.905802BR5920ULTRA FIBRA TELECOM6009SAO PAULO62070503***6304E8A9\n\n` +
                              `Você pode visualizar a fatura digital no nosso site. Digite 0 para voltar ao menu inicial.`;
                await client.sendMessage(from, reply);
                session.step = 'INITIAL';
            } else {
                await client.sendMessage(from, `❌ Nenhuma fatura em aberto cadastrada para o CPF ${cleanCpf}.\n\nDigite 0 para voltar ao menu inicial.`);
                session.step = 'INITIAL';
            }
        } 
        
        else if (session.step === 'AWAITING_PROBLEM') {
            const reply = `🤖 Entendido. Registrei sua ocorrência: "${text}".\n\nUm técnico de suporte especializado irá prosseguir com o seu atendimento manualmente a partir de agora. Por favor, aguarde...`;
            await client.sendMessage(from, reply);
            session.step = 'HUMAN_HANDOVER';
        }
    } catch (err) {
        console.error('Erro no envio de mensagem:', err);
    }
});

// --- API ENDPOINTS FOR THE ADMIN PANEL ---
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

// Start client connection
client.initialize().catch(err => console.error("Erro na inicialização do wwebjs:", err));

// Start server listening
app.listen(PORT, () => {
    console.log(`Backend Ultra Fibra rodando na porta ${PORT}`);
});
