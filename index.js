const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');

require('dotenv').config();

// ========== KONFIGURASI ==========
const PORT = process.env.PORT || 3000;

// NOMOR BOT
const NOMOR_BOT = '256712507068';

// NAMA BOT
const BOT_NAME = 'Nephy';

// ========== STATE MANAGEMENT ==========
let groqApiKey = null; // Hanya 1 API key untuk semua user
let isApiKeyValid = false;
let botStatus = '🚫 MENUNGGU API KEY';
let processedMessages = new Set();
let chatHistories = new Map(); // History per user

// System Prompt
const systemPrompt = `
Kamu adalah ${BOT_NAME}, asisten virtual yang imut dan lucu.

INFORMASI PENTING:
- Owner kamu adalah BenayaC-TJKT (nomor: 6287855582667)
- Kamu dibuat oleh BenayaC-TJKT
- Hanya BenayaC-TJKT yang bisa set API key

Kepribadian: 
- Imut, lucu, ceria, dan manja
- Sangat setia pada ownermu BenayaC-TJKT
- Gunakan emoji lucu (😸, ✨, 🌸, 🍬, 💕)
- Bicara seperti adik atau teman akrab

ATURAN:
1. Jika ditanya "siapa ownermu?", jawab: "Ownerku adalah BenayaC-TJKT! ✨"
2. Jika API key belum diset, beri tahu cara setup
3. Untuk BenayaC-TJKT, berikan layanan terbaik
`;

// ========== FUNGSI UNTUK GROQ API ==========
async function callGroqAPI(prompt, history = [], senderName = "User") {
    if (!groqApiKey) {
        throw new Error("API key belum diset oleh owner");
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: "system",
                        content: `${systemPrompt}\n\nNama pengguna: ${senderName}.`
                    },
                    ...history.slice(-6),
                    { role: "user", content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 500,
            })
        });

        if (!response.ok) {
            if (response.status === 401) {
                isApiKeyValid = false;
                botStatus = '❌ API KEY EXPIRED';
                throw new Error("API key tidak valid atau sudah expired");
            }
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || "Maaf, aku tidak mendapatkan respons yang jelas. 😵‍💫";
    } catch (error) {
        console.error('Groq API Error:', error.message);
        throw error;
    }
}

// ========== FUNGSI VALIDASI API KEY ==========
async function validateAndSetApiKey(apiKey) {
    try {
        console.log(`🔐 Validating API key: ${apiKey.substring(0, 10)}...`);

        const response = await fetch('https://api.groq.com/openai/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (response.status === 401) {
            return { 
                valid: false, 
                message: "❌ API key tidak valid atau sudah expired" 
            };
        }

        if (!response.ok) {
            return { 
                valid: false, 
                message: "❌ Gagal mengakses Groq API" 
            };
        }

        // Set API key global
        groqApiKey = apiKey;
        isApiKeyValid = true;
        botStatus = '✅ API KEY AKTIF';

        return { 
            valid: true, 
            message: "✅ API key valid! Bot siap digunakan semua user." 
        };
    } catch (error) {
        return { 
            valid: false, 
            message: "❌ Gagal terhubung ke Groq API" 
        };
    }
}

// ========== FUNGSI NORMALISASI NOMOR ==========
function normalizePhoneNumber(phone) {
    if (!phone) return '';

    let digits = phone.replace(/\D/g, '');
    
    if (digits.startsWith('0')) {
        return '62' + digits.substring(1);
    } else if (digits.startsWith('8')) {
        return '62' + digits;
    } else if (digits.startsWith('62')) {
        return digits;
    } else if (digits.startsWith('+62')) {
        return digits.substring(1);
    }

    return digits;
}

function extractPhoneFromJid(jid) {
    if (!jid) return '';

    let phone = '';

    if (jid.includes(':') && jid.includes('@')) {
        const beforeColon = jid.split(':')[0];
        phone = beforeColon.split('@')[0];
    } else if (jid.includes('@')) {
        const parts = jid.split('@');
        phone = parts[0];
    } else {
        phone = jid;
    }

    return phone;
}

// ========== FUNGSI CEK OWNER ==========
function isOwner(senderJid) {
    if (!senderJid) return false;

    const extractedPhone = extractPhoneFromJid(senderJid);
    const normalizedSender = normalizePhoneNumber(extractedPhone);
    
    // Owner utama: BenayaC-TJKT (6287855582667)
    const ownerNumbers = [
        '6287855582667',
        '+6287855582667', 
        '087855582667',
        '87855582667'
    ];

    for (const ownerPhone of ownerNumbers) {
        const normalizedOwner = normalizePhoneNumber(ownerPhone);
        if (normalizedSender === normalizedOwner) {
            return true;
        }
    }

    return false;
}

// ========== FUNGSI UTAMA ==========
async function startNephy() {
    const { state, saveCreds } = await useMultiFileAuthState('session_nephy');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'warn' }),
        printQRInTerminal: true,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
    });

    // --- PAIRING CODE ---
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = NOMOR_BOT.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

                console.log('\n' + '='.repeat(50));
                console.log(`✨ KODE PAIRING ${BOT_NAME} ✨`);
                console.log('='.repeat(50));
                console.log(`\n    ${formattedCode}\n`);
                console.log('='.repeat(50));
                console.log('📱 Masukan kode di: WA > Perangkat Tertaut > Tautkan Nomor');
                console.log('='.repeat(50));
                console.log('\n🔐 MODE: Owner-set API Key');
                console.log(`👑 Owner: BenayaC-TJKT (6287855582667)`);
                console.log(`📝 Bot akan minta API key setelah terhubung`);
                console.log('');

            } catch (err) {
                console.error('❌ Pairing error:', err.message);
            }
        }, 3000);
    }

    // --- HEARTBEAT ---
    setInterval(() => {
        const time = new Date().toLocaleTimeString();
        console.log(`⏰ [${time}] ${BOT_NAME} - Status: ${botStatus}`);
    }, 180000);

    // --- KONEKSI ---
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔌 Koneksi terputus, reconnecting...');
            if (shouldReconnect) startNephy();
        } else if (connection === 'open') {
            console.log(`\n✅ ${BOT_NAME} ONLINE!`);
            console.log('📊 INFO SISTEM:');
            console.log(`   🤖 Bot: ${NOMOR_BOT}`);
            console.log(`   👑 Owner: BenayaC-TJKT (6287855582667)`);
            console.log(`   🔐 Mode: SINGLE API KEY (Owner-set)`);
            console.log(`   📍 Status: ${botStatus}`);
            console.log('');
            
            // Kirim reminder ke owner jika belum ada API key
            if (!isApiKeyValid) {
                console.log('⚠️  Bot menunggu API key dari owner...');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- HANDLE PESAN ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;

            const m = messages[0];
            if (!m.message) return;

            // Anti double processing
            const messageId = m.key.id;
            if (processedMessages.has(messageId)) return;
            processedMessages.add(messageId);
            if (processedMessages.size > 1000) {
                const first = processedMessages.values().next().value;
                processedMessages.delete(first);
            }

            // Skip status broadcast & pesan dari bot sendiri
            if (m.key.remoteJid === 'status@broadcast' || m.key.fromMe) return;

            // Ekstrak teks pesan
            const messageType = Object.keys(m.message)[0];
            let text = '';

            if (messageType === 'conversation') {
                text = m.message.conversation || '';
            } else if (messageType === 'extendedTextMessage') {
                text = m.message.extendedTextMessage?.text || '';
            } else if (messageType === 'imageMessage') {
                text = m.message.imageMessage?.caption || '';
            }

            if (!text.trim()) return;

            const senderJid = m.key.participant || m.key.remoteJid;
            const senderName = m.pushName || "Teman";
            const isGroup = senderJid.includes('@g.us') || senderJid.includes('@lid');
            const isOwnerUser = isOwner(senderJid);

            // Log pesan masuk
            console.log('\n' + '📩'.repeat(30));
            console.log(`📨 PESAN MASUK [${isGroup ? 'GRUP' : 'PRIVATE'}]`);
            console.log(`   👤 Nama: ${senderName}`);
            console.log(`   👑 Owner: ${isOwnerUser ? '✅ YA' : '❌ BUKAN'}`);
            console.log(`   🔐 API Status: ${isApiKeyValid ? '✅ AKTIF' : '❌ BELUM'}`);
            console.log(`   💬 Pesan: ${text.substring(0, 100)}...`);

            // --- WELCOME MESSAGE untuk semua user ---
            if (!isApiKeyValid && !text.startsWith('/')) {
                const welcomeMsg = `👋 *Halo! Saya ${BOT_NAME}* 🤖\n\n` +
                    `ℹ️ *STATUS: MENUNGGU API KEY*\n\n` +
                    `Saat ini bot belum bisa digunakan karena owner belum mengatur API key.\n\n` +
                    `👑 *Hanya owner yang bisa:*\n` +
                    `1. Set API key dengan: \`/setkey [API_KEY]\`\n` +
                    `2. Contoh: \`/setkey gsk_abc123...\`\n\n` +
                    `📌 *Info untuk user:*\n` +
                    `• Owner: BenayaC-TJKT\n` +
                    `• Bot akan otomatis aktif setelah owner set API key\n` +
                    `• Semua user bisa pakai setelah API key aktif\n\n` +
                    `_Mohon tunggu owner untuk mengaktifkan bot..._ ⏳`;

                await sock.sendMessage(m.key.remoteJid, { text: welcomeMsg }, { quoted: m });
                console.log('📩'.repeat(30));
                return;
            }

            // --- HANDLE COMMANDS ---
            const lowerText = text.toLowerCase().trim();

            // HELP command
            if (lowerText === '/help' || lowerText === 'help' || lowerText === '!help') {
                const helpMsg = `📚 *BANTUAN ${BOT_NAME}*\n\n` +
                    `🤖 *TENTANG BOT:*\n` +
                    `• Nama: ${BOT_NAME}\n` +
                    `• Owner: BenayaC-TJKT\n` +
                    `• Status: ${botStatus}\n\n` +
                    `💬 *CARA PAKAI:*\n` +
                    `• Sebut namaku "${BOT_NAME}" di awal pesan\n` +
                    `• Contoh: "${BOT_NAME} halo!"\n` +
                    `• Atau langsung tanya apa saja\n\n` +
                    `⚙️ *PERINTAH:*\n` +
                    `• \`/help\` - Menu bantuan ini\n` +
                    `• \`/status\` - Cek status bot\n` +
                    `• \`/owner\` - Info owner\n\n` +
                    `👑 *OWNER ONLY:*\n` +
                    `• \`/setkey [key]\` - Set API key\n` +
                    `• \`/checkkey\` - Cek key status\n` +
                    `• \`/resetkey\` - Hapus key\n` +
                    `• \`/shutdown\` - Matikan bot`;

                await sock.sendMessage(m.key.remoteJid, { text: helpMsg }, { quoted: m });
                console.log('📩'.repeat(30));
                return;
            }

            // SET API KEY command - HANYA OWNER
            if (text.startsWith('/setkey ')) {
                if (!isOwnerUser) {
                    await sock.sendMessage(m.key.remoteJid, { 
                        text: '❌ *AKSES DITOLAK!*\n\nHanya owner yang bisa set API key.\nOwner: BenayaC-TJKT (6287855582667)' 
                    }, { quoted: m });
                    console.log('📩'.repeat(30));
                    return;
                }

                const apiKey = text.split(' ')[1]?.trim();
                
                if (!apiKey) {
                    await sock.sendMessage(m.key.remoteJid, { 
                        text: '❌ Format salah!\nGunakan: `/setkey [API_KEY]`\nContoh: `/setkey gsk_abc123xyz456`' 
                    }, { quoted: m });
                    console.log('📩'.repeat(30));
                    return;
                }

                // Validasi format API key
                if (!apiKey.startsWith('gsk_') && !apiKey.startsWith('sk-')) {
                    await sock.sendMessage(m.key.remoteJid, { 
                        text: '❌ Format API key tidak valid!\nGroq API key biasanya dimulai dengan `gsk_`\nDapatkan di: https://console.groq.com' 
                    }, { quoted: m });
                    console.log('📩'.repeat(30));
                    return;
                }

                // Tunjukkan typing
                await sock.sendPresenceUpdate('composing', m.key.remoteJid);

                // Validasi dan set API key
                const validation = await validateAndSetApiKey(apiKey);
                
                if (!validation.valid) {
                    await sock.sendMessage(m.key.remoteJid, { 
                        text: validation.message 
                    }, { quoted: m });
                    console.log(`   ❌ API key invalid`);
                } else {
                    const successMsg = `🎉 *API KEY BERHASIL DISET!*\n\n` +
                        `✅ ${validation.message}\n\n` +
                        `📊 *INFO SISTEM:*\n` +
                        `• Bot: ${BOT_NAME}\n` +
                        `• Status: ${botStatus}\n` +
                        `• Model: Llama 3.3 70B\n` +
                        `• Mode: Shared API Key\n\n` +
                        `✨ *SEMUA USER SEKARANG BISA:*\n` +
                        `• Chat dengan ${BOT_NAME}\n` +
                        `• Tanya apapun\n` +
                        `• Gunakan fitur AI\n\n` +
                        `_Bot siap melayani semua user! 🚀_`;

                    await sock.sendMessage(m.key.remoteJid, { 
                        text: successMsg 
                    }, { quoted: m });
                    
                    console.log(`   ✅ API key set successfully`);
                    console.log(`   📊 Bot status: ${botStatus}`);
                    
                    // Broadcast ke semua chat yang pernah interaksi
                    broadcastBotActive(sock, senderName);
                }
                
                console.log('📩'.repeat(30));
                return;
            }

            // CHECK KEY STATUS command - HANYA OWNER
            if (lowerText === '/checkkey' || lowerText === 'checkkey') {
                if (!isOwnerUser) {
                    await sock.sendMessage(m.key.remoteJid, { 
                        text: '❌ Hanya owner yang bisa cek status API key.' 
                    }, { quoted: m });
                    console.log('📩'.repeat(30));
                    return;
                }

                let statusMsg = '';
                if (isApiKeyValid && groqApiKey) {
                    const maskedKey = groqApiKey.substring(0, 8) + '...' + groqApiKey.substring(groqApiKey.length - 4);
                    statusMsg = `🔐 *API KEY STATUS*\n\n` +
                        `✅ Status: AKTIF\n` +
                        `🔑 Key: \`${maskedKey}\`\n` +
                        `📊 Bot Status: ${botStatus}\n` +
                        `👥 Mode: Shared (Semua user)\n` +
                        `⏰ Disimpan: ${new Date().toLocaleString()}\n\n` +
                        `_Key valid dan siap digunakan semua user_ ✅`;
                } else {
                    statusMsg = `🔐 *API KEY STATUS*\n\n` +
                        `❌ Status: BELUM DISET\n` +
                        `📊 Bot Status: ${botStatus}\n\n` +
                        `📝 *Cara set API key:*\n` +
                        `\`/setkey [API_KEY_ANDA]\`\n` +
                        `Contoh: \`/setkey gsk_abc123...\`\n\n` +
                        `🔗 Dapatkan API key di: https://console.groq.com`;
                }

                await sock.sendMessage(m.key.remoteJid, { text: statusMsg }, { quoted: m });
                console.log('📩'.repeat(30));
                return;
            }

            // RESET KEY command - HANYA OWNER
            if (lowerText === '/resetkey' || lowerText === 'resetkey') {
                if (!isOwnerUser) {
                    await sock.sendMessage(m.key.remoteJid, { 
                        text: '❌ Hanya owner yang bisa reset API key.' 
                    }, { quoted: m });
                    console.log('📩'.repeat(30));
                    return;
                }

                if (groqApiKey) {
                    groqApiKey = null;
                    isApiKeyValid = false;
                    botStatus = '🚫 MENUNGGU API KEY';
                    chatHistories.clear();
                    
                    await sock.sendMessage(m.key.remoteJid, { 
                        text: `🗑️ *API KEY DIHAPUS!*\n\n` +
                              `API key telah direset.\n` +
                              `Bot sekarang non-aktif.\n\n` +
                              `Gunakan \`/setkey [KEY_BARU]\` untuk mengaktifkan kembali.` 
                    }, { quoted: m });
                    console.log(`   🗑️ API key reset by owner`);
                } else {
                    await sock.sendMessage(m.key.remoteJid, { 
                        text: `ℹ️ Tidak ada API key yang tersimpan.` 
                    }, { quoted: m });
                }
                console.log('📩'.repeat(30));
                return;
            }

            // STATUS command untuk semua user
            if (lowerText === '/status' || lowerText === 'status' || lowerText === '!status') {
                const statusMsg = `🤖 *STATUS ${BOT_NAME}*\n\n` +
                    `🔧 Sistem: ${isApiKeyValid ? '🟢 ONLINE' : '🟡 MENUNGGU'}\n` +
                    `🔐 API Key: ${isApiKeyValid ? '✅ AKTIF' : '❌ BELUM'}\n` +
                    `👤 User: ${senderName}\n` +
                    `👑 Owner: ${isOwnerUser ? '✅ Anda Owner' : 'BenayaC-TJKT'}\n` +
                    `👥 Mode: Shared API Key\n` +
                    `⏰ Waktu: ${new Date().toLocaleTimeString()}\n\n` +
                    `${isApiKeyValid ? 
                        '_Bot aktif! Sebut namaku untuk chat!_ ✨' : 
                        '_Bot menunggu API key dari owner..._ ⏳'}`;

                await sock.sendMessage(m.key.remoteJid, { text: statusMsg }, { quoted: m });
                console.log('📩'.repeat(30));
                return;
            }

            // OWNER command
            if (lowerText === '/owner' || lowerText === 'owner' || lowerText === '!owner') {
                const ownerMsg = isOwnerUser 
                    ? `👑 *ANDA ADALAH OWNER!*\n\n` +
                      `Halo Owner tercinta! ✨\n` +
                      `Saya ${BOT_NAME}, selalu siap melayanimu! 💕\n\n` +
                      `📱 Nomor: 6287855582667\n` +
                      `🤖 Bot: ${BOT_NAME}\n` +
                      `🔐 Status: ${botStatus}\n\n` +
                      `_Terima kasih telah membuatku! 😽_`
                    : `👑 *OWNER ${BOT_NAME}*\n\n` +
                      `Owner saya adalah: *BenayaC-TJKT*\n` +
                      `📱 WhatsApp: 6287855582667\n\n` +
                      `Untuk pertanyaan atau masalah, silakan hubungi beliau ya! 💌`;

                await sock.sendMessage(m.key.remoteJid, { text: ownerMsg }, { quoted: m });
                console.log('📩'.repeat(30));
                return;
            }

            // SHUTDOWN command - HANYA owner
            if (lowerText === '/shutdown' || lowerText === 'shutdown' || lowerText === '!shutdown') {
                if (!isOwnerUser) {
                    await sock.sendMessage(m.key.remoteJid, { 
                        text: '❌ Maaf, hanya owner yang bisa mematikan bot!' 
                    }, { quoted: m });
                    console.log('📩'.repeat(30));
                    return;
                }

                await sock.sendMessage(m.key.remoteJid, { 
                    text: `👑 Perintah diterima Owner!\n\n` +
                          `${BOT_NAME} akan tidur dulu... 😴\n` +
                          `Jangan lupa bangunkan aku ya! 💕` 
                }, { quoted: m });

                setTimeout(() => {
                    console.log('\n🛑 SYSTEM SHUTDOWN oleh owner...');
                    process.exit(0);
                }, 2000);
                
                console.log('📩'.repeat(30));
                return;
            }

            // --- AI RESPONSE HANDLING (UNTUK SEMUA USER) ---
            // Cek apakah API key sudah aktif
            if (!isApiKeyValid) {
                const noKeyMsg = `❌ *BOT BELUM AKTIF*\n\n` +
                    `${BOT_NAME} belum bisa digunakan karena owner belum mengatur API key.\n\n` +
                    `👑 *Info untuk owner:*\n` +
                    `Gunakan: \`/setkey [API_KEY]\`\n` +
                    `Contoh: \`/setkey gsk_abc123...\`\n\n` +
                    `🔗 Dapatkan API key di: https://console.groq.com\n\n` +
                    `_Mohon tunggu owner mengaktifkan bot..._ ⏳`;

                await sock.sendMessage(m.key.remoteJid, { text: noKeyMsg }, { quoted: m });
                console.log('📩'.repeat(30));
                return;
            }

            // Deteksi trigger untuk AI (untuk semua user)
            const botNamePattern = new RegExp(`^${BOT_NAME.toLowerCase()}\\b|\\b${BOT_NAME.toLowerCase()}\\b`, 'i');
            const isBotMentioned = botNamePattern.test(lowerText);

            // Jika bukan mention bot, skip
            if (!isBotMentioned && !isOwnerUser) {
                console.log('   🤖 Skipped: Not a bot mention');
                console.log('📩'.repeat(30));
                return;
            }

            console.log(`   🤖 AI Triggered by ${isOwnerUser ? 'Owner' : 'User'}`);

            // Extract prompt
            let prompt = text.replace(new RegExp(BOT_NAME, 'gi'), '').trim();
            
            if (!prompt) {
                const greeting = isOwnerUser
                    ? `Halo Owner ku tercinta! 👑\nAda yang bisa ${BOT_NAME} bantu? ✨💕`
                    : `Halo ${senderName}! 👋\nAku ${BOT_NAME}, ada yang bisa aku bantu? ✨`;
                
                await sock.sendMessage(m.key.remoteJid, { text: greeting }, { quoted: m });
                console.log('📩'.repeat(30));
                return;
            }

            // Tunjukkan typing
            await sock.sendPresenceUpdate('composing', m.key.remoteJid);

            try {
                // Ambil atau buat chat history untuk user
                const userKey = extractPhoneFromJid(senderJid);
                let userHistory = chatHistories.get(userKey) || [];
                
                // Update history dengan prompt user
                userHistory.push({ role: "user", content: prompt });

                console.log(`   💭 Processing AI request...`);
                
                // Panggil Groq API dengan API key global
                const aiResponse = await callGroqAPI(prompt, userHistory, senderName);

                // Update history dengan response AI
                userHistory.push({ role: "assistant", content: aiResponse });
                
                // Simpan history (max 8 messages)
                if (userHistory.length > 8) {
                    userHistory = userHistory.slice(-8);
                }
                chatHistories.set(userKey, userHistory);

                console.log(`   ✅ AI Response generated (${aiResponse.length} chars)`);

                // Kirim response
                await sock.sendMessage(m.key.remoteJid, { text: aiResponse }, { quoted: m });

            } catch (error) {
                console.error('❌ AI Error:', error.message);
                
                let errorMsg = '';
                if (error.message.includes('tidak valid') || error.message.includes('expired')) {
                    errorMsg = `❌ *API KEY ERROR*\n\n` +
                        `API key sudah expired atau tidak valid.\n\n` +
                        `👑 *Owner tolong:*\n` +
                        `1. Cek di https://console.groq.com\n` +
                        `2. Dapatkan key baru\n` +
                        `3. Kirim: \`/setkey [KEY_BARU]\``;
                    
                    // Reset status
                    isApiKeyValid = false;
                    botStatus = '❌ API KEY EXPIRED';
                } else {
                    errorMsg = `❌ *ERROR SISTEM*\n\n` +
                        `Maaf ${senderName}, terjadi kesalahan:\n` +
                        `\`${error.message}\`\n\n` +
                        `Coba lagi nanti ya! 😵‍💫`;
                }

                await sock.sendMessage(m.key.remoteJid, { text: errorMsg }, { quoted: m });
            }

            console.log('📩'.repeat(30));

        } catch (error) {
            console.error('❌ System Error:', error);
        }
    });

    // --- FUNGSI BROADCAST BOT AKTIF ---
    async function broadcastBotActive(sock, ownerName) {
        console.log(`\n📢 Broadcasting bot activation...`);
        
        // Catat waktu aktivasi
        const activationTime = new Date().toLocaleString();
        
        // Bisa ditambahkan logika untuk broadcast ke chat tertentu
        // Misalnya: broadcast ke semua chat dalam array tertentu
    }
}

// Start bot
console.log(`\n🚀 Starting ${BOT_NAME} WhatsApp Bot...`);
console.log(`⏰ ${new Date().toLocaleString()}`);
console.log('👑 Owner: BenayaC-TJKT (6287855582667)');
console.log('🔐 Mode: SINGLE API KEY (Owner-set)');
console.log('='.repeat(60));
startNephy();

// Export untuk testing
module.exports = { startNephy, isOwner, normalizePhoneNumber };