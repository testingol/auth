const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs').promises;
const readline = require('readline');
const qrcode = require('qrcode-terminal');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

class AuthGenerator {
    constructor() {
        this.sessionDir = './auth_session';
        this.authFile = './auth_info.txt';
    }

    async start() {
        console.log('\n🚀 WhatsApp Auth Generator\n');
        
        // Create session directory if it doesn't exist
        await fs.mkdir(this.sessionDir, { recursive: true });
        
        rl.question('Choose auth method:\n1. QR Code\n2. Pairing Code\nEnter (1/2): ', async (choice) => {
            if (choice === '1') {
                await this.generateQRAuth();
            } else if (choice === '2') {
                rl.question('\nEnter phone number (with country code, eg: +1234567890): ', async (number) => {
                    await this.generatePairingAuth(number.trim());
                });
            } else {
                console.log('❌ Invalid choice!');
                rl.close();
                process.exit(1);
            }
        });
    }

    async generateQRAuth() {
        try {
            console.log('\n📱 Generating QR code...');
            const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
            
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: true,
                browser: ['Auth Generator', 'Chrome', '1.0.0'],
                logger: require('pino')({ level: 'silent' })
            });

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if(qr) {
                    // Display QR in a more visible way
                    qrcode.generate(qr, { small: true });
                    console.log('\n⚡ Scan the QR code above with WhatsApp\n');
                }

                if(connection === 'open') {
                    await this.handleSuccess(sock, state.creds, saveCreds);
                }

                if(connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error instanceof Boom) && 
                        lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
                    
                    if(!shouldReconnect) {
                        console.log('\n❌ Connection closed!');
                        process.exit(0);
                    }
                }
            });

        } catch (error) {
            console.error('\n❌ Error in QR auth:', error);
            process.exit(1);
        }
    }

    async generatePairingAuth(number) {
        try {
            if(!number.startsWith('+')) {
                console.log('\n❌ Phone number must start with + and country code');
                process.exit(1);
            }

            console.log('\n📱 Generating pairing code...');
            const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
            
            const sock = makeWASocket({
                auth: state,
                browser: ['Auth Generator', 'Chrome', '1.0.0'],
                logger: require('pino')({ level: 'silent' })
            });

            const code = await sock.requestPairingCode(number);
            console.log('\n🔑 Your pairing code:', code);
            console.log('\n⚡ Enter this code in your WhatsApp app\n');

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                
                if(connection === 'open') {
                    await this.handleSuccess(sock, state.creds, saveCreds);
                }

                if(connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error instanceof Boom) && 
                        lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
                    
                    if(!shouldReconnect) {
                        console.log('\n❌ Connection closed!');
                        process.exit(0);
                    }
                }
            });

        } catch (error) {
            console.error('\n❌ Error in pairing auth:', error);
            process.exit(1);
        }
    }

    async handleSuccess(sock, creds, saveCreds) {
        try {
            await saveCreds();
            
            // Generate base64 auth
            const base64Auth = Buffer.from(JSON.stringify(creds)).toString('base64');
            
            // Save to file
            await fs.writeFile(this.authFile, base64Auth);
            
            // Send to WhatsApp
            await sock.sendMessage(sock.user.id, {
                text: `🔐 Your Auth Code:\n\n${base64Auth}\n\n⚠️ Keep this safe and do not share!`
            });

            console.log('\n✅ Authentication successful!');
            console.log('📱 Phone Number:', sock.user.id.split(':')[0]);
            console.log('📁 Auth code saved to:', this.authFile);
            console.log('💬 Auth code also sent to your WhatsApp');
            console.log('\n⚡ You can now use this auth code in your projects\n');
            
            process.exit(0);
        } catch (error) {
            console.error('\n❌ Error saving auth:', error);
            process.exit(1);
        }
    }
}

// Start the generator
new AuthGenerator().start(); 